import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { EXPERTISE_MAX, PERSONALITY_STYLE, PersonalitySchema } from "@0run/shared";
import { db } from "@/db";
import { coaches } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { canDecrypt, decryptJson } from "@/lib/crypto/aes";
import { downloadDecrypted } from "@/lib/zerog/storage";
import { updateRegistry, toBytes32 } from "@/lib/zerog/contracts";
import { parseMemory, prepareMemoryCommit, setExpertise } from "@/lib/coach/memory";
import { commitMemory, MEMORY_CONFLICT } from "@/lib/coach/commit";
import { setTextRecord } from "@/lib/ens/subname";

const SITE_URL = (process.env.SITE_URL ?? "https://0run.fun").replace(/\/$/, "");

const Body = z.object({
  // An empty string is a valid intention: "I don't want to say anything about
  // this coach any more". Only whitespace collapses to the same thing.
  expertise: z.string().max(EXPERTISE_MAX),
  // The brief lives inside the encrypted memory (memory.coach.expertise), and
  // only the athlete's key opens it — same per-request trust model as the chat
  // route: derived client-side from a wallet signature, never persisted here.
  userKeyHex: z.string().regex(/^[0-9a-f]{64}$/i, "userKeyHex deve essere 64 caratteri esadecimali (32 byte)"),
});

/** Kept identical to the mint route's, so an edited brief reads like a minted one. */
function coachDescription(name: string, personality: string, expertise?: string): string {
  const style = PERSONALITY_STYLE[PersonalitySchema.parse(personality)];
  return [
    `${name} — ${style}`,
    expertise ? `Knows: ${expertise}` : "",
    "An AI running coach owned by one athlete on 0run; its memory is encrypted and only that athlete can read it.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Rewrites the coach's brief — what it knows, in its athlete's own words.
 *
 * The brief exists in four places, and all four move together or the coach
 * starts contradicting itself: the encrypted memory (the source, which is what
 * the model actually reads), the profile layer a stranger consulting this coach
 * gets, the plaintext column the public pages render, and the coach's ENS
 * `description`. The first three are written in one transaction-shaped step
 * here; ENS is best-effort, because it is a write to another chain and must
 * never make editing a sentence fail.
 */
export async function PATCH(req: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const brief = parsed.data.expertise.trim();
  const userKey = Buffer.from(parsed.data.userKeyHex, "hex");

  try {
    const [coach] = await db.select().from(coaches).where(eq(coaches.userId, user.userId));
    if (!coach) return NextResponse.json({ error: "nessun coach da modificare" }, { status: 404 });
    if (!coach.tokenId) {
      return NextResponse.json({ error: "il mint di questo coach non è ancora confermato" }, { status: 409 });
    }

    let memoryCipherText: string;
    if (coach.memoryCipher) {
      memoryCipherText = coach.memoryCipher;
    } else {
      const dl = await downloadDecrypted(coach.memoryRoot, userKey, (b) => canDecrypt(b.toString("utf8"), userKey));
      if (!dl.ok) return NextResponse.json({ error: dl.error }, { status: 502 });
      memoryCipherText = dl.data.toString("utf8");
    }

    let memory;
    try {
      memory = parseMemory(decryptJson(memoryCipherText, userKey, z.unknown()));
    } catch {
      // Same convention as /api/health-data: a key that cannot open this
      // envelope is an honest 400, not a 500 quoting node's crypto internals
      // back at the athlete inside their own coach page.
      return NextResponse.json({ error: "impossibile decifrare la memoria (chiave errata?)" }, { status: 400 });
    }

    // Hash locally, write, answer — then upload. Waiting for 0G Storage inside
    // the request can outlast the proxy, and the athlete would read "could not
    // save" for an edit the server went on to save.
    const commit = await prepareMemoryCommit(setExpertise(memory, brief), userKey);
    const committed = await commitMemory(user.userId, coach.memoryRoot, commit, { expertise: brief || null });
    if (!committed) return NextResponse.json(MEMORY_CONFLICT, { status: 409 });

    commit
      .upload()
      .then((receipts) => console.log("brief: background memory upload settled", receipts))
      .catch((e) => console.error("brief: background memory upload crashed", e));

    // The memory changed, so its on-chain anchor must change with it — or
    // coaches.memoryRoot, published as this coach's "memory fingerprint",
    // starts disagreeing with what CoachRegistry holds and anyone who checks
    // concludes the fingerprint is made up. Reported, never swallowed: unlike a
    // run, editing a sentence may never be followed by anything that re-anchors.
    let registryTx: string | null = null;
    let anchorError: string | null = null;
    try {
      registryTx = await updateRegistry(coach.tokenId, toBytes32(commit.memoryRoot), toBytes32(commit.profileRoot));
    } catch (e) {
      anchorError = e instanceof Error ? e.message : String(e);
      console.error("brief: on-chain memory anchor failed", e);
    }

    // ENS last and best-effort: a Sepolia write must never be the reason an
    // athlete cannot edit a sentence about their own coach.
    let ensTx: string | null = null;
    let ensError: string | null = null;
    // A coach whose ENS assignment has not landed yet has no name to write to.
    // Reported as skipped rather than passed over in silence: the record will
    // keep publishing the old description until the name exists, and the mint's
    // own background step reads the CURRENT brief when it finally runs.
    let ensSkipped: string | null = coach.ensName
      ? null
      : "questo coach non ha ancora un nome ENS: la description verrà scritta quando il nome viene assegnato";
    // Re-saving the same words must not send a transaction: the ENS wallet is
    // shared by every coach on this deployment, and an unbounded, user-repeatable
    // write is how it runs out of Sepolia ETH and stops assigning names at all.
    const briefUnchanged = (coach.expertise ?? "") === brief;
    if (briefUnchanged) ensSkipped = "brief invariato: nessuna scrittura ENS necessaria";
    if (coach.ensName && !briefUnchanged) {
      const result = await setTextRecord(
        coach.ensName,
        "description",
        coachDescription(coach.name, coach.personality, brief || undefined),
      );
      if ("error" in result) {
        ensError = result.error;
        console.error("brief: ENS description not updated", result.error);
      } else {
        ensTx = result.txHash;
      }
    }

    return NextResponse.json({
      expertise: brief || null,
      registryTx,
      anchored: registryTx !== null,
      anchorError,
      ens: ensSkipped ? { name: coach.ensName, skipped: ensSkipped } : { name: coach.ensName, txHash: ensTx, error: ensError },
      url: `${SITE_URL}/coach/${coach.tokenId}`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

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
import { parseMemory, persistMemory, setExpertise } from "@/lib/coach/memory";
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

    const memory = parseMemory(decryptJson(memoryCipherText, userKey, z.unknown()));
    const receipts = await persistMemory(setExpertise(memory, brief), userKey);
    if (!receipts.memory.ok || !receipts.profile.ok) {
      const reason = !receipts.memory.ok ? receipts.memory.error : (receipts.profile as { error: string }).error;
      return NextResponse.json({ error: `brief non salvato: ${reason}` }, { status: 502 });
    }

    // The memory changed, so its on-chain anchor must change with it. Not fatal:
    // the next run re-anchors.
    let registryTx: string | null = null;
    try {
      registryTx = await updateRegistry(
        coach.tokenId,
        toBytes32(receipts.memory.rootHash),
        toBytes32(receipts.profile.rootHash),
      );
    } catch (e) {
      console.error("brief: on-chain memory anchor failed, will re-anchor on the next run", e);
    }

    await db
      .update(coaches)
      .set({
        expertise: brief || null,
        memoryRoot: receipts.memory.rootHash,
        profileRoot: receipts.profile.rootHash,
        memoryCipher: receipts.memoryCipher,
      })
      .where(eq(coaches.userId, user.userId));

    // ENS last and best-effort: a Sepolia write must never be the reason an
    // athlete cannot edit a sentence about their own coach.
    let ensTx: string | null = null;
    let ensError: string | null = null;
    if (coach.ensName) {
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
      ens: coach.ensName ? { name: coach.ensName, txHash: ensTx, error: ensError } : null,
      url: `${SITE_URL}/coach/${coach.tokenId}`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

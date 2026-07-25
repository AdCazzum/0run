import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { z } from "zod";
import { PersonalitySchema, initialMemory, explorerTx } from "@0run/shared";
import { requireUser } from "@/lib/auth";
import { encryptJson } from "@/lib/crypto/aes";
import { serviceKey } from "@/lib/crypto/keys";
import { checkHumanBacking } from "@/lib/world/gate";
import { prepareEncryptedUpload } from "@/lib/zerog/storage";
import { mintCoachOnChain, updateRegistry, toBytes32 } from "@/lib/zerog/contracts";
import { registerAgent } from "@/lib/erc8004/register";
import { assignSubname, slugifyLabel } from "@/lib/ens/subname";
import { a2aAccount } from "@/lib/a2a/protocol";
import { buildAvatarPrompt, generateAvatar } from "@/lib/avatar/generate";
import { db } from "@/db";
import { coaches } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const Body = z.object({
  name: z.string().min(1).max(40),
  personality: PersonalitySchema,
  // Buffer.from(hex, "hex") silently truncates/ignores invalid characters
  // instead of throwing, so a malformed key would previously derive a
  // shorter-than-expected (or wrong) AES key instead of failing loudly.
  // Require exactly 32 bytes of hex up front.
  userKeyHex: z.string().regex(/^[0-9a-f]{64}$/i, "userKeyHex deve essere 64 caratteri esadecimali (32 byte)"),
});

// Chain calls (mint + registry update) are seconds in practice — see
// docs/0g-reality-check.md, both txs on Galileo confirmed with negligible
// cost. Storage upload is the slow, sometimes-unbounded part and is
// deliberately NOT part of this budget (see startBackgroundUpload below).
// nginx cuts proxied requests at 300s; budget well under that so the route
// can respond honestly instead of the connection dying silently.
const MINT_BUDGET_MS = 90_000;

// A reservation older than this with its placeholders still in place cannot be a
// live mint any more (the budget above is the longest a request can hold one), so
// the next attempt reclaims it. Without this, a process kill between reserving and
// finalizing locked the user out of minting permanently, with no recovery path.
const STALE_RESERVATION_MS = MINT_BUDGET_MS * 3;

// Where this deployment answers. It ends up written into ENS text records and
// the ERC-8004 registry — both permanent, both read by other people's software
// — so it is configurable rather than hardcoded per environment.
const SITE_URL = (process.env.SITE_URL ?? "https://0run.fun").replace(/\/$/, "");

/**
 * The name of the constraint a unique violation broke, or null if the error is
 * anything else.
 *
 * drizzle wraps driver errors (`DrizzleQueryError`), keeping the pg error — the
 * only place `code` and `constraint` actually live — on `.cause`, so the chain
 * has to be walked. Everything that is not code 23505 must fall through and
 * become a 500: an infrastructure failure that gets translated into a business
 * answer is worse than a crash, because nobody goes looking for it.
 */
function uniqueViolation(e: unknown): string | null {
  for (let cur: any = e; cur; cur = cur.cause) {
    if (cur.code === "23505") return typeof cur.constraint === "string" ? cur.constraint : "";
  }
  return null;
}

type MintOutcome =
  | { status: "mint_failed"; error: string }
  | { status: "registry_failed"; tokenId: string; txHash: string; error: string }
  | { status: "ok"; tokenId: string; txHash: string };

async function runMint(
  wallet: string, dataDescription: string, dataHash: string, memoryRoot: string, profileRoot: string,
): Promise<MintOutcome> {
  let minted: { tokenId: string; txHash: string };
  try {
    minted = await mintCoachOnChain(wallet, dataDescription, dataHash);
  } catch (e: any) {
    return { status: "mint_failed", error: e.message ?? String(e) };
  }
  // Point of no return: the NFT now exists on-chain. Any failure from here
  // on must NOT be treated the same as a pre-mint failure (see the
  // reservation-cleanup comment in POST below) — that's exactly the
  // double-mint bug this whole reservation exists to close.
  try {
    await updateRegistry(minted.tokenId, toBytes32(memoryRoot), toBytes32(profileRoot));
  } catch (e: any) {
    return { status: "registry_failed", tokenId: minted.tokenId, txHash: minted.txHash, error: e.message ?? String(e) };
  }
  return { status: "ok", tokenId: minted.tokenId, txHash: minted.txHash };
}

export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }

  // A non-JSON body previously made req.json() throw before zod validation
  // ever ran, surfacing as an uncaught 500 instead of an honest 400.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { name, personality, userKeyHex } = parsed.data;
  const userKey = Buffer.from(userKeyHex, "hex");

  // Resolve everything that can fail on configuration BEFORE reserving. serviceKey()
  // throws synchronously when SERVICE_ENC_KEY is missing or malformed; doing it after
  // the reservation left an orphaned row that made every later attempt answer 409
  // forever, so a one-line env mistake became a permanent per-user lockout.
  let svcKey: Buffer;
  try {
    svcKey = serviceKey();
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "configurazione server non valida" }, { status: 500 });
  }

  // Resolved BEFORE the reservation, like every other thing that can refuse the
  // request — a refusal after reserving is how you strand a row and lock someone
  // out permanently, which has already happened twice in this route's history.
  // The gate's scope and its two honest limits live in lib/world/gate.ts.
  const gate = await checkHumanBacking(user.wallet);
  if (!gate.ok) return gate.response;
  const humanId = gate.humanId;

  try {
    // Reserve BEFORE minting on-chain. coaches.userId is unique, so this
    // INSERT ... ON CONFLICT DO NOTHING is the atomic gate: of any number of
    // concurrent requests for the same user, only one can ever win it — the
    // same pattern used for the gas-funding cap (commit 7e568d3). Empty
    // strings in the not-null tokenId/mintTx/memoryRoot/profileRoot columns
    // are the placeholder: a coaches row with an empty tokenId means
    // "reserved, mint not yet confirmed" — never "minted with an empty id".
    // A conflict on coaches.userId means "this account already has one" and is
    // handled below. A conflict on coaches.humanId means "this PERSON already has
    // one, under some other account" — that is the whole point of the gate, and
    // Postgres raises it as a unique violation rather than returning no rows, so
    // it has to be caught here or it surfaces as an opaque 500.
    type Reservation = { rows: { id: number }[]; humanConflict?: false } | { rows: []; humanConflict: true };
    const insertReservation = async (): Promise<Reservation> => {
      try {
        const rows = await db
          .insert(coaches)
          .values({ userId: user.userId, tokenId: "", name, personality, memoryRoot: "", profileRoot: "", mintTx: "", humanId })
          .onConflictDoNothing({ target: coaches.userId })
          .returning({ id: coaches.id });
        return { rows };
      } catch (e) {
        // Identified by the constraint Postgres actually names, NOT by looking
        // for "human_id" in the message: drizzle rethrows every failure wrapped
        // in an error whose message is the full SQL text, and that text always
        // lists the human_id column. A substring test therefore reported a
        // connection reset, a deadlock or a statement timeout as "you already
        // own a coach" — a made-up answer to a real outage, with no 5xx anywhere.
        if (uniqueViolation(e) === "coaches_human_id_unique") return { rows: [], humanConflict: true };
        throw e;
      }
    };
    /**
     * A human_id conflict means some row already claims this person. That row may
     * be a real coach — or a dead reservation left by a killed process, in which
     * case refusing outright locks the person out of EVERY account they own,
     * forever: the reclaim path below keys on userId, so it never even looks at a
     * row created by a different account of the same human.
     *
     * Reclaiming here is safe in a way it would not be elsewhere: the row that
     * conflicted belongs to the same human by definition, so this frees the
     * person's own dead reservation and opens no sybil path.
     */
    const resolveHumanConflict = async (): Promise<Reservation | NextResponse> => {
      const [owner] = humanId
        ? await db.select().from(coaches).where(eq(coaches.humanId, humanId))
        : [];
      const isUnconfirmed = !!owner && owner.tokenId === "" && owner.mintTx === "";
      const ageMs = owner ? Date.now() - owner.reservedAt.getTime() : 0;

      if (isUnconfirmed && ageMs > STALE_RESERVATION_MS && humanId) {
        console.warn(`mint: reclaiming stale reservation held by human ${humanId} (age ${ageMs}ms)`);
        await db.delete(coaches).where(and(eq(coaches.humanId, humanId), eq(coaches.tokenId, "")));
        const retried = await insertReservation();
        if (!retried.humanConflict) return retried;
      }

      if (isUnconfirmed) {
        return NextResponse.json(
          { error: "un mint è già in corso per questa persona, riprova tra poco", mintInProgressForMs: ageMs },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          error: "questa persona possiede già un coach: un umano verificato, un solo agente",
          reason: "human_already_owns_a_coach",
          tokenId: owner?.tokenId,
        },
        { status: 409 },
      );
    };

    let reserved = await insertReservation();
    if (reserved.humanConflict) {
      const outcome = await resolveHumanConflict();
      if (outcome instanceof NextResponse) return outcome;
      reserved = outcome;
    }
    if (reserved.rows.length === 0) {
      const [existing] = await db.select().from(coaches).where(eq(coaches.userId, user.userId));
      const isUnconfirmed = !!existing && existing.tokenId === "" && existing.mintTx === "";
      const ageMs = existing ? Date.now() - existing.reservedAt.getTime() : 0;

      if (isUnconfirmed && ageMs > STALE_RESERVATION_MS) {
        // Reclaim a dead reservation. Both placeholders must still be empty: a row
        // whose mint confirmed always carries a tokenId, so this can never delete a
        // real coach. Residual risk, accepted and logged: if the database became
        // unreachable in the instant between a confirmed on-chain mint and the
        // finalize update, this reclaim allows a second mint. A rare extra NFT beats
        // a user permanently unable to mint.
        console.warn(`mint: reclaiming stale reservation for user ${user.userId} (age ${ageMs}ms)`);
        await db.delete(coaches).where(and(eq(coaches.userId, user.userId), eq(coaches.tokenId, "")));
        reserved = await insertReservation();
        if (reserved.humanConflict) {
          const outcome = await resolveHumanConflict();
          if (outcome instanceof NextResponse) return outcome;
          reserved = outcome;
        }
      }

      if (reserved.rows.length === 0) {
        // Three states used to answer with the same message, which hid the real
        // situation from the user and from anyone debugging through the API.
        if (isUnconfirmed) {
          return NextResponse.json(
            { error: "un mint è già in corso per questo account, riprova tra poco", mintInProgressForMs: ageMs },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { error: "coach già mintato", tokenId: existing?.tokenId, mintTx: existing?.mintTx },
          { status: 409 },
        );
      }
    }

    const abandonReservation = async () => {
      // Scoped to the unconfirmed placeholder so it can never delete a minted coach.
      await db.delete(coaches).where(and(eq(coaches.userId, user.userId), eq(coaches.tokenId, "")));
    };

    // Everything between reserving and the chain call must be covered: any throw here
    // used to escape to the outer catch, which does not clean up, stranding the row.
    let memCt: string;
    let memPrep: Awaited<ReturnType<typeof prepareEncryptedUpload>>;
    let profPrep: Awaited<ReturnType<typeof prepareEncryptedUpload>>;
    let profileCipher = "";
    try {
      const { memory, profile } = initialMemory(name, personality);
      memCt = encryptJson(memory, userKey);
      const profCt = encryptJson(profile, svcKey);
      profileCipher = profCt;
      const enc = (s: string) => new TextEncoder().encode(s);

      // Roots are computed LOCALLY — pure merkle-tree math over the already
      // AES-encrypted bytes, no network call — so the on-chain commitment
      // never has to wait for the slow (sometimes 20+ minute, sometimes
      // never-returning) 0G Storage upload. See docs/0g-reality-check.md and
      // the prepareEncryptedUpload doc comment in lib/zerog/storage.ts.
      [memPrep, profPrep] = await Promise.all([
        prepareEncryptedUpload(enc(memCt), userKey),
        prepareEncryptedUpload(enc(profCt), svcKey),
      ]);
    } catch (e: any) {
      // Nothing has touched the chain yet — the reservation is dead weight.
      await abandonReservation();
      return NextResponse.json({ error: e.message ?? "impossibile preparare la memoria cifrata" }, { status: 500 });
    }

    const dataDescription = `0g://storage/${memPrep.rootHash}`;
    const dataHash = ethers.keccak256(ethers.toUtf8Bytes(memPrep.rootHash));

    // Fires the real Storage uploads in the background, never awaited by
    // the response. A failed upload is logged, never thrown: the on-chain
    // rootHash is already the durable commitment, and memoryCipher (below)
    // is the DB cache that keeps the app usable regardless of Storage
    // propagation delay.
    const startBackgroundUpload = () => {
      Promise.all([memPrep.upload(), profPrep.upload()])
        .then(([memReceipt, profReceipt]) => {
          if (!memReceipt.ok) console.error("mint: background memory upload failed", memReceipt.error);
          else console.log("mint: background memory upload ok", memReceipt.txHash);
          if (!profReceipt.ok) console.error("mint: background profile upload failed", profReceipt.error);
          else console.log("mint: background profile upload ok", profReceipt.txHash);
        })
        .catch((e) => console.error("mint: background upload crashed", e));
    };

    // Fires the ERC-8004 IdentityRegistry registration in the background, same
    // lane as startBackgroundUpload above: it is a bonus identity on top of an
    // already-minted, already-usable coach, so it must never slow down or fail
    // the mint response. registerAgent() itself never throws (see
    // lib/erc8004/register.ts), but the DB write around it still needs its own
    // try/catch — a crash there must not take down the background task queue.
    // The page at this URL may not exist yet; the URI is recorded as-is
    // regardless, same as any ERC-721 tokenURI pointing at a page that ships later.
    const startBackgroundRegistration = (tokenId: string) => {
      registerAgent(tokenId, `${SITE_URL}/coach/${tokenId}`)
        .then(async (result) => {
          if ("error" in result) {
            console.error("mint: background ERC-8004 registration failed", result.error);
            return;
          }
          console.log("mint: background ERC-8004 registration ok", result.agentId, result.txHash);
          await db.update(coaches).set({ agentId: result.agentId }).where(eq(coaches.userId, user.userId));
        })
        .catch((e) => console.error("mint: background ERC-8004 registration crashed", e));
    };

    // Fires the ENS subname assignment in the background, same lane as the two
    // above: ENS lives on Sepolia — a different network from the coach's own
    // chain, reachable only over its own (sometimes slow) RPC — so it can
    // never slow down or fail the mint. assignSubname() itself never throws
    // (see lib/ens/subname.ts, same receipt discipline as registerAgent).
    const startBackgroundEns = (tokenId: string) => {
      const label = slugifyLabel(name, tokenId);
      assignSubname(label, user.wallet, {
        tokenId,
        endpoint: `${SITE_URL}/coach/${tokenId}`,
        avatar: `${SITE_URL}/api/coach/${tokenId}/avatar`,
        a2aEndpoint: `${SITE_URL}/api/coach/${tokenId}/a2a`,
        signer: a2aAccount()?.address ?? null,
      })
        .then(async (result) => {
          if ("error" in result) {
            console.error("mint: background ENS assignment failed", result.error);
            return;
          }
          console.log("mint: background ENS assignment ok", result.name, result.txHash);
          await db.update(coaches).set({ ensName: result.name }).where(eq(coaches.userId, user.userId));
        })
        .catch((e) => console.error("mint: background ENS assignment crashed", e));
    };

    // Fires the avatar generation in the background, same lane as the three
    // above: 0G Compute answers in about a second, but it is still a network
    // call on someone else's schedule and a coach without a face is a working
    // coach. generateAvatar() never throws (see lib/avatar/generate.ts).
    const startBackgroundAvatar = (tokenId: string) => {
      generateAvatar(buildAvatarPrompt(name, personality, tokenId))
        .then(async (result) => {
          if (!result.ok) {
            console.error("mint: background avatar generation failed", result.error);
            return;
          }
          console.log(
            `mint: background avatar ok (job ${result.jobId}, tee ${result.teeVerified}, cost ${result.costWei ?? "?"} wei)`,
          );
          await db
            .update(coaches)
            .set({
              avatarImage: result.pngBase64,
              avatarModel: result.model,
              avatarVerifiedTee: result.teeVerified ? "true" : "false",
            })
            .where(eq(coaches.userId, user.userId));
        })
        .catch((e) => console.error("mint: background avatar generation crashed", e));
    };

    const finalizeMinted = async (tokenId: string, txHash: string) => {
      // Writing tokenId here is also what takes the row out of reach of the stale
      // reclaim above, so it must be part of this single update, never a later one.
      await db.update(coaches)
        .set({ tokenId, mintTx: txHash, memoryRoot: memPrep.rootHash, profileRoot: profPrep.rootHash, memoryCipher: memCt, profileCipher })
        .where(eq(coaches.userId, user.userId));
      startBackgroundUpload();
      startBackgroundRegistration(tokenId);
      startBackgroundEns(tokenId);
      startBackgroundAvatar(tokenId);
    };

    const mintPromise = runMint(user.wallet, dataDescription, dataHash, memPrep.rootHash, profPrep.rootHash);

    const raced = await Promise.race([
      mintPromise,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), MINT_BUDGET_MS)),
    ]);

    if (raced === "timeout") {
      // Don't cancel mintPromise — it may still land (see doc comment
      // above), and we cannot safely delete the reservation without
      // knowing the outcome (that could enable a double mint). Let it
      // settle in the background and finalize/abandon then; the client
      // gets an honest 504 now instead of nginx killing the connection at
      // 300s with no explanation.
      mintPromise
        .then(async (outcome) => {
          if (outcome.status === "mint_failed") return abandonReservation();
          return finalizeMinted(outcome.tokenId, outcome.txHash);
        })
        .catch((e) => console.error("mint: late settlement crashed", e));
      return NextResponse.json(
        { error: "il mint on-chain sta impiegando più del previsto (>90s); riprova tra poco" },
        { status: 504 },
      );
    }

    if (raced.status === "mint_failed") {
      // The mint itself never confirmed — no NFT exists, so it's safe to
      // free the reservation for a clean retry.
      await abandonReservation();
      return NextResponse.json({ error: raced.error }, { status: 502 });
    }

    // From here the NFT is real on-chain (mintCoachOnChain succeeded) —
    // never delete the reservation again, only update it.
    await finalizeMinted(raced.tokenId, raced.txHash);

    if (raced.status === "registry_failed") {
      return NextResponse.json(
        { error: `coach mintato (token ${raced.tokenId}) ma la registry non è stata aggiornata: ${raced.error}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ tokenId: raced.tokenId, mintTx: raced.txHash, explorerUrl: explorerTx(raced.txHash) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

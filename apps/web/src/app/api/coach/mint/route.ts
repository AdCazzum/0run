import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { z } from "zod";
import { PersonalitySchema, initialMemory, explorerTx } from "@0run/shared";
import { requireUser } from "@/lib/auth";
import { encryptJson } from "@/lib/crypto/aes";
import { serviceKey } from "@/lib/crypto/keys";
import { prepareEncryptedUpload } from "@/lib/zerog/storage";
import { mintCoachOnChain, updateRegistry, toBytes32 } from "@/lib/zerog/contracts";
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

  try {
    // Reserve BEFORE minting on-chain. coaches.userId is unique, so this
    // INSERT ... ON CONFLICT DO NOTHING is the atomic gate: of any number of
    // concurrent requests for the same user, only one can ever win it — the
    // same pattern used for the gas-funding cap (commit 7e568d3). Empty
    // strings in the not-null tokenId/mintTx/memoryRoot/profileRoot columns
    // are the placeholder: a coaches row with an empty tokenId means
    // "reserved, mint not yet confirmed" — never "minted with an empty id".
    const insertReservation = () =>
      db
        .insert(coaches)
        .values({ userId: user.userId, tokenId: "", name, personality, memoryRoot: "", profileRoot: "", mintTx: "" })
        .onConflictDoNothing({ target: coaches.userId })
        .returning({ id: coaches.id });

    let reserved = await insertReservation();
    if (reserved.length === 0) {
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
      }

      if (reserved.length === 0) {
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
    try {
      const { memory, profile } = initialMemory(name, personality);
      memCt = encryptJson(memory, userKey);
      const profCt = encryptJson(profile, svcKey);
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

    const finalizeMinted = async (tokenId: string, txHash: string) => {
      // Writing tokenId here is also what takes the row out of reach of the stale
      // reclaim above, so it must be part of this single update, never a later one.
      await db.update(coaches)
        .set({ tokenId, mintTx: txHash, memoryRoot: memPrep.rootHash, profileRoot: profPrep.rootHash, memoryCipher: memCt })
        .where(eq(coaches.userId, user.userId));
      startBackgroundUpload();
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

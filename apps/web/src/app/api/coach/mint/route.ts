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
import { eq } from "drizzle-orm";

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

  try {
    // Reserve BEFORE minting on-chain. coaches.userId is unique, so this
    // INSERT ... ON CONFLICT DO NOTHING is the atomic gate: of any number of
    // concurrent requests for the same user, only one can ever win it — the
    // same pattern used for the gas-funding cap (commit 7e568d3). Empty
    // strings in the not-null tokenId/mintTx/memoryRoot/profileRoot columns
    // are the placeholder: a coaches row with an empty tokenId means
    // "reserved, mint not yet confirmed" — never "minted with an empty id".
    const reserved = await db
      .insert(coaches)
      .values({ userId: user.userId, tokenId: "", name, personality, memoryRoot: "", profileRoot: "", mintTx: "" })
      .onConflictDoNothing({ target: coaches.userId })
      .returning({ id: coaches.id });
    if (reserved.length === 0) {
      return NextResponse.json({ error: "coach già mintato" }, { status: 409 });
    }

    const abandonReservation = async () => {
      await db.delete(coaches).where(eq(coaches.userId, user.userId));
    };

    const { memory, profile } = initialMemory(name, personality);
    const memCt = encryptJson(memory, userKey);
    const profCt = encryptJson(profile, serviceKey());
    const enc = (s: string) => new TextEncoder().encode(s);

    // Roots are computed LOCALLY — pure merkle-tree math over the already
    // AES-encrypted bytes, no network call — so the on-chain commitment
    // never has to wait for the slow (sometimes 20+ minute, sometimes
    // never-returning) 0G Storage upload. See docs/0g-reality-check.md and
    // the prepareEncryptedUpload doc comment in lib/zerog/storage.ts.
    let memPrep: Awaited<ReturnType<typeof prepareEncryptedUpload>>;
    let profPrep: Awaited<ReturnType<typeof prepareEncryptedUpload>>;
    try {
      [memPrep, profPrep] = await Promise.all([
        prepareEncryptedUpload(enc(memCt), userKey),
        prepareEncryptedUpload(enc(profCt), serviceKey()),
      ]);
    } catch (e: any) {
      // Local hashing failed before any chain call — the reservation is
      // dead weight, free it for a clean retry.
      await abandonReservation();
      return NextResponse.json({ error: e.message ?? "impossibile calcolare i rootHash" }, { status: 500 });
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

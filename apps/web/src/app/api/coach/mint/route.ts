import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { z } from "zod";
import { PersonalitySchema, initialMemory, explorerTx } from "@0run/shared";
import { requireUser } from "@/lib/auth";
import { persistMemory } from "@/lib/coach/memory";
import { mintCoachOnChain, updateRegistry } from "@/lib/zerog/contracts";
import { db } from "@/db";
import { coaches } from "@/db/schema";
import { eq } from "drizzle-orm";

const Body = z.object({ name: z.string().min(1).max(40), personality: PersonalitySchema, userKeyHex: z.string().length(64) });

// 0G Storage rootHashes are already 32-byte hex, so zeroPadValue is a no-op
// on real data. It DOES throw on anything that isn't valid BytesLike (e.g.
// the short mock rootHashes used in tests, or any future non-hex root
// representation) — fall back to the raw value rather than 500ing the mint.
function toBytes32(value: string): string {
  try {
    return ethers.zeroPadValue(value, 32);
  } catch {
    return value;
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const { name, personality, userKeyHex } = parsed.data;

    const existing = await db.select().from(coaches).where(eq(coaches.userId, user.userId));
    if (existing.length) return NextResponse.json({ error: "coach già mintato" }, { status: 409 });

    const { memory } = initialMemory(name, personality);
    const receipts = await persistMemory(memory, Buffer.from(userKeyHex, "hex"));
    if (!receipts.memory.ok || !receipts.profile.ok)
      return NextResponse.json({ error: "0G Storage non disponibile, riprova" }, { status: 502 });

    const dataDescription = `0g://storage/${receipts.memory.rootHash}`;
    const dataHash = ethers.keccak256(ethers.toUtf8Bytes(receipts.memory.rootHash));
    const { tokenId, txHash } = await mintCoachOnChain(user.wallet, dataDescription, dataHash);
    await updateRegistry(tokenId, toBytes32(receipts.memory.rootHash), toBytes32(receipts.profile.rootHash));

    await db.insert(coaches).values({
      userId: user.userId, tokenId, name, personality,
      memoryRoot: receipts.memory.rootHash, profileRoot: receipts.profile.rootHash, mintTx: txHash,
    }).returning();

    return NextResponse.json({ tokenId, mintTx: txHash, explorerUrl: explorerTx(txHash) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { topUpIfNeeded } from "@/lib/funder";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, lt, sql } from "drizzle-orm";

const FUNDING_CAP = 3; // lifetime top-ups per user (0.09 OG max per user)

export async function POST(req: Request) {
  try {
    const { userId, wallet } = await requireUser(req);

    // Reserve a slot atomically BEFORE calling topUpIfNeeded. topUpIfNeeded
    // awaits on-chain confirmation (seconds), so a plain read-then-check
    // gate would let concurrent requests all read the same pre-increment
    // fundedCount and all pass (TOCTOU). This conditional UPDATE only
    // succeeds if fundedCount is still below the cap at write time, so
    // only one of N concurrent requests can claim each slot.
    const reserved = await db
      .update(users)
      .set({ fundedCount: sql`${users.fundedCount} + 1` })
      .where(and(eq(users.id, userId), lt(users.fundedCount, FUNDING_CAP)))
      .returning({ fundedCount: users.fundedCount });

    if (reserved.length === 0) {
      return NextResponse.json({ error: "funding cap reached" }, { status: 429 });
    }

    let result: Awaited<ReturnType<typeof topUpIfNeeded>>;
    try {
      result = await topUpIfNeeded(wallet);
    } catch (e: any) {
      // topUpIfNeeded threw after we already reserved the slot: we can't
      // tell whether the on-chain send went through before it failed, so
      // we conservatively burn the reserved slot rather than risk
      // decrementing on a transfer that actually landed.
      return NextResponse.json({ error: e.message ?? "funding failed" }, { status: 502 });
    }

    if (!result.funded) {
      // Wallet already had gas — return the unused reserved slot.
      await db
        .update(users)
        .set({ fundedCount: sql`${users.fundedCount} - 1` })
        .where(eq(users.id, userId));
    }

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

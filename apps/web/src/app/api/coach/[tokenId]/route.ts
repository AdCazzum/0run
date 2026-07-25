import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { coaches, runs } from "@/db/schema";

/**
 * Public identity of a coach agent — no auth, and deliberately no private data:
 * no run details, no stats, no memory, nothing derived from the athlete's traces.
 * This is what the ERC-8004 registry's agentURI and the ENS `agent-endpoint[web]`
 * record resolve to, so it has to be readable by anyone (a registry crawler, a
 * judge following the on-chain link) while revealing only what the owner has
 * already published on-chain.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ error: "tokenId non valido" }, { status: 400 });
  }

  const [coach] = await db.select().from(coaches).where(eq(coaches.tokenId, tokenId));
  // An empty tokenId row is only a mint reservation, and it can never match a
  // numeric lookup — but a missing coach must read as absent, not as an error.
  if (!coach) return NextResponse.json({ error: "coach non trovato" }, { status: 404 });

  const [runCount] = await db
    .select({ value: count() })
    .from(runs)
    .where(eq(runs.userId, coach.userId));

  return NextResponse.json({
    tokenId: coach.tokenId,
    name: coach.name,
    personality: coach.personality,
    mintTx: coach.mintTx,
    // The memory root is a hash, publishing it reveals nothing and lets anyone
    // check that what is anchored on-chain matches what we claim.
    memoryRoot: coach.memoryRoot,
    runsRead: runCount?.value ?? 0,
  });
}

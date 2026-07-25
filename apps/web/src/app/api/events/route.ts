import { NextResponse } from "next/server";
import { count, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { claims, events } from "@/db/schema";
import { createEventOnChain } from "@/lib/world/runEvents";
import { explorerTx } from "@0run/shared";

/**
 * Public feed — anyone can read it, no auth. Permissionless by design (see
 * POST below): the count here is "how many distinct World-ID-verified
 * humans claimed this", never "how many people attended".
 */
export async function GET() {
  const rows = await db.select().from(events).orderBy(desc(events.startsAt));
  const withCounts = await Promise.all(
    rows.map(async (e) => {
      const [c] = await db.select({ value: count() }).from(claims).where(eq(claims.eventId, e.id));
      return { ...e, claimCount: c?.value ?? 0 };
    }),
  );
  return NextResponse.json({ events: withCounts });
}

/**
 * Creates an event. Deliberately open to any logged-in user (requireUser is
 * only "you have an account", not a permission gate) — the plan's whole
 * point is that events are permissionless, and the sybil resistance lives in
 * the CLAIM path (World ID), not here. See lib/world/runEvents.ts for why
 * the on-chain `creator` ends up being the treasury address regardless of
 * who called this route, and why that's fine for creation but would be
 * unsafe for claim().
 */
export async function POST(req: Request) {
  try {
    const { userId } = await requireUser(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }

    const { name, startsAt, endsAt, uri } = body as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    const starts = Number(startsAt);
    const ends = Number(endsAt);
    if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) {
      return NextResponse.json({ error: "invalid startsAt/endsAt (unix seconds, endsAt > startsAt)" }, { status: 400 });
    }
    const uriValue = typeof uri === "string" ? uri : "";

    let onchain: { onchainId: string; txHash: string };
    try {
      onchain = await createEventOnChain(name.trim(), starts, ends, uriValue);
    } catch (e: any) {
      return NextResponse.json({ error: e.message ?? "on-chain createEvent failed" }, { status: 502 });
    }

    const [row] = await db
      .insert(events)
      .values({
        onchainId: onchain.onchainId,
        creatorUserId: userId,
        name: name.trim(),
        startsAt: new Date(starts * 1000),
        endsAt: new Date(ends * 1000),
        uri: uriValue || null,
        txHash: onchain.txHash,
      })
      .returning();

    return NextResponse.json({ ...row, explorerUrl: explorerTx(onchain.txHash) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

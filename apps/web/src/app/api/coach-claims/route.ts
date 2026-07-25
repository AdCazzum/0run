import { NextResponse } from "next/server";
import { humanCoachEnabled } from "@/lib/features";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { coachClaims } from "@/db/schema";
import { verifyWorldProof, type WorldIdKitResult } from "@/lib/world/verify";
import { coachClaimSignal } from "@/lib/world/signal";

/**
 * Self-declared coach claim (Piano B, Task 5; docs/superpowers/specs/
 * 2026-07-25-real-coach-spec.md). World ID proves a unique real human, never
 * a qualified coach — this route only ever turns a successful proof into a
 * "coach · autodichiarato" (self-declared) row, nothing stronger. There is
 * no on-chain step and no two-phase reservation: unlike the event claim
 * (which must reserve a nullifier BEFORE a client-side tx confirms, and so
 * needs a reclaim path for abandoned reservations — see
 * api/events/[id]/claim/route.ts), this claim is fully decided server-side
 * in one request, so the row is written only after `verifyWorldProof`
 * succeeds. There's nothing to abandon and nothing to reclaim.
 *
 * Order, mirroring the event claim route: requireUser → recompute the
 * signal (coach-claim:<wallet>, never trust a client-supplied one) →
 * verifyWorldProof (strict) → persist.
 */
export async function POST(req: Request) {
  // Hidden feature (see lib/features.ts): a hidden section must not stay callable.
  // The POST paths here spend treasury gas and write on-chain, so "not linked in
  // the UI" is not enough — the endpoint itself has to be closed.
  if (!humanCoachEnabled()) return NextResponse.json({ error: "funzione non attiva" }, { status: 404 });

  try {
    const { userId, wallet } = await requireUser(req);

    const body = await req.json().catch(() => null);
    const idkitResult = body?.idkitResult as WorldIdKitResult | undefined;
    if (!idkitResult) return NextResponse.json({ error: "missing idkitResult" }, { status: 400 });

    const signal = coachClaimSignal(wallet);
    const verified = await verifyWorldProof(idkitResult, signal);
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 401 });

    // Atomic insert: ON CONFLICT DO NOTHING with NO target catches EITHER
    // unique constraint on this table — userId (one claim per account) OR
    // nullifierHash (anti-replay, the real defense against the same
    // World-verified human claiming twice) — in a single statement. No
    // separate check-then-write window: that TOCTOU shape is exactly what
    // was fixed twice already elsewhere in this codebase (funding slot
    // reservation, event-claim reservation).
    const inserted = await db.insert(coachClaims).values({ userId, nullifierHash: verified.nullifierHash }).onConflictDoNothing().returning();

    if (inserted.length === 0) {
      const [existing] = await db.select().from(coachClaims).where(eq(coachClaims.userId, userId));
      if (existing) {
        return NextResponse.json({ error: "already claimed", claimedAt: existing.claimedAt }, { status: 409 });
      }
      return NextResponse.json({ error: "questa proof è già stata usata per un altro claim" }, { status: 409 });
    }

    return NextResponse.json({ ok: true, claimedAt: inserted[0].claimedAt });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

/** Whether the caller has already self-declared as a coach. */
export async function GET(req: Request) {
  // Hidden feature (see lib/features.ts): a hidden section must not stay callable.
  // The POST paths here spend treasury gas and write on-chain, so "not linked in
  // the UI" is not enough — the endpoint itself has to be closed.
  if (!humanCoachEnabled()) return NextResponse.json({ error: "funzione non attiva" }, { status: 404 });

  try {
    const { userId } = await requireUser(req);
    const [row] = await db.select().from(coachClaims).where(eq(coachClaims.userId, userId));
    return NextResponse.json({ claimed: !!row, claimedAt: row?.claimedAt ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

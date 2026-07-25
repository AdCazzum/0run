import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { claims, events } from "@/db/schema";
import { verifyWorldProof, type WorldIdKitResult } from "@/lib/world/verify";
import { claimSignal } from "@/lib/world/signal";
import { signClaim } from "@/lib/world/runEvents";

async function loadEvent(idParam: string) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await db.select().from(events).where(eq(events.id, id));
  return row ?? null;
}

/**
 * Phase 1 of a claim: verify the World ID proof, reserve the nullifier, and
 * hand back a backend co-signature. Order matters (Piano B, Task 2, Step 4):
 * requireUser → recompute the signal → verifyWorldProof (strict) → reserve
 * the nullifier in Postgres (the UNIQUE(eventId, nullifierHash) constraint
 * is the real anti-replay defense, not this route's own logic) → co-sign.
 *
 * This route deliberately does NOT submit RunEvents.claim() itself — see the
 * long comment on lib/world/runEvents.ts#signClaim for why the transaction
 * has to be sent by the claimant's own wallet. The client sends it (funded
 * via /api/fund) and then calls PATCH below to record the tx hash.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, wallet } = await requireUser(req);
    const { id } = await params;
    const event = await loadEvent(id);
    if (!event) return NextResponse.json({ error: "event not found" }, { status: 404 });

    const now = Date.now();
    if (now < event.startsAt.getTime() || now > event.endsAt.getTime()) {
      return NextResponse.json({ error: "claim window closed" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const idkitResult = body?.idkitResult as WorldIdKitResult | undefined;
    if (!idkitResult) return NextResponse.json({ error: "missing idkitResult" }, { status: 400 });

    const signal = claimSignal(event.onchainId, wallet);
    const verified = await verifyWorldProof(idkitResult, signal);
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 401 });

    const inserted = await db
      .insert(claims)
      .values({ eventId: event.id, userId, nullifierHash: verified.nullifierHash, txHash: null })
      .onConflictDoNothing({ target: [claims.eventId, claims.nullifierHash] })
      .returning();
    if (inserted.length === 0) {
      return NextResponse.json({ error: "already claimed" }, { status: 409 });
    }

    const backendSig = await signClaim(event.onchainId, wallet, verified.nullifierHash);
    return NextResponse.json({
      backendSig,
      nullifierHash: verified.nullifierHash,
      onchainEventId: event.onchainId,
      contractAddress: process.env.RUN_EVENTS_ADDRESS,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

/**
 * Phase 2: the client has just submitted RunEvents.claim() itself (its own
 * wallet was msg.sender, as it must be) and confirmed it — record the tx
 * hash on the reserved claims row so the crew list can link to it.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser(req);
    const { id } = await params;
    const event = await loadEvent(id);
    if (!event) return NextResponse.json({ error: "event not found" }, { status: 404 });

    const body = await req.json().catch(() => null);
    const nullifierHash = body?.nullifierHash;
    const txHash = body?.txHash;
    if (typeof nullifierHash !== "string" || typeof txHash !== "string" || !txHash) {
      return NextResponse.json({ error: "missing nullifierHash/txHash" }, { status: 400 });
    }

    const updated = await db
      .update(claims)
      .set({ txHash })
      .where(and(eq(claims.eventId, event.id), eq(claims.userId, userId), eq(claims.nullifierHash, nullifierHash)))
      .returning();
    if (updated.length === 0) return NextResponse.json({ error: "reserved claim not found" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

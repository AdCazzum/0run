import { NextResponse } from "next/server";
import { eventsEnabled } from "@/lib/features";
import { and, eq, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { claims, events } from "@/db/schema";
import { verifyWorldProof, type WorldIdKitResult } from "@/lib/world/verify";
import { claimSignal } from "@/lib/world/signal";
import { signClaim } from "@/lib/world/runEvents";

// A claim reservation only lives between "World ID verified" and "the claimant's
// wallet confirmed the on-chain tx". Generous enough for someone fumbling a wallet
// prompt, short enough that an abandoned attempt does not lock them out of the event.
const STALE_UNCONFIRMED_CLAIM_MS = 10 * 60_000;

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
  // Hidden feature (see lib/features.ts): a hidden section must not stay callable.
  // The POST paths here spend treasury gas and write on-chain, so "not linked in
  // the UI" is not enough — the endpoint itself has to be closed.
  if (!eventsEnabled()) return NextResponse.json({ error: "funzione non attiva" }, { status: 404 });

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

    const insertReservation = () =>
      db
        .insert(claims)
        .values({ eventId: event.id, userId, nullifierHash: verified.nullifierHash, txHash: null })
        .onConflictDoNothing({ target: [claims.eventId, claims.nullifierHash] })
        .returning();

    let inserted = await insertReservation();
    if (inserted.length === 0) {
      const [existing] = await db
        .select()
        .from(claims)
        .where(and(eq(claims.eventId, event.id), eq(claims.nullifierHash, verified.nullifierHash)));

      // The row is only a reservation until the claimant's wallet confirms the tx.
      // If they abandoned the wallet prompt (or the tab died) the reservation would
      // otherwise 409 them out of this event forever — the same permanent-lockout
      // shape already fixed on the mint reservation. Reclaim it, but ONLY for the
      // same user: letting anyone else take over an unconfirmed nullifier would
      // reopen exactly the sybil path the nullifier exists to close.
      const isOwnUnconfirmed = !!existing && existing.txHash === null && existing.userId === userId;
      const ageMs = existing ? Date.now() - existing.createdAt.getTime() : 0;

      if (isOwnUnconfirmed && ageMs > STALE_UNCONFIRMED_CLAIM_MS) {
        await db.delete(claims).where(and(eq(claims.id, existing.id), isNull(claims.txHash)));
        inserted = await insertReservation();
      }

      if (inserted.length === 0) {
        if (existing?.txHash) {
          return NextResponse.json(
            { error: "already claimed", txHash: existing.txHash },
            { status: 409 },
          );
        }
        return NextResponse.json(
          {
            error: isOwnUnconfirmed
              ? "un claim è già in corso: conferma la transazione nel wallet, oppure riprova tra qualche minuto"
              : "questa proof è già stata usata per questo evento",
            claimInProgressForMs: isOwnUnconfirmed ? ageMs : undefined,
          },
          { status: 409 },
        );
      }
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
  // Hidden feature (see lib/features.ts): a hidden section must not stay callable.
  // The POST paths here spend treasury gas and write on-chain, so "not linked in
  // the UI" is not enough — the endpoint itself has to be closed.
  if (!eventsEnabled()) return NextResponse.json({ error: "funzione non attiva" }, { status: 404 });

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

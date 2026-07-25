/**
 * Canonical signal string for a World ID event claim.
 *
 * Non-negotiable (Piano B, Task 2): the World ID signal is `hash(eventId +
 * claimant wallet)`, computed with the SAME formula on the client (when
 * opening the IDKit widget, see app/events/[id]/claim-widget.tsx) and on the
 * server (see lib/world/verify.ts, which recomputes it and rejects a
 * mismatch). If the two ever diverged, a proof minted for one claim could be
 * replayed against a different one — this function is the single source of
 * truth for the string that gets hashed, so there's exactly one place that
 * formula can drift.
 *
 * `eventId` here is the RunEvents ON-CHAIN id (decimal string), not our own
 * DB row id — the wallet is lowercased so a checksum/lowercase mismatch
 * between IDKit and our own address handling never breaks the binding.
 */
export function claimSignal(onchainEventId: string | number, wallet: string): string {
  return `${onchainEventId}:${wallet.toLowerCase()}`;
}

/**
 * Signal for the self-declared coach claim (Piano B, Task 5). Its own
 * distinct, constant string per wallet — never `${eventId}:${wallet}` — so a
 * proof requested for THIS claim cannot be replayed as (or from) an event
 * claim: verify.ts recomputes this exact string server-side and strictly
 * rejects any signal_hash mismatch, so the two proof requests are
 * cryptographically bound to different contexts.
 *
 * Caveat, stated honestly rather than glossed over: this is signal-level
 * separation, not action-level. World's nullifier_hash is derived from
 * (app_id, action, identity) — it does NOT depend on the signal — so if the
 * coach claim ends up reusing the same World action as the event claim (see
 * the fallback in components/crew/coach-badge.tsx, used only when a
 * dedicated action hasn't been created in the World Developer Portal), a
 * given human's coach-claim nullifier can be numerically identical to their
 * event-claim nullifier. That's harmless for OUR anti-replay — coachClaims
 * has its own UNIQUE(nullifierHash) in its own table — but it is not the
 * same as a disjoint nullifier value space. See the Task 5 report for why a
 * second action id was not invented and hard-coded on a guess.
 */
export function coachClaimSignal(wallet: string): string {
  return `coach-claim:${wallet.toLowerCase()}`;
}

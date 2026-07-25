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

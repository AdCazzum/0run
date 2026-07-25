/**
 * RunEvents ABI fragment, kept in its own file (no `ethers`/env imports) so
 * it can be safely imported from a "use client" component — the claim
 * widget needs it to encode the `claim(...)` calldata it sends from the
 * claimant's own wallet (see app/events/[id]/claim-widget.tsx and the long
 * comment on lib/world/runEvents.ts#signClaim for why that has to be the
 * claimant's wallet, not the backend). Source of truth:
 * contracts/contracts/RunEvents.sol.
 */
export const RUN_EVENTS_ABI = [
  "function createEvent(string name, uint64 startsAt, uint64 endsAt, string uri) returns (uint256 eventId)",
  "function claim(uint256 eventId, bytes32 nullifierHash, bytes backendSig)",
  "function hasClaimed(uint256 eventId, address who) view returns (bool)",
  "function claimantsOf(uint256 eventId) view returns (address[])",
  "event EventCreated(uint256 indexed eventId, address indexed creator, string name)",
  "event Claimed(uint256 indexed eventId, address indexed claimant, bytes32 nullifierHash)",
] as const;

import { ethers } from "ethers";
import { GALILEO } from "@0run/shared";
import { RUN_EVENTS_ABI } from "./runEventsAbi";

export { RUN_EVENTS_ABI };

function provider() {
  return new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl);
}

function treasurySigner() {
  return new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, provider());
}

export const runEvents = () =>
  new ethers.Contract(process.env.RUN_EVENTS_ADDRESS!, RUN_EVENTS_ABI, treasurySigner());

/**
 * Creates the event on-chain, submitted by the treasury wallet — like every
 * other on-chain write in this codebase (mint, registry update, ERC-8004
 * register). Because RunEvents.createEvent has no separate `creator`
 * parameter, the on-chain `creator` field ends up being the treasury address
 * for every event, not the actual user who requested it in our UI. That's a
 * deliberate, harmless simplification here — createEvent has no per-address
 * uniqueness constraint, so it doesn't matter which address calls it. The
 * real, user-attributed record of "who asked for this event" lives in our
 * own `events.creatorUserId` column. (Contrast with claim(), below, where
 * the caller's identity is load-bearing and CANNOT be the treasury.)
 */
export async function createEventOnChain(
  name: string,
  startsAt: number,
  endsAt: number,
  uri: string,
): Promise<{ onchainId: string; txHash: string }> {
  const contract = runEvents();
  const tx = await contract.createEvent(name, startsAt, endsAt, uri);
  const receipt = await tx.wait();
  const created = receipt.logs
    .map((l: ethers.Log) => {
      try {
        return contract.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p: any) => p?.name === "EventCreated");
  if (!created) throw new Error("evento EventCreated non trovato");
  return { onchainId: created.args.eventId.toString(), txHash: receipt.hash };
}

/**
 * Produces the backend co-signature that authorizes `claimant` to call
 * RunEvents.claim(eventOnchainId, nullifierHash, <this signature>).
 *
 * Digest formula — MUST stay byte-identical to the Solidity side
 * (`keccak256(abi.encodePacked(eventId, msg.sender, nullifierHash))`,
 * eth-signed) — verified against the real deployed contract, see
 * docs/decisions.md ("Prova reale del round-trip firma").
 *
 * IMPORTANT — unlike every other on-chain write in this codebase, this
 * signature does NOT let the treasury submit the claim transaction itself.
 * RunEvents.claim binds `msg.sender` into the signed digest and tracks
 * `hasClaimed`/`claimantsOf` keyed by `msg.sender`: if the treasury were the
 * one sending the tx, every claim on a given event would share the same
 * msg.sender, and the SECOND claim on that event — regardless of a distinct
 * nullifier, i.e. a distinct real human — would revert with "already
 * claimed". (Confirmed against contracts/test/runEvents.test.ts, whose claim
 * tests use two different signers — `bob` then `alice` — precisely because
 * the contract was designed around each claimant submitting their own
 * transaction.) So `claimant` must be the address that will itself send the
 * transaction — the user's own embedded wallet, funded via /api/fund for
 * exactly this purpose — and this function only produces the authorization
 * that lets it succeed; it never touches the chain.
 */
export async function signClaim(eventOnchainId: string, claimant: string, nullifierHash: string): Promise<string> {
  const digest = ethers.solidityPackedKeccak256(
    ["uint256", "address", "bytes32"],
    [eventOnchainId, claimant, nullifierHash],
  );
  const treasury = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!);
  return treasury.signMessage(ethers.getBytes(digest));
}

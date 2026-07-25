import { createAgentBookVerifier } from "@worldcoin/agentkit";

/**
 * AgentBook is World's registry binding an agent's wallet to an anonymous
 * identifier for the unique human behind it. It always lives on World Chain
 * (chainId 480) regardless of which chain the agent itself operates on — ours
 * runs on 0G Galileo, so this is a deliberate cross-chain lookup.
 *
 * Registration is a human action, not something a service can do on someone's
 * behalf: `npx @worldcoin/agentkit-cli register <address>` prints a link the
 * person scans in World App, and a relay submits it. Until a wallet has been
 * registered, `lookupHuman` returns null for it.
 */
const DEFAULT_WORLD_CHAIN_RPC = "https://worldchain-mainnet.g.alchemy.com/public";

/** Long enough to spare the RPC on a burst of page loads, short enough that a
 *  freshly registered wallet starts working within a demo, not a coffee break. */
const CACHE_TTL_MS = 60_000;

export type HumanLookup = {
  /** The anonymous human identifier, or null when the wallet is not registered. */
  humanId: string | null;
  /**
   * Set when the lookup itself could not be completed (RPC down, timeout).
   * `humanId: null` then means **unknown**, not "not a human" — callers must
   * never treat unknown as a denial for anything consequential, nor as an
   * approval. Deny-with-a-reason and allow are both wrong; say "unknown".
   */
  error?: string;
};

type Verifier = { lookupHuman(address: string): Promise<string | null> };

let verifier: Verifier | null = null;
const cache = new Map<string, { at: number; humanId: string | null }>();

function getVerifier(): Verifier {
  return (verifier ??= createAgentBookVerifier({
    rpcUrl: process.env.WORLD_CHAIN_RPC ?? DEFAULT_WORLD_CHAIN_RPC,
  }));
}

/** Test seam: inject a fake verifier and drop the cache. */
export function _setAgentBookForTest(fake: Verifier | null) {
  verifier = fake;
  cache.clear();
}

/**
 * Resolves the human behind an agent wallet. Never throws: an unreachable
 * registry must degrade into an explicit "unknown", because the callers of this
 * function make authorization decisions and a thrown error there would turn
 * into a 500 that tells the user nothing.
 */
export async function lookupHumanId(address: string): Promise<HumanLookup> {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { humanId: hit.humanId };

  try {
    const humanId = await getVerifier().lookupHuman(address);
    cache.set(key, { at: Date.now(), humanId: humanId ?? null });
    return { humanId: humanId ?? null };
  } catch (e) {
    // Deliberately NOT cached: a transient RPC failure must not pin a wallet as
    // unknown for the next minute.
    return { humanId: null, error: e instanceof Error ? e.message : "agentbook lookup failed" };
  }
}

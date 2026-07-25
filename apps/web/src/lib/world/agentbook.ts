import { createPublicClient, getAddress, http, toHex } from "viem";
import { worldchain } from "viem/chains";

/**
 * AgentBook is World's registry binding an agent's wallet to an anonymous
 * identifier for the unique human behind it. It always lives on World Chain
 * (chainId 480) regardless of which chain the agent itself operates on — ours
 * runs on 0G Galileo, so this is a deliberate cross-chain lookup.
 *
 * Registration is a human action, not something a service can do on someone's
 * behalf: `npx @worldcoin/agentkit-cli register <address>` prints a link the
 * person scans in World App, and a relay submits it. Until a wallet has been
 * registered, the registry answers with the zero id for it.
 *
 * The read is done here rather than through agentkit-core's
 * `createAgentBookVerifier().lookupHuman()`, which wraps its whole
 * `readContract` in `try { … } catch { return null }`. That turns an RPC
 * outage, a rate limit, or a wrong contract address into the same answer as
 * "this wallet is not registered" — and this value gates who may own an agent,
 * so conflating "we could not ask" with "the answer is no" is exactly the
 * mistake that must not be possible. Reading the contract directly is also the
 * only way to point at a non-mainnet deployment: that helper accepts a
 * `contractAddress`, but hardcodes chain id 480 for any `rpcUrl` it is given
 * without checking that the endpoint really is World Chain mainnet.
 */
const DEFAULT_WORLD_CHAIN_RPC = "https://worldchain-mainnet.g.alchemy.com/public";
/** Canonical AgentBook on World Chain mainnet; overridable for other deployments. */
const DEFAULT_AGENTBOOK_ADDRESS = "0xA23aB2712eA7BBa896930544C7d6636a96b944dA";

// Wall-clock cap for the whole lookup. This runs on the critical path of a
// mint, BEFORE anything is reserved, so an RPC that accepts connections and
// then stalls must not add tens of seconds to the request (viem's own default
// is 10s per attempt with retries, ~40s worst case) — the caller's budget is
// 90s in total and nginx cuts at 300s. Exceeding this is an "unknown", never a
// denial.
const LOOKUP_TIMEOUT_MS = 4_000;

/** Long enough to spare the RPC on a burst of page loads, short enough that a
 *  freshly registered wallet starts working within a demo, not a coffee break. */
const CACHE_TTL_MS = 60_000;

// Same shape agentkit-core reads (uint256, zero meaning "not registered"), and
// the id is rendered with viem's toHex exactly as that library does, so a
// human_id stored by either path is the same string.
const AGENTBOOK_ABI = [
  {
    type: "function",
    name: "lookupHuman",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "humanId", type: "uint256" }],
  },
  {
    type: "function",
    name: "getNextNonce",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type HumanLookup = {
  /** The anonymous human identifier, or null when the wallet is not registered. */
  humanId: string | null;
  /**
   * Set when the lookup itself could not be completed (RPC down, timeout,
   * unusable address). `humanId: null` then means **unknown**, not "not a
   * human" — callers must never treat unknown as a denial for anything
   * consequential, nor as an approval. Deny-with-a-reason and allow are both
   * wrong; say "unknown".
   *
   * Always a non-empty string when present: an error carrying an empty message
   * used to make `if (lookup.error)` false, which silently turned "the lookup
   * failed" back into "not registered".
   */
  error?: string;
};

type Reader = {
  lookupHuman(address: `0x${string}`): Promise<string | null>;
  getNextNonce?(address: `0x${string}`): Promise<string>;
};

let reader: Reader | null = null;
// Only ACCERTAINED answers land here, and only positive ones (see below).
const cache = new Map<string, { at: number; humanId: string }>();

/** Checksummed AgentBook address: env override or the canonical World Chain deploy. */
export function agentBookAddress(): string {
  return getAddress(process.env.WORLD_AGENTBOOK_ADDRESS ?? DEFAULT_AGENTBOOK_ADDRESS);
}

function realReader(): Reader {
  const client = createPublicClient({
    chain: worldchain,
    // One attempt, short fuse: retries belong to the caller's next request, not
    // to a request a person is waiting on.
    transport: http(process.env.WORLD_CHAIN_RPC ?? DEFAULT_WORLD_CHAIN_RPC, {
      timeout: LOOKUP_TIMEOUT_MS,
      retryCount: 0,
    }),
  });
  const address = agentBookAddress() as `0x${string}`;

  return {
    async lookupHuman(agent) {
      const humanId = await client.readContract({
        address,
        abi: AGENTBOOK_ABI,
        functionName: "lookupHuman",
        args: [agent],
      });
      // An unregistered wallet is the zero id, not an error and not a name.
      return humanId === 0n ? null : toHex(humanId);
    },
    async getNextNonce(agent) {
      const nonce = await client.readContract({
        address,
        abi: AGENTBOOK_ABI,
        functionName: "getNextNonce",
        args: [agent],
      });
      return nonce.toString();
    },
  };
}

/** Test seam: inject a fake reader and drop the cache. */
export function _setAgentBookForTest(fake: Reader | null) {
  reader = fake;
  cache.clear();
}

/**
 * Resolves the human behind an agent wallet. Never throws: an unreachable
 * registry must degrade into an explicit "unknown", because the callers of this
 * function make authorization decisions and a thrown error there would turn
 * into a 500 that tells the user nothing.
 */
export async function lookupHumanId(address: string): Promise<HumanLookup> {
  // Checksummed once, then used for BOTH the cache key and the contract call.
  // Passing a raw mixed-case string to viem throws on a bad EIP-55 checksum,
  // and caching that failure under a lowercased key let one malformed caller
  // mark a wallet unregistered for everyone else.
  let agent: `0x${string}`;
  try {
    agent = getAddress(address);
  } catch {
    return { humanId: null, error: `indirizzo non valido: ${address}` };
  }

  const hit = cache.get(agent);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { humanId: hit.humanId };

  try {
    const humanId = await withTimeout(
      (reader ??= realReader()).lookupHuman(agent),
      LOOKUP_TIMEOUT_MS,
      "agentbook lookup timeout",
    );
    // Only a POSITIVE answer is cached. A negative one is the answer someone is
    // about to change: they read the 403, register in World App, and come back
    // within seconds — caching "not registered" for a minute would refuse them
    // again and read as "the registration failed".
    if (humanId) cache.set(agent, { at: Date.now(), humanId });
    return { humanId: humanId ?? null };
  } catch (e) {
    // Never cached: a transient RPC failure must not pin a wallet as unknown
    // for the next minute.
    const message = e instanceof Error && e.message ? e.message : String(e);
    return { humanId: null, error: message || "agentbook lookup failed" };
  }
}

export type NonceLookup = { nonce: string } | { error: string };

/**
 * Next registration nonce for a wallet — part of the World ID signal the
 * person approves in World App (solidityEncode of [address, nonce]), so it is
 * read fresh per attempt and NEVER cached: a stale nonce makes the relay
 * reject the whole proof. Same never-throws + timeout discipline as
 * lookupHumanId above.
 */
export async function getAgentNonce(address: string): Promise<NonceLookup> {
  let agent: `0x${string}`;
  try {
    agent = getAddress(address);
  } catch {
    return { error: `indirizzo non valido: ${address}` };
  }
  try {
    const r = (reader ??= realReader());
    if (!r.getNextNonce) return { error: "nonce reader non disponibile" };
    const nonce = await withTimeout(r.getNextNonce(agent), LOOKUP_TIMEOUT_MS, "agentbook nonce timeout");
    return { nonce };
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : String(e);
    return { error: message || "agentbook nonce lookup failed" };
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

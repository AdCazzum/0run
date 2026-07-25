import { createPublicClient, http, type PublicClient } from "viem";
import { sepolia } from "viem/chains";

export type EnsResolution = { address: string | null; records: Record<string, string> };

// ENSIP-26 agent-identity keys, plus a 0run-specific pointer back at the exact
// on-chain iNFT this name identifies. `agent-endpoint[web]` is the literal
// ENSIP-26 key string (the "[web]" suffix is part of the key, not bracket
// syntax the resolver interprets).
const TEXT_KEYS = ["agent-context", "agent-endpoint[web]", "0run:inft", "avatar"] as const;

// Only the two viem actions this module actually calls — kept narrow so the
// test-only override below can supply a minimal fake instead of a full
// PublicClient mock.
type EnsClient = Pick<PublicClient, "getEnsAddress" | "getEnsText">;

function realClient(): EnsClient {
  const rpcUrl = process.env.ENS_SEPOLIA_RPC;
  if (!rpcUrl) throw new Error("ENS_SEPOLIA_RPC non configurato");
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

let client: EnsClient | null = null;
const getClient = () => (client ??= realClient());
/** Test-only override — same DI shape as lib/zerog/storage.ts's _setDepsForTest. */
export function _setClientForTest(c: EnsClient | null) {
  client = c;
}

/**
 * Live resolution over Sepolia RPC — no constant, no fallback string. Every
 * value returned came back from an actual `eth_call` made just now; if the
 * client can't be built (missing ENS_SEPOLIA_RPC) or any individual call
 * throws (name not registered, RPC down, resolver reverts), that piece of
 * the result is simply absent — never an invented placeholder. This is the
 * property the ENS bounty asks for explicitly ("no hard-coded values").
 */
export async function resolveCoachEns(name: string): Promise<EnsResolution> {
  let c: EnsClient;
  try {
    c = getClient();
  } catch {
    return { address: null, records: {} };
  }

  const address = await c.getEnsAddress({ name }).catch(() => null);

  const records: Record<string, string> = {};
  await Promise.all(
    TEXT_KEYS.map(async (key) => {
      const value = await c.getEnsText({ name, key }).catch(() => null);
      if (value) records[key] = value;
    }),
  );

  return { address: address ?? null, records };
}

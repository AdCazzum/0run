import { ethers } from "ethers";
import { GALILEO } from "@0run/shared";

// ERC-8004 IdentityRegistry — already deployed on Galileo by the erc-8004
// project, not one of our own contracts (no deploy step, no ABI of our own
// making). The interface below was NOT guessed: it comes from the reference
// implementation (github.com/erc-8004/erc-8004-contracts, commit 68fc676,
// contracts/IdentityRegistryUpgradeable.sol + abis/IdentityRegistry.json),
// whose README lists this exact address under "0G Galileo Testnet". It was
// then cross-checked live against the deployed contract via read-only
// eth_call (no gas spent): getVersion() -> "2.0.0", name() -> "AgentIdentity",
// symbol() -> "AGENT" (all match the source verbatim), and a
// register(agentURI, metadata).staticCall from the treasury address returned
// a real next agentId (148) without reverting — i.e. the exact selector this
// file calls is the one the deployed bytecode implements. Full trail in
// docs/decisions.md.
const IDENTITY_REGISTRY_ADDRESS = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

// Exact signatures from IdentityRegistryUpgradeable.sol:
//   function register(string agentURI, MetadataEntry[] metadata) external returns (uint256 agentId)
//   event Registered(uint256 indexed agentId, string agentURI, address indexed owner)
// where MetadataEntry = { string metadataKey; bytes metadataValue; }
const IDENTITY_REGISTRY_ABI = [
  "function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];

function signer() {
  return new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl));
}

export const identityRegistry = () =>
  new ethers.Contract(process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS ?? IDENTITY_REGISTRY_ADDRESS, IDENTITY_REGISTRY_ABI, signer());

type Result = { agentId: string; txHash: string } | { error: string };

/**
 * Registers a coach as an ERC-8004 agent on the (already deployed)
 * IdentityRegistry. `agentUri` should point at something real and stable —
 * the coach's public identity on our side (e.g. `https://0run.fun/coach/<tokenId>`).
 * NOTE: that page may not exist yet at the time this is called; the URI is
 * recorded as-is regardless, same as any ERC-721 tokenURI pointing at a page
 * that ships later.
 *
 * `tokenId` (the coach's id on OrunAgentNFT — a separate contract, see
 * lib/zerog/contracts.ts) is attached as an on-chain metadata entry
 * ("0run.tokenId") so the two identities are linkable on-chain, not just by
 * convention in the URL string.
 *
 * Never throws — same receipt discipline as lib/zerog/storage.ts. Callers
 * treat this as a bonus, non-blocking step: a failure here must never fail
 * or slow down a mint.
 */
export async function registerAgent(tokenId: string, agentUri: string): Promise<Result> {
  try {
    const metadata = [{ metadataKey: "0run.tokenId", metadataValue: ethers.toUtf8Bytes(tokenId) }];
    const contract = identityRegistry();
    const tx = await contract.register(agentUri, metadata);
    const receipt = await tx.wait();
    const registered = receipt.logs
      .map((l: ethers.Log) => { try { return contract.interface.parseLog(l); } catch { return null; } })
      .find((p: any) => p?.name === "Registered");
    if (!registered) return { error: "evento Registered non trovato" };
    return { agentId: registered.args.agentId.toString(), txHash: receipt.hash };
  } catch (e: any) {
    return { error: e.message ?? String(e) };
  }
}

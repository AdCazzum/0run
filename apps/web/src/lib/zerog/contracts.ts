import { ethers } from "ethers";
import { GALILEO } from "@0run/shared";

const NFT_ABI = [
  "function mint((string dataDescription, bytes32 dataHash)[] iDatas, address to) payable returns (uint256)",
  "function intelligentDatasOf(uint256 tokenId) view returns ((string dataDescription, bytes32 dataHash)[])",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Minted(uint256 indexed tokenId, address indexed to)",
];
const REG_ABI = [
  "function update(uint256 tokenId, bytes32 memoryRoot, bytes32 profileRoot)",
  "function memoryOf(uint256) view returns (bytes32 memoryRoot, bytes32 profileRoot, uint32 runCount, uint64 updatedAt)",
];

function signer() {
  return new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl));
}
export const nft = () => new ethers.Contract(process.env.AGENT_NFT_ADDRESS!, NFT_ABI, signer());
export const registry = () => new ethers.Contract(process.env.COACH_REGISTRY_ADDRESS!, REG_ABI, signer());

export async function mintCoachOnChain(to: string, dataDescription: string, dataHash: string): Promise<{ tokenId: string; txHash: string }> {
  const tx = await nft().mint([{ dataDescription, dataHash }], to);
  const receipt = await tx.wait();
  const minted = receipt.logs.map((l: ethers.Log) => { try { return nft().interface.parseLog(l); } catch { return null; } })
    .find((p: any) => p?.name === "Minted");
  if (!minted) throw new Error("evento Minted non trovato");
  return { tokenId: minted.args.tokenId.toString(), txHash: receipt.hash };
}

export async function updateRegistry(tokenId: string, memoryRoot: string, profileRoot: string): Promise<string> {
  const tx = await registry().update(tokenId, memoryRoot, profileRoot);
  return (await tx.wait()).hash;
}

// 0G Storage rootHashes are already 32-byte hex, so zeroPadValue is a no-op
// on real data. It DOES throw on anything that isn't valid BytesLike (e.g.
// the short mock rootHashes used in tests, or any future non-hex root
// representation) — fall back to the raw value rather than 500ing the caller.
// Shared by the mint route and the run-upload pipeline, both of which pass
// storage rootHashes to updateRegistry.
export function toBytes32(value: string): string {
  try {
    return ethers.zeroPadValue(value, 32);
  } catch {
    return value;
  }
}

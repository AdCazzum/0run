import { ethers } from "ethers";
import { GALILEO } from "@0run/shared";

type Deps = { getBalance: (a: string) => Promise<bigint>; send: (to: string, wei: bigint) => Promise<string> };
let deps: Deps | null = null;
export function _setFunderDepsForTest(d: Deps) { deps = d; }
function getDeps(): Deps {
  if (deps) return deps;
  const provider = new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl);
  const treasury = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, provider);
  return (deps = {
    getBalance: (a) => provider.getBalance(a),
    send: async (to, value) => (await (await treasury.sendTransaction({ to, value })).wait())!.hash,
  });
}

const THRESHOLD = 10_000_000_000_000_000n;  // 0.01 OG
const TOPUP = 30_000_000_000_000_000n;       // 0.03 OG

export async function topUpIfNeeded(wallet: string): Promise<{ funded: boolean; txHash?: string }> {
  const bal = await getDeps().getBalance(wallet);
  if (bal >= THRESHOLD) return { funded: false };
  const txHash = await getDeps().send(wallet, TOPUP);
  return { funded: true, txHash };
}

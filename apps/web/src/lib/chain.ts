import { defineChain } from "viem";
import { GALILEO } from "@0run/shared";

export const galileo = defineChain({
  id: GALILEO.chainId,
  name: GALILEO.name,
  nativeCurrency: GALILEO.currency,
  rpcUrls: { default: { http: [GALILEO.rpcUrl] } },
  blockExplorers: { default: { name: "Chainscan", url: GALILEO.explorer } },
});

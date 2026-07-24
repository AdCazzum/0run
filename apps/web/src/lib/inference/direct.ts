import { ethers } from "ethers";
import { GALILEO } from "@0run/shared";
import type { ChatMsg, CoachCompletion } from "./types";

let brokerPromise: Promise<any> | null = null;
async function getBroker() {
  return (brokerPromise ??= (async () => {
    const { createZGComputeNetworkBroker } = await import("@0gfoundation/0g-compute-ts-sdk");
    const wallet = new ethers.Wallet(
      process.env.TREASURY_PRIVATE_KEY!,
      new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl),
    );
    return createZGComputeNetworkBroker(wallet);
  })());
}

export async function directComplete(messages: ChatMsg[]): Promise<CoachCompletion> {
  const providers = (process.env.DIRECT_PROVIDERS ?? "").split(",").filter(Boolean);
  if (!providers.length) throw new Error("DIRECT_PROVIDERS vuoto");
  const broker = await getBroker();
  let lastErr = "";
  for (const provider of providers) {
    try {
      await broker.inference.acknowledgeProviderSigner(provider).catch(() => {}); // idempotente
      const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
      const content = messages.map((m) => m.content).join("\n");
      const headers = await broker.inference.getRequestHeaders(provider, content);
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ model, messages }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.length) { lastErr = "vuoto"; continue; }
      const chatID = res.headers.get("ZG-Res-Key") ?? data.id;
      let verified: boolean | null = null;
      try { verified = Boolean(await broker.inference.processResponse(provider, chatID)); } catch { verified = null; }
      return { text, verified, model, path: "direct" };
    } catch (e) { lastErr = String(e); }
  }
  throw new Error(`direct: tutti i provider falliti (${lastErr})`);
}

import { createRequire } from "node:module";
import { ethers } from "ethers";
import { GALILEO } from "@0run/shared";
import type { ChatMsg, CoachCompletion } from "./types";

// The SDK's ESM build is broken — importing it throws "does not provide an export
// named 'C'" (verified against @0gfoundation/0g-compute-ts-sdk 0.9.0), so the
// CommonJS build has to be loaded explicitly. Without this the whole direct path
// fails at runtime, silently falling back to the router.
const requireCjs = createRequire(import.meta.url);

let brokerPromise: Promise<any> | null = null;
async function getBroker() {
  return (brokerPromise ??= (async () => {
    const { createZGComputeNetworkBroker } = requireCjs("@0gfoundation/0g-compute-ts-sdk");
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
      // SSRF guard: `endpoint` is on-chain data from an allowlisted provider (DIRECT_PROVIDERS),
      // but the URL itself is attacker-influenced if that provider misbehaves — require https,
      // except http to localhost/127.0.0.1 for local testing.
      const endpointUrl = new URL(endpoint);
      const isLocalHost = endpointUrl.hostname === "localhost" || endpointUrl.hostname === "127.0.0.1";
      if (endpointUrl.protocol !== "https:" && !(endpointUrl.protocol === "http:" && isLocalHost)) {
        throw new Error(`direct: endpoint non sicuro per provider ${provider}: ${endpoint}`);
      }
      // The SDK's `content` param is deprecated/unused for sync completions — Authorization is
      // an ephemeral session token, not derived from content (0g-compute-ts-sdk
      // lib.commonjs/inference/broker/request.js:51-61 ignores `_content`); omit it rather than
      // pass content that doesn't match the POST body and isn't actually signed over anyway.
      const headers = await broker.inference.getRequestHeaders(provider);
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
      try { verified = Boolean(await broker.inference.processResponse(provider, chatID)); }
      catch (e) {
        verified = null;
        // Fail-open on verification: keep serving the completion, but make it observable.
        console.warn(`direct: verifica attestazione non disponibile per provider ${provider}: ${String(e)}`);
      }
      return { text, verified, model, path: "direct" };
    } catch (e) { lastErr = String(e); }
  }
  throw new Error(`direct: tutti i provider falliti (${lastErr})`);
}

import type { ZodType } from "zod";
import { routerComplete } from "./router";
import { directComplete } from "./direct";
import { extractJson } from "./json";
import type { ChatMsg, CoachCompletion } from "./types";

export type { ChatMsg, CoachCompletion };

/**
 * Which path to try first. `direct` pays from the treasury wallet on-chain and is
 * the only path that returns a per-response TEE attestation (`processResponse`),
 * which is what lets the UI claim "TEE verified" honestly; `router` reaches larger
 * models but bills a prepaid account and exposes no per-response attestation.
 * Whichever is preferred, the other stays as automatic fallback.
 */
function preferDirect(): boolean {
  return process.env.DIRECT_ENABLED === "1" && process.env.INFERENCE_PREFER === "direct";
}

export async function coachComplete(messages: ChatMsg[]): Promise<CoachCompletion> {
  if (preferDirect()) {
    try {
      return await directComplete(messages);
    } catch (directErr) {
      try {
        return await routerComplete(messages);
      } catch (routerErr) {
        throw new Error(`direct=${directErr} · router=${routerErr}`);
      }
    }
  }

  try {
    return await routerComplete(messages);
  } catch (routerErr) {
    if (process.env.DIRECT_ENABLED !== "1") throw routerErr;
    try {
      return await directComplete(messages);
    } catch (directErr) {
      // Both paths failed: surface both causes, not just the last one.
      throw new Error(`router=${routerErr} · direct=${directErr}`);
    }
  }
}

export async function completeJson<T>(
  schema: ZodType<T>, messages: ChatMsg[], retries = 2,
): Promise<{ value: T; meta: CoachCompletion }> {
  let convo = [...messages];
  let lastErr = "";
  for (let i = 0; i <= retries; i++) {
    const meta = await coachComplete(convo);
    try {
      return { value: extractJson(schema, meta.text), meta };
    } catch (e) {
      lastErr = String(e);
      convo = [...messages, { role: "assistant", content: meta.text },
        { role: "user", content: `La risposta non era JSON valido per lo schema (${lastErr}). Rispondi SOLO con il JSON corretto, nessun altro testo.` }];
    }
  }
  throw new Error(`completeJson: JSON invalido dopo ${retries + 1} tentativi (${lastErr})`);
}

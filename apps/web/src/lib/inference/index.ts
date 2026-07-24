import type { ZodType } from "zod";
import { routerComplete } from "./router";
import { directComplete } from "./direct";
import { extractJson } from "./json";
import type { ChatMsg, CoachCompletion } from "./types";

export type { ChatMsg, CoachCompletion };

export async function coachComplete(messages: ChatMsg[]): Promise<CoachCompletion> {
  try {
    return await routerComplete(messages);
  } catch (routerErr) {
    if (process.env.DIRECT_ENABLED === "1") return directComplete(messages);
    throw routerErr;
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

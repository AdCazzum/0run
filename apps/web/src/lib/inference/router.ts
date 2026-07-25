import type { ChatMsg, CoachCompletion } from "./types";

export async function routerComplete(messages: ChatMsg[]): Promise<CoachCompletion> {
  const base = process.env.ROUTER_API_URL ?? "https://router-api.0g.ai/v1";
  const models = [process.env.ROUTER_MODEL_PRIMARY ?? "glm-5.2", process.env.ROUTER_MODEL_FALLBACK ?? "0gm-1.0-35b-a3b"];
  let lastErr = "";
  for (const model of models) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ROUTER_API_KEY}` },
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(120_000),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({}), headers: new Headers(), _e: String(e) } as any));
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.length) return { text, verified: null, model, path: "router" };
      lastErr = "risposta senza contenuto";
    } else lastErr = (res as any)._e ?? `HTTP ${res.status}`;
  }
  throw new Error(`router: tutti i modelli falliti (${lastErr})`);
}

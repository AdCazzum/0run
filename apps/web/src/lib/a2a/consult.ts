import { randomUUID } from "node:crypto";
import { resolveCoachEns } from "@/lib/ens/resolve";
import { signConsult, type ConsultPayload } from "./protocol";

export const A2A_TIMEOUT_MS = 45_000;

export type ConsultResult =
  | { ok: true; to: string; question: string; reply: string; coach: { name: string; ensName: string; personality: string } }
  | { ok: false; error: string };

/**
 * Dev-only escape hatch: ENS records hold production URLs, so local runs set
 * A2A_ENDPOINT_OVERRIDE to redirect the ORIGIN while keeping the ENS-resolved
 * path and the signature flow byte-identical to production.
 */
export function overrideOrigin(url: string, override?: string): string {
  if (!override) return url;
  const u = new URL(url);
  const o = new URL(override);
  u.protocol = o.protocol;
  u.host = o.host;
  return u.toString();
}

/**
 * One coach consults another: resolve the target's ENS name, read its
 * `agent-endpoint[a2a]` record, sign the payload with the executor key, POST.
 * Never throws — the chat must degrade gracefully, so every failure is an
 * `ok:false` with a reason (same discipline as assignSubname/registerAgent).
 */
export async function consultCoach(from: string, to: string, question: string, context: string): Promise<ConsultResult> {
  try {
    const pk = process.env.A2A_SIGNER_PRIVATE_KEY;
    if (!pk) return { ok: false, error: "A2A_SIGNER_PRIVATE_KEY non configurata" };

    const resolution = await resolveCoachEns(to);
    const rawEndpoint = resolution.records["agent-endpoint[a2a]"];
    if (!rawEndpoint) return { ok: false, error: `${to} non pubblica agent-endpoint[a2a]` };
    const endpoint = overrideOrigin(rawEndpoint, process.env.A2A_ENDPOINT_OVERRIDE);

    const payload: ConsultPayload = {
      from, to, question, context,
      ts: Math.floor(Date.now() / 1000),
      nonce: randomUUID(),
    };
    const signed = await signConsult(payload, pk as `0x${string}`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signed),
      signal: AbortSignal.timeout(A2A_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true, to, question, reply: body.reply, coach: body.coach };
  } catch (e: any) {
    return { ok: false, error: e.message ?? String(e) };
  }
}

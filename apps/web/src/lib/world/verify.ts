import { hashSignal } from "@worldcoin/idkit/hashing";

/**
 * The shape IDKit hands back from IDKitRequestWidget/useIDKitRequest's
 * onSuccess/handleVerify for a World ID 4.0 uniqueness proof (see
 * @worldcoin/idkit-core's `IDKitResultV4`). Typed loosely on purpose: this
 * whole object is forwarded byte-for-byte to the cloud-verify endpoint, so
 * this file only needs to read the couple of fields it inspects itself.
 */
export type WorldIdKitResult = {
  protocol_version?: string;
  responses?: Array<{
    identifier: string;
    nullifier: string;
    signal_hash?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

type Result = { ok: true; nullifierHash: string; level: string } | { ok: false; error: string };

/**
 * Cloud-verify against World's Developer Portal v4 API. On 0G there is no
 * WorldIDRouter deployed, so the proof cannot be checked on-chain — the
 * backend verifies it server-side and only then co-signs the claim (see
 * lib/world/runEvents.ts).
 *
 * Non-negotiables:
 * - STRICT check: only `body.success === true` counts. A response missing
 *   the field, or with any other value (including a truthy non-boolean), is
 *   NOT a success. No bypass flag, no lenient fallback.
 * - Signal binding: `signal` must be the SAME string the client embedded in
 *   the proof request (see lib/world/signal.ts). This function recomputes
 *   `hashSignal(signal)` and rejects a mismatch BEFORE spending a network
 *   call — otherwise a proof minted for one claim could be replayed against
 *   another.
 * - Never logs the proof, the signal, or any part of the response.
 * - Never throws: every failure path (missing config, malformed result,
 *   signal mismatch, non-2xx, network error, unsuccessful verification)
 *   returns `{ ok: false }`.
 */
export async function verifyWorldProof(result: WorldIdKitResult, signal: string): Promise<Result> {
  const rpId = process.env.WORLD_RP_ID;
  if (!rpId) return { ok: false, error: "WORLD_RP_ID non configurato" };

  const response = result?.responses?.[0];
  if (!response) return { ok: false, error: "nessuna proof nella risposta IDKit" };

  const expectedSignalHash = hashSignal(signal);
  if (response.signal_hash !== expectedSignalHash) {
    return { ok: false, error: "signal mismatch: la proof non è legata a questo claim" };
  }

  try {
    const res = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (!res.ok) return { ok: false, error: `world verify HTTP ${res.status}` };
    if (body?.success !== true) return { ok: false, error: "proof non valida (success !== true)" };
    return { ok: true, nullifierHash: response.nullifier, level: response.identifier };
  } catch (e) {
    // Never include the proof itself in the error message — only the error
    // type/message from the fetch layer, which never contains proof bytes.
    return { ok: false, error: `world verify failed: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

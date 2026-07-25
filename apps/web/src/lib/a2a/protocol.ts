import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type ConsultPayload = {
  from: string; // ENS name of the calling agent, e.g. "marco.0run.eth"
  to: string; // ENS name of the receiving agent
  question: string;
  context: string; // non-sensitive summary; may be ""
  ts: number; // unix seconds
  nonce: string;
};
export type SignedConsult = ConsultPayload & { sig: `0x${string}` };

export const MAX_SKEW_SEC = 300;

/**
 * Canonical serialization both sides sign/verify: the six fields in this
 * exact order, JSON.stringify with no whitespace. Never hand the raw request
 * body to the verifier — re-serialize through this function, so an attacker
 * cannot smuggle differences via key order or extra fields.
 */
export function consultDigest(p: ConsultPayload): string {
  return JSON.stringify({ from: p.from, to: p.to, question: p.question, context: p.context, ts: p.ts, nonce: p.nonce });
}

/** The deployment's agent-executor key (spec: one key, published as `agent-signer`). Null when unconfigured. */
export function a2aAccount() {
  const pk = process.env.A2A_SIGNER_PRIVATE_KEY;
  if (!pk) return null;
  return privateKeyToAccount(pk as `0x${string}`);
}

export async function signConsult(p: ConsultPayload, pk: `0x${string}`): Promise<SignedConsult> {
  const account = privateKeyToAccount(pk);
  const sig = await account.signMessage({ message: consultDigest(p) });
  return { ...p, sig };
}

/**
 * ENS-anchored verification: `expected.signer` is what the receiver just read
 * from the caller's `agent-signer` text record — the ONLY registry of who may
 * speak. `expected.selfName` is the receiver's own ENS name (rejects replaying
 * the same signed message at a different coach).
 */
export async function verifyConsult(
  msg: SignedConsult,
  expected: { signer: string; selfName: string },
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (Math.abs(nowSec - msg.ts) > MAX_SKEW_SEC) return { ok: false, reason: "timestamp fuori finestra" };
  if (msg.to.toLowerCase() !== expected.selfName.toLowerCase()) return { ok: false, reason: "destinatario non corrispondente" };
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: consultDigest(msg), signature: msg.sig });
  } catch {
    return { ok: false, reason: "firma non valida" };
  }
  if (recovered.toLowerCase() !== expected.signer.toLowerCase()) return { ok: false, reason: "firma non valida" };
  return { ok: true };
}

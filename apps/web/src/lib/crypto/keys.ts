import { hkdfSync } from "node:crypto";
export { SIGN_MESSAGE } from "@0run/shared";

export function deriveUserKey(signatureHex: string): Buffer {
  const ikm = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");
  if (ikm.length < 32) throw new Error("firma troppo corta");
  return Buffer.from(hkdfSync("sha256", ikm, Buffer.from("0run-v1"), Buffer.from("user-data-key"), 32));
}

export function serviceKey(): Buffer {
  const hex = process.env.SERVICE_ENC_KEY;
  if (!hex || hex.length !== 64) throw new Error("SERVICE_ENC_KEY mancante o non 32 byte hex");
  return Buffer.from(hex, "hex");
}

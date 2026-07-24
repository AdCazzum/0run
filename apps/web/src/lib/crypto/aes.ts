import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ZodType } from "zod";

export function encryptJson(obj: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptJson<T>(payload: string, key: Buffer, schema: ZodType<T>): T {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(ct), d.final()]).toString("utf8"); // GCM: chiave sbagliata → throw qui
  return schema.parse(JSON.parse(plain));
}

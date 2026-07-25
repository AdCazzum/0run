import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ZodType } from "zod";

export function encryptJson(obj: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

// ZodType<T, any, any> (not ZodType<T>): schemas that use .default() (e.g.
// RunSummarySchema.reportHeadline) have a wider Input than Output. ZodType<T>
// implicitly pins Input to Output=T too (its 3rd type param defaults to the
// 1st), which pulls T's inference toward the wider (optional-field) Input
// type via the class's `_input` member instead of the intended Output type —
// silently widening every field with a default to optional downstream.
// Freeing Input (and Def) to `any` makes T bind to Output only, which is
// what callers actually get back at runtime (schema.parse's return type).
export function decryptJson<T>(payload: string, key: Buffer, schema: ZodType<T, any, any>): T {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(ct), d.final()]).toString("utf8"); // GCM: chiave sbagliata → throw qui
  return schema.parse(JSON.parse(plain));
}

import type { ZodType } from "zod";

export function extractJson<T>(schema: ZodType<T>, text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("nessun oggetto JSON nella risposta");
  return schema.parse(JSON.parse(match[0]));
}

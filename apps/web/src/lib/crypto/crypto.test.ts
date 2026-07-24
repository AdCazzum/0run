import { describe, expect, it } from "vitest";
import { z } from "zod";
import { encryptJson, decryptJson } from "./aes";
import { deriveUserKey, SIGN_MESSAGE } from "./keys";

const sigA = "0x" + "ab".repeat(65);
const sigB = "0x" + "cd".repeat(65);

describe("keys", () => {
  it("SIGN_MESSAGE è stabile (cambiarlo invaliderebbe tutti i dati cifrati)", () => {
    expect(SIGN_MESSAGE).toBe("0run key derivation v1 — sign to unlock your encrypted running data");
  });
  it("derivazione deterministica, 32 byte, firma diversa → chiave diversa", () => {
    const k1 = deriveUserKey(sigA);
    expect(k1.length).toBe(32);
    expect(deriveUserKey(sigA).equals(k1)).toBe(true);
    expect(deriveUserKey(sigB).equals(k1)).toBe(false);
  });
});

describe("aes-gcm json", () => {
  const schema = z.object({ a: z.number() });
  it("roundtrip", () => {
    const key = deriveUserKey(sigA);
    expect(decryptJson(encryptJson({ a: 1 }, key), key, schema)).toEqual({ a: 1 });
  });
  it("chiave sbagliata → throw, mai garbage", () => {
    const ct = encryptJson({ a: 1 }, deriveUserKey(sigA));
    expect(() => decryptJson(ct, deriveUserKey(sigB), schema)).toThrow();
  });
});

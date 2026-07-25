"use client";
import { useCallback, useRef } from "react";
import { useSignMessage } from "@privy-io/react-auth";
import { SIGN_MESSAGE } from "@/lib/crypto/keys";

export function useUserKey() {
  const cached = useRef<string | null>(null);
  const { signMessage } = useSignMessage();
  const getKeyHex = useCallback(async (): Promise<string> => {
    if (cached.current) return cached.current;
    const { signature } = await signMessage({ message: SIGN_MESSAGE });
    const ikm = Uint8Array.from((signature.replace(/^0x/, "").match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
    const keyMaterial = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("0run-v1"), info: new TextEncoder().encode("user-data-key") },
      keyMaterial, 256,
    );
    cached.current = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return cached.current;
  }, [signMessage]);
  return { getKeyHex };
}

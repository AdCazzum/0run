"use client";
import { useCallback } from "react";
import { usePrivy, useSignMessage } from "@privy-io/react-auth";
import { SIGN_MESSAGE } from "@/lib/crypto/keys";

/**
 * The athlete's data key, derived from one wallet signature.
 *
 * The cache and the in-flight promise live at MODULE scope, not in a ref, and
 * that is the whole point. With a per-component ref every screen and every
 * widget had its own copy: opening a run asked for a signature, its chat asked
 * again, and arriving from the upload page asked a third time. Worse, two of
 * those could overlap — the run page derives the key in an effect the moment
 * the run loads — and a second signature request while one is open makes Privy
 * abandon both with its own "Something went wrong" dialog, which is what people
 * actually hit. One signature per session, shared, is both the fix and the
 * behaviour anyone would expect.
 *
 * Keyed by wallet address so signing out and back in as someone else can never
 * hand the second person the first person's key — and the key stays in memory
 * only: never localStorage, never sessionStorage, so it does not outlive the
 * tab and cannot be read back by anything that manages to run script later.
 */
let cache: { address: string; keyHex: string } | null = null;
let inFlight: { address: string; promise: Promise<string> } | null = null;

/** Called on sign-out: the previous person's key must not survive them. */
export function forgetUserKey() {
  cache = null;
  inFlight = null;
}

/** Test seam only. */
export function _resetUserKeyCacheForTest() {
  forgetUserKey();
}

async function deriveKeyHex(signature: string): Promise<string> {
  const ikm = Uint8Array.from((signature.replace(/^0x/, "").match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("0run-v1"),
      info: new TextEncoder().encode("user-data-key"),
    },
    keyMaterial,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function useUserKey() {
  const { user } = usePrivy();
  const { signMessage } = useSignMessage();
  const address = user?.wallet?.address ?? null;

  const getKeyHex = useCallback(async (): Promise<string> => {
    if (!address) throw new Error("wallet non pronto: riprova tra un istante");
    if (cache?.address === address) return cache.keyHex;
    if (inFlight?.address === address) return inFlight.promise;

    const promise = (async () => {
      const { signature } = await signMessage(
        { message: SIGN_MESSAGE },
        // No modal. This signature is plumbing — it derives the key that
        // decrypts the athlete's own data, there is nothing for them to decide
        // — and the modal was the part that failed.
        { uiOptions: { showWalletUIs: false } },
      );
      return deriveKeyHex(signature);
    })();

    inFlight = { address, promise };
    try {
      const keyHex = await promise;
      cache = { address, keyHex };
      return keyHex;
    } finally {
      // Only clear if nobody started a newer request in the meantime.
      if (inFlight?.promise === promise) inFlight = null;
    }
  }, [address, signMessage]);

  return { getKeyHex };
}

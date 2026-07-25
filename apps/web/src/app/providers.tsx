"use client";
import { createContext, useContext } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { galileo } from "@/lib/chain";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
// A Privy app id looks like "cmrzhzbis004e0djr4xxpr2l3": 20+ chars, no dashes.
// CI and preview builds run without one, and PrivyProvider throws on an invalid id —
// which used to abort the whole `next build` while prerendering /_not-found. Static
// pages must never depend on auth being configured, so we skip the provider instead.
const isUsableAppId = !!appId && appId.length >= 20 && !appId.includes("-");

/**
 * Whether the Privy provider is actually mounted.
 *
 * Skipping the provider keeps a build without an app id from crashing, but any
 * component that calls a Privy hook still throws at render time ("Cannot read
 * properties of undefined") — which turned the public landing page into a 500,
 * the single worst place for it. Components must therefore branch on this flag
 * BEFORE calling those hooks, which means putting the hook calls in a separate
 * component rather than behind an `if` (hooks cannot be called conditionally).
 */
const PrivyReadyContext = createContext(false);

export function usePrivyReady(): boolean {
  return useContext(PrivyReadyContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  if (!isUsableAppId) {
    if (typeof window !== "undefined") {
      console.error(
        "NEXT_PUBLIC_PRIVY_APP_ID is missing or malformed: login is disabled in this build.",
      );
    }
    return <PrivyReadyContext.Provider value={false}>{children}</PrivyReadyContext.Provider>;
  }

  return (
    <PrivyReadyContext.Provider value={true}>
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: galileo,
        supportedChains: [galileo],
      }}
    >
      {children}
    </PrivyProvider>
    </PrivyReadyContext.Provider>
  );
}

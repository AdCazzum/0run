"use client";
import { PrivyProvider } from "@privy-io/react-auth";
import { galileo } from "@/lib/chain";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
// A Privy app id looks like "cmrzhzbis004e0djr4xxpr2l3": 20+ chars, no dashes.
// CI and preview builds run without one, and PrivyProvider throws on an invalid id —
// which used to abort the whole `next build` while prerendering /_not-found. Static
// pages must never depend on auth being configured, so we skip the provider instead.
const isUsableAppId = !!appId && appId.length >= 20 && !appId.includes("-");

export function Providers({ children }: { children: React.ReactNode }) {
  if (!isUsableAppId) {
    if (typeof window !== "undefined") {
      console.error(
        "NEXT_PUBLIC_PRIVY_APP_ID is missing or malformed: login is disabled in this build.",
      );
    }
    return <>{children}</>;
  }

  return (
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
  );
}

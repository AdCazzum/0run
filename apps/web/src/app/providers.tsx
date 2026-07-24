"use client";
import { PrivyProvider } from "@privy-io/react-auth";
import { galileo } from "@/lib/chain";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
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

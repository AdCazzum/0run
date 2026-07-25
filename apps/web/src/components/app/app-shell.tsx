"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

const TABS = [
  { href: "/dashboard", label: "Runs", match: (p: string) => p === "/dashboard" || p.startsWith("/runs") },
  { href: "/upload", label: "Upload", match: (p: string) => p.startsWith("/upload") },
  { href: "/coach", label: "Coach", match: (p: string) => p.startsWith("/coach") || p.startsWith("/mint") },
];

/**
 * Post-login chrome, phone-first: a compact sticky top bar and a bottom tab
 * bar that stays put like a native app. The tab bar is typographic — the same
 * uppercase micro-labels and orange ● marker the rest of the design uses —
 * so the app keeps its editorial identity without pretending to be iOS.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, logout } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } finally {
      router.push("/");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-navy/10 bg-cream/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center justify-between px-5 md:px-8">
          <Link
            href="/dashboard"
            className="font-serif text-xl italic tracking-tight text-navy outline-none focus-visible:ring-1 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            0run<span className="not-italic text-orange">.</span>
          </Link>

          <div className="flex items-center gap-8">
            <nav aria-label="Sections" className="hidden items-center gap-8 md:flex">
              {TABS.map((tab) => {
                const active = tab.match(pathname);
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={`py-4 font-sans text-[10px] uppercase tracking-[0.25em] transition-colors duration-500 hover:text-orange ${
                      active ? "text-navy" : "text-ocean"
                    }`}
                  >
                    {active && <span aria-hidden className="mr-2 text-[8px] text-orange">●</span>}
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
            {/* Public coach directory — deliberately outside TABS/the tab bar
                grid (another session owns that structure): every agent that
                exists on-chain, discoverable by anyone, not just the signed-in
                athlete. Kept visible at every breakpoint, unlike the tabs. */}
            <Link
              href="/coaches"
              className="py-4 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean transition-colors duration-500 hover:text-orange"
            >
              Coaches
            </Link>
            {ready && authenticated && (
              <button
                onClick={() => void handleSignOut()}
                disabled={signingOut}
                className="py-4 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline disabled:opacity-50"
              >
                {signingOut ? "signing out…" : "Sign out"}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-5 pb-28 pt-8 md:px-8 md:pb-20 md:pt-14">
        {children}
      </main>

      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-navy/10 bg-cream/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,78,137,0.06)] backdrop-blur md:hidden"
      >
        <div className="grid grid-cols-3">
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1.5 font-sans text-[10px] uppercase tracking-[0.25em] transition-colors duration-500 ${
                  active ? "text-navy" : "text-ocean/70"
                }`}
              >
                <span aria-hidden className={`text-[8px] ${active ? "text-orange" : "text-transparent"}`}>●</span>
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

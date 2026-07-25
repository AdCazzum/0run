"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/landing/site-header";

const TABS = [
  { href: "/dashboard", label: "Runs", match: (p: string) => p === "/dashboard" || p.startsWith("/runs") },
  { href: "/upload", label: "Upload", match: (p: string) => p.startsWith("/upload") },
  { href: "/coach", label: "Coach", match: (p: string) => p.startsWith("/coach") || p.startsWith("/mint") },
];

/**
 * Post-login chrome, phone-first: the site header (shared with every other
 * page) plus a bottom tab bar that stays put like a native app. The tab bar is
 * typographic — the same uppercase micro-labels and orange ● marker the rest of
 * the design uses — so the app keeps its editorial identity without pretending
 * to be iOS. It exists only on phones, where the same three destinations are
 * hidden in the header to keep it one line.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh flex-col">
      {/* The one header the whole site uses — see components/landing/site-header.tsx.
          This shell used to carry its own, so walking from the dashboard to a
          public page swapped the navigation out from under the reader. */}
      <SiteHeader />

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-5 pb-28 pt-8 md:px-8 md:pb-20 md:pt-14">
        {children}
      </main>

      <nav
        // Distinct from the header's "Sections": on a phone both are on screen
        // at once, and two navigation landmarks with the same name are
        // indistinguishable to anyone browsing by landmark.
        aria-label="App"
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

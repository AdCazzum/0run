"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import { usePrivyReady } from "@/app/providers";
import { forgetUserKey } from "@/lib/client/useUserKey";

const SECTIONS = [
  { href: "/coaches", label: "Coaches" },
  { href: "/events", label: "Events" },
  { href: "/technology", label: "Technology" },
];

/** The same three destinations the signed-in app shows in its own tab bar. */
const APP_TABS = [
  { href: "/dashboard", label: "Runs" },
  { href: "/upload", label: "Upload" },
  { href: "/coach", label: "Coach" },
];

const LINK_CLASS =
  "py-2 font-sans text-[10px] uppercase tracking-[0.25em] underline-offset-4 transition-colors duration-500 hover:text-orange";

/**
 * The site's only header. Every page renders this one — public or signed-in,
 * editorial or app.
 *
 * There used to be two: this one and the app's own bar. Crossing between them
 * (dashboard → coaches) swapped the navigation out from under the reader, which
 * is disorienting in a way no amount of styling fixes. The only thing that
 * changes now is what a reader can actually reach: signed in, the app's three
 * destinations and a way out; signed out, a way in.
 *
 * On phones the app tabs stay hidden here and live in AppShell's bottom bar
 * instead — thumb-reachable, and the header would otherwise wrap to three rows.
 */
export function SiteHeader() {
  const pathname = usePathname();
  // Privy hooks are only legal where the provider is mounted, and a public page
  // must render without it (see providers.tsx — this is what turned the landing
  // page into a 500). Hooks cannot be conditional, so the branch is a component.
  const privyReady = usePrivyReady();

  return (
    <header className="sticky top-0 z-40 border-b border-navy/15 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-8 gap-y-2 px-8 py-4 md:px-16">
        <Link
          href="/"
          className="font-serif text-2xl italic tracking-tight text-navy outline-none [font-variant-numeric:slashed-zero] focus-visible:ring-1 focus-visible:ring-navy"
        >
          0run<span className="not-italic text-orange">.</span>
        </Link>

        <nav aria-label="Sections" className="flex flex-wrap items-center gap-x-6 gap-y-1 md:gap-x-10">
          {SECTIONS.map((section) => {
            const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`${LINK_CLASS} ${active ? "text-navy" : "text-ocean"}`}
              >
                {active && <span aria-hidden className="mr-2 text-[8px] text-orange">●</span>}
                {section.label}
              </Link>
            );
          })}
          {privyReady ? <SignedInLinks /> : <SignedOutLinks />}
        </nav>
      </div>
    </header>
  );
}

/** Auth is not configured in this build: still offer the destination. */
function SignedOutLinks() {
  return (
    <Link href="/dashboard" className={`${LINK_CLASS} text-navy hover:underline`}>
      Your runs ↗
    </Link>
  );
}

function SignedInLinks() {
  const { ready, authenticated, logout } = usePrivy();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  if (!ready || !authenticated) return <SignedOutLinks />;

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } finally {
      // The data key derived from this person's signature is held in memory for
      // the session; signing out has to drop it, or the next person to log in
      // on this tab starts with it still there.
      forgetUserKey();
      router.push("/");
    }
  }

  return (
    <>
      <span aria-hidden className="hidden h-4 w-px bg-navy/20 md:block" />
      {APP_TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className={`hidden md:inline-block ${LINK_CLASS} text-navy hover:underline`}>
          {tab.label}
        </Link>
      ))}
      <button
        onClick={() => void handleSignOut()}
        disabled={signingOut}
        className={`${LINK_CLASS} text-ocean hover:underline disabled:opacity-50`}
      >
        {signingOut ? "signing out…" : "Sign out"}
      </button>
    </>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/coaches", label: "Directory" },
  { href: "/events", label: "Events" },
  { href: "/technology", label: "Technology" },
];

const LINK_CLASS =
  "py-2 font-sans text-[10px] uppercase tracking-[0.25em] underline-offset-4 transition-colors duration-500 hover:text-orange";

/**
 * Navigation for the public, unauthenticated pages.
 *
 * These pages used to have no chrome at all, so anyone who reached the coach
 * directory from inside the app was stranded there: no way back to Runs,
 * Upload or Coach except the browser's back button. The right-hand link is
 * that way back; it points into the app and is shown to everyone, because
 * whether someone is signed in is only knowable client-side and a public page
 * must not depend on the auth provider being configured at all (a lesson from
 * the landing page 500 — see providers.tsx).
 *
 * Deliberately NOT the app's AppShell: that one is the soft, 1100px-wide,
 * bottom-tab-bar register for a signed-in athlete on a phone. This is the
 * editorial register — full 1600px measure, hairline rules, typographic
 * labels — so the public site stays a public site.
 */
export function SiteHeader() {
  const pathname = usePathname();

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
          <Link href="/dashboard" className={`${LINK_CLASS} text-navy hover:underline`}>
            Your runs ↗
          </Link>
        </nav>
      </div>
    </header>
  );
}

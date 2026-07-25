import Link from "next/link";

const EXTERNAL_LINKS = [
  { href: "https://github.com/AdCazzum/0run", label: "GitHub" },
  { href: "https://ethglobal.com/events/lisbon", label: "ETHGlobal Lisbon 2026" },
];

const LINK_CLASS =
  "inline-block py-3 font-sans text-[10px] uppercase tracking-[0.25em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline";

export function SiteFooter() {
  return (
    <footer className="border-t border-navy">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-12 px-8 py-16 md:flex-row md:items-end md:justify-between md:px-16 md:py-24">
        <div>
          <span aria-hidden className="mb-6 block h-px w-12 bg-navy" />
          <p className="font-serif text-4xl italic text-navy [font-variant-numeric:slashed-zero]">
            0run
          </p>
          <p className="mt-4 max-w-xs font-sans text-sm leading-relaxed text-ocean">
            The AI running coach you own — private, personal, and yours for good.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-10 gap-y-4">
          <Link href="/technology" className={LINK_CLASS}>
            Technology
          </Link>
          <Link href="/coaches" className={LINK_CLASS}>
            Coach directory
          </Link>
          {EXTERNAL_LINKS.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
              {l.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="mx-auto max-w-[1600px] border-t border-navy/15 px-8 py-6 md:px-16">
        <p className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
          Made at ETHGlobal Lisbon 2026 · Built in the open
        </p>
      </div>
    </footer>
  );
}

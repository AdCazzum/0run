import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-navy">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-8 px-8 py-12 md:flex-row md:items-end md:justify-between md:px-16">
        <div>
          <span className="font-serif text-3xl text-navy [font-variant-numeric:slashed-zero]">
            0run
          </span>
          <div className="mt-2 flex items-center gap-3">
            <span aria-hidden className="h-px w-8 bg-navy/40" />
            <span className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
              The AI running coach you own
            </span>
          </div>
        </div>
        <nav className="flex flex-wrap gap-8 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
          <Link
            href="/technology"
            className="transition-colors duration-500 hover:text-orange"
          >
            Technology
          </Link>
          <a
            href="https://github.com/AdCazzum/0run"
            className="transition-colors duration-500 hover:text-orange"
          >
            GitHub
          </a>
          <span>ETHGlobal Lisbon 2026</span>
        </nav>
      </div>
    </footer>
  );
}

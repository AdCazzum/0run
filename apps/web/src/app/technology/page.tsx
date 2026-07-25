import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/landing/site-footer";

export const metadata: Metadata = {
  title: "The technology — 0run",
  description:
    "Every promise on the home page is backed by open, inspectable infrastructure. Encrypted storage, verifiable AI inference, a coach you truly own.",
};

const PILLARS = [
  {
    promise: "Your data stays private",
    how: "Every run is encrypted with AES-256 before it leaves your device and stored on 0G Storage, a decentralized storage network. The encryption key is derived from your wallet signature and is never persisted anywhere: only you can unlock your files.",
    label: "Encryption / 0G Storage",
  },
  {
    promise: "The coach is yours",
    how: "Your coach is an intelligent NFT (ERC-7857 “Agentic ID”) minted on 0G Chain. Its memory — everything it has learned about you — belongs to the token, and the token belongs to your wallet. No platform sits between you and your coach.",
    label: "iNFT / 0G Chain",
  },
  {
    promise: "Nobody reads your runs",
    how: "Analysis runs on 0G Compute inside a trusted execution environment (TEE): the hardware itself guarantees that nobody — not the provider, not us — can peek at your data while the coach thinks. Each response ships with a cryptographic attestation.",
    label: "TEE inference / 0G Compute",
  },
  {
    promise: "Check it yourself",
    how: "Every run produces on-chain receipts: the hash of your coach’s updated memory is written to a public registry, and storage and inference leave verifiable traces on public explorers. You never have to take our word for it.",
    label: "On-chain proofs",
  },
];

export default function TechnologyPage() {
  return (
    <main>
      <section className="mx-auto max-w-[1600px] px-8 pb-16 pt-32 md:px-16">
        <div className="mb-8 flex items-center gap-4">
          <span aria-hidden className="h-px w-12 bg-navy" />
          <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">
            The technology
          </span>
        </div>
        <h1 className="max-w-4xl font-serif text-5xl leading-[0.95] tracking-tight text-navy md:text-7xl">
          Verifiable <em className="italic text-orange">by default.</em>
        </h1>
        <p className="mt-8 max-w-xl font-sans text-lg leading-relaxed text-navy">
          Every promise on the home page is backed by open, inspectable
          infrastructure. Here is how.
        </p>
      </section>

      {PILLARS.map((p, i) => (
        <section key={p.promise} className="border-t border-navy/15">
          <div className="mx-auto grid max-w-[1600px] grid-cols-12 gap-8 px-8 py-16 md:px-16 md:py-24">
            <div className="col-span-12 md:col-span-4 md:col-start-1">
              <span className="font-serif text-2xl italic text-orange">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 className="mt-4 font-serif text-3xl text-navy md:text-4xl">
                {p.promise}
              </h2>
            </div>
            <div className="col-span-12 md:col-span-6 md:col-start-6">
              <span className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
                {p.label}
              </span>
              <p className="mt-4 font-sans text-lg leading-relaxed text-navy">
                {p.how}
              </p>
            </div>
          </div>
        </section>
      ))}

      <section className="border-t border-navy/15">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-8 px-8 py-16 md:px-16">
          <Link
            href="/"
            className="font-sans text-xs uppercase tracking-[0.2em] text-ocean transition-colors duration-500 hover:text-orange"
          >
            &larr; Back home
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex h-12 items-center bg-navy px-10 font-sans text-xs font-medium uppercase tracking-[0.2em] text-cream shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-shadow duration-500 hover:shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
          >
            Start running
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

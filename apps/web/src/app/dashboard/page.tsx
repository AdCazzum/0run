import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="mx-auto flex min-h-[88vh] max-w-[1600px] flex-col justify-end px-8 pb-24 pt-32 md:px-16">
      <div className="mb-8 flex items-center gap-4">
        <span aria-hidden className="h-px w-12 bg-navy" />
        <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">
          Coming soon
        </span>
      </div>
      <h1 className="max-w-4xl font-serif text-5xl leading-[0.95] tracking-tight text-navy md:text-7xl">
        Your coach is <em className="italic text-orange">in training.</em>
      </h1>
      <p className="mt-8 max-w-md font-sans text-lg leading-relaxed text-navy">
        The app opens at ETHGlobal Lisbon 2026. Come back soon — or watch the
        build in the open.
      </p>
      <Link
        href="/"
        className="mt-12 font-sans text-xs uppercase tracking-[0.2em] text-ocean transition-colors duration-500 hover:text-orange"
      >
        &larr; Back home
      </Link>
    </main>
  );
}

import Link from "next/link";

const BENEFITS = [
  {
    title: "Truly private",
    body: "Nobody can read your runs. Not even us.",
  },
  {
    title: "Always yours",
    body: "Your coach and your history belong to you, not to a platform.",
  },
  {
    title: "Remembers everything",
    body: "Advice built on your whole story, not last week's.",
  },
  {
    title: "Proof, not promises",
    body: "Everything your coach says can be independently checked.",
  },
];

export function BenefitsSection() {
  return (
    <section className="bg-navy py-24 text-cream md:py-32">
      <div className="mx-auto max-w-[1600px] px-8 md:px-16">
        <div className="mb-6 flex items-center gap-4">
          <span aria-hidden className="h-px w-8 bg-cream/40" />
          <span className="font-sans text-xs uppercase tracking-[0.3em] text-peach/80">
            Why 0run
          </span>
        </div>
        <h2 className="font-serif text-4xl tracking-tight text-cream md:text-6xl">
          Yours, <em className="italic text-orange">for good.</em>
        </h2>
        <div className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-4">
          {BENEFITS.map((b) => (
            <div key={b.title} className="border-t border-cream/20 pt-8">
              <h3 className="font-serif text-2xl text-cream">{b.title}</h3>
              <p className="mt-4 font-sans text-base leading-relaxed text-peach/80">
                {b.body}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-20 font-sans text-sm text-peach/80">
          Curious how it works under the hood?{" "}
          <Link
            href="/technology"
            className="underline decoration-peach/40 underline-offset-4 transition-colors duration-500 hover:text-cream hover:decoration-orange"
          >
            The technology &rarr;
          </Link>
        </p>
      </div>
    </section>
  );
}

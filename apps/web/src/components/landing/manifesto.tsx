export function Manifesto() {
  return (
    <section className="border-t border-navy/15 py-24 md:py-32">
      <div className="mx-auto grid max-w-[1600px] grid-cols-12 px-8 md:px-16">
        <p className="col-span-12 font-serif text-2xl leading-relaxed text-navy first-letter:float-left first-letter:mr-4 first-letter:font-serif first-letter:text-7xl first-letter:leading-[0.8] first-letter:text-orange md:col-span-6 md:col-start-6 md:text-3xl">
          Your running history is the story of your body. Today it lives on
          servers you don&rsquo;t control, inside apps that can change the
          rules overnight. <span className="[font-variant-numeric:slashed-zero]">0run</span> starts from a different premise: your runs
          belong to you, and so does the coach who learns from them. If you
          ever leave, everything leaves with you.
        </p>
      </div>
    </section>
  );
}

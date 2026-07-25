export function Manifesto() {
  return (
    <section className="border-t border-navy/15 py-24 md:py-32">
      <div className="mx-auto grid max-w-[1600px] grid-cols-12 gap-y-12 px-8 md:px-16">
        <div className="col-span-12 md:col-span-4 md:col-start-1">
          <div className="flex items-center gap-4">
            <span aria-hidden className="h-px w-8 bg-navy" />
            <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">
              Manifesto
            </span>
          </div>
          <h2 className="mt-6 font-serif text-5xl leading-[0.95] text-navy md:text-7xl">
            Your data.
            <br />
            Your <em className="italic text-orange">coach.</em>
          </h2>
        </div>

        <div className="col-span-12 md:col-span-6 md:col-start-6">
          <p className="font-sans text-lg leading-relaxed text-navy first-letter:float-left first-letter:mr-3 first-letter:font-serif first-letter:text-7xl first-letter:leading-[0.8] first-letter:text-navy">
            Every run you have ever logged lives in someone else&rsquo;s app — years of effort
            behind a login you don&rsquo;t control, under rules that can change overnight.{" "}
            <span className="[font-variant-numeric:slashed-zero]">0run</span> starts from a
            different premise: your runs belong to you, and so does the coach who learns from
            them. Yours like the shoes by your door, not like an account you rent. It keeps your
            story private, it answers to no one but you, and if you ever leave, everything
            leaves with you.
          </p>
        </div>
      </div>
    </section>
  );
}

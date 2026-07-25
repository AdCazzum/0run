const STEPS = [
  {
    n: "01",
    title: "Upload your run",
    body: "Drop a GPX. It is encrypted client-side and stored on 0G decentralized storage — only your wallet can unlock it.",
  },
  {
    n: "02",
    title: "Meet your coach",
    body: "An AI coach minted as an intelligent NFT. Analysis runs in a trusted execution environment: nobody reads your data. Not even us.",
  },
  {
    n: "03",
    title: "Watch it grow",
    body: "Every run feeds its encrypted memory, hashed on-chain. Switch apps, keep the coach. One day, lend it.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-t border-navy/15">
      <div className="mx-auto max-w-[1600px] px-8 pt-24 md:px-16 md:pt-32">
        <div className="grid grid-cols-12">
          <div className="col-span-12 md:col-span-6 md:col-start-2">
            <div className="flex items-center gap-4">
              <span aria-hidden className="h-px w-8 bg-navy" />
              <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">
                How it works
              </span>
            </div>
            <h2 className="mt-6 font-serif text-4xl leading-[0.95] text-navy md:text-5xl">
              Three steps to a coach that is <em className="italic text-orange">yours.</em>
            </h2>
          </div>
        </div>
      </div>
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-12 px-8 py-16 md:grid-cols-3 md:px-16 md:pb-32 md:pt-16">
        {STEPS.map((s) => (
          <div
            key={s.n}
            className="border-t border-navy p-8 transition-colors duration-700 hover:bg-peach/20 md:p-12"
          >
            <span className="font-serif text-2xl italic text-orange">{s.n}</span>
            <h3 className="mt-6 font-serif text-3xl text-navy">{s.title}</h3>
            <p className="mt-4 font-sans text-base leading-relaxed text-navy">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

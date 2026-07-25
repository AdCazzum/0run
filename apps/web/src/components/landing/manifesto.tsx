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
          <h2 className="mt-6 font-serif text-4xl leading-[0.95] text-navy md:text-5xl">
            Your data.
            <br />
            Your <em className="italic text-orange">coach.</em>
          </h2>
        </div>

        <div className="col-span-12 md:col-span-6 md:col-start-6">
          <p className="font-sans text-lg leading-relaxed text-navy first-letter:float-left first-letter:mr-3 first-letter:font-serif first-letter:text-7xl first-letter:leading-[0.8] first-letter:text-navy">
            Strava owns your data — your pace, your routes, your history — the moment you save
            it. Every training app you have ever used keeps its copy of years of effort behind a
            login it controls, not you. 0run inverts that. Your runs are encrypted before they
            ever leave your device, stored on decentralized infrastructure, and unlocked by
            nothing but your own wallet. Your coach is not a feature of an app you rent — it is
            an intelligent NFT you own outright, one whose memory of every kilometre travels with
            you, provably yours, verifiable by anyone, readable by no one but you.
          </p>
        </div>
      </div>
    </section>
  );
}

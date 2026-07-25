const STACK = [
  {
    label: "Storage",
    title: "0G Storage",
    body: "Every GPX file is encrypted client-side before it ever leaves your device, then written to 0G's decentralized storage network. No single server holds a readable copy.",
  },
  {
    label: "Compute TEE",
    title: "0G Compute",
    body: "Coach inference runs on 0G Compute — about 20 seconds measured latency, billed on-chain against a provider address and request ID. We select for TEE-attested providers, so verification is built into the model, not just claimed after the fact.",
  },
  {
    label: "Agentic ID",
    title: "Intelligent NFT",
    body: "Your coach is minted as an ERC-7857-style intelligent NFT. Its personality and memory are bound to a token you hold, not an account you rent.",
  },
  {
    label: "Chain",
    title: "0G Galileo",
    body: "Contracts are live on 0G Galileo (chainId 16602). Every memory update is hashed and anchored on-chain, so the coach's growth is verifiable by anyone.",
  },
];

export function StackSection() {
  return (
    <section className="bg-navy py-24 text-cream md:py-32">
      <div className="mx-auto max-w-[1600px] px-8 md:px-16">
        <div className="grid grid-cols-12">
          <div className="col-span-12 md:col-span-7 md:col-start-2">
            <div className="flex items-center gap-4">
              <span aria-hidden className="h-px w-8 bg-cream/40" />
              <span className="font-sans text-xs uppercase tracking-[0.3em] text-peach/80">
                Built on 0G
              </span>
            </div>
            <h2 className="mt-6 font-serif text-5xl leading-[0.95] text-cream md:text-7xl">
              Verifiable <em className="italic text-orange">by default.</em>
            </h2>
          </div>
        </div>

        <div className="mt-20 grid grid-cols-1 gap-12 md:mt-28 md:grid-cols-4">
          {STACK.map((s) => (
            <div key={s.label} className="border-t border-cream/20 pt-8">
              <span className="font-sans text-xs uppercase tracking-[0.25em] text-peach/80">
                {s.label}
              </span>
              <h3 className="mt-4 font-serif text-2xl text-cream">{s.title}</h3>
              <p className="mt-3 font-sans text-sm leading-relaxed text-peach/80">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

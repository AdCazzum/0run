import { Card } from "@/components/ui/card";

const STEPS = [
  {
    n: "01",
    title: "Upload your run",
    body: "Drag in a run from your watch or phone. It is locked away the moment it arrives — only you can open it.",
  },
  {
    n: "02",
    title: "Meet your coach",
    body: "A personal AI coach reads your run and tells you what it means: where you are improving, what to do next. Nobody else can read your data. Not even us.",
  },
  {
    n: "03",
    title: "Watch it grow",
    body: "Your coach remembers every run and knows you better each week. And it is yours for good: change apps, change devices — the coach comes with you.",
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
            <h2 className="mt-6 font-serif text-5xl leading-[0.95] text-navy md:text-7xl">
              Three steps to a coach that is <em className="italic text-orange">yours.</em>
            </h2>
          </div>
        </div>
      </div>
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-12 px-8 py-16 md:grid-cols-3 md:px-16 md:pb-32 md:pt-16">
        {STEPS.map((s) => (
          <Card key={s.n}>
            <span className="font-serif text-2xl italic text-orange">{s.n}</span>
            <h3 className="mt-6 font-serif text-3xl text-navy">{s.title}</h3>
            <p className="mt-4 font-sans text-base leading-relaxed text-navy">{s.body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

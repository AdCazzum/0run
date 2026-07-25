"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function Hero() {
  const router = useRouter();
  return (
    <section className="relative mx-auto grid min-h-[88vh] max-w-[1600px] grid-cols-12 items-end px-8 pb-24 pt-32 md:px-16">
      <span
        aria-hidden
        className="absolute right-8 top-32 hidden font-sans text-[10px] uppercase tracking-[0.3em] text-ocean lg:block"
        style={{ writingMode: "vertical-rl" }}
      >
        0run / Vol. 01 — Lisboa
      </span>
      <div className="col-span-12 md:col-span-9 md:col-start-2">
        <div className="mb-8 flex items-center gap-4">
          <span data-testid="hero-overline-line" aria-hidden className="h-px w-12 bg-navy" />
          <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">
            The AI running coach you own
          </span>
        </div>
        <h1 className="font-serif text-6xl leading-[0.9] tracking-tight text-navy md:text-9xl">
          Own your
          <br />
          <em className="italic text-orange">Coach.</em>
          <br />
          Own your runs.
        </h1>
        <p className="mt-10 max-w-md font-sans text-lg leading-relaxed text-navy">
          A coach that is only yours. It remembers every run, learns how you
          train, and gets sharper with every kilometre. Your data stays private
          — nobody else can read it. Not even us.
        </p>
        <div className="mt-12 flex flex-wrap items-center gap-6">
          <Button variant="primary" onClick={() => router.push("/dashboard")}>
            Start running
          </Button>
          <Button
            variant="link"
            onClick={() =>
              document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            How it works
          </Button>
        </div>
      </div>
    </section>
  );
}

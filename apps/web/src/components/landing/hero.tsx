"use client";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function Hero() {
  const { authenticated } = usePrivy();
  const router = useRouter();
  const { login } = useLogin({ onComplete: () => router.push("/dashboard") });

  const handleStart = () => (authenticated ? router.push("/dashboard") : login());
  const handleHowItWorks = () =>
    document.getElementById("how")?.scrollIntoView({ behavior: "smooth" });

  return (
    <section className="relative mx-auto grid min-h-[88vh] max-w-[1600px] grid-cols-12 items-end gap-y-16 px-8 pb-24 pt-40 md:px-16">
      <span
        aria-hidden
        className="absolute right-8 top-32 hidden font-sans text-[10px] uppercase tracking-[0.3em] text-ocean lg:block md:right-16"
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
      </div>

      <div className="col-span-12 mt-2 md:col-span-4 md:col-start-9 md:mt-0">
        <p className="max-w-md font-sans text-lg leading-relaxed text-navy">
          Your runs, encrypted on decentralized storage. Your coach, an intelligent NFT whose
          memory grows with every kilometre. Private by design, verifiable by default.
        </p>
        <div className="mt-10 flex flex-wrap gap-6">
          <Button variant="primary" onClick={handleStart}>
            Start running
          </Button>
          <Button variant="link" onClick={handleHowItWorks}>
            How it works
          </Button>
        </div>
      </div>
    </section>
  );
}

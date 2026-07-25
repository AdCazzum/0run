"use client";
import { useEffect, useRef, useState } from "react";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { PERSONALITY_STYLE, type Personality } from "@0run/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useUserKey } from "@/lib/client/useUserKey";

const PERSONALITIES: { id: Personality; title: string }[] = [
  { id: "pacer", title: "The Pacer" },
  { id: "coach", title: "The Coach" },
  { id: "drill_sergeant", title: "The Drill Sergeant" },
];

// Real inference + 0G Storage finality run tens of seconds long. A step
// label that advances slowly tells the truth about that latency instead of
// a spinner that implies the mint is instant.
const MINT_STEPS = [
  "encrypting your data",
  "uploading to 0g storage",
  "minting on 0g galileo…",
  "writing to the coach registry",
];

type Phase = "form" | "minting" | "success";
type MintResult = { tokenId: string; mintTx: string; explorerUrl: string };

/** Cross-fades in on every text change; a genuine >=500ms CSS transition, not a snap. */
function FadingLabel({ text, className = "" }: { text: string; className?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <span className={`transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"} ${className}`}>
      {text}
    </span>
  );
}

export default function MintPage() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { login } = useLogin();
  const { getKeyHex } = useUserKey();

  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Personality | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MintResult | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    if (phase !== "minting") return;
    setStepIndex(0);
    const id = setInterval(() => setStepIndex((i) => Math.min(i + 1, MINT_STEPS.length - 1)), 4000);
    return () => clearInterval(id);
  }, [phase]);

  async function handleMint() {
    if (submitting.current || !selected || !name.trim()) return;
    submitting.current = true;
    setError(null);
    setPhase("minting");
    try {
      const [keyHex, token] = await Promise.all([getKeyHex(), getAccessToken()]);
      if (!token) throw new Error("session expired, please sign in again");

      // Best-effort gas top-up for the user's embedded wallet. The mint
      // itself is paid for server-side by the treasury signer (see
      // mintCoachOnChain), so a funding hiccup (cap reached, rpc blip)
      // must not block minting the coach.
      try {
        await fetch("/api/fund", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      } catch {
        /* non-fatal, see above */
      }

      const res = await fetch("/api/coach/mint", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), personality: selected, userKeyHex: keyHex }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "mint failed");
      setResult(body);
      setPhase("success");
    } catch (e: any) {
      setError(e.message ?? "something went wrong");
      setPhase("form");
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section className="relative mx-auto grid max-w-[1600px] grid-cols-12 gap-y-16 px-8 pb-32 pt-40 md:px-16">
      <span
        aria-hidden
        className="absolute right-8 top-32 hidden font-sans text-[10px] uppercase tracking-[0.3em] text-ocean lg:block md:right-16"
        style={{ writingMode: "vertical-rl" }}
      >
        0run / Vol. 01 — Onboarding
      </span>

      <div className="col-span-12 md:col-span-9 md:col-start-2">
        <div className="mb-8 flex items-center gap-4">
          <span aria-hidden className="h-px w-12 bg-navy" />
          <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Step one of one</span>
        </div>
        <h1 className="font-serif text-5xl leading-[0.9] tracking-tight text-navy md:text-7xl">
          Choose your <em className="italic text-orange">Coach</em>.
        </h1>
        <p className="mt-6 max-w-xl font-sans text-lg leading-relaxed text-navy">
          Your coach is an intelligent NFT: a personality you pick, a memory encrypted on 0G Storage,
          an identity minted on 0G Galileo. It only ever grows from here.
        </p>
      </div>

      {phase === "form" && (
        <>
          <div className="col-span-12 md:col-span-5 md:col-start-2">
            <label htmlFor="coach-name" className="mb-3 block font-sans text-xs uppercase tracking-[0.3em] text-ocean">
              Name your coach
            </label>
            <Input
              id="coach-name"
              placeholder="name your coach"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="col-span-12">
            <div className="mb-8 flex items-center gap-4">
              <span aria-hidden className="h-px w-12 bg-navy" />
              <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Choose a personality</span>
            </div>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              {PERSONALITIES.map((p) => {
                const isSelected = selected === p.id;
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelected(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(p.id);
                      }
                    }}
                    className="cursor-pointer text-left outline-none focus-visible:ring-1 focus-visible:ring-orange focus-visible:ring-offset-2"
                  >
                    <Card featured={isSelected} className={isSelected ? "bg-peach/40" : ""}>
                      <h3 className="font-serif text-3xl text-navy">{p.title}</h3>
                      <p className="mt-4 font-sans text-sm leading-relaxed text-ocean">{PERSONALITY_STYLE[p.id]}</p>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="col-span-12 md:col-span-5 md:col-start-2">
            {error && <p className="mb-4 font-sans text-sm text-orange">{error}</p>}
            {ready && !authenticated ? (
              <Button variant="primary" onClick={() => login()}>
                Sign in to continue
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!ready || !selected || !name.trim()}
                onClick={handleMint}
              >
                Mint your coach
              </Button>
            )}
          </div>
        </>
      )}

      {phase === "minting" && (
        <div className="col-span-12 flex min-h-[30vh] flex-col justify-center md:col-span-7 md:col-start-2">
          <div className="flex items-center gap-4">
            <span aria-hidden className="h-px w-12 bg-orange" />
            <FadingLabel
              key={stepIndex}
              text={MINT_STEPS[stepIndex]}
              className="font-sans text-xs uppercase tracking-[0.3em] text-navy"
            />
          </div>
          <p className="mt-6 max-w-md font-sans text-sm leading-relaxed text-ocean">
            This is a real transaction on 0G Galileo — inference and storage finality take a little
            time. Stay on this page.
          </p>
        </div>
      )}

      {phase === "success" && result && (
        <div className="col-span-12 md:col-span-7 md:col-start-2">
          <div className="mb-8 flex items-center gap-4">
            <span aria-hidden className="h-px w-12 bg-orange" />
            <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Coach minted</span>
          </div>
          <h2 className="font-serif text-4xl leading-[0.95] tracking-tight text-navy md:text-6xl">
            {name} is <em className="italic text-orange">live</em>.
          </h2>
          <p className="mt-6 font-sans text-sm text-ocean">Token #{result.tokenId}</p>
          <div className="mt-8">
            <Button
              variant="link"
              onClick={() => window.open(result.explorerUrl, "_blank", "noopener,noreferrer")}
            >
              View transaction on Chainscan
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

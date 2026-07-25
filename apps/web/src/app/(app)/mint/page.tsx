"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { EXPERTISE_MAX, PERSONALITY_STYLE, type Personality } from "@0run/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUserKey } from "@/lib/client/useUserKey";

const PERSONALITIES: { id: Personality; title: string }[] = [
  { id: "pacer", title: "The Pacer" },
  { id: "coach", title: "The Coach" },
  { id: "drill_sergeant", title: "The Drill Sergeant" },
];

// Root hashes are now computed locally before any network call, so the
// on-chain mint itself is a matter of seconds (see docs/0g-reality-check.md
// and the mint route). The old fixed 4-step/4s-per-step timeline implied a
// slow, linear pipeline that no longer matches reality — and hid the one
// thing that genuinely is slow (0G Storage propagation, which now happens
// in the BACKGROUND, after the response). An honest UI needs only two
// things: a real elapsed-time counter, and a label that switches once from
// "local, near-instant" to "waiting on-chain" — driven by actual elapsed
// time, not a fake cadence.
const ENCRYPT_LABEL_WINDOW_SEC = 3;

/** mm:ss, always two digits each — a genuine ticking counter, not a guess dressed as one. */
function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// The server budgets its own synchronous (on-chain) work at 90s and returns
// an honest 504 past that (see MINT_BUDGET_MS in the mint route) rather than
// letting nginx's 300s proxy cutoff kill the connection with no explanation.
// This client-side abort sits comfortably above that server budget — enough
// margin for network latency and queuing — but still finite: the fetch must
// never hang forever on the client either.
const MINT_CLIENT_TIMEOUT_MS = 120_000;
const FUND_CLIENT_TIMEOUT_MS = 10_000; // best-effort gas top-up; short leash, never blocks the mint

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
  const router = useRouter();

  const [name, setName] = useState("");
  // What this coach knows, in the athlete's own words. Public on purpose (see
  // the label below): it is what makes one coach worth asking over another.
  const [expertise, setExpertise] = useState("");
  const [selected, setSelected] = useState<Personality | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  // Actionable detail that came with a refusal (currently the World
  // human-backing gate): the command to run, and what it does not restrict.
  const [howTo, setHowTo] = useState<{ howTo: string; note?: string } | null>(null);
  const [result, setResult] = useState<MintResult | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    if (phase !== "minting") return;
    setElapsedSec(0);
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const mintLabel = elapsedSec < ENCRYPT_LABEL_WINDOW_SEC ? "encrypting your data" : "minting on 0g galileo…";

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
      // mintCoachOnChain), so a funding hiccup (cap reached, rpc blip,
      // or even a hang) must not block minting the coach — bounded by its
      // own short timeout so it can never stall the flow below.
      try {
        await fetchWithTimeout("/api/fund", { method: "POST", headers: { authorization: `Bearer ${token}` } }, FUND_CLIENT_TIMEOUT_MS);
      } catch {
        /* non-fatal, see above */
      }

      let res: Response;
      try {
        res = await fetchWithTimeout("/api/coach/mint", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            name: name.trim(),
            personality: selected,
            userKeyHex: keyHex,
            ...(expertise.trim() ? { expertise: expertise.trim() } : {}),
          }),
        }, MINT_CLIENT_TIMEOUT_MS);
      } catch (e: any) {
        if (e?.name === "AbortError") {
          throw new Error(
            "this is taking longer than expected — the mint may have gone through on-chain even though we didn't hear back; wait a moment, then try again",
          );
        }
        throw e;
      }
      const body = await res.json();
      if (!res.ok) {
        // A refusal that comes with instructions must SHOW them. The
        // human-backing 403 carries `howTo` (a command the person runs to
        // register in World App) and `note`; rendering only `error` left the
        // user staring at a dead end they had no way to get past.
        if (body.howTo) setHowTo({ howTo: body.howTo, note: body.note });
        throw new Error(body.error ?? "mint failed");
      }
      setHowTo(null);
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
    <section className="flex flex-col gap-10 md:gap-14">
      <div>
        <div className="mb-6 flex items-center gap-4">
          <span aria-hidden className="h-px w-8 bg-navy md:w-12" />
          <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Step one of one</span>
        </div>
        <h1 className="font-serif text-4xl leading-[0.95] tracking-tight text-navy md:text-6xl">
          Choose your <em className="italic text-orange">Coach</em>.
        </h1>
        <p className="mt-5 max-w-xl font-sans text-base leading-relaxed text-navy md:text-lg">
          Your coach is an intelligent NFT: a personality you pick, a memory encrypted on 0G Storage,
          an identity minted on 0G Galileo. It only ever grows from here.
        </p>
      </div>

      {phase === "form" && (
        <>
          <div className="max-w-md">
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

          <div className="max-w-md">
            <label htmlFor="coach-expertise" className="mb-3 block font-sans text-xs uppercase tracking-[0.3em] text-ocean">
              What does it know? <span className="text-navy/50">optional</span>
            </label>
            <Textarea
              id="coach-expertise"
              rows={3}
              maxLength={EXPERTISE_MAX}
              placeholder="trail ultras, heat adaptation, low heart-rate base building…"
              value={expertise}
              onChange={(e) => setExpertise(e.target.value)}
            />
            <p className="mt-3 font-sans text-sm leading-relaxed text-ocean">
              Shapes how it coaches you — and it is <em className="font-serif italic">public</em>: it appears on your
              coach&apos;s page, in its ENS record, and is what other runners read when they decide whose coach to ask.
              Nothing about your runs is ever published.
            </p>
          </div>

          <div>
            <div className="mb-6 flex items-center gap-4">
              <span aria-hidden className="h-px w-8 bg-navy md:w-12" />
              <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Choose a personality</span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-8">
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
                    className="cursor-pointer rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
                  >
                    <Card featured={isSelected}>
                      <h3 className="font-serif text-2xl text-navy md:text-3xl">{p.title}</h3>
                      <p className="mt-3 font-sans text-sm leading-relaxed text-ocean md:mt-4">{PERSONALITY_STYLE[p.id]}</p>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="max-w-md">
            {error && (
              <div className="mb-6 flex items-start gap-4">
                <span aria-hidden className="mt-1 h-px w-8 shrink-0 bg-orange md:w-12" />
                <div>
                  <p className="font-sans text-sm leading-relaxed text-orange">{error}</p>
                  {howTo && (
                    <>
                      <p className="mt-4 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
                        Run this, then scan the link in World App
                      </p>
                      <code className="mt-2 block overflow-x-auto rounded-xl bg-white/45 px-4 py-3 font-mono text-xs text-navy">
                        {howTo.howTo}
                      </code>
                      {howTo.note && (
                        <p className="mt-3 font-sans text-sm leading-relaxed text-ocean">{howTo.note}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            {ready && !authenticated ? (
              <Button variant="primary" className="w-full md:w-auto" onClick={() => login()}>
                Sign in to continue
              </Button>
            ) : (
              <Button
                variant="primary"
                className="w-full md:w-auto"
                disabled={!ready || !selected || !name.trim()}
                onClick={handleMint}
              >
                {error ? "Try again" : "Mint your coach"}
              </Button>
            )}
          </div>
        </>
      )}

      {phase === "minting" && (
        <div className="flex min-h-[30vh] max-w-xl flex-col justify-center">
          <div className="flex items-center gap-4">
            <span aria-hidden className="h-px w-8 bg-orange md:w-12" />
            <FadingLabel
              key={mintLabel}
              text={mintLabel}
              className="font-sans text-xs uppercase tracking-[0.3em] text-navy"
            />
            <span aria-live="polite" className="font-sans text-xs tabular-nums text-ocean">
              {formatElapsed(elapsedSec)}
            </span>
          </div>
          <p className="mt-6 max-w-md font-sans text-sm leading-relaxed text-ocean">
            The on-chain mint itself is a matter of seconds — your coach&rsquo;s encrypted memory
            keeps propagating to 0G Storage in the background after that. Stay on this page.
          </p>
        </div>
      )}

      {phase === "success" && result && (
        <div className="max-w-xl">
          <div className="mb-6 flex items-center gap-4">
            <span aria-hidden className="h-px w-8 bg-orange md:w-12" />
            <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Coach minted</span>
          </div>
          <h2 className="font-serif text-4xl leading-[0.95] tracking-tight text-navy md:text-6xl">
            {name} is <em className="italic text-orange">live</em>.
          </h2>
          <p className="mt-6 font-sans text-sm text-ocean">Token #{result.tokenId}</p>
          <p className="mt-2 max-w-md font-sans text-sm leading-relaxed text-ocean">
            Confirmed on-chain now. Encrypted storage propagation continues in the background —
            your coach is ready to use in the meantime.
          </p>
          <div className="mt-8 flex flex-col items-start gap-6 md:flex-row md:items-center">
            <Button
              variant="primary"
              className="w-full md:w-auto"
              onClick={() => router.push("/dashboard")}
            >
              Continue to dashboard
            </Button>
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

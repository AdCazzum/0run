"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAccessToken, usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { RunCard } from "@/components/run/run-card";
import { EnsBadge } from "@/components/coach/ens-badge";
import { HumanBackingWidget } from "@/components/world/human-backing-widget";
import type { CoachSummary, RunRow } from "@/components/run/types";

type Feed = { runs: RunRow[]; coach: CoachSummary | null };

export default function DashboardPage() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/runs", { headers: { authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setFeed(body);
      return body as Feed;
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load your runs");
      return null;
    }
  }, []);

  useEffect(() => {
    if (ready && !authenticated) router.push("/");
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (!authenticated) return;
    void load();
  }, [authenticated, load]);

  // A run stays `processing` for minutes (docs/0g-reality-check.md), so the feed
  // keeps polling while any run is unfinished instead of showing a stale card.
  useEffect(() => {
    if (!feed?.runs.some((r) => r.status === "processing")) return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [feed, load]);

  if (!ready || (authenticated && !feed && !error)) {
    return <Overline>loading your runs…</Overline>;
  }
  if (error) {
    return <Overline>{error}</Overline>;
  }
  if (!feed) return null;

  // State 1: no coach yet — nothing else on this page means anything until one exists.
  if (!feed.coach) {
    return (
      <section>
        <Overline>Step one</Overline>
        <h1 className="mt-6 max-w-2xl font-serif text-3xl leading-[1.05] text-navy md:text-5xl">
          First, mint the <em className="italic text-orange">coach</em> that will read every run.
        </h1>
        <p className="mt-6 max-w-md font-sans text-base leading-relaxed text-navy">
          It becomes an intelligent NFT you own on 0G. Its memory is encrypted with a key derived from
          your wallet, and it grows with every kilometre you give it.
        </p>
        <div className="mt-8">
          <Link href="/mint"><Button variant="primary" className="w-full md:w-auto">Mint your coach</Button></Link>
        </div>
        {/* Minting is human-gated: if this person has not proven they are one
            real human yet, propose it here too — the widget disappears on its
            own once they are registered. */}
        <div className="mt-8 max-w-md">
          <HumanBackingWidget hideWhenRegistered />
        </div>
      </section>
    );
  }

  return (
    <section>
      {/* The coach owns this page even when it's a feed: who is reading your
          runs, and how much it already remembers. Full identity (mint tx,
          health data, chat) lives on the Coach tab. */}
      <header className="flex items-end justify-between gap-4 border-b border-navy/15 pb-6 md:pb-8">
        <div>
          <Overline>Your coach</Overline>
          {/* The agent's name carries the accent: it is the one thing on this page
              that is unmistakably *yours*, and at display size the orange reads as
              brand rather than as a warning. */}
          <h1 className="mt-3 font-serif text-2xl leading-tight text-orange md:text-4xl">{feed.coach.name}</h1>
          <p className="mt-2 font-sans text-[10px] uppercase tracking-[0.3em] text-ocean">
            {feed.coach.personality.replace("_", " ")} · agent #{feed.coach.tokenId} ·{" "}
            {feed.runs.length === 0
              ? "no runs yet"
              : `${feed.runs.length} ${feed.runs.length === 1 ? "run" : "runs"} remembered`}
          </p>
          {/* The ENS name is the agent's public identity: it resolves live over
              Sepolia and points back at the on-chain iNFT, so it belongs where the
              coach is named. Everything else (mint tx, health data) lives on the
              Coach tab to keep this header phone-sized. */}
          <div className="mt-3">
            <EnsBadge name={feed.coach.ensName} />
          </div>
        </div>
        <Link
          href="/coach"
          className="shrink-0 py-3 font-sans text-[10px] uppercase tracking-[0.25em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
        >
          Talk to it ↗
        </Link>
      </header>

      {/* Owners who minted while the human gate was off can still register:
          renders nothing once they are human-backed. */}
      <div className="mt-6 max-w-md">
        <HumanBackingWidget hideWhenRegistered />
      </div>

      {feed.runs.length === 0 ? (
        <div className="mt-8 md:mt-12">
          <h2 className="max-w-2xl font-serif text-3xl leading-[1.05] text-navy md:text-5xl">
            Give it the first <em className="italic text-orange">GPX</em> and it starts remembering.
          </h2>
          <p className="mt-6 max-w-md font-sans text-base leading-relaxed text-navy">
            Export a run from Workout Copy, drop the file here, and the coach will read it against
            everything that comes after. Encryption happens before anything leaves your browser session.
          </p>
          <div className="mt-8">
            <Link href="/upload"><Button variant="primary" className="w-full md:w-auto">Upload your first run</Button></Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-8 flex items-end justify-between gap-4 md:mt-12">
            <Overline>Your runs</Overline>
            <Link
              href="/upload"
              className="hidden py-3 font-sans text-[10px] uppercase tracking-[0.25em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline md:inline-block"
            >
              Upload a run ↗
            </Link>
          </div>
          <div className="mt-6 flex flex-col gap-6 md:gap-10">
            {feed.runs.map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Overline({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span aria-hidden className="h-px w-8 bg-navy md:w-12" />
      <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">{children}</span>
    </div>
  );
}

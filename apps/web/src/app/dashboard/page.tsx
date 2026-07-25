"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAccessToken, usePrivy } from "@privy-io/react-auth";
import { explorerTx } from "@0run/shared";
import { Button } from "@/components/ui/button";
import { Chat } from "@/components/run/chat";
import { RunCard } from "@/components/run/run-card";
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
    return <Shell><Overline>loading your runs…</Overline></Shell>;
  }
  if (error) {
    return <Shell><Overline>{error}</Overline></Shell>;
  }
  if (!feed) return null;

  // State 1: no coach yet — nothing else on this page means anything until one exists.
  if (!feed.coach) {
    return (
      <Shell>
        <Overline>Step one</Overline>
        <h1 className="mt-8 max-w-3xl font-serif text-5xl leading-[0.9] text-navy md:text-7xl">
          First, mint the <em className="italic text-orange">coach</em> that will read every run.
        </h1>
        <p className="mt-10 max-w-md font-sans text-lg leading-relaxed text-navy">
          It becomes an intelligent NFT you own on 0G. Its memory is encrypted with a key derived from
          your wallet, and it grows with every kilometre you give it.
        </p>
        <div className="mt-12">
          <Link href="/mint"><Button variant="primary">Mint your coach</Button></Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="grid grid-cols-12 gap-8 border-b border-navy/15 pb-12">
        <div className="col-span-12 md:col-span-7">
          <Overline>Your coach</Overline>
          <h1 className="mt-6 font-serif text-4xl leading-tight text-navy md:text-6xl">{feed.coach.name}</h1>
          <p className="mt-4 font-sans text-[10px] uppercase tracking-[0.3em] text-ocean">
            {feed.coach.personality.replace("_", " ")} · agent #{feed.coach.tokenId}
          </p>
          {feed.coach.mintTx && (
            <a
              className="mt-4 inline-block py-3 font-sans text-[10px] uppercase tracking-[0.25em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
              href={explorerTx(feed.coach.mintTx)} target="_blank" rel="noopener noreferrer"
            >
              minted on 0G ↗
            </a>
          )}
        </div>
        <div className="col-span-12 flex flex-col items-start gap-6 md:col-span-4 md:col-start-9 md:items-end">
          <Link href="/upload"><Button variant="primary">Upload a run</Button></Link>
          {/* Health data is context, not an activity: it never appears in the feed,
              only as coverage here, and its effect shows up inside the reports. */}
          <span className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
            health data · not connected
          </span>
        </div>
      </header>

      {feed.runs.length === 0 ? (
        <section className="py-24">
          <Overline>No runs yet</Overline>
          <h2 className="mt-8 max-w-2xl font-serif text-4xl leading-[0.95] text-navy md:text-6xl">
            Give it the first <em className="italic text-orange">GPX</em> and it starts remembering.
          </h2>
          <p className="mt-8 max-w-md font-sans text-lg leading-relaxed text-navy">
            Export a run from Workout Copy, drop the file here, and the coach will read it against
            everything that comes after. Encryption happens before anything leaves your browser session.
          </p>
          <div className="mt-12"><Link href="/upload"><Button variant="primary">Upload your first run</Button></Link></div>
        </section>
      ) : (
        <section className="grid grid-cols-12 gap-x-8 gap-y-16 py-16">
          {feed.runs.map((run, i) => (
            <div
              key={run.id}
              // Offset alternating columns: an editorial index, not a symmetric grid.
              className={i % 2 === 0 ? "col-span-12 md:col-span-7" : "col-span-12 md:col-span-6 md:col-start-7"}
            >
              <RunCard run={run} />
            </div>
          ))}
        </section>
      )}

      <Chat />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="relative mx-auto max-w-[1600px] px-8 py-20 md:px-16 md:py-32">{children}</main>;
}

function Overline({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span aria-hidden className="h-px w-12 bg-navy" />
      <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">{children}</span>
    </div>
  );
}

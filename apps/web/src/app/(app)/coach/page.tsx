"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAccessToken, usePrivy } from "@privy-io/react-auth";
import { explorerTx } from "@0run/shared";
import { Button } from "@/components/ui/button";
import { Chat } from "@/components/run/chat";
import type { CoachSummary } from "@/components/run/types";

/**
 * The Coach tab: who your coach is, and the general conversation with it.
 * Run-scoped questions live on each run page; this is the home of everything
 * that isn't about one specific run.
 */
export default function CoachPage() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();
  const [coach, setCoach] = useState<CoachSummary | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/runs", { headers: { authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setCoach(body.coach ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load your coach");
    }
  }, []);

  useEffect(() => {
    if (ready && !authenticated) router.push("/");
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated, load]);

  if (!ready || (authenticated && coach === undefined && !error)) {
    return <Overline>loading your coach…</Overline>;
  }
  if (error) return <Overline>{error}</Overline>;

  if (!coach) {
    return (
      <section>
        <Overline>No coach yet</Overline>
        <h1 className="mt-6 max-w-2xl font-serif text-3xl leading-[1.05] text-navy md:text-5xl">
          Mint the <em className="italic text-orange">coach</em> before you talk to it.
        </h1>
        <div className="mt-8">
          <Link href="/mint"><Button variant="primary" className="w-full md:w-auto">Mint your coach</Button></Link>
        </div>
      </section>
    );
  }

  return (
    <section>
      <header className="border-b border-navy/15 pb-8">
        <Overline>Your coach</Overline>
        <h1 className="mt-4 font-serif text-3xl leading-tight text-navy md:text-5xl">{coach.name}</h1>
        <p className="mt-3 font-sans text-[10px] uppercase tracking-[0.3em] text-ocean">
          {coach.personality.replace("_", " ")} · agent #{coach.tokenId}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2">
          {coach.mintTx && (
            <a
              className="inline-block py-2 font-sans text-[10px] uppercase tracking-[0.25em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
              href={explorerTx(coach.mintTx)} target="_blank" rel="noopener noreferrer"
            >
              minted on 0G ↗
            </a>
          )}
          {/* Health data is context, not an activity: it never appears in the feed,
              only as coverage here, and its effect shows up inside the reports. */}
          <span className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
            health data · not connected
          </span>
        </div>
      </header>

      <Chat />
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

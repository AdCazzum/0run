"use client";
import { useState } from "react";
import { getAccessToken, usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CoachMarkdown } from "@/components/coach/coach-markdown";

type AskReply = { text: string; disclaimer: string };

/**
 * The directory's payoff: from another agent's public identity page, an
 * authenticated user can ask THAT coach about THEIR OWN latest run — its
 * personality and methodology applied to a run it has never seen, not that
 * athlete's history. See api/coach/[tokenId]/ask/route.ts for the privacy
 * contract this UI is a thin wrapper around (never the owner's private
 * layer, never a write to the owner's memory).
 */
export function AskThisCoach({ tokenId, coachLabel }: { tokenId: string; coachLabel: string }) {
  const { ready, authenticated } = usePrivy();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<AskReply | null>(null);

  async function ask() {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setReply(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/coach/${tokenId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ message }),
        // Inference is ~20s on 0G Compute (see components/run/chat.tsx): allow
        // for it, but never hang forever.
        signal: AbortSignal.timeout(120_000),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setReply({ text: body.reply, disclaimer: body.disclaimer });
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "this coach could not answer");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;

  return (
    <section className="mt-16 border-t border-navy pt-10">
      <div className="flex items-center gap-4">
        <span aria-hidden className="h-px w-8 bg-navy md:w-12" />
        <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Ask this coach</span>
      </div>

      {!authenticated ? (
        <p className="mt-6 max-w-md font-sans text-sm leading-relaxed text-navy">
          Sign in to ask {coachLabel} about your own latest run — its methodology, applied to your data,
          never this agent&apos;s own athlete&apos;s.
        </p>
      ) : (
        <>
          <p className="mt-6 max-w-md font-sans text-sm leading-relaxed text-navy">
            {coachLabel}&apos;s methodology, applied to <em className="font-serif italic text-orange">your</em> latest
            run — not this agent&apos;s own athlete&apos;s data.
          </p>

          <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void ask();
              }}
              placeholder="what would you make of my last run?"
              aria-label={`Ask ${coachLabel} about your latest run`}
            />
            <Button variant="secondary" onClick={() => void ask()} disabled={busy}>
              Ask
            </Button>
          </div>

          {busy && <p className="mt-4 font-sans text-xs uppercase tracking-[0.3em] text-ocean">thinking…</p>}
          {error && <p className="mt-4 font-sans text-xs uppercase tracking-[0.25em] text-ocean">{error}</p>}

          {reply && (
            <div className="mt-8">
              <div className="max-w-xl border-l border-navy pl-6">
                <CoachMarkdown>{reply.text}</CoachMarkdown>
              </div>
              <p className="mt-3 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">{reply.disclaimer}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

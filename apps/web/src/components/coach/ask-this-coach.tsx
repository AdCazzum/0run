"use client";
import { useState } from "react";
import Link from "next/link";
import { getAccessToken, usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CoachMarkdown } from "@/components/coach/coach-markdown";
import { usePrivyReady } from "@/app/providers";

type AskReply = { text: string; disclaimer: string };

/**
 * The directory's payoff: from another agent's public identity page, an
 * authenticated user can ask THAT coach about THEIR OWN latest run — its
 * personality and methodology applied to a run it has never seen, not that
 * athlete's history. See api/coach/[tokenId]/ask/route.ts for the privacy
 * contract this UI is a thin wrapper around (never the owner's private
 * layer, never a write to the owner's memory).
 *
 * This sits on a PUBLIC page, so the Privy hooks live one component deeper:
 * calling them where the provider is not mounted is what once turned the
 * landing page into a 500 (see app/providers.tsx), and hooks cannot be called
 * behind an `if`.
 */
export function AskThisCoach(props: { tokenId: string; coachLabel: string }) {
  return usePrivyReady() ? <AskThisCoachWithPrivy {...props} /> : <SignInElsewhere />;
}

/** Auth is not configured in this build — say what is true, offer the way in. */
function SignInElsewhere() {
  return (
    <section className="mt-16 border-t border-navy pt-10">
      <div className="flex items-center gap-4">
        <span aria-hidden className="h-px w-8 bg-navy md:w-12" />
        <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Ask this coach</span>
      </div>
      <p className="mt-6 max-w-md font-sans text-sm leading-relaxed text-navy">
        Asking a coach needs an account.{" "}
        <Link href="/dashboard" className="text-navy underline-offset-4 hover:text-orange hover:underline">
          Start here
        </Link>
        .
      </p>
    </section>
  );
}

function AskThisCoachWithPrivy({ tokenId, coachLabel }: { tokenId: string; coachLabel: string }) {
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
          Sign in to get a second opinion from {coachLabel} on your own last run. It reads your run,
          in its own style — it never sees the athlete it belongs to.
        </p>
      ) : (
        <>
          <p className="mt-6 max-w-md font-sans text-sm leading-relaxed text-navy">
            A second opinion on <em className="font-serif italic text-orange">your</em> last run, in{" "}
            {coachLabel}&apos;s own style. It never sees the athlete it belongs to.
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

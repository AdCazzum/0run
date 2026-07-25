"use client";
import { useState } from "react";
import { getAccessToken } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUserKey } from "@/lib/client/useUserKey";
import { CoachMarkdown } from "@/components/coach/coach-markdown";

type Turn = { role: "user" | "assistant"; content: string };

/**
 * One chat implementation for both surfaces. With `runId` the API pins that run
 * into the prompt context, so "how did it go?" has a referent; without it the
 * conversation is general over the recent history.
 */
export function Chat({ runId }: { runId?: number }) {
  const { getKeyHex } = useUserKey();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setDraft("");
    setTurns((t) => [...t, { role: "user", content: message }]);
    try {
      const [token, userKeyHex] = await Promise.all([getAccessToken(), getKeyHex()]);
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, userKeyHex, runId }),
        // Inference is ~20s on 0G Compute: allow for it, but never hang forever.
        signal: AbortSignal.timeout(120_000),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setTurns((t) => [...t, { role: "assistant", content: body.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "the coach could not answer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 border-t border-navy pt-8 md:mt-16 md:pt-10">
      <div className="mb-8 flex items-center gap-4">
        <span aria-hidden className="h-px w-8 bg-navy md:w-12" />
        <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">
          {runId ? "Ask about this run" : "Ask your coach"}
        </span>
      </div>

      <div className="space-y-8">
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <p key={i} className="ml-auto max-w-md rounded-2xl rounded-br-md bg-peach/50 px-4 py-3 font-sans text-base leading-relaxed text-navy shadow-sm">
              {turn.content}
            </p>
          ) : (
            // The coach answers in markdown; the athlete's own message stays plain
            // text — they typed it, and rendering user input as markdown would let a
            // stray character reflow the thread.
            <div key={i} className="max-w-xl border-l border-navy pl-6">
              <CoachMarkdown>{turn.content}</CoachMarkdown>
            </div>
          ),
        )}
        {busy && (
          <p className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">the coach is thinking…</p>
        )}
        {error && (
          <p className="font-sans text-xs uppercase tracking-[0.25em] text-ocean">{error}</p>
        )}
      </div>

      <div className="mt-10 flex flex-col gap-4 md:flex-row md:items-end">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
          placeholder={runId ? "how was my pace on the climb?" : "what should I work on this week?"}
          aria-label="Message your coach"
        />
        <Button variant="secondary" onClick={() => void send()} disabled={busy}>Ask</Button>
      </div>
    </section>
  );
}

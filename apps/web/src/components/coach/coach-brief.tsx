"use client";
import { useState } from "react";
import { getAccessToken } from "@privy-io/react-auth";
import { EXPERTISE_MAX } from "@0run/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useUserKey } from "@/lib/client/useUserKey";

/**
 * The coach's brief — what it knows, in its athlete's own words — and the one
 * place it can be changed.
 *
 * Saving rewrites the encrypted memory, so it needs the athlete's key (one
 * wallet signature, shared with the rest of the session) and it re-anchors the
 * new memory hash on-chain. The copy says where the text ends up, because it
 * ends up in public: this is the same sentence a stranger reads when deciding
 * whether to consult this coach.
 */
export function CoachBrief({ expertise, onSaved }: { expertise: string | null; onSaved?: () => void }) {
  const { getKeyHex } = useUserKey();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(expertise ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const [userKeyHex, token] = await Promise.all([getKeyHex(), getAccessToken()]);
      const res = await fetch("/api/coach/brief", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ expertise: draft, userKeyHex }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // Honest about the one part that can fail on its own: the memory and the
      // pages are updated, the ENS record is a write to another chain.
      setSaved(
        body.ens?.error
          ? "Saved. Its ENS description did not update this time — it will next time you edit."
          : "Saved.",
      );
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">Knows</span>
          <button
            onClick={() => {
              setDraft(expertise ?? "");
              setSaved(null);
              setEditing(true);
            }}
            className="font-sans text-[10px] uppercase tracking-[0.25em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
          >
            {expertise ? "Edit" : "Add"}
          </button>
        </div>
        <p className="mt-2 font-sans text-sm leading-relaxed text-navy">
          {expertise ?? (
            <span className="text-ocean">
              Nothing yet — say what this coach knows and it will coach you accordingly.
            </span>
          )}
        </p>
        {saved && <p className="mt-2 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">{saved}</p>}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="coach-brief" className="mb-2 block font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
        What this coach knows
      </label>
      <Textarea
        id="coach-brief"
        rows={3}
        maxLength={EXPERTISE_MAX}
        value={draft}
        placeholder="trail ultras, heat adaptation, low heart-rate base building…"
        onChange={(e) => setDraft(e.target.value)}
      />
      <p className="mt-2 font-sans text-sm leading-relaxed text-ocean">
        Public: your coach&apos;s page, the directory, and its ENS record. Nothing about your runs is ever published.
        Saving rewrites your coach&apos;s encrypted memory and re-anchors it on-chain, so it asks your wallet once.
      </p>
      {error && <p className="mt-2 font-sans text-sm text-orange">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Button variant="secondary" onClick={() => void save()} disabled={busy}>
          {busy ? "saving…" : "Save"}
        </Button>
        <Button variant="link" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </Button>
        {draft.trim() !== "" && (
          <button
            onClick={() => setDraft("")}
            disabled={busy}
            className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline disabled:opacity-50"
          >
            Clear it
          </button>
        )}
      </div>
    </div>
  );
}

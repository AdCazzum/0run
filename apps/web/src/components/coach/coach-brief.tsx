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
/** Parses a JSON body when there is one; a non-JSON error page is not a crash. */
async function readJson(res: Response): Promise<any | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function CoachBrief({ expertise, onSaved }: { expertise: string | null; onSaved?: () => void }) {
  const { getKeyHex } = useUserKey();
  const [editing, setEditing] = useState(false);
  // What is on screen after a save, independent of the parent's refresh: the
  // save already succeeded, so the text must not disappear because a later
  // GET failed.
  const [current, setCurrent] = useState<string | null>(expertise);
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
      // Status first, body second. A proxy timeout or a Next error page answers
      // with HTML, and parsing that before checking res.ok turned a 504 into
      // "Unexpected token '<'" — shown to the athlete as the reason it failed,
      // for an operation the server may well have completed.
      const body = await readJson(res);
      if (!res.ok) throw new Error(body?.error ?? `the server answered ${res.status}`);
      // Honest about the one part that can fail on its own: the memory and the
      // pages are updated, the ENS record is a write to another chain.
      setCurrent(body.expertise ?? null);
      setSaved(
        body.anchored === false
          ? "Saved. The on-chain anchor did not move this time — your next run re-anchors it."
          : body.ens?.error
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
              setDraft(current ?? "");
              setSaved(null);
              setEditing(true);
            }}
            className="font-sans text-[10px] uppercase tracking-[0.25em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
          >
            {current ? "Edit" : "Add"}
          </button>
        </div>
        <p className="mt-2 font-sans text-sm leading-relaxed text-navy">
          {current ?? (
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

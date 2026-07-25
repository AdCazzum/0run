"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { useUserKey } from "@/lib/client/useUserKey";

/**
 * Deletes a run, after saying plainly what that does and does not undo.
 *
 * Two-step on purpose — no browser confirm() dialog, which says nothing useful
 * and cannot explain the one part that matters: the run leaves the coach's
 * memory for good, and the encrypted copy already on 0G Storage cannot be
 * deleted by anyone, us included. Someone deleting a run deserves to read that
 * before they do it, not after.
 */
/** Parses a JSON body when there is one; a non-JSON error page is not a crash. */
async function readJson(res: Response): Promise<any | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function DeleteRun({ runId }: { runId: number }) {
  const { getKeyHex } = useUserKey();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const [userKeyHex, token] = await Promise.all([getKeyHex(), getAccessToken()]);
      const res = await fetch(`/api/runs/${runId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ userKeyHex }),
      });
      // Status first, body second. A proxy timeout or a Next error page answers
      // with HTML, and parsing that before checking res.ok turned a 504 into
      // "Unexpected token '<'" — shown to the athlete as the reason it failed,
      // for an operation the server may well have completed.
      const body = await readJson(res);
      if (!res.ok) throw new Error(body?.error ?? `the server answered ${res.status}`);
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not delete this run");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <div className="mt-16 border-t border-navy/15 pt-8">
        <button
          onClick={() => setConfirming(true)}
          className="py-2 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
        >
          Delete this run
        </button>
      </div>
    );
  }

  return (
    <div className="mt-16 border-t border-navy/15 pt-8">
      <p className="max-w-md font-sans text-sm leading-relaxed text-navy">
        This removes the run from 0run and from your coach&apos;s memory, so it stops shaping anything your coach says.
        Your coach&apos;s memory is rewritten and re-anchored on-chain, which asks your wallet once.
      </p>
      <p className="mt-3 max-w-md font-sans text-sm leading-relaxed text-ocean">
        What cannot be undone: the encrypted file already written to 0G Storage stays there — storage is immutable and
        nobody, including us, holds a key to delete it. Without your key it is unreadable, and after this nothing points
        at it.
      </p>
      {error && <p className="mt-3 max-w-md font-sans text-sm text-orange">{error}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button variant="secondary" onClick={() => void remove()} disabled={busy}>
          {busy ? "deleting…" : "Delete it"}
        </Button>
        <Button variant="link" onClick={() => setConfirming(false)} disabled={busy}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

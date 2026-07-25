"use client";
import { useCallback, useEffect, useState } from "react";
import { getAccessToken, usePrivy } from "@privy-io/react-auth";
import { IDKitRequestWidget, proofOfHuman, type IDKitErrorCodes } from "@worldcoin/idkit";
import { Button } from "@/components/ui/button";
import { coachClaimSignal } from "@/lib/world/signal";

type RpContext = { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
type Status = "loading" | "unclaimed" | "claimed" | "unauthenticated" | "error";

const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}` | undefined;
// Prefer a dedicated World action for the coach claim so its nullifier
// doesn't share the event-claim action's space — but a second action can't
// be assumed to exist in the World Developer Portal just because we'd like
// one (see the long comment on lib/world/signal.ts#coachClaimSignal for the
// exact tradeoff, and the Task 5 report for what still needs a manual step
// on developer.world.org). Falls back to the SAME action already configured
// for event claims: cross-context replay is still blocked at the signal
// level, just not at the World nullifier-value level.
const ACTION = process.env.NEXT_PUBLIC_WORLD_COACH_ACTION || process.env.NEXT_PUBLIC_WORLD_ACTION || "claim-run-event";

/**
 * The self-declared coach badge (Piano B, Task 5; docs/superpowers/specs/
 * 2026-07-25-real-coach-spec.md, §3). The ONE non-negotiable rule this
 * component exists to enforce: World ID proves a unique real human, never a
 * qualified coach, so every label here says "autodichiarato" (self-declared)
 * — never "verified", never a checkmark that implies credential
 * verification. The trust ladder is stated inline, not hidden in a tooltip,
 * so it survives a screenshot: verified unique human → self-declaration →
 * reputation earned over time (the last rung isn't built yet — see
 * real-coach-spec.md §3 on ERC-8004-backed reviews — so it's named honestly
 * as a future rung, not implied as already live).
 */
export function CoachBadge() {
  const { ready, authenticated, user } = usePrivy();
  const wallet = user?.wallet?.address;

  const [status, setStatus] = useState<Status>("loading");
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/coach-claims", { headers: { authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setStatus(body.claimed ? "claimed" : "unclaimed");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "could not load coach claim status");
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setStatus("unauthenticated");
      return;
    }
    void load();
  }, [ready, authenticated, load]);

  async function start() {
    if (!wallet) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/world/rp-context?action=${encodeURIComponent(ACTION)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "could not start World ID verification");
      setRpContext(body);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || status === "unauthenticated") return null;

  return (
    <div className="mt-8 border-t border-navy/15 pt-6">
      {status === "claimed" ? (
        <div className="flex items-center gap-4">
          <span aria-hidden className="h-px w-8 bg-orange" />
          <span className="font-sans text-[10px] uppercase tracking-[0.3em] text-navy">coach · autodichiarato</span>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <span aria-hidden className="h-px w-8 bg-navy/30" />
          <span className="font-sans text-[10px] uppercase tracking-[0.3em] text-ocean">not a coach yet</span>
        </div>
      )}

      <p className="mt-3 max-w-md font-sans text-xs leading-relaxed text-ocean">
        {status === "claimed"
          ? "Prova solo che dietro questo profilo c'è una persona reale unica, verificata con World ID — non una qualifica di coaching."
          : "Verifica con World ID di essere una persona reale unica per autodichiararti coach. Non certifica alcuna competenza."}
        {" "}Scala di fiducia: umano unico verificato → autodichiarazione → reputazione guadagnata nel tempo.
      </p>

      {status === "unclaimed" && (
        <div className="mt-4">
          {APP_ID && wallet ? (
            <>
              <Button variant="secondary" onClick={start} disabled={busy}>
                {busy ? "preparing…" : "I'm a coach"}
              </Button>
              {rpContext && (
                <IDKitRequestWidget
                  open={open}
                  onOpenChange={setOpen}
                  app_id={APP_ID}
                  action={ACTION}
                  rp_context={rpContext}
                  allow_legacy_proofs={false}
                  preset={proofOfHuman({ signal: coachClaimSignal(wallet) })}
                  handleVerify={async (result) => {
                    const token = await getAccessToken();
                    const res = await fetch("/api/coach-claims", {
                      method: "POST",
                      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
                      body: JSON.stringify({ idkitResult: result }),
                    });
                    const resBody = await res.json();
                    if (!res.ok) throw new Error(resBody.error ?? "claim failed");
                  }}
                  onSuccess={() => setStatus("claimed")}
                  onError={(code: IDKitErrorCodes) => setError(`World ID verification failed (${code})`)}
                />
              )}
            </>
          ) : (
            <p className="font-sans text-xs text-ocean">World ID claiming isn&apos;t configured on this deployment.</p>
          )}
        </div>
      )}
      {error && <p className="mt-3 font-sans text-xs text-orange">{error}</p>}
    </div>
  );
}

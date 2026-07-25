"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useLogin, useSendTransaction } from "@privy-io/react-auth";
import { IDKitRequestWidget, proofOfHuman, type IDKitErrorCodes } from "@worldcoin/idkit";
import { encodeFunctionData, parseAbi } from "viem";
import { GALILEO } from "@0run/shared";
import { Button } from "@/components/ui/button";
import { claimSignal } from "@/lib/world/signal";
import { RUN_EVENTS_ABI } from "@/lib/world/runEventsAbi";

type RpContext = { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
type Phase = "idle" | "fetching-context" | "verifying" | "sending-tx" | "confirming" | "done" | "error";
type PendingClaim = { backendSig: string; nullifierHash: string; onchainEventId: string; contractAddress: string };

const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}` | undefined;
const ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION ?? "claim-run-event";
const ABI = parseAbi(RUN_EVENTS_ABI);

function label(phase: Phase): string {
  switch (phase) {
    case "fetching-context":
      return "preparing…";
    case "verifying":
      return "verifying with World ID…";
    case "sending-tx":
      return "confirm in your wallet…";
    case "confirming":
      return "recording claim…";
    default:
      return "Claim with World ID";
  }
}

/**
 * Two-phase claim, driven from the browser:
 * 1. IDKit collects a World ID proof; `handleVerify` sends it to our backend
 *    (POST /api/events/:id/claim), which cloud-verifies it strictly and, only
 *    on success, returns a co-signature for THIS wallet + nullifier.
 * 2. `onSuccess` sends the actual RunEvents.claim() transaction from the
 *    user's OWN embedded wallet (via Privy's useSendTransaction) — it can't
 *    be sent by our backend, because the contract binds msg.sender into the
 *    signed digest and tracks one-claim-per-address (see the long comment on
 *    lib/world/runEvents.ts#signClaim). Once it confirms, PATCH records the
 *    tx hash against the reserved claim row.
 *
 * NOT verified in this codebase's test suite: this exact browser flow needs
 * a live World App with a verified identity and a funded embedded wallet —
 * see the Task 2 report for what specifically still needs a phone test.
 */
export function ClaimWidget({ dbEventId, onchainEventId }: { dbEventId: number; onchainEventId: string }) {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { login } = useLogin();
  const { sendTransaction } = useSendTransaction();
  const router = useRouter();
  const pendingRef = useRef<PendingClaim | null>(null);

  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const wallet = user?.wallet?.address;
  const busy = phase !== "idle" && phase !== "error" && phase !== "done";

  if (!APP_ID) {
    return <p className="font-sans text-sm text-ocean">World ID claiming isn&apos;t configured on this deployment.</p>;
  }

  async function start() {
    if (!ready) return;
    if (!authenticated) return login();
    if (!wallet) {
      setError("this account has no wallet yet — try again in a moment");
      return;
    }
    setError(null);
    setPhase("fetching-context");
    try {
      const res = await fetch(`/api/world/rp-context?action=${encodeURIComponent(ACTION)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "could not start World ID verification");
      setRpContext(body);
      setOpen(true);
      setPhase("idle");
    } catch (e: any) {
      setError(e.message ?? "something went wrong");
      setPhase("error");
    }
  }

  return (
    <div>
      {phase === "done" ? (
        <p className="font-sans text-sm text-navy">Claimed — welcome to the crew.</p>
      ) : (
        <Button variant="primary" onClick={start} disabled={busy}>
          {label(phase)}
        </Button>
      )}
      {error && <p className="mt-4 max-w-xs font-sans text-sm text-orange">{error}</p>}
      <p className="mt-4 max-w-xs font-sans text-xs leading-relaxed text-ocean">
        Verifies you&apos;re a unique human via World ID, then a transaction from your own wallet records the claim
        on-chain — proof of one real person, not proof you were here.
      </p>

      {rpContext && wallet && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={APP_ID}
          action={ACTION}
          rp_context={rpContext}
          allow_legacy_proofs={false}
          preset={proofOfHuman({ signal: claimSignal(onchainEventId, wallet) })}
          handleVerify={async (result) => {
            setPhase("verifying");
            const token = await getAccessToken();
            const res = await fetch(`/api/events/${dbEventId}/claim`, {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
              body: JSON.stringify({ idkitResult: result }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? "claim verification failed");
            pendingRef.current = body as PendingClaim;
          }}
          onSuccess={async () => {
            const pending = pendingRef.current;
            if (!pending) {
              setError("missing claim authorization");
              setPhase("error");
              return;
            }
            try {
              setPhase("sending-tx");
              const data = encodeFunctionData({
                abi: ABI,
                functionName: "claim",
                args: [BigInt(pending.onchainEventId), pending.nullifierHash as `0x${string}`, pending.backendSig as `0x${string}`],
              });
              const { hash } = await sendTransaction({ to: pending.contractAddress, data, chainId: GALILEO.chainId });
              setPhase("confirming");
              const token = await getAccessToken();
              await fetch(`/api/events/${dbEventId}/claim`, {
                method: "PATCH",
                headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify({ nullifierHash: pending.nullifierHash, txHash: hash }),
              });
              setPhase("done");
              router.refresh();
            } catch (e: any) {
              setError(e.message ?? "the on-chain claim transaction failed");
              setPhase("error");
            }
          }}
          onError={(code: IDKitErrorCodes) => {
            setError(`World ID verification failed (${code})`);
            setPhase("error");
          }}
        />
      )}
    </div>
  );
}

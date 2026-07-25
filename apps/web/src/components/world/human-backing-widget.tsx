"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { getAccessToken } from "@privy-io/react-auth";
import { createWorldBridgeStore } from "@worldcoin/idkit-core";
import { solidityEncode } from "@worldcoin/idkit-core/hashing";
import { decodeAbiParameters } from "viem";
import { Button } from "@/components/ui/button";

// AgentBook protocol constants, verified against @worldcoin/agentkit-cli@0.2.0
// source: this is WORLD's app/action (the proof must carry AgentBook's own
// external nullifier to verify on-chain), NOT our NEXT_PUBLIC_WORLD_APP_ID.
const AGENTBOOK_APP_ID = "app_a7c3e2b6b83927251a0db5345bd7146a";
const AGENTBOOK_ACTION = "agentbook-registration";
const BRIDGE_POLL_MS = 1_000;
const BRIDGE_TIMEOUT_MS = 300_000; // 5 min, like the CLI
const CONFIRM_POLL_MS = 2_000;
const CONFIRM_TIMEOUT_MS = 60_000;

type State =
  | { kind: "loading" }
  | { kind: "registered"; humanId: string }
  | { kind: "idle" }
  | { kind: "verifying"; uri: string }
  | { kind: "submitting" }
  | { kind: "confirming" }
  | { kind: "error"; message: string };

// IDKit returns the proof ABI-encoded (or, rarely, as a JSON array) — the
// relay wants the plain uint256[8]. Same normalization as the CLI.
function normalizeProof(raw: string): string[] | null {
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through to ABI decode */
    }
  }
  try {
    const decoded = decodeAbiParameters([{ type: "uint256[8]" }], raw as `0x${string}`)[0] as readonly bigint[];
    return decoded.map((v) => `0x${v.toString(16).padStart(64, "0")}`);
  } catch {
    return null;
  }
}

async function authed(path: string, init?: RequestInit) {
  const token = await getAccessToken();
  return fetch(path, { ...init, headers: { ...init?.headers, authorization: `Bearer ${token}` } });
}

/**
 * Self-serve AgentBook registration: the person scans a QR (or taps the deep
 * link on mobile), approves in World App, and a gasless relay writes the
 * binding on World Chain. Until now this required running agentkit-cli by
 * hand; the flow below is that CLI's exact protocol, in the page where the
 * human-backing gate refuses.
 */
export function HumanBackingWidget() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  // `quiet` is for the confirm-loop poll: it only ever transitions state on
  // a confirmed `registered: true`, never downgrading verifying/submitting/
  // confirming back to idle/error on a transient miss or a 503.
  const loadStatus = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet ?? false;
    try {
      const res = await authed("/api/world/agentbook/status");
      const body = await res.json();
      if (cancelled.current) return null;
      if (!res.ok) {
        if (!quiet) setState({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
        return null;
      }
      if (body.registered) setState({ kind: "registered", humanId: body.humanId });
      else if (!quiet) setState({ kind: "idle" });
      return body as { registered: boolean; nonce?: string; wallet?: string };
    } catch (e: any) {
      if (!cancelled.current && !quiet) setState({ kind: "error", message: e.message ?? String(e) });
      return null;
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function start() {
    setState({ kind: "loading" });
    const status = await loadStatus();
    if (!status || status.registered || !status.nonce || !status.wallet) return;

    try {
      const bridge = createWorldBridgeStore();
      await bridge.getState().createClient({
        app_id: AGENTBOOK_APP_ID,
        action: AGENTBOOK_ACTION,
        // nonce as bigint: the CLI passes the raw uint256 from readContract,
        // and the encoder must see a number-like value, not a decimal string.
        signal: solidityEncode(["address", "uint256"], [status.wallet, BigInt(status.nonce)]),
      });
      const uri = bridge.getState().connectorURI;
      if (!uri) throw new Error("bridge World ID non disponibile");
      if (!cancelled.current) setState({ kind: "verifying", uri });

      const deadline = Date.now() + BRIDGE_TIMEOUT_MS;
      let proofResult: { merkle_root: string; nullifier_hash: string; proof: string } | null = null;
      while (Date.now() < deadline && !cancelled.current) {
        await bridge.getState().pollForUpdates();
        const { result, errorCode } = bridge.getState();
        if (result) {
          proofResult = result;
          break;
        }
        if (errorCode) throw new Error(`World App: ${errorCode}`);
        await new Promise((r) => setTimeout(r, BRIDGE_POLL_MS));
      }
      if (cancelled.current) return;
      if (!proofResult) throw new Error("tempo scaduto: verifica non completata in World App");

      const proof = normalizeProof(proofResult.proof);
      if (!proof) throw new Error("formato proof inatteso da World App");

      if (!cancelled.current) setState({ kind: "submitting" });
      const reg = await authed("/api/world/agentbook/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          root: proofResult.merkle_root,
          nonce: status.nonce,
          nullifierHash: proofResult.nullifier_hash,
          proof,
        }),
      });
      const regBody = await reg.json().catch(() => ({}));
      if (!reg.ok) throw new Error(regBody.error ?? `registrazione fallita (HTTP ${reg.status})`);

      if (!cancelled.current) setState({ kind: "confirming" });
      const confirmDeadline = Date.now() + CONFIRM_TIMEOUT_MS;
      while (Date.now() < confirmDeadline && !cancelled.current) {
        const s = await loadStatus({ quiet: true });
        if (s?.registered) return; // loadStatus already set "registered"
        await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS));
      }
      if (!cancelled.current) {
        setState({ kind: "error", message: "transazione inviata ma non ancora visibile: ricarica tra poco" });
      }
    } catch (e: any) {
      if (!cancelled.current) setState({ kind: "error", message: e.message ?? String(e) });
    }
  }

  if (state.kind === "loading") {
    return <p className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">checking human backing…</p>;
  }
  if (state.kind === "registered") {
    return (
      <p className="font-sans text-xs uppercase tracking-[0.25em] text-ocean">
        human-backed ✓ <span className="text-navy/60">World App verified, unique human</span>
      </p>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-ocean/60 p-4">
      <p className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
        prove you are one real human — needed to own a coach
      </p>
      {state.kind === "idle" && (
        <Button variant="primary" className="mt-3" onClick={() => void start()}>
          Verify with World App
        </Button>
      )}
      {state.kind === "verifying" && (
        <div className="mt-3 flex flex-col items-start gap-3">
          <div className="rounded-xl bg-white p-3">
            <QRCode value={state.uri} size={144} />
          </div>
          <a className="font-sans text-sm text-navy underline" href={state.uri}>
            on your phone? open World App directly
          </a>
          <p className="font-sans text-xs text-ocean">scan with World App, then approve — waiting…</p>
        </div>
      )}
      {(state.kind === "submitting" || state.kind === "confirming") && (
        <p className="mt-3 font-sans text-xs uppercase tracking-[0.3em] text-ocean">
          {state.kind === "submitting" ? "submitting to the relay…" : "waiting for World Chain…"}
        </p>
      )}
      {state.kind === "error" && (
        <div className="mt-3">
          <p className="font-sans text-sm text-orange">{state.message}</p>
          <Button variant="primary" className="mt-2" onClick={() => void start()}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

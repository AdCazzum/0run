"use client";
import { useEffect, useState } from "react";
import { getAccessToken, usePrivy } from "@privy-io/react-auth";
import { usePrivyReady } from "@/app/providers";

/**
 * Read-only "human-backed" indicator for public pages: renders ONLY when the
 * visitor is signed in AND their wallet resolves in AgentBook — otherwise
 * nothing. On a landing page an unverified state is not an error to nag
 * about; the nudge lives on the dashboard and the mint page. Same split as
 * hero.tsx's StartWithLogin: Privy hooks mount only under a ready provider,
 * because a public page must never 500 over a missing Privy env.
 */
type HumanBadgeVariant = "self" | "owner";

export function HumanBadge({ variant = "self" }: { variant?: HumanBadgeVariant } = {}) {
  const privyReady = usePrivyReady();
  if (!privyReady) return null;
  return <HumanBadgeInner variant={variant} />;
}

function HumanBadgeInner({ variant }: { variant: HumanBadgeVariant }) {
  const { ready, authenticated } = usePrivy();
  const [backed, setBacked] = useState(false);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let alive = true;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/world/agentbook/status", {
          headers: { authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (alive && res.ok && body.registered) setBacked(true);
      } catch {
        // Silent by design: this badge only ever adds information, a failed
        // lookup on the landing page must not surface anything.
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, authenticated]);

  if (!backed) return null;
  // "owner" is for pages whose subject is the AGENT (e.g. the dashboard's
  // coach header): the copy must say the verified human is YOU, its owner —
  // never read as a property of the coach itself.
  if (variant === "owner") {
    return (
      <p className="mt-2 font-sans text-[10px] uppercase tracking-[0.25em] text-emerald-700">
        you · human-backed ✓{" "}
        <span className="text-navy/60">one real human behind this coach — verified with World App</span>
      </p>
    );
  }
  return (
    <p className="mt-6 font-sans text-[10px] uppercase tracking-[0.25em] text-emerald-700">
      human-backed ✓ <span className="text-navy/60">unique human, verified with World App</span>
    </p>
  );
}

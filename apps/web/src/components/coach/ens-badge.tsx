"use client";
import { useEffect, useState } from "react";

type Resolution = { address: string | null; records: Record<string, string> };

/**
 * Renders the coach's live ENS identity next to its name. `name` (e.g.
 * "pedro.0run.eth") comes from the coaches row, written by the background
 * step in api/coach/mint/route.ts — but that alone is not proof the name
 * still resolves, so this component re-resolves it live, over Sepolia RPC,
 * every time it mounts (via GET /api/ens/resolve, which calls
 * resolveCoachEns() fresh, no cache). If resolution comes back empty — the
 * record was cleared, the RPC is down, or `name` was never assigned — this
 * renders nothing. No placeholder, no cached "last known good" name: that is
 * the whole point of the ENS bounty's "no hard-coded values" requirement.
 *
 * Sepolia is a separate, public testnet from the coach's own chain (0G
 * Galileo) — the label says so explicitly rather than reading as if it were
 * the coach's home network.
 */
export function EnsBadge({ name }: { name: string | null | undefined }) {
  const [resolution, setResolution] = useState<Resolution | null>(null);

  useEffect(() => {
    if (!name) {
      setResolution(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/ens/resolve?name=${encodeURIComponent(name)}`)
      .then((res) => res.json())
      .then((body: Resolution) => {
        if (!cancelled) setResolution(body);
      })
      .catch(() => {
        if (!cancelled) setResolution({ address: null, records: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (!name || !resolution?.address) return null;

  return (
    <a
      href={`https://sepolia.app.ens.domains/${name}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-3 py-1 font-sans text-[10px] uppercase tracking-[0.3em] text-orange underline-offset-4 transition-colors duration-500 hover:text-navy hover:underline"
    >
      <span aria-hidden className="h-px w-8 bg-orange/40" />
      {name} · ens · sepolia ↗
    </a>
  );
}

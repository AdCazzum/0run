import { NextResponse } from "next/server";
import { resolveCoachEns } from "@/lib/ens/resolve";

/**
 * Public, unauthenticated, read-only bridge to resolveCoachEns(): the badge
 * is rendered from a client component (see components/coach/ens-badge.tsx),
 * but resolution itself needs server-only env (ENS_SEPOLIA_RPC) and makes a
 * real Sepolia RPC call, so it can't run in the browser. Every call here
 * performs that call fresh — no caching layer sits in front of it — which is
 * what makes "clear the on-chain record and the badge disappears on reload"
 * true rather than aspirational.
 */
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return NextResponse.json({ error: "missing ?name=" }, { status: 400 });
  const resolution = await resolveCoachEns(name);
  return NextResponse.json(resolution);
}

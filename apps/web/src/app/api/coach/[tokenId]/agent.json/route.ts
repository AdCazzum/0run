import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { GALILEO } from "@0run/shared";
import { db } from "@/db";
import { coaches } from "@/db/schema";
import { a2aAccount } from "@/lib/a2a/protocol";

/**
 * The machine-readable face of a coach agent — what a crawler or another
 * agent reads to learn HOW to talk to this one. Public by design (like the
 * sibling /api/coach/[tokenId] identity route) and derivable entirely from
 * the public row + env: no private data, no live RPC on this hot path.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ error: "tokenId non valido" }, { status: 400 });
  }

  const [coach] = await db.select().from(coaches).where(eq(coaches.tokenId, tokenId));
  if (!coach) return NextResponse.json({ error: "coach non trovato" }, { status: 404 });

  const siteUrl = (process.env.SITE_URL ?? "https://0run.fun").replace(/\/$/, "");
  return NextResponse.json({
    name: coach.name,
    ensName: coach.ensName,
    personality: coach.personality,
    capabilities: ["coach-consult"],
    endpoints: {
      web: `${siteUrl}/coach/${tokenId}`,
      a2a: `${siteUrl}/api/coach/${tokenId}/a2a`,
    },
    inft: `${GALILEO.chainId}:${process.env.AGENT_NFT_ADDRESS ?? ""}:${tokenId}`,
    avatar: `${siteUrl}/api/coach/${tokenId}/avatar`,
    // The executor key authorized to sign consults FROM this agent — the
    // same address published as the ENS `agent-signer` text record.
    signer: a2aAccount()?.address ?? null,
  });
}

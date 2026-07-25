import { NextResponse } from "next/server";
import { getCoachDirectory } from "@/lib/coach/directory";

/**
 * Public, unauthenticated directory of every coach agent that exists on-chain
 * — the ERC-8004/ENS "systems where agents can register and discover each
 * other onchain" deliverable. All the actual enumeration + ENS resolution
 * logic (and its in-process cache) lives in lib/coach/directory.ts so the
 * server-rendered /coaches page can call the exact same function directly
 * without an extra HTTP round trip.
 */
export async function GET() {
  try {
    const entries = await getCoachDirectory();
    return NextResponse.json({ coaches: entries });
  } catch (e: any) {
    // Never answer with `{ coaches: [] }` here: a directory build failure
    // (chain RPC down, ENS RPC down, misconfigured addresses) is a real
    // error and must read as one, not as "no coach exists".
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 502 });
  }
}

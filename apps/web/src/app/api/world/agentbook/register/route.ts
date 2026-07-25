import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { agentBookAddress } from "@/lib/world/agentbook";

const DEFAULT_RELAY = "https://x402-worldchain.vercel.app";
const RELAY_TIMEOUT_MS = 30_000;

const Body = z.object({
  root: z.string().min(1),
  nonce: z.string().regex(/^\d+$/),
  nullifierHash: z.string().min(1),
  proof: z.array(z.string().regex(/^0x[0-9a-fA-F]+$/)).length(8),
});

/**
 * Server-side proxy to World's gasless registration relay (the same one
 * agentkit-cli submits to). Proxied rather than called from the browser so
 * the relay URL stays server-config and CORS never enters the picture. The
 * `agent` field is ALWAYS the session wallet — a body-supplied agent is
 * ignored, so nobody can register someone else's proof onto their address
 * (the proof wouldn't verify anyway: the signal binds the address).
 */
export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const relay = (process.env.AGENTBOOK_RELAY_URL ?? DEFAULT_RELAY).replace(/\/$/, "");
  const registration = { agent: user.wallet, ...parsed.data, contract: agentBookAddress() };

  let res: Response;
  try {
    res = await fetch(`${relay}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registration),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
  } catch (e: any) {
    return NextResponse.json({ error: `relay non raggiungibile: ${e.message ?? e}` }, { status: 502 });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: body.error ? String(body.error) : `relay HTTP ${res.status}`, relayStatus: res.status },
      { status: 502 },
    );
  }
  return NextResponse.json({ txHash: body.txHash ?? null });
}

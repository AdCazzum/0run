import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAgentNonce, lookupHumanId } from "@/lib/world/agentbook";

/**
 * Registration status of the SESSION wallet in AgentBook, plus — only while
 * unregistered — the fresh nonce the widget needs to build the World ID
 * signal. The address always comes from the Privy session, never from the
 * client: this endpoint answers "am I human-backed?", not "is X human-backed?".
 */
export async function GET(req: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }

  const lookup = await lookupHumanId(user.wallet);
  if (lookup.error) {
    return NextResponse.json(
      { error: "impossibile verificare ora lo stato su AgentBook, riprova", detail: lookup.error },
      { status: 503 },
    );
  }
  if (lookup.humanId) return NextResponse.json({ registered: true, humanId: lookup.humanId });

  const nonce = await getAgentNonce(user.wallet);
  if ("error" in nonce) {
    return NextResponse.json(
      { error: "impossibile leggere il nonce di registrazione, riprova", detail: nonce.error },
      { status: 503 },
    );
  }
  return NextResponse.json({ registered: false, humanId: null, nonce: nonce.nonce, wallet: user.wallet });
}

import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";

/**
 * Issues a short-lived, signed `rp_context` for IDKit's request builder.
 * World ID 4.0 refuses to open a verification flow without one (it proves
 * the proof request genuinely comes from our relying party, not an
 * impersonator) — see docs.world.org's IDKit integration guide.
 *
 * `WORLD_SIGNING_KEY` is the RP signing key: it never leaves this function,
 * is never logged, and the response only ever contains the derived
 * signature/nonce/timestamps — never the key itself.
 *
 * No auth required: this endpoint reveals nothing about any user, it only
 * proves our own app's identity to World for the next few minutes. `action`
 * defaults to the shared claim action but accepts an override so other
 * World-ID-gated flows (e.g. the self-declared coach claim, Task 5) can
 * reuse this same endpoint with their own action string.
 */
export async function GET(req: Request) {
  const signingKeyHex = process.env.WORLD_SIGNING_KEY;
  const rpId = process.env.WORLD_RP_ID;
  if (!signingKeyHex || !rpId) {
    return NextResponse.json({ error: "World ID non configurato" }, { status: 500 });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || process.env.NEXT_PUBLIC_WORLD_ACTION || undefined;

  try {
    const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex, action });
    return NextResponse.json({
      rp_id: rpId,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      signature: sig,
    });
  } catch (e: any) {
    // Never log signingKeyHex, and never let it leak into an error message —
    // signRequest only throws on malformed hex/params, neither of which
    // includes the key material itself in this SDK's error text, but we
    // still avoid echoing the caught error's raw fields just in case.
    return NextResponse.json({ error: "impossibile firmare rp-context" }, { status: 500 });
  }
}

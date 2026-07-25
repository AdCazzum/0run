import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { coaches } from "@/db/schema";
import { verifyConsult, MAX_SKEW_SEC, type SignedConsult } from "@/lib/a2a/protocol";
import { resolveCoachEns } from "@/lib/ens/resolve";
import { loadConsultProfile } from "@/lib/coach/consult-profile";
import { systemPrompt } from "@/lib/coach/prompts";
import { coachComplete } from "@/lib/inference";
import type { ChatMsg } from "@/lib/inference";

const Body = z.object({
  from: z.string().min(3).max(255),
  to: z.string().min(3).max(255),
  question: z.string().min(1).max(2000),
  context: z.string().max(4000).default(""),
  ts: z.number().int(),
  nonce: z.string().min(1).max(128),
  sig: z.string().regex(/^0x[0-9a-f]+$/i),
});

/**
 * Agent→agent consult endpoint — the machine-callable half of this coach's
 * ENS identity (`agent-endpoint[a2a]` text record points here).
 *
 * Auth is pure ENS, no Privy, no tokens: the request is signed by the CALLER
 * agent's executor key, and the only registry consulted to validate it is the
 * caller's own ENS name — resolve `from`, read its `agent-signer` text
 * record, check the signature recovers to exactly that address. Any agent
 * that registers a compatible subname can speak here; nobody else can.
 *
 * Privacy contract — identical to the ask route (see its doc comment):
 * profile cascade only, never memoryRoot/memoryCipher, and NOTHING is ever
 * written. Anti-loop by construction: this consultant's prompt offers no
 * colleagues and its reply is never parsed for markers — max depth 1.
 */
export async function POST(req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ error: "tokenId non valido" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const msg = parsed.data as SignedConsult;

  try {
    const [coach] = await db.select().from(coaches).where(eq(coaches.tokenId, tokenId));
    if (!coach) return NextResponse.json({ error: "coach non trovato" }, { status: 404 });
    if (!coach.ensName) {
      return NextResponse.json({ error: "questo coach non ha ancora un'identità ENS" }, { status: 409 });
    }

    // Cheap pre-check BEFORE the expensive live ENS resolution of `from`:
    // reject a stale/replayed or misdirected request on timestamp/recipient
    // alone, same reasons verifyConsult would give below, so a spammer can't
    // force a resolveCoachEns RPC round-trip per garbage request. verifyConsult
    // still runs afterwards as the authoritative check (ts+to+signature together).
    if (Math.abs(Math.floor(Date.now() / 1000) - msg.ts) > MAX_SKEW_SEC) {
      return NextResponse.json({ error: "timestamp fuori finestra" }, { status: 401 });
    }
    if (msg.to.toLowerCase() !== coach.ensName.toLowerCase()) {
      return NextResponse.json({ error: "destinatario non corrispondente" }, { status: 401 });
    }

    // ENS as the auth registry: who may speak as `from` is whatever the
    // caller's own subname declares as its signer — resolved live, never cached.
    const caller = await resolveCoachEns(msg.from);
    const signer = caller.records["agent-signer"];
    if (!signer) {
      return NextResponse.json({ error: `${msg.from} non risolve o non pubblica agent-signer` }, { status: 401 });
    }
    const verdict = await verifyConsult(msg, { signer, selfName: coach.ensName });
    if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 401 });

    const { profile, profileSource } = await loadConsultProfile(coach);

    const messages: ChatMsg[] = [
      {
        role: "system",
        content: [
          systemPrompt(profile),
          `IMPORTANT: a fellow coach agent (${msg.from}) is consulting you on behalf of THEIR athlete — not yours. You know nothing about that athlete beyond what is quoted below. Answer as a specialist, in the language of the question, concisely (this is coach-to-coach advice, not a chat with an athlete).`,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          msg.context ? `Context from ${msg.from}:\n${msg.context}` : "",
          `Question from ${msg.from}: ${msg.question}`,
        ].filter(Boolean).join("\n\n"),
      },
    ];

    let completion: Awaited<ReturnType<typeof coachComplete>>;
    try {
      completion = await coachComplete(messages);
    } catch (e: any) {
      return NextResponse.json({ error: `inference non disponibile: ${e.message ?? e}` }, { status: 502 });
    }

    // Deliberately no db write of any kind — stateless, like the ask route.
    return NextResponse.json({
      reply: completion.text,
      coach: { name: profile.name, ensName: coach.ensName, personality: profile.personality },
      profileSource,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

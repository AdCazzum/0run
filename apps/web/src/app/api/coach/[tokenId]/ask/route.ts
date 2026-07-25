import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { coaches, runs } from "@/db/schema";
import { loadConsultProfile } from "@/lib/coach/consult-profile";
import { systemPrompt } from "@/lib/coach/prompts";
import { coachComplete } from "@/lib/inference";
import type { ChatMsg } from "@/lib/inference";

const Body = z.object({ message: z.string().min(1).max(2000) });

/**
 * "Ask this coach" — the product payoff of the public directory
 * (apps/web/src/app/coaches/page.tsx): an authenticated user can ask ANOTHER
 * person's coach agent about their OWN latest run.
 *
 * Privacy contract, enforced by what this route reads and never reads:
 *  - It reads ONLY the owner coach's `profileRoot` (the service-key-encrypted
 *    aggregate: name, personality, totals, pace trend, style notes — see
 *    lib/coach/memory.ts's buildProfile). This is exactly why the profile is
 *    encrypted separately from the private layer in the first place.
 *  - It NEVER reads the owner coach's `memoryRoot` or cached `memoryCipher`
 *    (the privateLayer: every raw run, encrypted with the OWNER's own
 *    wallet-derived key, which this route has no access to and must not try
 *    to obtain).
 *  - It NEVER writes anything — not to the owner's coach row, not to the
 *    owner's memory, not even to the asker's own chatMessages transcript
 *    (mixing this reply into the asker's own coach's history would
 *    misattribute it). The reply is returned and nothing more; this is a
 *    stateless consultation.
 *  - The asker's "own latest run" context comes from the PLAINTEXT
 *    `runs.stats` / `runs.report` columns for their own userId — no
 *    decryption, no wallet signature needed from the asker either.
 */
export async function POST(req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }

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
  const { message } = parsed.data;

  try {
    const [ownerCoach] = await db.select().from(coaches).where(eq(coaches.tokenId, tokenId));
    if (!ownerCoach) return NextResponse.json({ error: "coach non trovato" }, { status: 404 });

    // Public profile only — see the doc comment above for why this is the
    // one field of the owner's coach that is safe to decrypt server-side.
    //
    // Read from the cached envelope first, exactly like the chat route reads
    // memoryCipher: this is a stranger-facing path and a profile uploaded
    // minutes ago is not downloadable from 0G Storage yet. Falling straight
    // to the network made every consultation of a recently minted coach fail.
    const { profile, profileSource } = await loadConsultProfile(ownerCoach);

    // The asker's own latest run, plaintext columns only — never their own
    // encrypted memory either, so this route needs no userKeyHex from them.
    const [latestRun] = await db
      .select()
      .from(runs)
      .where(eq(runs.userId, user.userId))
      .orderBy(desc(runs.createdAt))
      .limit(1);
    if (!latestRun) {
      return NextResponse.json(
        { error: "carica prima una tua corsa per poterla chiedere a un altro coach" },
        { status: 409 },
      );
    }

    const messages: ChatMsg[] = [
      {
        role: "system",
        content: [
          systemPrompt(profile),
          `IMPORTANT: the person asking is NOT your usual athlete — you have no history with them, only what is given below about their single latest run. Apply your personality and methodology to THIS run only; do not pretend to know their past.`,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Their latest run:\n${JSON.stringify(latestRun.stats)}`,
          latestRun.report ? `Their own coach's take on it, for context:\n${JSON.stringify(latestRun.report)}` : "",
          `Question: ${message}`,
        ].filter(Boolean).join("\n\n"),
      },
    ];

    const completion = await coachComplete(messages);

    // Deliberately no db write of any kind here — see the doc comment above.
    return NextResponse.json({
      reply: completion.text,
      coach: { name: profile.name, personality: profile.personality },
      // Where the coach's profile came from. "public-row" means its aggregate
      // (totals, pace trend) could not be read and the answer is based on its
      // personality alone — degraded, and said so rather than hidden.
      profileSource,
      disclaimer: `${profile.name} read your run in its own style. It has never seen your training history — and you never see its athlete's.`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

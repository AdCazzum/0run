import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { chatMessages, coaches, runs } from "@/db/schema";
import { decryptJson, canDecrypt } from "@/lib/crypto/aes";
import { downloadDecrypted } from "@/lib/zerog/storage";
import { buildProfile, parseMemory } from "@/lib/coach/memory";
import { buildChatMessages } from "@/lib/coach/prompts";
import { coachComplete } from "@/lib/inference";
import type { ChatMsg } from "@/lib/inference";
import { buildConsultInstruction, parseConsultMarker } from "@/lib/a2a/marker";
import { consultCoach } from "@/lib/a2a/consult";
import { getCoachDirectory } from "@/lib/coach/directory";

const Body = z.object({
  message: z.string().min(1).max(2000),
  // Same shape as the mint route's userKeyHex validation: Buffer.from(hex,
  // "hex") silently ignores invalid characters instead of throwing, so a
  // plain .length(64) check would let non-hex garbage through and derive a
  // wrong AES key instead of failing loudly.
  userKeyHex: z.string().regex(/^[0-9a-f]{64}$/i, "userKeyHex deve essere 64 caratteri esadecimali (32 byte)"),
  runId: z.number().int().positive().optional(),
});

export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }

  // A non-JSON body would otherwise make req.json() throw before zod
  // validation ever runs, surfacing as an uncaught 500 instead of an
  // honest 400 (same fix as the mint route).
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { message, userKeyHex, runId } = parsed.data;
  const userKey = Buffer.from(userKeyHex, "hex");

  try {
    const [coach] = await db.select().from(coaches).where(eq(coaches.userId, user.userId));
    if (!coach) return NextResponse.json({ error: "coach non trovato, minta prima il coach" }, { status: 409 });

    // AMENDMENT 1 (docs/0g-reality-check.md, see lib/coach/pipeline.ts for
    // the full rationale): a freshly uploaded blob is not reliably
    // downloadable from 0G Storage for 16+ minutes, so this request path
    // must NEVER read the coach's memory from Storage on the hot path.
    // coaches.memoryCipher caches the exact same AES envelope Storage holds
    // (ciphertext only); only fall back to downloadDecrypted when that
    // cache is empty (rows minted before the column existed) — by then the
    // blob is old and finalized, so the download is safe.
    let memoryCipherText: string;
    if (coach.memoryCipher) {
      memoryCipherText = coach.memoryCipher;
    } else {
      const dl = await downloadDecrypted(coach.memoryRoot, userKey, (b) => canDecrypt(b.toString("utf8"), userKey));
      if (!dl.ok) return NextResponse.json({ error: dl.error }, { status: 502 });
      memoryCipherText = dl.data.toString("utf8");
    }
    // parseMemory (not decryptJson(..., CoachMemorySchema) directly): real
    // memories already on 0G Storage may still be v1 (pre-healthSnapshot) —
    // see apps/web/src/lib/coach/memory.ts for the migration.
    const memory = parseMemory(decryptJson(memoryCipherText, userKey, z.unknown()));
    const profile = buildProfile(memory);

    // Pin the specific run this chat is scoped to (run page) so "how did it
    // go?" has a referent. Ownership-scoped: a runId that doesn't exist or
    // belongs to someone else silently falls back to general chat instead
    // of erroring — the chat is still useful without a pin.
    let pinnedRun: typeof runs.$inferSelect | undefined;
    if (runId != null) {
      [pinnedRun] = await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.userId, user.userId)));
    }

    const pastHistory: ChatMsg[] = (await db.select().from(chatMessages).where(eq(chatMessages.userId, user.userId)))
      .map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content }));

    let messages = buildChatMessages(
      profile, memory.privateLayer.runs,
      [...pastHistory, { role: "user", content: message }],
      // Decrypted private-layer health snapshot, if any — same "owner's own
      // decrypt path only" contract as the run pipeline (see prompts.ts).
      memory.privateLayer.healthSnapshot,
    );

    if (pinnedRun) {
      const pin: ChatMsg = {
        role: "system",
        content: `The user is asking specifically about this run (pinned from the run page):\n${JSON.stringify(
          { stats: pinnedRun.stats, report: pinnedRun.report, createdAt: pinnedRun.createdAt },
        )}`,
      };
      // Right after the system prompt, before the conversation history, so
      // it reads as context the model was primed with, not a stray user turn.
      messages = [messages[0], pin, ...messages.slice(1)];
    }

    // Colleague roster for the consult instruction — best-effort: the
    // directory does live RPC (cached 60s) and its failure must never take
    // the chat down. Own coach excluded; only live-resolving ENS names count.
    let roster: { tokenId: string; ensName: string; personality: string | null }[] = [];
    try {
      roster = (await getCoachDirectory())
        .filter((e) => e.displayName && e.ensName && e.tokenId !== coach.tokenId)
        .map((e) => ({ tokenId: e.tokenId, ensName: e.ensName!, personality: e.personality }));
    } catch (e) {
      console.warn("chat: directory unavailable, no consult roster", e);
    }
    const instruction = buildConsultInstruction(roster);
    if (instruction && coach.ensName) {
      messages = [
        { role: "system", content: `${messages[0].content}\n${instruction}` },
        ...messages.slice(1),
      ];
    }

    const completion = await coachComplete(messages);

    // A2A consult (spec 2026-07-25-a2a-ens-design.md): the model asks a
    // colleague via an inline marker; the server resolves the colleague's ENS
    // name, makes the signed call, and a second inference integrates the
    // reply. Depth 1: the marker is only ever parsed HERE, never on the
    // receiving a2a route. Best-effort throughout — a failed consult means
    // the coach answers alone and says so, never an error to the athlete.
    let replyText = completion.text;
    let consult: { to: string; toTokenId: string | null; question: string; reply: string; coachName: string } | undefined;

    const { marker } = parseConsultMarker(completion.text);
    // The model can hallucinate a coach that isn't in the roster we gave it
    // (or that dropped out between prompt build and completion) — treat that
    // exactly like "no marker": strip it, no A2A call. Never resolve/consult
    // an ENS name we didn't ourselves offer as a colleague.
    if (marker && coach.ensName && roster.some((r) => r.ensName === marker.coach)) {
      const contextSummary = pinnedRun ? `L'ultimo run del mio atleta: ${JSON.stringify(pinnedRun.stats)}` : "";
      const result = await consultCoach(coach.ensName, marker.coach, marker.question, contextSummary);
      const followUp: ChatMsg = result.ok
        ? {
            role: "user",
            content: `[risultato del consulto] ${result.coach.name} (${result.coach.ensName}) ha risposto: «${result.reply}». Ora rispondi al tuo atleta integrando e citando il parere del collega. Non usare più il marker <consult>.`,
          }
        : {
            role: "user",
            content: `[risultato del consulto] Il collega ${marker.coach} non era raggiungibile (${result.error}). Rispondi al tuo atleta da solo, dicendo che hai provato a consultarlo. Non usare più il marker <consult>.`,
          };
      const second = await coachComplete([...messages, { role: "assistant", content: completion.text }, followUp]);
      // Never leak a stray marker to the athlete, whatever the model did.
      replyText = parseConsultMarker(second.text).cleaned;
      if (result.ok) {
        consult = {
          to: result.coach.ensName,
          toTokenId: roster.find((r) => r.ensName === marker.coach)?.tokenId ?? null,
          question: marker.question,
          reply: result.reply,
          coachName: result.coach.name,
        };
      }
    } else {
      replyText = parseConsultMarker(completion.text).cleaned;
    }

    // Never write to the coach's memory (0G Storage / coaches table) from
    // chat — only the run pipeline updates memory. Chat only persists the
    // conversation turns (now with the consult block on the assistant turn).
    await db.insert(chatMessages).values([
      { userId: user.userId, role: "user", content: message },
      { userId: user.userId, role: "assistant", content: replyText, consult: consult ?? null },
    ]);

    return NextResponse.json(consult ? { reply: replyText, consult } : { reply: replyText });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

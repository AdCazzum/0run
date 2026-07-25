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

    const completion = await coachComplete(messages);

    // Never write to the coach's memory (0G Storage / coaches table) from
    // chat — only the run pipeline updates memory. Chat only persists the
    // conversation turns.
    await db.insert(chatMessages).values([
      { userId: user.userId, role: "user", content: message },
      { userId: user.userId, role: "assistant", content: completion.text },
    ]);

    return NextResponse.json({ reply: completion.text });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

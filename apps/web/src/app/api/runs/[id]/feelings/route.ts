import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { runs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { decryptJson } from "@/lib/crypto/aes";

const Body = z.object({
  // Same shape as the chat route's userKeyHex validation: Buffer.from(hex,
  // "hex") silently ignores invalid characters instead of throwing, so a
  // plain .length(64) check would let non-hex garbage through and derive a
  // wrong AES key instead of failing loudly.
  userKeyHex: z.string().regex(/^[0-9a-f]{64}$/i, "userKeyHex deve essere 64 caratteri esadecimali (32 byte)"),
});

/**
 * Decrypts and returns the free-text "how did it feel" note captured at
 * upload. Postgres holds only runs.feelingsCipher (ciphertext) — this is the
 * one place that turns it back into plaintext, and only for the run's own
 * owner. Same trust model as POST /api/coach/chat: the user key arrives per
 * request (derived client-side from a wallet signature) and is never
 * persisted server-side.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }

  // A non-JSON body would otherwise make req.json() throw before zod
  // validation ever runs, surfacing as an uncaught 500 instead of an honest
  // 400 (same fix as the chat route).
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { userKeyHex } = parsed.data;

  try {
    const { id } = await params;
    // Ownership-scoped by construction: a run that doesn't exist, or belongs
    // to a different user, matches nothing here and is indistinguishable
    // from "doesn't exist" to the caller — a 404, never a 403 that would
    // confirm the run ID belongs to someone else.
    const [run] = await db.select().from(runs).where(and(eq(runs.id, Number(id)), eq(runs.userId, user.userId)));
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    // No feelings were ever submitted for this run — a real, non-error
    // state. Never a placeholder implying data exists.
    if (!run.feelingsCipher) return NextResponse.json({ feelings: null });

    try {
      const feelings = decryptJson(run.feelingsCipher, Buffer.from(userKeyHex, "hex"), z.string());
      return NextResponse.json({ feelings });
    } catch {
      // Wrong key and a corrupted/foreign ciphertext both throw inside
      // decryptJson (AES-GCM auth tag mismatch) — deliberately the same
      // generic failure either way, so this endpoint can't be used to probe
      // which one it was.
      return NextResponse.json({ error: "could not decrypt" }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

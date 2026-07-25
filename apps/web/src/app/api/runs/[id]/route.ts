import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { coaches, runs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { canDecrypt, decryptJson } from "@/lib/crypto/aes";
import { downloadDecrypted } from "@/lib/zerog/storage";
import { updateRegistry, toBytes32 } from "@/lib/zerog/contracts";
import { parseMemory, persistMemory, removeRun } from "@/lib/coach/memory";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const [run] = await db.select().from(runs).where(and(eq(runs.id, Number(id)), eq(runs.userId, user.userId)));
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

const DeleteBody = z.object({
  // The run has to leave the ENCRYPTED memory, not just the index, and only the
  // athlete's own key can open it — same per-request trust model as the chat
  // route: derived client-side from a wallet signature, never persisted here.
  userKeyHex: z.string().regex(/^[0-9a-f]{64}$/i, "userKeyHex deve essere 64 caratteri esadecimali (32 byte)"),
});

/**
 * Deletes a run.
 *
 * Order matters, and it is: rewrite the memory first, delete the row second. If
 * the rewrite fails nothing is lost and the caller gets an honest error; if the
 * row delete failed after it, the run is gone from the coach's memory and still
 * listed, which a retry fixes. The reverse order could leave a run shaping the
 * coach's advice with no way for the athlete to find or remove it.
 *
 * What this genuinely undoes: the run stops existing for 0run and stops shaping
 * anything the coach says, and the rewritten memory is re-anchored on-chain
 * under a new hash.
 *
 * What nobody can undo, and the response says so rather than implying
 * otherwise: the encrypted GPX already written to 0G Storage stays there —
 * storage is immutable and we hold no delete key — and the previous memory
 * hashes remain in the chain's history. Both are unreadable without the
 * athlete's own key, and after this nothing points at them.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const parsed = DeleteBody.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const userKey = Buffer.from(parsed.data.userKeyHex, "hex");

  try {
    const { id } = await params;
    const runId = Number(id);
    if (!Number.isInteger(runId)) return NextResponse.json({ error: "id non valido" }, { status: 400 });

    // Ownership-scoped read: a run belonging to someone else is simply not found.
    const [run] = await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.userId, user.userId)));
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

    const [coach] = await db.select().from(coaches).where(eq(coaches.userId, user.userId));

    // A run whose GPX never made it to storage (the pipeline failed before that
    // step) has no entry in the memory to remove: the row is the whole of it.
    const inMemory = !!coach && !!run.gpxRoot;
    let memoryUpdated = false;
    let registryTx: string | null = null;

    if (inMemory && coach) {
      let memoryCipherText: string;
      if (coach.memoryCipher) {
        memoryCipherText = coach.memoryCipher;
      } else {
        const dl = await downloadDecrypted(coach.memoryRoot, userKey, (b) => canDecrypt(b.toString("utf8"), userKey));
        if (!dl.ok) return NextResponse.json({ error: dl.error }, { status: 502 });
        memoryCipherText = dl.data.toString("utf8");
      }

      const memory = parseMemory(decryptJson(memoryCipherText, userKey, z.unknown()));
      const without = removeRun(memory, run.gpxRoot!);
      const receipts = await persistMemory(without, userKey);
      if (!receipts.memory.ok || !receipts.profile.ok) {
        // Nothing has been deleted yet — say what failed and change nothing.
        const reason = !receipts.memory.ok ? receipts.memory.error : (receipts.profile as { error: string }).error;
        return NextResponse.json({ error: `memoria non riscritta, corsa non eliminata: ${reason}` }, { status: 502 });
      }
      memoryUpdated = true;

      // The memory changed, so its on-chain anchor must change with it, or the
      // claim "the hash of this coach's memory is verifiable on-chain" quietly
      // stops being true. Not fatal: the next run re-anchors.
      try {
        registryTx = await updateRegistry(
          coach.tokenId,
          toBytes32(receipts.memory.rootHash),
          toBytes32(receipts.profile.rootHash),
        );
      } catch (e) {
        console.error("run delete: on-chain memory anchor failed, will re-anchor on the next run", e);
      }

      await db
        .update(coaches)
        .set({
          memoryRoot: receipts.memory.rootHash,
          profileRoot: receipts.profile.rootHash,
          memoryCipher: receipts.memoryCipher,
        })
        .where(eq(coaches.userId, user.userId));
    }

    await db.delete(runs).where(and(eq(runs.id, runId), eq(runs.userId, user.userId)));

    return NextResponse.json({
      deleted: true,
      memoryUpdated,
      registryTx,
      // Said plainly, every time: what remains, and why it is still private.
      note: "La corsa non c'è più su 0run e non influenza più il tuo coach. Il file cifrato già scritto su 0G Storage resta lì — nessuno, noi compresi, può cancellarlo — ma senza la tua chiave è illeggibile e ora niente lo indica.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

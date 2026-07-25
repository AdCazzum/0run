import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { coaches, runs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { canDecrypt, decryptJson } from "@/lib/crypto/aes";
import { downloadDecrypted } from "@/lib/zerog/storage";
import { updateRegistry, toBytes32 } from "@/lib/zerog/contracts";
import { parseMemory, prepareMemoryCommit, removeRun } from "@/lib/coach/memory";
import { commitMemory, MEMORY_CONFLICT } from "@/lib/coach/commit";

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

/** Postgres int4: anything past this reaches the driver and comes back as a raw DB error. */
const MAX_RUN_ID = 2_147_483_647;

/**
 * Deletes a run.
 *
 * Order matters, and it is: rewrite the memory first, delete the row second. If
 * the rewrite fails nothing is lost and the caller gets an honest error; the
 * reverse could leave a run shaping the coach's advice with no way for the
 * athlete to find or remove it.
 *
 * What this genuinely undoes: the run stops existing for 0run and stops shaping
 * anything the coach says, and the rewritten memory is re-anchored on-chain
 * under a new hash.
 *
 * What nobody can undo — and the response says so only when it is true: an
 * encrypted GPX that was already written to 0G Storage stays there, because
 * storage is immutable and we hold no delete key. It is unreadable without the
 * athlete's own key, and after this nothing points at it.
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
    // Digits only, and inside int4. Number() alone accepts "1e3" (→ 1000) and
    // "0x11" (→ 17), so a malformed link would delete a DIFFERENT run of this
    // athlete's — row and memory entry both — and an oversized value would come
    // back as a raw Postgres range error rendered to the user as the reason.
    if (!/^\d+$/.test(id) || Number(id) > MAX_RUN_ID) {
      return NextResponse.json({ error: "id non valido" }, { status: 400 });
    }
    const runId = Number(id);

    // Ownership-scoped read: a run belonging to someone else is simply not found.
    const [run] = await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.userId, user.userId)));
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

    // A run still being processed is being written by the pipeline right now.
    // Deleting it here would race that: the pipeline appends it to the memory
    // moments later, leaving the run inside the coach's head with no row left
    // to remove it — permanently. Refuse, and say when to come back.
    if (run.status === "processing") {
      return NextResponse.json(
        {
          error: "questa corsa è ancora in elaborazione: attendi che finisca, poi eliminala",
          reason: "run_processing",
        },
        { status: 409 },
      );
    }

    const [coach] = await db.select().from(coaches).where(eq(coaches.userId, user.userId));

    // Whether the run is in the coach's memory is decided by READING the memory,
    // never inferred from the row: gpxRoot is written at the store_gpx step,
    // before update_memory, so a run that failed in between has a gpxRoot and no
    // entry — and rewriting for it would re-upload an identical memory, pay a
    // chain tx, and (when 0G Storage is slow) refuse the deletion outright.
    // A coach whose mint never confirmed has no memory at all: its memoryRoot is
    // the empty placeholder, and downloading that just times out.
    const coachHasMemory = !!coach?.tokenId && (!!coach.memoryCipher || !!coach.memoryRoot);
    let memoryUpdated = false;
    let registryTx: string | null = null;
    let anchorError: string | null = null;
    let uploadStarted = false;

    if (coach && coachHasMemory && run.gpxRoot) {
      let memoryCipherText: string;
      if (coach.memoryCipher) {
        memoryCipherText = coach.memoryCipher;
      } else {
        const dl = await downloadDecrypted(coach.memoryRoot, userKey, (b) => canDecrypt(b.toString("utf8"), userKey));
        if (!dl.ok) return NextResponse.json({ error: dl.error }, { status: 502 });
        memoryCipherText = dl.data.toString("utf8");
      }

      let memory;
      try {
        memory = parseMemory(decryptJson(memoryCipherText, userKey, z.unknown()));
      } catch {
        // Same convention as /api/health-data: a key that does not open this
        // envelope is the caller's problem to fix, not a server crash with node's
        // crypto internals quoted back at them.
        return NextResponse.json({ error: "impossibile decifrare la memoria (chiave errata?)" }, { status: 400 });
      }

      const isInMemory = memory.privateLayer.runs.some((r) => r.gpxRoot === run.gpxRoot);
      if (isInMemory) {
        const without = removeRun(memory, run.gpxRoot);
        // Hash locally, write, answer — then upload. Waiting for 0G Storage here
        // can outlast the proxy, which would leave the athlete reading "could not
        // delete" while the server finishes the job behind them.
        const commit = await prepareMemoryCommit(without, userKey);
        const committed = await commitMemory(user.userId, coach.memoryRoot, commit);
        if (!committed) return NextResponse.json(MEMORY_CONFLICT, { status: 409 });
        memoryUpdated = true;

        startBackgroundUpload(commit.upload, `run ${runId} delete`);
        uploadStarted = true;

        // The memory changed, so its on-chain anchor must change with it, or the
        // claim "the hash of this coach's memory is verifiable on-chain" quietly
        // stops being true. Not fatal, and reported rather than swallowed.
        try {
          registryTx = await updateRegistry(
            coach.tokenId,
            toBytes32(commit.memoryRoot),
            toBytes32(commit.profileRoot),
          );
        } catch (e) {
          anchorError = e instanceof Error ? e.message : String(e);
          console.error("run delete: on-chain memory anchor failed, will re-anchor on the next run", e);
        }
      }
    }

    await db.delete(runs).where(and(eq(runs.id, runId), eq(runs.userId, user.userId)));

    return NextResponse.json({
      deleted: true,
      memoryUpdated,
      registryTx,
      anchored: memoryUpdated ? registryTx !== null : null,
      anchorError,
      // Only claimed when it is true: a run whose upload never happened has no
      // encrypted copy on 0G Storage, and telling someone an undeletable copy of
      // their run exists forever when it does not is exactly the kind of scary
      // false statement this codebase refuses to make.
      note: run.gpxRoot
        ? "La corsa non c'è più su 0run e non influenza più il tuo coach. Il file cifrato già scritto su 0G Storage resta lì — nessuno, noi compresi, può cancellarlo — ma senza la tua chiave è illeggibile e ora niente lo indica."
        : "La corsa non c'è più su 0run. Di questa corsa non era mai stato caricato nulla su 0G Storage: non resta alcuna copia.",
      uploadPending: uploadStarted,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

/** Fire-and-forget, with the same discipline as the mint route's background upload. */
function startBackgroundUpload(upload: () => Promise<{ memory: unknown; profile: unknown }>, label: string) {
  upload()
    .then((receipts) => console.log(`${label}: background memory upload settled`, receipts))
    .catch((e) => console.error(`${label}: background memory upload crashed`, e));
}

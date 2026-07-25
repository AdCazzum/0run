import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { coaches } from "@/db/schema";

/**
 * Writes a rewritten memory onto the coaches row — but only if nobody else
 * rewrote it in the meantime.
 *
 * Four different paths rewrite the same encrypted memory: the run pipeline, a
 * health-data upload, a brief edit and a run deletion. Each one reads the
 * envelope, changes it in memory, and writes it back, which is a read-modify-
 * write with no coordination at all: upload a run and edit your brief while it
 * processes, and whichever finishes second silently throws the other's change
 * away. The athlete sees "Saved." for an edit that no longer exists, or a run
 * that is on the dashboard but not in the coach's memory.
 *
 * The guard is the root we started from: the UPDATE only matches while
 * `memory_root` still holds it. If it does not, someone else committed first,
 * this write does not land, and the caller is told — a refused write it can
 * retry, instead of a lost one nobody notices.
 *
 * It is honest to call this detection, not exclusion: two writers can still
 * both read the same root and race to the UPDATE, and the loser simply loses
 * the race rather than corrupting anything. A per-coach lock would be the
 * complete answer; this converts silent data loss into an explicit conflict,
 * which is the part that matters.
 */
export type MemoryCommit = {
  memoryRoot: string;
  profileRoot: string;
  memoryCipher: string;
  profileCipher: string;
};

export async function commitMemory(
  userId: number,
  expectedMemoryRoot: string,
  next: MemoryCommit,
  extra: Partial<typeof coaches.$inferInsert> = {},
): Promise<boolean> {
  const rows = await db
    .update(coaches)
    .set({
      memoryRoot: next.memoryRoot,
      profileRoot: next.profileRoot,
      memoryCipher: next.memoryCipher,
      // Always together with memoryCipher: this is the envelope a stranger's
      // consultation reads, and leaving it stale is how an edited brief never
      // reaches the coach someone else is talking to.
      profileCipher: next.profileCipher,
      ...extra,
    })
    .where(and(eq(coaches.userId, userId), eq(coaches.memoryRoot, expectedMemoryRoot)))
    .returning({ id: coaches.id });

  return rows.length > 0;
}

/** The 409 every caller of commitMemory returns when it loses the race. */
export const MEMORY_CONFLICT = {
  error:
    "your coach's memory changed while this was being saved (another upload or edit landed first) — reload and try again",
  reason: "memory_conflict",
} as const;

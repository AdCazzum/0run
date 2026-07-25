import { eq } from "drizzle-orm";
import type { Personality } from "@0run/shared";
import { db } from "@/db";
import { coaches } from "@/db/schema";
import { buildAvatarPrompt, generateAvatar } from "./generate";

/**
 * Gives a face to a coach that does not have one yet, in the background.
 *
 * Avatars arrived after the first coaches did, and generation is a best-effort
 * step that can also simply fail at mint time — so without this, those coaches
 * would stay faceless forever with no way to fix it short of hand-editing the
 * database. Every listing that notices a missing avatar asks for one instead.
 *
 * Bounded on purpose, because each image is a paid call:
 * - one attempt at a time per coach (`inFlight`), so a page opened in five
 *   tabs does not order five portraits;
 * - a cooldown after a failure, so a broken router key does not turn a 60s
 *   cache refresh into a retry loop.
 *
 * Never throws and never returns anything: the caller is rendering a page, and
 * the avatar shows up on a later load or not at all.
 */
const inFlight = new Set<string>();
const failedAt = new Map<string, number>();
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

/** Test seam: forget what is in flight and what recently failed. */
export function _resetEnsureAvatarForTest() {
  inFlight.clear();
  failedAt.clear();
}

export function ensureAvatarInBackground(coach: {
  userId: number;
  tokenId: string;
  name: string;
  personality: string;
}): void {
  const { tokenId } = coach;
  if (!tokenId || inFlight.has(tokenId)) return;

  const lastFailure = failedAt.get(tokenId);
  if (lastFailure && Date.now() - lastFailure < RETRY_AFTER_FAILURE_MS) return;

  inFlight.add(tokenId);
  generateAvatar(buildAvatarPrompt(coach.name, coach.personality as Personality, tokenId))
    .then(async (result) => {
      if (!result.ok) {
        failedAt.set(tokenId, Date.now());
        console.error(`avatar: backfill for coach ${tokenId} failed`, result.error);
        return;
      }
      await db
        .update(coaches)
        .set({
          avatarImage: result.pngBase64,
          avatarModel: result.model,
          avatarVerifiedTee: result.teeVerified ? "true" : "false",
        })
        .where(eq(coaches.userId, coach.userId));
      console.log(`avatar: backfill for coach ${tokenId} ok (tee ${result.teeVerified})`);
    })
    .catch((e) => {
      failedAt.set(tokenId, Date.now());
      console.error(`avatar: backfill for coach ${tokenId} crashed`, e);
    })
    .finally(() => inFlight.delete(tokenId));
}

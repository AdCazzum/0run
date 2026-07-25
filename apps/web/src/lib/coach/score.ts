import type { CoachProfile, RunStats, RunSummary } from "@0run/shared";
import { directComplete } from "../inference/direct";
import { completeJsonWith } from "../inference";
import { buildScoreMessages, ScoreSchema } from "./prompts";

export type ScoreOutcome =
  | { ok: true; score: 1 | 2 | 3 | 4 | 5; note: string; verified: boolean | null; model: string }
  | { ok: false; error: string };

/**
 * Attested effort score: a number 1-5 describing how hard THIS run was for
 * THIS athlete, RELATIVE TO THEIR OWN recent history (1 = recovery, 3 =
 * typical, 5 = maximal) — never an absolute scale, because a fixed scale
 * compared across different runners' fitness levels would be meaningless.
 * See buildScoreMessages in ./prompts.ts, which is the only place that
 * encodes this semantics into the actual prompt.
 *
 * Deliberately calls `directComplete` from ../inference/direct, NEVER
 * `coachComplete`: this is the one call in the product that must always take
 * the TEE-attested "direct" 0G Compute path, regardless of INFERENCE_PREFER.
 * The narrative report (see ./pipeline.ts, step "inference") stays on the
 * router because it needs a model good enough to use memory context; the
 * score is a single number a 7B model can produce well, and it's also the
 * part someone could dispute or game, so tamper-proof provenance is what
 * actually matters here. See docs/0g-reality-check.md, "Router contro
 * Direct", for the measurements behind this split. Reusing `coachComplete`
 * (which prefers direct only when INFERENCE_PREFER=direct) would silently
 * let the score be produced by the unattested router path instead.
 *
 * Never throws. The direct path is a single provider on a testnet and falls
 * over often — timeout, empty response, no provider configured, or a reply
 * that fails ScoreSchema even after completeJsonWith's built-in retries (an
 * out-of-range score like 9 is rejected, never silently clamped into 1-5).
 * Any of those degrade to `{ ok: false }` so callers can treat the score as
 * merely unavailable — same receipt discipline as StorageReceipt in
 * ../zerog/storage.ts: always return an outcome, never throw, never invent a
 * value that wasn't actually produced.
 */
export async function scoreRun(
  profile: CoachProfile, recentRuns: RunSummary[], current: RunStats,
): Promise<ScoreOutcome> {
  try {
    const { value, meta } = await completeJsonWith(directComplete, ScoreSchema, buildScoreMessages(profile, recentRuns, current));
    return { ok: true, score: value.score as 1 | 2 | 3 | 4 | 5, note: value.note, verified: meta.verified, model: meta.model };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

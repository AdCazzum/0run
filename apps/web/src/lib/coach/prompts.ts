import { z } from "zod";
import type { CoachProfile, RunStats, RunSummary } from "@0run/shared";
import type { ChatMsg } from "../inference";

export const ReportSchema = z.object({
  headline: z.string().min(1),
  analysis: z.string().min(1),
  comparison: z.string().min(1),
  advice: z.array(z.string()).min(1).max(5),
});
export type Report = z.infer<typeof ReportSchema>;

export function systemPrompt(profile: CoachProfile): string {
  return [
    `You are ${profile.name}, an AI running coach. Personality: ${profile.styleNotes}`,
    `Athlete totals: ${profile.totals.runs} runs, ${profile.totals.km} km. Recent pace trend (sec/km, latest last): ${profile.paceTrend.join(", ") || "none"}.`,
    `Stay in character. Be specific with numbers. Answer in the user's language (Italian if unsure).`,
  ].join("\n");
}

/**
 * `score` is the attested effort score computed separately on the TEE-verified
 * 0G Compute "direct" path (see ../score.ts) — optional because that path can
 * be unavailable (single provider, testnet). When present, it's handed to the
 * narrative model as a fact to cite, not something to re-derive; when absent,
 * the prompt is byte-for-byte what it was before this feature existed.
 */
export function buildReportMessages(
  profile: CoachProfile, recentRuns: RunSummary[], current: RunStats,
  score?: { score: number; verified: boolean | null } | null,
): ChatMsg[] {
  const scoreLine = score
    ? [`Attested effort score for today's run (independently computed, 1-5 relative to this athlete's own history, ${
        score.verified === true ? "cryptographically TEE-verified" : score.verified === false ? "verification failed" : "TEE attestation unavailable"
      }): ${score.score}/5. Cite this figure in your analysis.`]
    : [];
  return [
    { role: "system", content: systemPrompt(profile) },
    {
      role: "user",
      content: [
        `Analyze today's run and compare it EXPLICITLY with the previous runs (cite concrete deltas, e.g. sec/km).`,
        `Today's run:\n${JSON.stringify(current, null, 1)}`,
        `Summaries of previous runs (latest last):\n${JSON.stringify(recentRuns.slice(-5), null, 1)}`,
        ...scoreLine,
        `Respond ONLY with JSON: {"headline": string, "analysis": string, "comparison": string, "advice": string[]} (max 4 advice).`,
      ].join("\n\n"),
    },
  ];
}

export const ScoreSchema = z.object({
  score: z.number().int().min(1).max(5),
  note: z.string().min(1).max(200),
});
export type Score = z.infer<typeof ScoreSchema>;

/**
 * Prompt for the attested effort score (see ../score.ts). Deliberately tiny:
 * this call runs on the "direct" 0G Compute path, a single 7B model
 * (qwen2.5-omni-7b) that has measured to ignore memory context on longer
 * prompts (docs/0g-reality-check.md) — so it gets ONE instruction and
 * pre-aggregated numbers only, never the raw GPX or per-km splits.
 *
 * The score is EFFORT/INTENSITY RELATIVE TO THIS ATHLETE'S OWN HISTORY (1 =
 * recovery, 5 = maximal), not an absolute scale — an absolute scale would be
 * meaningless across runners with different fitness levels, so the prompt
 * anchors the model explicitly on this athlete's own recent pace trend.
 */
export function buildScoreMessages(profile: CoachProfile, recentRuns: RunSummary[], current: RunStats): ChatMsg[] {
  const recentPaces = recentRuns.slice(-5).map((r) => r.avgPaceSecKm);
  return [
    {
      role: "system",
      content: [
        `Rate how hard today's run was for THIS athlete, RELATIVE TO THEIR OWN recent runs — not an absolute scale (comparing across different runners would be meaningless).`,
        `1 = clearly easier than usual (recovery), 3 = typical effort, 5 = maximal/all-out effort for them.`,
        `Respond ONLY with this JSON, nothing else: {"score": <integer 1-5>, "note": "<reason, max 15 words>"}.`,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Athlete's recent pace trend (sec/km, latest last): ${recentPaces.join(", ") || "none"}.`,
        `Athlete totals: ${profile.totals.runs} runs, ${profile.totals.km} km.`,
        `Today's run: distance ${current.distanceKm} km, duration ${current.durationSec} s, avg pace ${current.avgPaceSecKm} sec/km, elevation gain ${current.elevationGainM} m, avg hr ${current.avgHr ?? "n/a"}.`,
      ].join("\n"),
    },
  ];
}

export function buildChatMessages(profile: CoachProfile, recentRuns: RunSummary[], history: ChatMsg[]): ChatMsg[] {
  return [
    { role: "system", content: `${systemPrompt(profile)}\nRecent runs:\n${JSON.stringify(recentRuns.slice(-5))}` },
    ...history.slice(-12),
  ];
}

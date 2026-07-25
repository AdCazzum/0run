import { z } from "zod";

export const SIGN_MESSAGE = "0run key derivation v1 — sign to unlock your encrypted running data";

export const PersonalitySchema = z.enum(["pacer", "coach", "drill_sergeant"]);
export type Personality = z.infer<typeof PersonalitySchema>;

export const RunStatsSchema = z.object({
  distanceKm: z.number().positive(),
  durationSec: z.number().positive(),
  avgPaceSecKm: z.number().positive(),
  elevationGainM: z.number().min(0),
  splitsSecKm: z.array(z.number().positive()),
  avgHr: z.number().positive().nullable(),
  startedAt: z.string().datetime(),
});
export type RunStats = z.infer<typeof RunStatsSchema>;

// Shape of a completed coach report, duplicated (not imported) from
// apps/web/src/lib/coach/prompts.ts's ReportSchema on purpose: that schema
// lives in the app layer (it drives inference/UI), while this one only
// exists to describe what a RunSummary embeds in the manifest. Keeping them
// separate avoids a shared -> app dependency; they are kept structurally
// identical by convention.
export const RunReportSchema = z.object({
  headline: z.string(),
  analysis: z.string(),
  comparison: z.string(),
  advice: z.array(z.string()),
});
export type RunReport = z.infer<typeof RunReportSchema>;

export const RunSummarySchema = RunStatsSchema.extend({
  reportHeadline: z.string().default(""),
  // SSOT amendment (2026-07-25, docs/superpowers/specs/2026-07-25-storage-ssot-spec.md):
  // the encrypted CoachMemory is the user's complete manifest, so the DB is
  // rebuildable from Storage + chain alone. gpxRoot/gpxContentHash are always
  // known synchronously when the pipeline appends a run (right after the GPX
  // upload). report is nullable: the pipeline appends+persists the run BEFORE
  // running inference (memory has to exist to build the report prompt), so
  // the just-appended entry's report is not yet known at that point and is
  // stored as null — a known, accepted gap for this run only (not backfilled
  // retroactively in this task).
  gpxRoot: z.string(),
  gpxContentHash: z.string(),
  report: RunReportSchema.nullable(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const CoachMemorySchema = z.object({
  version: z.literal(1),
  coach: z.object({ name: z.string().min(1), personality: PersonalitySchema }),
  privateLayer: z.object({ runs: z.array(RunSummarySchema) }),
});
export type CoachMemory = z.infer<typeof CoachMemorySchema>;

export const CoachProfileSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  personality: PersonalitySchema,
  totals: z.object({ runs: z.number().int().min(0), km: z.number().min(0) }),
  paceTrend: z.array(z.number()).describe("avgPaceSecKm ultime N corse, più recente per ultima"),
  styleNotes: z.string(),
});
export type CoachProfile = z.infer<typeof CoachProfileSchema>;

export type StorageReceipt =
  | { ok: true; rootHash: string; txHash: string }
  | { ok: false; error: string };

export const PERSONALITY_STYLE: Record<Personality, string> = {
  pacer: "Supportive companion: celebrates effort, gentle suggestions, warm tone.",
  coach: "Balanced professional: data-driven, honest, encouraging but precise.",
  drill_sergeant: "No excuses: blunt verdicts, high standards, direct commands.",
};

export function initialMemory(name: string, personality: Personality): { memory: CoachMemory; profile: CoachProfile } {
  PersonalitySchema.parse(personality);
  return {
    memory: { version: 1, coach: { name, personality }, privateLayer: { runs: [] } },
    profile: { version: 1, name, personality, totals: { runs: 0, km: 0 }, paceTrend: [], styleNotes: PERSONALITY_STYLE[personality] },
  };
}

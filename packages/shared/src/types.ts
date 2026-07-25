import { z } from "zod";

export const SIGN_MESSAGE = "0run key derivation v1 — sign to unlock your encrypted running data";

/**
 * Cap on the athlete-written coach brief. Long enough for a real specialisation
 * ("trail ultras, heat adaptation, low-HR base building"), short enough that it
 * cannot crowd out the rest of a system prompt.
 */
export const EXPERTISE_MAX = 400;

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
  // Free-text "how did it feel" captured at GPX upload (apps/web upload
  // page). Nullable (not optional) because "the athlete didn't write
  // anything" is a real state the coach needs to represent, distinct from
  // "field not sent" — the upload route already collapses empty/whitespace
  // input to null before this ever reaches the pipeline. Capped at 1000
  // chars there too; not re-validated here (this schema only describes
  // shape, not upload-time policy). Defaults to null so RunSummary entries
  // written before this field existed still parse without a migration
  // (same convention as reportHeadline's default above).
  feelings: z.string().max(1000).nullable().default(null),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

// --- Health snapshot -------------------------------------------------------
// Duplicated (not imported) from apps/web/src/lib/health/parse.ts's
// DailyHealthSchema/HealthSnapshotSchema — same reasoning as RunReportSchema
// above: that parser lives in the app layer (already proven against a real
// 11 MB export, see docs/superpowers/specs/2026-07-25-health-data-spec.md),
// while this copy exists only so CoachMemorySchema (below) can describe what
// the private layer holds. A shared -> app import would invert the package
// dependency direction (apps depend on @0run/shared, never the reverse), so
// the two are kept structurally identical by convention instead — whatever
// parseHealthExport() returns satisfies this schema by construction, since
// both are the same zod shape.
export const DailyHealthSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  sleepMin: z.number().min(0).nullable(),
  restingHr: z.number().positive().nullable(),
  hrvSdnnMs: z.number().positive().nullable(),
  steps: z.number().min(0).nullable(),
  activeKcal: z.number().min(0).nullable(),
});
export type DailyHealth = z.infer<typeof DailyHealthSchema>;

export const HealthSnapshotSchema = z.object({
  source: z.literal("apple-health-json"),
  exportedAt: z.string(),
  // min(0), not positive(): an export with no datapoints/date_range at all
  // still produces a valid snapshot with an empty window (parse.ts, "array
  // vuoti" test), not a throw.
  windowDays: z.number().int().min(0),
  days: z.array(DailyHealthSchema).max(30),
  baselines: z.object({
    restingHr: z.number().nullable(),
    hrvSdnnMs: z.number().nullable(),
    sleepMin: z.number().nullable(),
  }),
  vo2max: z.number().positive().nullable(),
  otherWorkouts: z.array(z.object({ type: z.string(), count: z.number().int().min(0) })),
});
export type HealthSnapshot = z.infer<typeof HealthSnapshotSchema>;

// --- CoachMemory v1 (frozen) ------------------------------------------------
// Exact shape memories were written in before healthSnapshot existed —
// frozen on purpose, never edited again. Real encrypted memories already on
// 0G Storage were written against this shape; parseMemory()
// (apps/web/src/lib/coach/memory.ts) tries CoachMemorySchema (v2, below)
// first, falls back to this, and migrates. Do not add fields here: a v1
// memory that doesn't match this exactly should fail to parse as v1, not be
// silently coerced into matching.
export const CoachMemoryV1Schema = z.object({
  version: z.literal(1),
  coach: z.object({
    name: z.string().min(1),
    personality: PersonalitySchema,
    // Free text the athlete wrote at creation: what this coach knows, believes,
    // specialises in. Optional so every v2 memory written before it existed
    // still parses. It is PUBLIC by design — it travels into the profile layer
    // (see buildProfile), which is what a stranger consulting this coach reads,
    // and into the coach's ENS description. That is the point: it is what makes
    // one coach worth asking rather than another.
    expertise: z.string().max(EXPERTISE_MAX).optional(),
  }),
  privateLayer: z.object({ runs: z.array(RunSummarySchema) }),
});
export type CoachMemoryV1 = z.infer<typeof CoachMemoryV1Schema>;

// --- CoachMemory v2 ----------------------------------------------------------
// Adds the private, user-key-encrypted health snapshot (see
// docs/superpowers/specs/2026-07-25-health-data-spec.md). `healthSnapshot` is
// nullable, not optional: "no health data uploaded yet" is a real state every
// v2 memory carries explicitly, distinct from "field not sent" (same
// convention as RunSummary.feelings above). Deliberately NOT expressed as
// `z.union([CoachMemoryV1Schema, CoachMemorySchema]).transform(...)` on the
// exported schema — a union+transform would change the inferred CoachMemory
// type for every caller in the app just to accommodate a migration path.
// parseMemory() (apps/web/src/lib/coach/memory.ts) does the v1->v2 migration
// as an explicit function instead; this schema stays the single, unambiguous
// source of the CoachMemory type.
export const CoachMemorySchema = z.object({
  version: z.literal(2),
  coach: z.object({
    name: z.string().min(1),
    personality: PersonalitySchema,
    // Free text the athlete wrote at creation: what this coach knows, believes,
    // specialises in. Optional so every v2 memory written before it existed
    // still parses. It is PUBLIC by design — it travels into the profile layer
    // (see buildProfile), which is what a stranger consulting this coach reads,
    // and into the coach's ENS description. That is the point: it is what makes
    // one coach worth asking rather than another.
    expertise: z.string().max(EXPERTISE_MAX).optional(),
  }),
  privateLayer: z.object({
    runs: z.array(RunSummarySchema),
    healthSnapshot: HealthSnapshotSchema.nullable().default(null),
  }),
});
export type CoachMemory = z.infer<typeof CoachMemorySchema>;

export const CoachProfileSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  personality: PersonalitySchema,
  totals: z.object({ runs: z.number().int().min(0), km: z.number().min(0) }),
  paceTrend: z.array(z.number()).describe("avgPaceSecKm ultime N corse, più recente per ultima"),
  styleNotes: z.string(),
  /** See CoachMemorySchema.coach.expertise — carried here so a consultation can read it. */
  expertise: z.string().max(EXPERTISE_MAX).optional(),
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

export function initialMemory(
  name: string,
  personality: Personality,
  expertise?: string,
): { memory: CoachMemory; profile: CoachProfile } {
  PersonalitySchema.parse(personality);
  const brief = expertise?.trim() ? expertise.trim().slice(0, EXPERTISE_MAX) : undefined;
  return {
    memory: {
      version: 2,
      coach: { name, personality, ...(brief ? { expertise: brief } : {}) },
      privateLayer: { runs: [], healthSnapshot: null },
    },
    profile: {
      version: 1,
      name,
      personality,
      totals: { runs: 0, km: 0 },
      paceTrend: [],
      styleNotes: PERSONALITY_STYLE[personality],
      ...(brief ? { expertise: brief } : {}),
    },
  };
}

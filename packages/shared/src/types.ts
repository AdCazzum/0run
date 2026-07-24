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

export const RunSummarySchema = RunStatsSchema.extend({
  reportHeadline: z.string().default(""),
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

const STYLE: Record<Personality, string> = {
  pacer: "Supportive companion: celebrates effort, gentle suggestions, warm tone.",
  coach: "Balanced professional: data-driven, honest, encouraging but precise.",
  drill_sergeant: "No excuses: blunt verdicts, high standards, direct commands.",
};

export function initialMemory(name: string, personality: Personality): { memory: CoachMemory; profile: CoachProfile } {
  PersonalitySchema.parse(personality);
  return {
    memory: { version: 1, coach: { name, personality }, privateLayer: { runs: [] } },
    profile: { version: 1, name, personality, totals: { runs: 0, km: 0 }, paceTrend: [], styleNotes: STYLE[personality] },
  };
}

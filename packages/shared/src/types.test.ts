import { describe, expect, it } from "vitest";
import {
  CoachMemorySchema, CoachMemoryV1Schema, CoachProfileSchema, HealthSnapshotSchema, RunStatsSchema, RunSummarySchema,
  initialMemory,
} from "./types";

const stats = {
  distanceKm: 5.02, durationSec: 1500, avgPaceSecKm: 299, elevationGainM: 42,
  splitsSecKm: [295, 301, 298, 305, 296], avgHr: null, startedAt: "2026-07-20T07:30:00.000Z",
};

const runBase = {
  ...stats, reportHeadline: "", gpxRoot: "0xroot", gpxContentHash: "0x" + "ab".repeat(32), report: null,
};

describe("shared types", () => {
  it("valida RunStats", () => {
    expect(RunStatsSchema.parse(stats)).toEqual(stats);
  });
  it("initialMemory produce memoria e profilo validi e coerenti con la personalità", () => {
    const { memory, profile } = initialMemory("Kilian", "drill_sergeant");
    expect(CoachMemorySchema.parse(memory).coach.personality).toBe("drill_sergeant");
    expect(CoachProfileSchema.parse(profile).totals.runs).toBe(0);
    expect(memory.privateLayer.runs).toHaveLength(0);
  });
  it("rifiuta personalità sconosciute", () => {
    expect(() => initialMemory("X", "hard" as never)).toThrow();
  });
  it("initialMemory produce memoria v2 con healthSnapshot null", () => {
    const { memory } = initialMemory("Kilian", "pacer");
    expect(memory.version).toBe(2);
    expect(memory.privateLayer.healthSnapshot).toBeNull();
  });
});

describe("CoachMemory v1/v2", () => {
  const v1 = { version: 1, coach: { name: "K", personality: "coach" }, privateLayer: { runs: [] } };

  it("CoachMemoryV1Schema (congelato) valida ancora la vecchia forma", () => {
    expect(CoachMemoryV1Schema.parse(v1)).toEqual(v1);
  });
  it("CoachMemorySchema (v2) rifiuta un oggetto v1 — la migrazione è responsabilità di parseMemory, non dello schema", () => {
    expect(() => CoachMemorySchema.parse(v1)).toThrow();
  });
  it("CoachMemorySchema (v2) valida una memoria con healthSnapshot presente", () => {
    const v2 = {
      version: 2,
      coach: { name: "K", personality: "coach" },
      privateLayer: {
        runs: [],
        healthSnapshot: {
          source: "apple-health-json", exportedAt: "2026-07-25T00:00:00Z", windowDays: 1,
          days: [{ date: "2026-07-24", sleepMin: 400, restingHr: 50, hrvSdnnMs: 60, steps: 8000, activeKcal: 500 }],
          baselines: { restingHr: 50, hrvSdnnMs: 60, sleepMin: 400 },
          vo2max: null, otherWorkouts: [],
        },
      },
    };
    expect(CoachMemorySchema.parse(v2).privateLayer.healthSnapshot?.days).toHaveLength(1);
  });
});

describe("HealthSnapshotSchema", () => {
  it("valida uno snapshot sintetico completo", () => {
    const snapshot = {
      source: "apple-health-json", exportedAt: "2026-07-25T00:00:00Z", windowDays: 0,
      days: [], baselines: { restingHr: null, hrvSdnnMs: null, sleepMin: null },
      vo2max: null, otherWorkouts: [],
    };
    expect(HealthSnapshotSchema.parse(snapshot).windowDays).toBe(0);
  });
});

describe("RunSummary.feelings", () => {
  it("accetta e restituisce il testo delle feelings", () => {
    const parsed = RunSummarySchema.parse({ ...runBase, feelings: "legs felt heavy today" });
    expect(parsed.feelings).toBe("legs felt heavy today");
  });
  it("accetta null esplicito", () => {
    const parsed = RunSummarySchema.parse({ ...runBase, feelings: null });
    expect(parsed.feelings).toBeNull();
  });
  it("va a null di default quando il campo manca (retrocompatibilità con corse pre-feature)", () => {
    const parsed = RunSummarySchema.parse({ ...runBase });
    expect(parsed.feelings).toBeNull();
  });
  it("rifiuta un testo oltre i 1000 caratteri", () => {
    expect(() => RunSummarySchema.parse({ ...runBase, feelings: "a".repeat(1001) })).toThrow();
  });
});

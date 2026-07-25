import { describe, expect, it } from "vitest";
import { CoachMemorySchema, CoachProfileSchema, RunStatsSchema, initialMemory } from "./types";

const stats = {
  distanceKm: 5.02, durationSec: 1500, avgPaceSecKm: 299, elevationGainM: 42,
  splitsSecKm: [295, 301, 298, 305, 296], avgHr: null, startedAt: "2026-07-20T07:30:00.000Z",
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
});

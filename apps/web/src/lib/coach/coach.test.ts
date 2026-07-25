import { describe, expect, it } from "vitest";
import { initialMemory } from "@0run/shared";
import { appendRun, buildProfile } from "./memory";
import { buildReportMessages, ReportSchema } from "./prompts";

const run = {
  distanceKm: 5, durationSec: 1500, avgPaceSecKm: 300, elevationGainM: 40,
  splitsSecKm: [300, 298, 302, 301, 299], avgHr: 150, startedAt: "2026-07-20T07:30:00.000Z", reportHeadline: "",
  gpxRoot: "0xfixturegpxroot", gpxContentHash: "0x" + "ab".repeat(32), report: null,
};

describe("memory", () => {
  it("appendRun è pure e accumula", () => {
    const { memory } = initialMemory("K", "coach");
    const m2 = appendRun(memory, run);
    expect(memory.privateLayer.runs).toHaveLength(0);
    expect(m2.privateLayer.runs).toHaveLength(1);
  });
  it("buildProfile aggrega senza dati personali grezzi", () => {
    const { memory } = initialMemory("K", "drill_sergeant");
    const p = buildProfile(appendRun(appendRun(memory, run), { ...run, avgPaceSecKm: 290 }));
    expect(p.totals).toEqual({ runs: 2, km: 10 });
    expect(p.paceTrend).toEqual([300, 290]);
    expect(JSON.stringify(p)).not.toContain("startedAt"); // niente corse grezze nel profile
    expect(p.styleNotes).toContain("No excuses");
  });
});

describe("prompts", () => {
  it("il system prompt porta personalità e profile; lo user porta la corsa e lo storico", () => {
    const { memory } = initialMemory("K", "pacer");
    const profile = buildProfile(appendRun(memory, run));
    const msgs = buildReportMessages(profile, [run], { ...run });
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("Supportive companion");
    expect(msgs[1].content).toContain('"distanceKm": 5');
    expect(msgs[1].content).toContain("previous runs");
  });
  it("ReportSchema valida il formato report", () => {
    expect(ReportSchema.parse({ headline: "h", analysis: "a", comparison: "c", advice: ["x"] }).advice).toEqual(["x"]);
  });
});

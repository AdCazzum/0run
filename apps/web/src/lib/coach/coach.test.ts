import { describe, expect, it } from "vitest";
import { initialMemory } from "@0run/shared";
import { appendRun, buildProfile } from "./memory";
import { buildChatMessages, buildReportMessages, ReportSchema } from "./prompts";

const run = {
  distanceKm: 5, durationSec: 1500, avgPaceSecKm: 300, elevationGainM: 40,
  splitsSecKm: [300, 298, 302, 301, 299], avgHr: 150, startedAt: "2026-07-20T07:30:00.000Z", reportHeadline: "",
  gpxRoot: "0xfixturegpxroot", gpxContentHash: "0x" + "ab".repeat(32), report: null, feelings: null,
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
  it("con uno score attestato, lo user prompt lo cita esplicitamente", () => {
    const { memory } = initialMemory("K", "pacer");
    const profile = buildProfile(appendRun(memory, run));
    const msgs = buildReportMessages(profile, [run], { ...run }, null, { score: 4, verified: true });
    expect(msgs[1].content).toContain("4/5");
    expect(msgs[1].content).toContain("TEE-verified");
  });
  it("senza score, il prompt resta invariato (nessuna menzione di 'effort score')", () => {
    const { memory } = initialMemory("K", "pacer");
    const profile = buildProfile(appendRun(memory, run));
    const msgs = buildReportMessages(profile, [run], { ...run });
    expect(msgs[1].content).not.toContain("effort score");
  });
  it("le feelings della corsa corrente appaiono nello user message", () => {
    const { memory } = initialMemory("K", "pacer");
    const profile = buildProfile(appendRun(memory, run));
    const msgs = buildReportMessages(profile, [run], { ...run }, "legs felt heavy today");
    expect(msgs[1].content).toContain("legs felt heavy today");
  });
  it("senza feelings correnti, nessun blocco relativo compare nello user message", () => {
    const { memory } = initialMemory("K", "pacer");
    const profile = buildProfile(appendRun(memory, run));
    const msgs = buildReportMessages(profile, [run], { ...run });
    expect(msgs[1].content).not.toContain("described how this run felt");
  });
  it("le feelings delle corse precedenti appaiono nel blocco storico dello user message", () => {
    const { memory } = initialMemory("K", "pacer");
    const runWithFeelings = { ...run, feelings: "knee was a bit sore" };
    const profile = buildProfile(appendRun(memory, runWithFeelings));
    const msgs = buildReportMessages(profile, [runWithFeelings], { ...run });
    expect(msgs[1].content).toContain("knee was a bit sore");
  });
  it("l'istruzione di non dare consigli medici è presente nel system prompt", () => {
    const { memory } = initialMemory("K", "pacer");
    const profile = buildProfile(appendRun(memory, run));
    const msgs = buildReportMessages(profile, [run], { ...run });
    expect(msgs[0].content.toLowerCase()).toContain("medical advice");
  });
  it("buildChatMessages include le feelings delle corse recenti nel system message", () => {
    const { memory } = initialMemory("K", "pacer");
    const runWithFeelings = { ...run, feelings: "felt great, near PB pace" };
    const profile = buildProfile(appendRun(memory, runWithFeelings));
    const msgs = buildChatMessages(profile, [runWithFeelings], []);
    expect(msgs[0].content).toContain("felt great, near PB pace");
    expect(msgs[0].content.toLowerCase()).toContain("medical advice");
  });
});

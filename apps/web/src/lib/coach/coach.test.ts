import { describe, expect, it } from "vitest";
import { CoachMemoryV1Schema, HealthSnapshot, initialMemory } from "@0run/shared";
import { appendRun, buildProfile, parseMemory, setHealthSnapshot } from "./memory";
import { buildChatMessages, buildReportMessages, ReportSchema } from "./prompts";

const run = {
  distanceKm: 5, durationSec: 1500, avgPaceSecKm: 300, elevationGainM: 40,
  splitsSecKm: [300, 298, 302, 301, 299], avgHr: 150, startedAt: "2026-07-20T07:30:00.000Z", reportHeadline: "",
  gpxRoot: "0xfixturegpxroot", gpxContentHash: "0x" + "ab".repeat(32), report: null, feelings: null,
};

// Small synthetic fixture — never the real export (gitignored real health
// data, see docs/superpowers/specs/2026-07-25-health-data-spec.md §9).
const healthSnapshot: HealthSnapshot = {
  source: "apple-health-json",
  exportedAt: "2026-07-25T06:00:00Z",
  windowDays: 2,
  days: [
    { date: "2026-07-23", sleepMin: 410, restingHr: 48, hrvSdnnMs: 62, steps: 9000, activeKcal: 480 },
    { date: "2026-07-24", sleepMin: 310, restingHr: 55, hrvSdnnMs: 44, steps: 6000, activeKcal: 300 },
  ],
  baselines: { restingHr: 51.5, hrvSdnnMs: 53, sleepMin: 360 },
  vo2max: null,
  otherWorkouts: [{ type: "strength_training", count: 2 }],
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
  it("appendRun preserva un healthSnapshot esistente (non lo azzera aggiungendo una corsa)", () => {
    const { memory } = initialMemory("K", "coach");
    const withHealth = setHealthSnapshot(memory, healthSnapshot);
    const withRun = appendRun(withHealth, run);
    expect(withRun.privateLayer.healthSnapshot).toEqual(healthSnapshot);
  });
  it("setHealthSnapshot è pura e sostituisce integralmente (ultimo export vince)", () => {
    const { memory } = initialMemory("K", "coach");
    const m2 = setHealthSnapshot(memory, healthSnapshot);
    expect(memory.privateLayer.healthSnapshot).toBeNull();
    expect(m2.privateLayer.healthSnapshot).toEqual(healthSnapshot);
    const otherSnapshot = { ...healthSnapshot, windowDays: 1, days: [healthSnapshot.days[0]] };
    const m3 = setHealthSnapshot(m2, otherSnapshot);
    expect(m3.privateLayer.healthSnapshot?.days).toHaveLength(1); // replace, not merge
  });
});

describe("parseMemory (retrocompatibilità v1 -> v2)", () => {
  it("una memoria v1 (già cifrata su 0G, mai riscritta) continua a fare il parse", () => {
    const v1 = { version: 1, coach: { name: "K", personality: "coach" }, privateLayer: { runs: [run] } };
    expect(() => CoachMemoryV1Schema.parse(v1)).not.toThrow(); // la forma congelata resta valida
    const migrated = parseMemory(v1);
    expect(migrated.version).toBe(2);
    expect(migrated.privateLayer.runs).toHaveLength(1);
    expect(migrated.privateLayer.healthSnapshot).toBeNull();
  });
  it("una memoria v2 fa il round-trip inalterata", () => {
    const { memory } = initialMemory("K", "pacer");
    const withHealth = setHealthSnapshot(appendRun(memory, run), healthSnapshot);
    const parsed = parseMemory(JSON.parse(JSON.stringify(withHealth)));
    expect(parsed).toEqual(withHealth);
  });
  it("un payload che non è né v1 né v2 lancia (nessuna coercizione silenziosa)", () => {
    expect(() => parseMemory({ nonsense: true })).toThrow();
  });
});

describe("privacy invariant: il coaching profile pubblico non contiene mai dati sanitari", () => {
  it("buildProfile su una memoria CON healthSnapshot non lo espone in nessuna chiave/valore", () => {
    const { memory } = initialMemory("K", "coach");
    const withHealth = setHealthSnapshot(appendRun(memory, run), healthSnapshot);
    const profile = buildProfile(withHealth);
    const json = JSON.stringify(profile);
    // Chiavi dello HealthSnapshot
    for (const key of ["healthSnapshot", "sleepMin", "restingHr", "hrvSdnnMs", "activeKcal", "vo2max", "otherWorkouts", "apple-health-json"]) {
      expect(json).not.toContain(key);
    }
    // Valori concreti dello snapshot sintetico
    for (const value of [410, 48, 62, 9000, 480, 310, 55, 44, "strength_training"]) {
      expect(json).not.toContain(String(value));
    }
    expect(profile).not.toHaveProperty("health");
    expect(profile).not.toHaveProperty("healthSnapshot");
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

  describe("recovery context (health snapshot)", () => {
    it("con uno healthSnapshot, buildReportMessages aggiunge il blocco Recovery context con i delta calcolati dal backend", () => {
      const { memory } = initialMemory("K", "pacer");
      const profile = buildProfile(appendRun(memory, run));
      const msgs = buildReportMessages(profile, [run], { ...run }, null, null, healthSnapshot);
      expect(msgs[1].content).toContain("Recovery context");
      expect(msgs[1].content).toContain("2026-07-24"); // most recent day shown
      // Delta vs baseline for the most recent day with data, precomputed (backend), not left to the model.
      expect(msgs[1].content).toMatch(/resting HR.*55 bpm vs baseline 51\.5 bpm/);
      expect(msgs[1].content).toMatch(/HRV.*44 ms vs baseline 53 ms/);
      expect(msgs[1].content.toLowerCase()).toContain("factor recovery into your verdict");
    });
    it("senza healthSnapshot, il prompt resta byte-per-byte invariato (nessuna menzione di 'recovery context')", () => {
      const { memory } = initialMemory("K", "pacer");
      const profile = buildProfile(appendRun(memory, run));
      const withHealth = buildReportMessages(profile, [run], { ...run }, null, null, healthSnapshot)[1].content;
      const withoutHealth = buildReportMessages(profile, [run], { ...run })[1].content;
      expect(withoutHealth.toLowerCase()).not.toContain("recovery context");
      expect(withoutHealth).not.toBe(withHealth);
    });
    it("il guardrail medico compare SOLO quando lo healthSnapshot è presente (non duplica quello delle feelings)", () => {
      const { memory } = initialMemory("K", "pacer");
      const profile = buildProfile(appendRun(memory, run));
      const withoutHealth = buildReportMessages(profile, [run], { ...run });
      const withHealth = buildReportMessages(profile, [run], { ...run }, null, null, healthSnapshot);
      expect(withoutHealth[1].content.toLowerCase()).not.toContain("never diagnose");
      expect(withHealth[1].content.toLowerCase()).toContain("never diagnose");
      expect(withHealth[1].content.toLowerCase()).toContain("professional");
    });
    it("buildChatMessages aggiunge il blocco recovery nel system message quando lo healthSnapshot è presente", () => {
      const { memory } = initialMemory("K", "pacer");
      const profile = buildProfile(appendRun(memory, run));
      const msgs = buildChatMessages(profile, [run], [], healthSnapshot);
      expect(msgs[0].content).toContain("Recovery context");
      expect(msgs[0].content.toLowerCase()).toContain("never diagnose");
    });
    it("buildChatMessages senza healthSnapshot non menziona 'recovery context'", () => {
      const { memory } = initialMemory("K", "pacer");
      const profile = buildProfile(appendRun(memory, run));
      const msgs = buildChatMessages(profile, [run], []);
      expect(msgs[0].content.toLowerCase()).not.toContain("recovery context");
    });
  });
});

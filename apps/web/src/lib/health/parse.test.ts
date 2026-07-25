import { describe, expect, it } from "vitest";
import { HealthParseError, HealthSnapshotSchema, parseHealthExport } from "./parse";

// Tutte le fixture qui sotto sono sintetiche (inventate per il test), MAI l'export reale:
// quello è gitignored e contiene dati sanitari veri di una persona reale.

function metric(id: string, points: Array<{ value: number; start_date: string; end_date?: string }>) {
  return { id, display_name: id, unit: "x", data_points: points.map((p) => ({ ...p, end_date: p.end_date ?? p.start_date, source: { name: "Test" } })) };
}

function sleepSeg(value: number, label: string, start_date: string, end_date: string) {
  return { value, label, start_date, end_date, source: { name: "Test" } };
}

describe("parseHealthExport", () => {
  it("estrae aggregati corretti da un export ben formato (3 giorni)", () => {
    const raw = {
      date_range: { days: 3, start: "2026-07-01T00:00:00Z", end: "2026-07-03T23:59:59Z" },
      export_date: "2026-07-04T08:00:00Z",
      metrics: [
        metric("HKQuantityTypeIdentifierRestingHeartRate", [
          { value: 50, start_date: "2026-07-01T06:00:00Z" },
          { value: 52, start_date: "2026-07-01T07:00:00Z" }, // ultimo del giorno -> vince
          { value: 48, start_date: "2026-07-02T06:00:00Z" },
        ]),
        metric("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", [
          { value: 60, start_date: "2026-07-01T06:10:00Z" },
          { value: 70, start_date: "2026-07-01T18:10:00Z" }, // media giorno1 = 65
          { value: 55, start_date: "2026-07-02T06:10:00Z" },
        ]),
        metric("HKQuantityTypeIdentifierStepCount", [
          { value: 3000, start_date: "2026-07-01T09:00:00Z" },
          { value: 4000, start_date: "2026-07-01T15:00:00Z" }, // somma giorno1 = 7000
          { value: 5000, start_date: "2026-07-03T09:00:00Z" },
        ]),
        metric("HKQuantityTypeIdentifierActiveEnergyBurned", [
          { value: 200, start_date: "2026-07-01T09:00:00Z" },
          { value: 300, start_date: "2026-07-02T09:00:00Z" },
          { value: 150, start_date: "2026-07-02T15:00:00Z" }, // somma giorno2 = 450
        ]),
        metric("HKQuantityTypeIdentifierVO2Max", [{ value: 42.5, start_date: "2026-07-02T06:00:00Z" }]),
        // metrica non nello schema di coaching: deve essere ignorata senza rompere il parse
        // (tolleranza per future versioni dell'app di export).
        metric("HKQuantityTypeIdentifierWalkingStepLength", [{ value: 0.7, start_date: "2026-07-01T09:00:00Z" }]),
      ],
      category_metrics: [
        {
          category: "Sleep",
          data_points: [
            // segmento a cavallo di mezzanotte: attribuito al giorno di end_date (2), non a start_date (1)
            sleepSeg(3, "awake", "2026-07-01T23:00:00Z", "2026-07-02T01:00:00Z"), // 120 min, label FUORVIANTE
            // label incoerente ("asleepUnspecified") ma value=2 (awake): NON deve essere conteggiato
            sleepSeg(2, "asleepUnspecified", "2026-07-02T02:00:00Z", "2026-07-02T02:30:00Z"),
            sleepSeg(4, "unknown", "2026-07-02T05:00:00Z", "2026-07-02T06:30:00Z"), // 90 min
            // inBed (value=0), label fuorviante "asleep": non conteggiato
            sleepSeg(0, "asleep", "2026-07-03T22:00:00Z", "2026-07-03T22:50:00Z"),
          ],
        },
      ],
      workouts: [
        { type: "running", duration: 1800, energy: 300, start_date: "2026-07-01T07:00:00Z", end_date: "2026-07-01T07:30:00Z", source: {}, id: "w1" },
        { type: "running", duration: 1800, energy: 300, start_date: "2026-07-02T07:00:00Z", end_date: "2026-07-02T07:30:00Z", source: {}, id: "w2" },
        { type: "strength_training", duration: 2400, energy: 250, start_date: "2026-07-01T18:00:00Z", end_date: "2026-07-01T18:40:00Z", source: {}, id: "w3" },
        { type: "cycling", duration: 3600, energy: 400, start_date: "2026-07-03T09:00:00Z", end_date: "2026-07-03T10:00:00Z", source: {}, id: "w4" },
      ],
    };

    const { snapshot, coverage } = parseHealthExport(raw);

    expect(() => HealthSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.source).toBe("apple-health-json");
    expect(snapshot.exportedAt).toBe("2026-07-04T08:00:00Z");
    expect(snapshot.windowDays).toBe(3);
    expect(snapshot.days.map((d) => d.date)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);

    const [day1, day2, day3] = snapshot.days;
    expect(day1).toEqual({ date: "2026-07-01", sleepMin: null, restingHr: 52, hrvSdnnMs: 65, steps: 7000, activeKcal: 200 });
    expect(day2).toEqual({ date: "2026-07-02", sleepMin: 210, restingHr: 48, hrvSdnnMs: 55, steps: null, activeKcal: 450 });
    expect(day3).toEqual({ date: "2026-07-03", sleepMin: null, restingHr: null, hrvSdnnMs: null, steps: 5000, activeKcal: null });

    expect(snapshot.baselines).toEqual({ restingHr: 50, hrvSdnnMs: 60, sleepMin: 210 });
    expect(snapshot.vo2max).toBe(42.5);
    expect(snapshot.otherWorkouts).toEqual([
      { type: "cycling", count: 1 },
      { type: "strength_training", count: 1 },
    ]);

    expect(coverage).toEqual({
      from: "2026-07-01",
      to: "2026-07-03",
      days: 3,
      metrics: ["restingHr", "hrvSdnnMs", "sleepMin", "steps", "activeKcal", "vo2max", "otherWorkouts"],
    });
  });

  it("accetta anche una stringa JSON (non solo un oggetto già parsato)", () => {
    const raw = {
      date_range: { days: 1, start: "2026-07-01T00:00:00Z", end: "2026-07-01T23:59:59Z" },
      export_date: "2026-07-02T00:00:00Z",
      metrics: [metric("HKQuantityTypeIdentifierStepCount", [{ value: 1000, start_date: "2026-07-01T09:00:00Z" }])],
      category_metrics: [],
      workouts: [],
    };
    const { snapshot } = parseHealthExport(JSON.stringify(raw));
    expect(snapshot.days[0].steps).toBe(1000);
  });

  it("metriche mancanti (niente VO2max, niente HRV, niente sonno, niente workout) restano null, non crashano", () => {
    const raw = {
      date_range: { days: 2, start: "2026-07-10T00:00:00Z", end: "2026-07-11T23:59:59Z" },
      export_date: "2026-07-12T00:00:00Z",
      metrics: [
        metric("HKQuantityTypeIdentifierStepCount", [{ value: 500, start_date: "2026-07-10T09:00:00Z" }]),
        metric("HKQuantityTypeIdentifierActiveEnergyBurned", [{ value: 100, start_date: "2026-07-10T09:00:00Z" }]),
      ],
      category_metrics: [],
      workouts: [],
    };
    const { snapshot, coverage } = parseHealthExport(raw);
    expect(() => HealthSnapshotSchema.parse(snapshot)).not.toThrow();
    for (const day of snapshot.days) {
      expect(day.hrvSdnnMs).toBeNull();
      expect(day.restingHr).toBeNull();
      expect(day.sleepMin).toBeNull();
    }
    expect(snapshot.vo2max).toBeNull();
    expect(snapshot.baselines.hrvSdnnMs).toBeNull();
    expect(snapshot.baselines.restingHr).toBeNull();
    expect(snapshot.baselines.sleepMin).toBeNull();
    expect(snapshot.otherWorkouts).toEqual([]);
    expect(coverage.metrics).toEqual(["steps", "activeKcal"]);
  });

  it("si fida del value numerico del sonno, non della label incoerente", () => {
    const raw = {
      date_range: { days: 1, start: "2026-07-15T00:00:00Z", end: "2026-07-15T23:59:59Z" },
      export_date: "2026-07-16T00:00:00Z",
      metrics: [],
      category_metrics: [
        {
          category: "Sleep",
          data_points: [
            // stessa label ("unknown") su due segmenti con value opposti: solo quello
            // "asleep" (value=4) deve contare, quello "awake" (value=2) no.
            sleepSeg(4, "unknown", "2026-07-15T01:00:00Z", "2026-07-15T02:00:00Z"), // 60 min, conta
            sleepSeg(2, "unknown", "2026-07-15T02:00:00Z", "2026-07-15T02:45:00Z"), // 45 min, NON conta
            // label che sembra "corretta" (asleepUnspecified) ma value=0 (inBed): non conta
            sleepSeg(0, "asleepUnspecified", "2026-07-15T22:00:00Z", "2026-07-15T22:30:00Z"),
          ],
        },
      ],
      workouts: [],
    };
    const { snapshot } = parseHealthExport(raw);
    expect(snapshot.days[0].sleepMin).toBe(60);
  });

  it("giorno bucato: RHR presente solo per alcuni giorni della finestra resta null altrove", () => {
    const raw = {
      date_range: { days: 3, start: "2026-07-20T00:00:00Z", end: "2026-07-22T23:59:59Z" },
      export_date: "2026-07-23T00:00:00Z",
      metrics: [
        metric("HKQuantityTypeIdentifierRestingHeartRate", [
          { value: 55, start_date: "2026-07-20T06:00:00Z" },
          { value: 57, start_date: "2026-07-22T06:00:00Z" },
        ]),
      ],
      category_metrics: [],
      workouts: [],
    };
    const { snapshot } = parseHealthExport(raw);
    expect(snapshot.days.map((d) => d.restingHr)).toEqual([55, null, 57]);
  });

  it("lancia HealthParseError su JSON malformato", () => {
    expect(() => parseHealthExport("{not valid json")).toThrow(HealthParseError);
  });

  it("lancia HealthParseError su input che non ha la forma di un export", () => {
    expect(() => parseHealthExport({})).toThrow(HealthParseError);
    expect(() => parseHealthExport({ foo: "bar" })).toThrow(HealthParseError);
    expect(() => parseHealthExport([1, 2, 3])).toThrow(HealthParseError);
    expect(() => parseHealthExport("hello")).toThrow(HealthParseError);
    expect(() => parseHealthExport(42)).toThrow(HealthParseError);
    expect(() => parseHealthExport(null)).toThrow(HealthParseError);
  });

  it("un export con array di metriche vuoti non crasha e la copertura riflette zero giorni", () => {
    const raw = { metrics: [], category_metrics: [], workouts: [] };
    const { snapshot, coverage } = parseHealthExport(raw);
    expect(snapshot.days).toEqual([]);
    expect(snapshot.windowDays).toBe(0);
    expect(coverage).toEqual({ from: "", to: "", days: 0, metrics: [] });
    expect(() => HealthSnapshotSchema.parse(snapshot)).not.toThrow();
  });
});

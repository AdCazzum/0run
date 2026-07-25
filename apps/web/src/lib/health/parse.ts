import { z } from "zod";

// Parser per l'export JSON prodotto dall'app iOS "Health Data Export" (NON
// l'export.xml nativo di Apple Health — vedi docs/superpowers/specs/2026-07-25-health-data-spec.md).
// Regola d'oro dello spec: aggregati e trend brevi, MAI serie di sample grezzi — lo
// HealthSnapshot risultante deve restare piccolo (poche KB) perché finisce nella
// memoria cifrata del coach.

export class HealthParseError extends Error {}

// --- Shape pubblica (consumata dal resto dell'app) --------------------------------

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
  // A differenza della bozza nello spec (che lo vuole positive()), qui windowDays
  // può essere 0: un export senza alcun datapoint/date_range deve produrre uno
  // snapshot valido con finestra vuota, non lanciare — vedi test "array vuoti".
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

export type HealthCoverage = { from: string; to: string; days: number; metrics: string[] };

// --- Shape grezza in input (lasca di proposito) ------------------------------------
//
// L'app di export cambierà versione: validiamo solo ciò che consumiamo, tutto il
// resto passa via .passthrough()/.default(). Le metriche si riconoscono dall'`id`
// HealthKit (es. "HKQuantityTypeIdentifierRestingHeartRate"), MAI da `display_name`
// (localizzabile). I `data_points` sono tipati `unknown[]` qui: la validazione fine
// (value/date) avviene a mano, per metrica riconosciuta, in un solo passaggio —
// evita di far camminare zod su oggetti su cui non ci servono (es. gli oltre 10k
// sample di HeartRate continuo, che scartiamo).

const RawMetricSchema = z
  .object({ id: z.string().default(""), data_points: z.array(z.unknown()).default([]) })
  .passthrough();

const RawCategoryMetricSchema = z
  .object({ category: z.string().default(""), data_points: z.array(z.unknown()).default([]) })
  .passthrough();

const RawWorkoutSchema = z.object({ type: z.string().default("") }).passthrough();

const RawExportSchema = z
  .object({
    date_range: z
      .object({ days: z.number().optional(), start: z.string().optional(), end: z.string().optional() })
      .partial()
      .optional(),
    export_date: z.string().optional(),
    metrics: z.array(RawMetricSchema).default([]),
    category_metrics: z.array(RawCategoryMetricSchema).default([]),
    workouts: z.array(RawWorkoutSchema).default([]),
  })
  .passthrough();

function looksLikeHealthExport(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.metrics) || Array.isArray(o.category_metrics) || Array.isArray(o.workouts);
}

// HealthKit identifiers (mai display_name — vedi commento sopra).
const METRIC_ID = {
  restingHr: "HKQuantityTypeIdentifierRestingHeartRate",
  hrv: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  steps: "HKQuantityTypeIdentifierStepCount",
  activeKcal: "HKQuantityTypeIdentifierActiveEnergyBurned",
  vo2max: "HKQuantityTypeIdentifierVO2Max",
} as const;

type RawPoint = Record<string, unknown>;

function asRawPoint(v: unknown): RawPoint | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as RawPoint) : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Prende solo i primi 10 caratteri (YYYY-MM-DD) se la stringa è un ISO date-time
// valido con separatore "T"; scarta il datapoint altrimenti (data malformata).
function dayKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mean(values: (number | null)[]): number | null {
  const vs = values.filter((v): v is number => v != null);
  return vs.length ? round1(vs.reduce((a, b) => a + b, 0) / vs.length) : null;
}

/**
 * Estrae uno HealthSnapshot compatto (aggregati/giorno + baseline) da un export
 * JSON di Apple Health. Tollerante: metriche non riconosciute, campi mancanti o
 * datapoint malformati vengono ignorati singolarmente invece di far fallire
 * l'intero parse; solo un input che non ha proprio la forma di un export
 * (v. `looksLikeHealthExport`) o JSON non valido lancia `HealthParseError`.
 *
 * Single-pass: nessuna copia intermedia dell'intero export — si itera una volta
 * sui data_points di ogni metrica riconosciuta, accumulando in Map per giorno.
 */
export function parseHealthExport(json: string | unknown): { snapshot: HealthSnapshot; coverage: HealthCoverage } {
  let raw: unknown;
  if (typeof json === "string") {
    try {
      raw = JSON.parse(json);
    } catch {
      throw new HealthParseError("JSON malformato");
    }
  } else {
    raw = json;
  }

  if (!looksLikeHealthExport(raw)) {
    throw new HealthParseError("Export non riconosciuto: mancano metrics/category_metrics/workouts");
  }
  const parsed = RawExportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HealthParseError(`Struttura export non valida: ${parsed.error.message}`);
  }
  const data = parsed.data;

  const restingHrByDay = new Map<string, { value: number; ts: string }>();
  const hrvByDay = new Map<string, { sum: number; n: number }>();
  const stepsByDay = new Map<string, number>();
  const kcalByDay = new Map<string, number>();
  let vo2max: { value: number; ts: string } | null = null;

  for (const m of data.metrics) {
    if (m.id === METRIC_ID.restingHr) {
      for (const dp of m.data_points) {
        const p = asRawPoint(dp);
        const v = p && num(p.value);
        const k = p && dayKey(p.start_date);
        if (v == null || k == null) continue;
        const startDate = p!.start_date as string;
        const prev = restingHrByDay.get(k);
        if (!prev || startDate > prev.ts) restingHrByDay.set(k, { value: v, ts: startDate });
      }
    } else if (m.id === METRIC_ID.hrv) {
      for (const dp of m.data_points) {
        const p = asRawPoint(dp);
        const v = p && num(p.value);
        const k = p && dayKey(p.start_date);
        if (v == null || k == null) continue;
        const acc = hrvByDay.get(k) ?? { sum: 0, n: 0 };
        acc.sum += v;
        acc.n += 1;
        hrvByDay.set(k, acc);
      }
    } else if (m.id === METRIC_ID.steps) {
      for (const dp of m.data_points) {
        const p = asRawPoint(dp);
        const v = p && num(p.value);
        const k = p && dayKey(p.start_date);
        if (v == null || k == null) continue;
        stepsByDay.set(k, (stepsByDay.get(k) ?? 0) + v);
      }
    } else if (m.id === METRIC_ID.activeKcal) {
      for (const dp of m.data_points) {
        const p = asRawPoint(dp);
        const v = p && num(p.value);
        const k = p && dayKey(p.start_date);
        if (v == null || k == null) continue;
        kcalByDay.set(k, (kcalByDay.get(k) ?? 0) + v);
      }
    } else if (m.id === METRIC_ID.vo2max) {
      for (const dp of m.data_points) {
        const p = asRawPoint(dp);
        const v = p && num(p.value);
        const ts = p && typeof p.start_date === "string" ? p.start_date : null;
        if (v == null || ts == null) continue;
        if (!vo2max || ts > vo2max.ts) vo2max = { value: v, ts };
      }
    }
    // id non riconosciuto (es. HeartRate continuo, WalkingStepLength, ecc.): ignorato
    // di proposito, mai validato a fondo — è rumore fuori scope per il coaching (spec §3).
  }

  // Sonno: ci si fida SOLO del value numerico (HKCategoryValueSleepAnalysis: 0=inBed,
  // 2=awake, il resto = dormito), mai della label — in questo export le label sono
  // inconsistenti rispetto all'enum HealthKit. Attribuito al giorno di end_date: la
  // notte appartiene al giorno in cui ci si sveglia.
  const sleepMinByDay = new Map<string, number>();
  for (const cat of data.category_metrics) {
    if (cat.category.toLowerCase() !== "sleep") continue;
    for (const dp of cat.data_points) {
      const p = asRawPoint(dp);
      if (!p) continue;
      const v = num(p.value);
      if (v == null || v === 0 || v === 2) continue;
      const k = dayKey(p.end_date);
      if (k == null) continue;
      const startMs = Date.parse(typeof p.start_date === "string" ? p.start_date : "");
      const endMs = Date.parse(typeof p.end_date === "string" ? p.end_date : "");
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
      sleepMinByDay.set(k, (sleepMinByDay.get(k) ?? 0) + (endMs - startMs) / 60000);
    }
  }

  const workoutCounts = new Map<string, number>();
  for (const w of data.workouts) {
    if (!w.type || w.type.toLowerCase() === "running") continue;
    workoutCounts.set(w.type, (workoutCounts.get(w.type) ?? 0) + 1);
  }
  const otherWorkouts = [...workoutCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => ({ type, count }));

  // Finestra: preferisce date_range dichiarato dall'export (ultimo giorno = data di
  // date_range.end, per `days` giorni all'indietro); se assente, deriva dal min/max
  // dei giorni effettivamente osservati nei dati; se non c'è proprio nulla, finestra
  // vuota (coverage a zero giorni, non un crash — v. spec e test dedicato).
  let fromDate: string | null = null;
  let toDate: string | null = null;
  const dr = data.date_range;
  if (dr?.end) {
    const endKey = dayKey(dr.end) ?? dr.end.slice(0, 10);
    const spanDays = typeof dr.days === "number" && dr.days > 0 ? Math.floor(dr.days) : 1;
    const endObj = new Date(`${endKey}T00:00:00Z`);
    if (!Number.isNaN(endObj.getTime())) {
      const startObj = new Date(endObj);
      startObj.setUTCDate(startObj.getUTCDate() - (spanDays - 1));
      fromDate = startObj.toISOString().slice(0, 10);
      toDate = endKey;
    }
  }
  if (fromDate == null || toDate == null) {
    const allKeys = [
      ...restingHrByDay.keys(),
      ...hrvByDay.keys(),
      ...stepsByDay.keys(),
      ...kcalByDay.keys(),
      ...sleepMinByDay.keys(),
    ].sort();
    if (allKeys.length > 0) {
      fromDate = allKeys[0];
      toDate = allKeys[allKeys.length - 1];
    }
  }

  const days: DailyHealth[] = [];
  if (fromDate != null && toDate != null) {
    const cursor = new Date(`${fromDate}T00:00:00Z`);
    const end = new Date(`${toDate}T00:00:00Z`);
    while (cursor.getTime() <= end.getTime()) {
      const k = cursor.toISOString().slice(0, 10);
      const hrv = hrvByDay.get(k);
      days.push({
        date: k,
        sleepMin: sleepMinByDay.has(k) ? Math.round(sleepMinByDay.get(k)!) : null,
        restingHr: restingHrByDay.get(k)?.value ?? null,
        hrvSdnnMs: hrv ? round1(hrv.sum / hrv.n) : null,
        steps: stepsByDay.has(k) ? Math.round(stepsByDay.get(k)!) : null,
        activeKcal: kcalByDay.has(k) ? Math.round(kcalByDay.get(k)!) : null,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  // Cap a 30 giorni (schema + cut-line spec §10: niente trend multi-settimana):
  // se la finestra dichiarata fosse più lunga, si tengono gli ultimi 30 giorni.
  const cappedDays = days.length > 30 ? days.slice(days.length - 30) : days;

  const baselines = {
    restingHr: mean(cappedDays.map((d) => d.restingHr)),
    hrvSdnnMs: mean(cappedDays.map((d) => d.hrvSdnnMs)),
    sleepMin: mean(cappedDays.map((d) => d.sleepMin)),
  };

  const exportedAt = data.export_date ?? toDate ?? "";

  const snapshot = HealthSnapshotSchema.parse({
    source: "apple-health-json",
    exportedAt,
    windowDays: cappedDays.length,
    days: cappedDays,
    baselines,
    vo2max: vo2max?.value ?? null,
    otherWorkouts,
  });

  const metricsPresent: string[] = [];
  if (restingHrByDay.size) metricsPresent.push("restingHr");
  if (hrvByDay.size) metricsPresent.push("hrvSdnnMs");
  if (sleepMinByDay.size) metricsPresent.push("sleepMin");
  if (stepsByDay.size) metricsPresent.push("steps");
  if (kcalByDay.size) metricsPresent.push("activeKcal");
  if (vo2max) metricsPresent.push("vo2max");
  if (otherWorkouts.length) metricsPresent.push("otherWorkouts");

  return {
    snapshot,
    coverage: {
      from: cappedDays.length ? cappedDays[0].date : "",
      to: cappedDays.length ? cappedDays[cappedDays.length - 1].date : "",
      days: cappedDays.length,
      metrics: metricsPresent,
    },
  };
}

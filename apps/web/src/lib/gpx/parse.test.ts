import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GpxError, parseGpx } from "./parse";

const xml = readFileSync(join(__dirname, "fixtures/short-run.gpx"), "utf8");

describe("parseGpx", () => {
  it("estrae stats da un GPX valido", () => {
    const { stats, polyline } = parseGpx(xml);
    expect(stats.distanceKm).toBeCloseTo(1.11, 1);       // 2 x ~0.556km di latitudine
    expect(stats.durationSec).toBe(360);
    expect(stats.avgPaceSecKm).toBeCloseTo(360 / stats.distanceKm, 0);
    expect(stats.elevationGainM).toBe(4);                 // 10→14 (+4), 14→12 (0)
    expect(stats.avgHr).toBe(148);                        // (140+150+155)/3 arrotondato
    expect(stats.startedAt).toBe("2026-07-20T07:00:00.000Z");
    expect(polyline).toHaveLength(3);
    expect(polyline[0]).toEqual([38.71, -9.14]);
  });
  it("splitsSecKm copre la distanza (ultimo split parziale escluso se < 500m)", () => {
    const { stats } = parseGpx(xml);
    expect(stats.splitsSecKm.length).toBe(1);             // 1.11km → 1 split pieno
  });
  it("rifiuta GPX senza trackpoint", () => {
    expect(() => parseGpx("<gpx></gpx>")).toThrow(GpxError);
  });
  it("rifiuta XML malformato", () => {
    expect(() => parseGpx("not xml at all {")).toThrow(GpxError);
  });
});

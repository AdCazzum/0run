import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GpxError, parseGpx } from "./parse";

const xml = readFileSync(join(__dirname, "fixtures/short-run.gpx"), "utf8");

// Fixture sintetica per provare l'interpolazione dei confini di split a passo non uniforme.
// Entrambi i segmenti si muovono sulla sola latitudine (stessa longitudine): con dLon=0,
// la formula haversine si riduce esattamente a R * dLat(rad), quindi le distanze dei
// segmenti sono note con precisione sub-millimetrica e la derivazione a mano è esatta.
//   Segmento A→B: ~400.000m in 40s  → 10 m/s   (passo ~100s/km)
//   Segmento B→C: ~900.000m in 300s → 3 m/s    (passo ~333.33s/km, molto più lento)
// Distanza totale ≈ 1300m: il confine del km cade DENTRO il segmento B→C (a 400m+600m),
// non alla fine di un segmento, quindi il test dipende dall'interpolazione entro segmento.
const nonUniformPaceXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="0run-test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>NonUniform</name><trkseg>
    <trkpt lat="38.700000000000" lon="-9.140000"><time>2026-07-20T07:00:00Z</time></trkpt>
    <trkpt lat="38.703597286424" lon="-9.140000"><time>2026-07-20T07:00:40Z</time></trkpt>
    <trkpt lat="38.711691180877" lon="-9.140000"><time>2026-07-20T07:05:40Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

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
  it("scarta sempre l'ultimo split parziale (<1km)", () => {
    const { stats } = parseGpx(xml);
    // 1.11km percorsi con passo uniforme → 1 split pieno da 1km, i ~0.11km residui
    // non formano mai uno split parziale, qualunque sia la loro lunghezza.
    expect(stats.splitsSecKm.length).toBe(1);
  });
  it("interpola il confine di split entro il segmento GPS a passo non uniforme", () => {
    // Derivazione a mano (interpolazione lineare del tempo entro il segmento B→C):
    //   splitDist accumulato prima del segmento B→C = 400m (nessun confine chiuso in A→B,
    //     perché 400m < 1000m)
    //   metri necessari, nel segmento B→C, per raggiungere il confine dei 1000m:
    //     needed = 1000 - 400 = 600m
    //   frazione del segmento B→C percorsa per coprire quei 600m:
    //     frac = 600 / 900 = 2/3
    //   tempo del confine, interpolato linearmente nel segmento B→C (dt = 300s):
    //     boundaryTime = t(B) + frac * dt = 40s + (2/3)*300s = 40s + 200s = 240s  (da t(A)=0s)
    //   durata del primo split (da splitStartTime = t(A) = 0s):
    //     split1 = round(boundaryTime - splitStartTime) = round(240s - 0s) = 240s
    //
    // Con la VECCHIA logica (attribuisce l'intero tempo/distanza del segmento che chiude
    // il confine, corretto solo a passo uniforme):
    //   t_fine_segmento_B→C = 40 + 300 = 340s ; splitDist totale al momento della chiusura = 400+900 = 1300m
    //   split1_vecchio = round(340 / (1300/1000)) = round(261.54...) = 262s
    // 262 ≠ 240: la vecchia logica whole-segment fallirebbe questa asserzione.
    const { stats } = parseGpx(nonUniformPaceXml);
    expect(stats.splitsSecKm).toHaveLength(1);
    expect(stats.splitsSecKm[0]).toBe(240);
    // I restanti 300m (1300 - 1000) restano sotto il km e vengono scartati come split
    // parziale finale, invariato rispetto al comportamento precedente.
  });
  it("rifiuta GPX senza trackpoint", () => {
    expect(() => parseGpx("<gpx></gpx>")).toThrow(GpxError);
  });
  it("rifiuta XML malformato", () => {
    expect(() => parseGpx("not xml at all {")).toThrow(GpxError);
  });
});

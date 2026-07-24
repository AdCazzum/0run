import { XMLParser } from "fast-xml-parser";
import { RunStats, RunStatsSchema } from "@0run/shared";

export class GpxError extends Error {}

type Pt = { lat: number; lon: number; ele: number | null; time: Date; hr: number | null };

const R = 6371000;
function haversineM(a: Pt, b: Pt): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180, lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function parseGpx(xml: string): { stats: RunStats; polyline: [number, number][] } {
  let doc: any;
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" }).parse(xml);
  } catch {
    throw new GpxError("XML malformato");
  }
  const segs = doc?.gpx?.trk?.trkseg;
  const rawPts = [segs].flat().flatMap((s: any) => [s?.trkpt].flat()).filter(Boolean);
  if (rawPts.length < 2) throw new GpxError("GPX senza trackpoint sufficienti");

  const pts: Pt[] = rawPts.map((p: any) => {
    const hrRaw = p?.extensions?.["gpxtpx:TrackPointExtension"]?.["gpxtpx:hr"];
    return {
      lat: Number(p["@lat"]), lon: Number(p["@lon"]),
      ele: p.ele != null ? Number(p.ele) : null,
      time: new Date(p.time), hr: hrRaw != null ? Number(hrRaw) : null,
    };
  });
  if (pts.some(p => Number.isNaN(p.lat) || Number.isNaN(p.lon) || Number.isNaN(p.time.getTime())))
    throw new GpxError("Trackpoint con lat/lon/time invalidi");

  let distM = 0, gain = 0;
  const splits: number[] = [];
  let splitStartT = pts[0].time.getTime(), splitDist = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineM(pts[i - 1], pts[i]);
    distM += d;
    const eleDelta = (pts[i].ele ?? 0) - (pts[i - 1].ele ?? 0);
    if (pts[i].ele != null && pts[i - 1].ele != null && eleDelta > 0) gain += eleDelta;

    // Consume this segment's distance/time, closing every 1km boundary it crosses by
    // linearly interpolating the timestamp at which the boundary is reached (assumes
    // constant velocity within the segment). A single long segment can close multiple
    // splits; the leftover (<1km) carries into splitDist for the next segment.
    const segStartT = pts[i - 1].time.getTime();
    const dt = pts[i].time.getTime() - segStartT;
    let consumedD = 0;
    while (splitDist + (d - consumedD) >= 1000) {
      const neededD = 1000 - splitDist;
      consumedD += neededD;
      const frac = d > 0 ? consumedD / d : 1;
      const boundaryT = segStartT + frac * dt;
      splits.push(Math.round((boundaryT - splitStartT) / 1000));
      splitStartT = boundaryT;
      splitDist = 0;
    }
    splitDist += d - consumedD;
  }
  const durationSec = Math.round((pts.at(-1)!.time.getTime() - pts[0].time.getTime()) / 1000);
  if (durationSec <= 0 || distM <= 0) throw new GpxError("Durata o distanza nulla");
  const hrs = pts.map(p => p.hr).filter((h): h is number => h != null);

  const stats = RunStatsSchema.parse({
    distanceKm: distM / 1000,
    durationSec,
    avgPaceSecKm: Math.round(durationSec / (distM / 1000)),
    elevationGainM: Math.round(gain),
    splitsSecKm: splits,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    startedAt: pts[0].time.toISOString(),
  });
  return { stats, polyline: pts.map(p => [p.lat, p.lon]) };
}

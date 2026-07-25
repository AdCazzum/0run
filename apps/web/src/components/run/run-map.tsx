"use client";
import { MapContainer, Polyline, TileLayer } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet paints this into an SVG layer, not through Tailwind classes, so
// the palette's navy token has to be a raw value here — the design system's
// "no raw hex" rule targets Tailwind utility usage, not values handed to a
// third-party mapping library. Kept as one named constant so there is
// exactly one place this could ever drift from --color-navy.
const NAVY = "#004E89";

/**
 * Grayscale-by-default, color-on-hover hero treatment (design system "bold
 * factor" #4) applied to the run's route instead of a photo. This must be
 * loaded client-only (see the `dynamic(..., { ssr: false })` import at the
 * call site) — Leaflet touches `window` at module init and has no SSR mode.
 *
 * Deliberately renders an honest empty state instead of a fake/blank map
 * when a run has no polyline (e.g. a GPX with no track points) — never a
 * MapContainer with nothing in it pretending to be data.
 */
export function RunMap({ polyline }: { polyline: [number, number][] | null }) {
  if (!polyline || polyline.length === 0) {
    return (
      <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden border border-navy/15 bg-peach/20 shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
        <span className="max-w-[12rem] text-center font-serif text-lg italic text-ocean">
          No route recorded for this run
        </span>
      </div>
    );
  }

  const positions = polyline as LatLngExpression[];
  const bounds = polyline as LatLngBoundsExpression;

  return (
    <div className="group relative aspect-[4/5] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
      <div className="absolute inset-0 grayscale transition-[filter] duration-[1500ms] group-hover:grayscale-0">
        <MapContainer
          bounds={bounds}
          boundsOptions={{ padding: [16, 16] }}
          zoomControl={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          dragging={false}
          touchZoom={false}
          boxZoom={false}
          keyboard={false}
          className="h-full w-full"
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <Polyline positions={positions} color={NAVY} weight={3} />
        </MapContainer>
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-4 right-4 bg-cream/90 px-1 font-sans text-[10px] uppercase tracking-[0.3em] text-navy"
        style={{ writingMode: "vertical-rl" }}
      >
        0run / Route
      </span>
    </div>
  );
}

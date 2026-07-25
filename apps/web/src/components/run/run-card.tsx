import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PipelineSteps } from "./pipeline-steps";
import type { RunRow } from "./types";

function pace(secPerKm: number) {
  const m = Math.floor(secPerKm / 60);
  return `${m}:${String(Math.round(secPerKm - m * 60)).padStart(2, "0")}/km`;
}

function duration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long" });

/**
 * Feed card. The coach's verdict is the dominant element, not the numbers: the
 * feed should read like an editorial index of what the coach said, which is the
 * product's differentiator — a card leading with "5.02 km · 25:00" would be a
 * workout log. Stats stay as micro-labels underneath.
 */
export function RunCard({ run }: { run: RunRow }) {
  const started = run.stats ? new Date(run.stats.startedAt) : new Date(run.createdAt);

  return (
    <Card className="group">
      <div className="mb-6 flex items-center gap-4">
        <span aria-hidden className="h-px w-8 bg-navy/40" />
        <span className="font-sans text-[10px] uppercase tracking-[0.3em] text-ocean">{DAY.format(started)}</span>
        {run.verifiedTee === "true" && (
          <span className="font-sans text-[10px] uppercase tracking-[0.25em] text-orange">● TEE</span>
        )}
        {run.effortScore != null && (
          // Attested effort score (../lib/coach/score.ts): a SEPARATE
          // attestation from the report badge above — it covers only the
          // score, computed on the TEE-verified "direct" 0G Compute path.
          // Orange (a verification claim) only when scoreVerified is
          // literally "true"; any other state (including "unavailable")
          // shows the number with no attestation wording at all, per the
          // design system rule that orange = a claim that must hold.
          <span
            className={`font-sans text-[10px] uppercase tracking-[0.25em] ${
              run.scoreVerified === "true" ? "text-orange" : "text-ocean"
            }`}
          >
            effort {run.effortScore}/5{run.scoreVerified === "true" ? " · TEE verified" : ""}
          </span>
        )}
      </div>

      {run.status === "processing" ? (
        <>
          <h2 className="font-serif text-3xl leading-tight text-navy">
            The coach is <em className="italic text-orange">reading</em> this run…
          </h2>
          <p className="mt-4 max-w-md font-sans text-sm leading-relaxed text-ocean">
            Encryption, decentralized storage and attested inference each take real time on 0G.
          </p>
          <div className="mt-8">
            <PipelineSteps steps={run.steps} />
          </div>
        </>
      ) : run.status === "error" ? (
        <h2 className="font-serif text-3xl leading-tight text-navy">This run could not be processed</h2>
      ) : (
        <Link href={`/runs/${run.id}`} className="block">
          <h2 className="font-serif text-3xl leading-tight text-navy transition-colors duration-500 group-hover:text-orange md:text-4xl">
            {run.report?.headline ?? "Report unavailable"}
          </h2>
        </Link>
      )}

      {run.stats && (
        <div className="mt-8 flex flex-wrap gap-x-10 gap-y-3 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
          <span>{run.stats.distanceKm.toFixed(2)} km</span>
          <span>{duration(run.stats.durationSec)}</span>
          <span>{pace(run.stats.avgPaceSecKm)}</span>
          {run.stats.elevationGainM > 0 && <span>{run.stats.elevationGainM} m D+</span>}
          {run.stats.avgHr && <span>{run.stats.avgHr} bpm</span>}
        </div>
      )}

      {run.status === "done" && (
        <Link
          href={`/runs/${run.id}`}
          className="mt-8 inline-block py-3 font-sans text-xs uppercase tracking-[0.2em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
        >
          Read the report ↗
        </Link>
      )}
    </Card>
  );
}

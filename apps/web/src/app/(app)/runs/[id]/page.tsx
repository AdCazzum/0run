"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { getAccessToken, usePrivy } from "@privy-io/react-auth";
import { Chat } from "@/components/run/chat";
import { PipelineSteps } from "@/components/run/pipeline-steps";
import { ReportView } from "@/components/run/report-view";
import type { RunRow } from "@/components/run/types";

// Leaflet touches window at import time, so the map must never be part of the
// server render.
const RunMap = dynamic(() => import("@/components/run/run-map").then((m) => m.RunMap), { ssr: false });

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ready, authenticated } = usePrivy();
  const [run, setRun] = useState<RunRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/runs/${id}`, { headers: { authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRun(body);
      return body as RunRow;
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load this run");
      return null;
    }
  }, [id]);

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated, load]);

  // Storage propagation and attested inference take minutes end to end, so the
  // page follows the pipeline instead of pretending the run is ready.
  useEffect(() => {
    if (run?.status !== "processing") return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [run?.status, load]);

  if (!ready) return null;
  if (error) return <Label>{error}</Label>;
  if (!run) return <Label>loading this run…</Label>;

  return (
    <section>
      <Link
        href="/dashboard"
        className="inline-block py-3 font-sans text-[10px] uppercase tracking-[0.3em] text-ocean underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
      >
        ← all runs
      </Link>

      {run.status === "processing" && (
        <section className="mt-6 border-t border-navy pt-8">
          <Label>The coach is working</Label>
          <div className="mt-8 max-w-md"><PipelineSteps steps={run.steps} /></div>
        </section>
      )}

      {run.status === "error" && (
        <section className="mt-6 border-t border-navy pt-8">
          <Label>This run could not be processed</Label>
          <div className="mt-8 max-w-md"><PipelineSteps steps={run.steps} /></div>
        </section>
      )}

      <div className="mt-8 grid grid-cols-1 gap-y-10 md:mt-12 md:grid-cols-12 md:gap-x-8">
        <div className="md:col-span-5">
          <RunMap polyline={run.polyline} />
          {run.stats && (
            <dl className="mt-6 grid grid-cols-2 gap-y-6 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean md:mt-8">
              <Stat label="distance" value={`${run.stats.distanceKm.toFixed(2)} km`} />
              <Stat label="pace" value={`${Math.floor(run.stats.avgPaceSecKm / 60)}:${String(Math.round(run.stats.avgPaceSecKm % 60)).padStart(2, "0")}/km`} />
              <Stat label="elevation" value={`${run.stats.elevationGainM} m`} />
              {run.stats.avgHr && <Stat label="avg hr" value={`${run.stats.avgHr} bpm`} />}
            </dl>
          )}
        </div>

        <div className="md:col-span-6 md:col-start-7">
          {run.report ? (
            <ReportView
              report={run.report}
              verifiedTee={run.verifiedTee}
              model={run.model}
              registryTx={run.registryTx}
              gpxRoot={run.gpxRoot}
              effortScore={run.effortScore}
              scoreVerified={run.scoreVerified}
            />
          ) : (
            <Label>the report will appear here once the coach has answered</Label>
          )}
        </div>
      </div>

      {run.status === "done" && <Chat runId={run.id} />}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span aria-hidden className="h-px w-12 bg-navy" />
      <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">{children}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ocean">{label}</dt>
      <dd className="mt-2 font-serif text-2xl normal-case tracking-normal text-navy">{value}</dd>
    </div>
  );
}

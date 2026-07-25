"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { getAccessToken, usePrivy } from "@privy-io/react-auth";
import { Chat } from "@/components/run/chat";
import { CoachChase } from "@/components/run/coach-chase";
import { PipelineSteps } from "@/components/run/pipeline-steps";
import { ReportView } from "@/components/run/report-view";
import type { RunRow } from "@/components/run/types";
import { DeleteRun } from "@/components/run/delete-run";
import { useUserKey } from "@/lib/client/useUserKey";

// Leaflet touches window at import time, so the map must never be part of the
// server render.
const RunMap = dynamic(() => import("@/components/run/run-map").then((m) => m.RunMap), { ssr: false });

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ready, authenticated } = usePrivy();
  const { getKeyHex } = useUserKey();
  const [run, setRun] = useState<RunRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feelings, setFeelings] = useState<string | null>(null);

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

  // Decrypt-on-read: Postgres only ever holds runs.feelingsCipher
  // (ciphertext), so the plaintext "how did it feel" note is fetched
  // separately, once per run id (not on every processing-status poll above).
  // Any failure here (no cipher stored, wrong/missing key, network error)
  // just leaves feelings unset — never a placeholder implying data exists.
  useEffect(() => {
    // No note stored → nothing to decrypt, so do not ask the athlete's wallet
    // for a signature at all. Asking for one the moment a page loads, for
    // nothing, is how this page ended up showing a wallet error dialog.
    if (!run?.id || !run.feelingsCipher) return;
    let cancelled = false;
    (async () => {
      try {
        const [token, userKeyHex] = await Promise.all([getAccessToken(), getKeyHex()]);
        const res = await fetch(`/api/runs/${run.id}/feelings`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ userKeyHex }),
        });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setFeelings(body.feelings ?? null);
      } catch {
        if (!cancelled) setFeelings(null);
      }
    })();
    return () => { cancelled = true; };
  }, [run?.id, run?.feelingsCipher, getKeyHex]);

  // Longer than the pipeline can possibly take: uploads are capped at 3x120s
  // per layer and inference at ~2 minutes, so past this a "processing" row is a
  // job nobody is running any more.
  const STALLED_AFTER_MS = 15 * 60_000;
  const stalled = !!run && run.status === "processing" && Date.now() - new Date(run.createdAt).getTime() > STALLED_AFTER_MS;

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

      {run.status === "processing" && !stalled && (
        <section className="mt-6 border-t border-navy pt-8">
          <Label>The coach is working</Label>
          <div className="mt-6"><CoachChase /></div>
          <div className="mt-8 max-w-md"><PipelineSteps steps={run.steps} /></div>
        </section>
      )}

      {/* A run left mid-flight is not a run still being worked on. The pipeline
          lives in the server process, so a restart (a deploy, a crash) kills it
          and the row stays "processing" for ever — telling the athlete their
          coach is still reading is simply false after a while. */}
      {run.status === "processing" && stalled && (
        <section className="mt-6 border-t border-navy pt-8">
          <Label>This run stopped part-way</Label>
          <p className="mt-6 max-w-md font-sans text-sm leading-relaxed text-navy">
            Processing was interrupted — most likely the server restarted while your coach was reading it. It will not
            resume on its own: delete it below and upload the file again.
          </p>
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
          <RunMap polyline={run.polyline} muted={run.status === "processing"} />
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
          {feelings && (
            <div className="mb-8">
              <div className="mb-3 flex items-center gap-3">
                <span aria-hidden className="h-px w-8 bg-navy" />
                <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">How it felt</span>
              </div>
              <p className="border-l border-orange pl-6 font-serif text-xl italic text-navy">“{feelings}”</p>
            </div>
          )}
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

      {/* Not offered while the run is still being written: the server refuses
          it anyway (the pipeline would re-add the run seconds later), and a
          button that only ever answers "wait" is worse than no button. */}
      {(run.status !== "processing" || stalled) && <DeleteRun runId={run.id} />}
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

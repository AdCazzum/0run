"use client";
import { useCallback, useRef, useState } from "react";
import { getAccessToken } from "@privy-io/react-auth";
import { useUserKey } from "@/lib/client/useUserKey";
import type { CoachSummary } from "@/components/run/types";

// Internal metric names (parseHealthExport's coverage.metrics, see
// apps/web/src/lib/health/parse.ts) mapped to the human labels the spec's
// example uses ("7 days · resting HR, HRV, sleep, steps") — never the raw
// HealthKit-flavored key.
const METRIC_LABELS: Record<string, string> = {
  restingHr: "resting HR",
  hrvSdnnMs: "HRV",
  sleepMin: "sleep",
  steps: "steps",
  activeKcal: "active energy",
  vo2max: "VO2max",
  otherWorkouts: "cross-training",
};

function formatMetrics(metrics: string[]): string {
  return metrics.map((m) => METRIC_LABELS[m] ?? m).join(", ");
}

/**
 * Replaces the old inert "health data · not connected" label in the coach
 * header with a real control: an upload action when nothing is connected,
 * or the coverage summary once it is. Shows COVERAGE ONLY — never a value.
 * Per docs/superpowers/specs/2026-07-25-health-data-spec.md: "l'interfaccia
 * ai tuoi dati sanitari è il coach" (no charts, no numbers here — those only
 * ever reach the athlete through the coach's own recovery-aware reports and
 * chat, see lib/coach/prompts.ts).
 */
export function HealthDataStatus({
  coverage, onUploaded,
}: {
  coverage: CoachSummary["healthCoverage"];
  onUploaded: () => void;
}) {
  const { getKeyHex } = useUserKey();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file || submitting.current) return;
      submitting.current = true;
      setUploading(true);
      setError(null);
      try {
        const [keyHex, token] = await Promise.all([getKeyHex(), getAccessToken()]);
        if (!token) throw new Error("session expired, please sign in again");

        const form = new FormData();
        form.set("file", file);
        form.set("userKeyHex", keyHex);

        const res = await fetch("/api/health-data", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: form,
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "upload failed");
        onUploaded();
      } catch (e) {
        setError(e instanceof Error ? e.message : "something went wrong");
      } finally {
        setUploading(false);
        submitting.current = false;
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [getKeyHex, onUploaded],
  );

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {coverage && (
        <span className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
          health data · {coverage.windowDays} day{coverage.windowDays === 1 ? "" : "s"}
          {coverage.metrics.length > 0 && ` · ${formatMetrics(coverage.metrics)}`}
        </span>
      )}
      <label className="inline-block cursor-pointer py-2 font-sans text-[10px] uppercase tracking-[0.25em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline">
        {uploading ? "uploading…" : coverage ? "update" : "health data · not connected — upload"}
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          disabled={uploading}
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <span className="font-sans text-[10px] text-orange">{error}</span>}
    </span>
  );
}

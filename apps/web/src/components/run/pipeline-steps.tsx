import type { RunStep, StepState } from "./types";

const ORDER: RunStep[] = ["encrypt", "store_gpx", "update_memory", "registry_tx", "score", "inference"];

const LABELS: Record<RunStep, string> = {
  encrypt: "Encrypt",
  store_gpx: "Store on 0G",
  update_memory: "Update memory",
  registry_tx: "Anchor on-chain",
  score: "Attested effort score",
  inference: "Coach report",
};

function Dot({ status }: { status: StepState["status"] }) {
  if (status === "done") {
    return <span aria-hidden className="h-2 w-2 shrink-0 bg-orange transition-colors duration-700" />;
  }
  if (status === "error") {
    return <span aria-hidden className="h-2 w-2 shrink-0 border border-ocean" />;
  }
  return <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse border border-navy/40" />;
}

/**
 * Vertical list of the 6 pipeline phases from `runs.steps`. Real inference is
 * ~20s and real storage propagation takes minutes (docs/0g-reality-check.md),
 * so this is what the UI shows instead of a bare spinner while a run is
 * `processing` — the caller polls GET /api/runs/:id and re-renders this with
 * fresh step state every ~2.5s.
 */
export function PipelineSteps({ steps }: { steps: Record<RunStep, StepState> }) {
  return (
    <ol className="space-y-4">
      {ORDER.map((step) => {
        const state = steps[step] ?? { status: "pending" as const };
        return (
          <li key={step} className="flex items-center gap-4">
            <span aria-hidden className="h-px w-8 bg-navy/20" />
            <Dot status={state.status} />
            <span
              className={`font-sans text-xs uppercase tracking-[0.3em] ${
                state.status === "pending" ? "text-ocean" : "text-navy"
              }`}
            >
              {LABELS[step]}
            </span>
            {state.status === "error" && state.detail && (
              <span className="font-sans text-xs normal-case tracking-normal text-ocean">{state.detail}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

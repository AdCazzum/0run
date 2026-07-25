import type { RunStats } from "@0run/shared";

// Deliberately NOT imported from @/db/schema: these types describe the JSON
// shape the API routes actually send over the wire (dates are ISO strings
// once they round-trip through NextResponse.json), and keeping this file
// free of any import from the server-only db module means every component
// in this directory can stay a plain client component without dragging in
// drizzle/pg types.
export type RunStep = "encrypt" | "store_gpx" | "update_memory" | "registry_tx" | "score" | "inference";
export type StepState = { status: "pending" | "done" | "error"; detail?: string };

export type RunReport = { headline: string; analysis: string; comparison: string; advice: string[] };

export type RunRow = {
  id: number;
  userId: number;
  status: "processing" | "done" | "error";
  steps: Record<RunStep, StepState>;
  stats: RunStats | null;
  polyline: [number, number][] | null;
  gpxRoot: string | null;
  registryTx: string | null;
  report: RunReport | null;
  verifiedTee: string | null;
  model: string | null;
  // Attested effort score (1-5), computed separately on the TEE-verified 0G
  // Compute "direct" path — see apps/web/src/lib/coach/score.ts. Nullable:
  // that path is a single provider on a testnet and can be unavailable,
  // which must never fail the run itself. scoreVerified follows the same
  // "true" | "false" | "unavailable" convention as verifiedTee above.
  effortScore: number | null;
  scoreNote: string | null;
  scoreVerified: string | null;
  createdAt: string;
};

export type CoachSummary = {
  id: number;
  name: string;
  personality: string;
  tokenId: string;
  mintTx: string;
  // Live ENS identity on Sepolia (see lib/ens/), null until the background
  // step after mint assigns it — or forever, if it failed. Never a
  // placeholder: EnsBadge re-resolves it live before showing anything.
  ensName: string | null;
};

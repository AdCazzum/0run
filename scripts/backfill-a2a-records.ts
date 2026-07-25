/**
 * Backfills the two A2A text records (`agent-endpoint[a2a]`, `agent-signer`)
 * onto every EXISTING coach subname — coaches minted after Task 3 get them at
 * mint time. Reads the roster from the public directory API (never the DB
 * directly: the API is the same source the judges see), then writes records
 * with the ENS owner key from .env.
 *
 * Dry-run by default — prints what it would write. Pass --apply to execute.
 *
 *   BASE=https://0run.fun npx tsx --env-file=.env scripts/backfill-a2a-records.ts
 *   BASE=https://0run.fun npx tsx --env-file=.env scripts/backfill-a2a-records.ts --apply
 */
import { setTextRecords } from "../apps/web/src/lib/ens/subname";
import { a2aAccount } from "../apps/web/src/lib/a2a/protocol";

const BASE = (process.env.BASE ?? "https://0run.fun").replace(/\/$/, "");
const apply = process.argv.includes("--apply");

async function main() {
  const signer = a2aAccount()?.address;
  if (!signer) throw new Error("A2A_SIGNER_PRIVATE_KEY non configurata — niente da pubblicare come agent-signer");

  const res = await fetch(`${BASE}/api/coaches`);
  if (!res.ok) throw new Error(`GET ${BASE}/api/coaches → HTTP ${res.status}`);
  // The route answers { coaches: DirectoryEntry[] }, not a bare array — see
  // apps/web/src/app/api/coaches/route.ts.
  const { coaches: entries }: { coaches: { tokenId: string; ensName: string | null }[] } = await res.json();
  const named = entries.filter((e): e is { tokenId: string; ensName: string } => Boolean(e.ensName));
  console.log(`${entries.length} coach, ${named.length} con nome ENS`);

  for (const { tokenId, ensName } of named) {
    const records = {
      "agent-endpoint[a2a]": `${BASE}/api/coach/${tokenId}/a2a`,
      "agent-signer": signer,
    };
    if (!apply) {
      console.log(`[dry-run] ${ensName}:`, records);
      continue;
    }
    const result = await setTextRecords(ensName, records);
    if ("error" in result) console.error(`✗ ${ensName}: ${result.error}`);
    else console.log(`✓ ${ensName} → ${result.txHash}`);
  }
  if (!apply) console.log("\nNessuna scrittura eseguita. Rilancia con --apply per scrivere su Sepolia.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

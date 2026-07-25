/**
 * Drives the full 0run journey against a running instance over the real HTTP API:
 * mint the coach, upload every GPX fixture, follow the pipeline, ask the coach a
 * question. It is both the end-to-end smoke test and the way the demo account is
 * seeded, so the runs a judge sees were produced by exactly the code path a user
 * hits — no fixtures written straight into the database.
 *
 *   BASE=https://0run.fun \
 *   PRIVY_TOKEN=<access token>  DEMO_KEY_HEX=<64 hex chars> \
 *   npx tsx scripts/demo-journey.ts
 *
 * Both values belong to the account being seeded and are visible to its owner in
 * the browser: the token in the Privy session, the key hex in the body of any
 * upload request the app already sends. Nothing here can derive them on its own —
 * the key exists only where the wallet signature happens.
 *
 * GPX fixtures live in scripts/fixtures/real/ and are gitignored: they contain
 * real GPS traces, which do not belong in a public repository.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const TOKEN = need("PRIVY_TOKEN");
const KEY_HEX = need("DEMO_KEY_HEX");
const FIXTURES = join(import.meta.dirname, "fixtures", "real");
const POLL_TIMEOUT_MS = 15 * 60_000; // storage propagation is measured in minutes

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing ${name} — see the header comment in this file`);
    process.exit(2);
  }
  return v;
}

const auth = { authorization: `Bearer ${TOKEN}` };
let failures = 0;

function step(title: string) {
  console.log(`\n\x1b[1m== ${title}\x1b[0m`);
}

async function main() {
  step("health");
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  console.log(health);
  if (!health.ok) throw new Error("instance is not healthy, aborting");

  step("gas top-up");
  const fund = await fetch(`${BASE}/api/fund`, { method: "POST", headers: auth });
  console.log(fund.status, await fund.text());

  step("mint the coach");
  const mint = await fetch(`${BASE}/api/coach/mint`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ name: "Kilian", personality: "drill_sergeant", userKeyHex: KEY_HEX }),
  });
  const mintBody = await mint.json();
  if (mint.status === 200) console.log("minted:", mintBody.tokenId, mintBody.explorerUrl);
  else if (mint.status === 409) console.log("already minted:", mintBody.error);
  else throw new Error(`mint failed (${mint.status}): ${JSON.stringify(mintBody)}`);

  const gpxFiles = readdirSync(FIXTURES).filter((f) => f.toLowerCase().endsWith(".gpx")).sort();
  if (gpxFiles.length === 0) throw new Error(`no .gpx fixtures in ${FIXTURES}`);
  console.log(`\n${gpxFiles.length} fixture(s): ${gpxFiles.join(", ")}`);

  const runIds: number[] = [];
  for (const file of gpxFiles) {
    step(`upload ${file}`);
    const form = new FormData();
    form.append("gpx", new Blob([readFileSync(join(FIXTURES, file))]), file);
    form.append("userKeyHex", KEY_HEX);
    const res = await fetch(`${BASE}/api/runs`, { method: "POST", headers: auth, body: form });
    const body = await res.json();
    if (!res.ok) { console.error(`upload failed: ${JSON.stringify(body)}`); failures++; continue; }
    console.log("runId:", body.runId);
    runIds.push(body.runId);
  }

  // Uploads are deliberately sequential-then-polled: each run mutates the coach's
  // memory, and interleaving them would race two updates onto the same row.
  for (const runId of runIds) {
    step(`follow run ${runId}`);
    const started = Date.now();
    let last = "";
    for (;;) {
      const run = await fetch(`${BASE}/api/runs/${runId}`, { headers: auth }).then((r) => r.json());
      const done = Object.entries(run.steps ?? {})
        .filter(([, s]: [string, any]) => s.status === "done").map(([k]) => k).join(",");
      if (done !== last) { console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${done || "starting"}`); last = done; }
      if (run.status === "done") {
        console.log(`  report: "${run.report?.headline}"`);
        console.log(`  model: ${run.model} · attestation: ${run.verifiedTee}`);
        break;
      }
      if (run.status === "error") {
        const failed = Object.entries(run.steps ?? {}).find(([, s]: [string, any]) => s.status === "error");
        console.error(`  FAILED at ${failed?.[0]}: ${(failed?.[1] as any)?.detail}`);
        failures++;
        break;
      }
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        console.error(`  TIMEOUT after ${POLL_TIMEOUT_MS / 60000} min (still ${run.status})`);
        failures++;
        break;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  step("ask the coach");
  const chat = await fetch(`${BASE}/api/coach/chat`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ message: "Come sto andando rispetto alla settimana scorsa?", userKeyHex: KEY_HEX }),
  });
  const chatBody = await chat.json();
  if (chat.ok) console.log(`  reply: ${String(chatBody.reply).slice(0, 200)}…`);
  else { console.error(`  chat failed (${chat.status}): ${JSON.stringify(chatBody)}`); failures++; }

  step(failures === 0 ? "JOURNEY OK" : `JOURNEY COMPLETED WITH ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nJOURNEY ABORTED:", e instanceof Error ? e.message : e);
  process.exit(1);
});

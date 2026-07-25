# 0run — Piano A: Fondamenta + Ciclo Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ciclo core di 0run funzionante end-to-end: login Privy → mint del coach iNFT su 0G Galileo → upload GPX cifrato su 0G Storage → memoria aggiornata on-chain → report AI via 0G Compute → chat.

**Architecture:** Monorepo npm workspaces: `apps/web` (Next.js App Router, frontend + API routes), `contracts/` (Hardhat, AgentNFT vendorizzato + CoachRegistry), `packages/shared` (tipi+zod). Postgres in Docker è solo indice di navigazione; la fonte di verità è 0G (Storage per i dati cifrati, chain per gli hash). Inferenza dietro interfaccia unica con due adapter (Router mainnet / Direct testnet).

**Tech Stack:** Node 22, TypeScript, Next.js 15 App Router, Tailwind CSS v4, Privy, ethers v6 + viem, `@0gfoundation/0g-storage-ts-sdk`, `@0gfoundation/0g-compute-ts-sdk`, Hardhat + solidity 0.8.28, Drizzle ORM + node-postgres, react-leaflet, vitest.

## Global Constraints

- Node 22; `.npmrc` con `legacy-peer-deps=true` in root dal giorno zero.
- SOLO package `@0gfoundation/*` (mai `@0glabs/*`, sono deprecati); ethers v6.
- ChainId **16602** unico e centralizzato in `packages/shared/src/chain.ts` — 16600/16601 nei tutorial sono obsoleti.
- Endpoint canonici: RPC `https://evmrpc-testnet.0g.ai` · indexer `https://indexer-storage-testnet-turbo.0g.ai` · router `https://router-api.0g.ai/v1` · explorer `https://chainscan-galileo.0g.ai` · storage explorer `https://storagescan-galileo.0g.ai`.
- Modelli inferenza: MAI i claude-*/gpt-* del router (senza attestazione TEE). Primario `glm-5.2`, fallback `0gm-1.0-35b-a3b`; catalogo verificato a runtime da `GET /v1/models`.
- **Mai fallback su dati finti** (i mock squalificano): ogni operazione 0G ritorna una receipt (`ok: false` + errore), mai un valore inventato.
- La chiave utente (derivata da firma wallet) NON viene mai persistita server-side: arriva per-richiesta e vive solo in memoria.
- UI: design system Luxury/Editorial vincolante (`docs/superpowers/specs/2026-07-24-0run-design-system.md`): palette cream `#EFEFD0` / navy `#004E89` / peach `#F7C59F` / ocean `#1A659E` / orange `#FF6B35`; radius 0; Playfair Display + Inter; transizioni ≥500ms (immagini 1500-2000ms); grayscale sulle immagini.
- Postgres solo in Docker; nessun SaaS oltre Privy.
- Test con vitest (`npx vitest run <file>`); i test che toccano 0G reale sono gated da `RUN_ZG_INTEGRATION=1`.

## File Structure

```
.npmrc, package.json (workspaces), docker-compose.yml, .env.example
packages/shared/src/chain.ts        → costanti chain/endpoint (unica fonte)
packages/shared/src/types.ts        → RunStats, CoachMemory, CoachProfile, StorageReceipt, zod schemas
apps/web/src/lib/gpx/parse.ts       → parser GPX → RunStats
apps/web/src/lib/crypto/keys.ts     → deriveUserKey (HKDF da firma), service key
apps/web/src/lib/crypto/aes.ts      → encryptJson/decryptJson AES-256-GCM
apps/web/src/db/schema.ts, index.ts → Drizzle schema + client
apps/web/src/lib/zerog/storage.ts   → uploadEncrypted/downloadDecrypted (receipt pattern)
apps/web/src/lib/inference/types.ts, router.ts, direct.ts, index.ts, json.ts
apps/web/src/lib/coach/memory.ts    → initMemory/appendRun/buildProfile
apps/web/src/lib/coach/prompts.ts   → system/user prompt builder (personalità)
apps/web/src/lib/zerog/contracts.ts → indirizzi + ABI helper ethers
apps/web/src/lib/funder.ts          → top-up gas embedded wallet
apps/web/src/app/(auth)/…           → login, providers Privy
apps/web/src/components/ui/…        → Button, Card, Input, PageChrome (noise+gridlines)
apps/web/src/app/api/coach/mint/route.ts
apps/web/src/app/api/runs/route.ts, api/runs/[id]/route.ts
apps/web/src/app/api/coach/chat/route.ts
apps/web/src/app/mint/page.tsx, app/runs/[id]/page.tsx, app/upload/page.tsx, app/page.tsx
contracts/contracts/CoachRegistry.sol, OrunAgentNFT.sol (fallback), vendor da 0g-agent-nft
contracts/test/coachRegistry.test.ts, orunAgentNft.test.ts
contracts/scripts/deploy.ts
scripts/spike/*.ts, scripts/seed-demo.ts, scripts/smoke-core.sh
docs/decisions.md                   → log decisioni spike
```

**Lane parallele per il team:** Lane contratti = Task 9 · Lane servizi = Task 3-8, 10 · Lane UI = Task 11-12 (dopo Task 1). I task 13-16 integrano e richiedono le lane precedenti.

---

### Task 1: Scaffold monorepo, Docker, env

**Files:**
- Create: `.npmrc`, `package.json`, `docker-compose.yml`, `.env.example`, `packages/shared/package.json`, `packages/shared/tsconfig.json`, `apps/web` (via create-next-app), `contracts/` (via hardhat init), `.gitignore` (append)

**Interfaces:**
- Produces: struttura workspaces `@0run/shared`, `web`, `contracts`; Postgres su `localhost:5432`.

- [ ] **Step 1: Verifica Node 22 e crea struttura**

```bash
node --version   # atteso v22.x — se minore: installare Node 22 prima di procedere
printf 'legacy-peer-deps=true\n' > .npmrc
```

`package.json` (root):

```json
{
  "name": "0run",
  "private": true,
  "workspaces": ["apps/*", "packages/*", "contracts"],
  "scripts": {
    "dev": "npm run dev -w web",
    "test": "npm run test -ws --if-present"
  }
}
```

- [ ] **Step 2: create-next-app + shared package**

```bash
npx create-next-app@latest apps/web --ts --app --tailwind --src-dir --import-alias "@/*" --no-eslint --use-npm
mkdir -p packages/shared/src
```

`packages/shared/package.json`:

```json
{
  "name": "@0run/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.0.0" },
  "scripts": { "test": "vitest run" }
}
```

`packages/shared/src/index.ts`:

```ts
export * from "./chain";
export * from "./types";
```

- [ ] **Step 3: docker-compose e .env.example**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: orun
      POSTGRES_PASSWORD: orun
      POSTGRES_DB: orun
    ports: ["127.0.0.1:5432:5432"]
    volumes: [dbdata:/var/lib/postgresql/data]
volumes:
  dbdata:
```

`.env.example`:

```bash
# --- DB ---
DATABASE_URL=postgres://orun:orun@localhost:5432/orun
# --- 0G chain (Galileo 16602) ---
ZG_RPC_URL=https://evmrpc-testnet.0g.ai
ZG_INDEXER_URL=https://indexer-storage-testnet-turbo.0g.ai
TREASURY_PRIVATE_KEY=        # wallet team: deploy, mint, storage fee, funder
AGENT_NFT_ADDRESS=           # da Task 9
COACH_REGISTRY_ADDRESS=      # da Task 9
# --- 0G Compute ---
ROUTER_API_URL=https://router-api.0g.ai/v1
ROUTER_API_KEY=              # sk-... da pc.0g.ai
ROUTER_MODEL_PRIMARY=glm-5.2
ROUTER_MODEL_FALLBACK=0gm-1.0-35b-a3b
DIRECT_ENABLED=0             # 1 per il path Direct testnet (Task 8)
DIRECT_PROVIDERS=            # csv indirizzi provider, da spike
# --- crypto ---
SERVICE_ENC_KEY=             # 32 byte hex: openssl rand -hex 32
# --- Privy ---
NEXT_PUBLIC_PRIVY_APP_ID=
PRIVY_APP_SECRET=
```

- [ ] **Step 4: Verifica e commit**

```bash
docker compose up -d db && docker compose ps   # atteso: db healthy/running
npm install
git add -A && git commit -m "chore: scaffold monorepo, docker-compose, env"
```

---

### Task 2: Spike 0G (de-risk, decisioni loggate)

**Files:**
- Create: `scripts/spike/storage-roundtrip.ts`, `scripts/spike/router-chat.ts`, `docs/decisions.md`

**Interfaces:**
- Produces: `docs/decisions.md` con: branch scelto per AgentNFT, modello router funzionante, tempi reali di upload/finality. I task 7-9 leggono queste decisioni.

- [ ] **Step 1: Fondare il wallet tesoreria**

Manuale: `https://faucet.0g.ai` con l'address di `TREASURY_PRIVATE_KEY` (0.1 0G/giorno — iniziare SUBITO, servono più giorni). API key router: `https://pc.0g.ai` → connetti wallet → deposito → API key `sk-...` in `.env`.

- [ ] **Step 2: Spike storage roundtrip**

```bash
npm i -w web @0gfoundation/0g-storage-ts-sdk ethers
```

`scripts/spike/storage-roundtrip.ts`:

```ts
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";
import crypto from "node:crypto";

const RPC = process.env.ZG_RPC_URL!, INDEXER = process.env.ZG_INDEXER_URL!;
const signer = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, new ethers.JsonRpcProvider(RPC));
const indexer = new Indexer(INDEXER);
const key = crypto.randomBytes(32);
const payload = new TextEncoder().encode(JSON.stringify({ hello: "0run", t: Date.now() }));

const data = new MemData(payload);
const [tree, treeErr] = await data.merkleTree();
if (treeErr) throw treeErr;
console.log("rootHash:", tree!.rootHash());
const t0 = Date.now();
const [tx, upErr] = await indexer.upload(data, RPC, signer, { encryption: { type: "aes256", key } });
if (upErr) throw upErr;
console.log("upload tx:", tx, "ms:", Date.now() - t0);
// poll finality: downloadToBlob finché non torna il payload
for (let i = 0; i < 30; i++) {
  try {
    const blob = await indexer.downloadToBlob(tree!.rootHash()!, { decryption: { symmetricKey: key } });
    const text = new TextDecoder().decode(await blob.arrayBuffer());
    JSON.parse(text); // valida: chiave sbagliata NON darebbe errore, darebbe garbage
    console.log("download ok dopo", i, "tentativi:", text);
    process.exit(0);
  } catch { await new Promise(r => setTimeout(r, 5000)); }
}
throw new Error("finality non raggiunta in 150s");
```

Run: `npx tsx scripts/spike/storage-roundtrip.ts` — atteso: rootHash + tx + download ok. Annotare i tempi in `docs/decisions.md`. Se le firme SDK differiscono (versione ≥1.2.10 richiesta), correggere QUI e annotare — questo file è la reference per Task 7.

- [ ] **Step 3: Spike router**

`scripts/spike/router-chat.ts`:

```ts
const base = process.env.ROUTER_API_URL!;
const models = await fetch(`${base}/models`).then(r => r.json());
console.log("models:", models.data?.map((m: any) => m.id));
const res = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ROUTER_API_KEY}` },
  body: JSON.stringify({ model: process.env.ROUTER_MODEL_PRIMARY, messages: [{ role: "user", content: "Say OK" }] }),
});
console.log(res.status, JSON.stringify(await res.json()).slice(0, 400));
```

Run: `npx tsx scripts/spike/router-chat.ts` — atteso: catalogo con `glm-5.2` (o annotare l'id reale in `.env` e decisions.md) e risposta 200.

- [ ] **Step 4: Decisione branch AgentNFT**

```bash
git clone --depth 1 https://github.com/0gfoundation/0g-agent-nft /tmp/0g-agent-nft
git clone --depth 1 -b eip-7857-draft https://github.com/0gfoundation/0g-agent-nft /tmp/0g-agent-nft-draft
grep -n "function mint" /tmp/0g-agent-nft/contracts/AgentNFT.sol
grep -n "function mint" /tmp/0g-agent-nft-draft/contracts/AgentNFT.sol
```

Criterio (dalla spec): scegliere il branch il cui `mint` corrisponde a `mint(IntelligentData[] calldata, address) payable` con `intelligentDatasOf(tokenId)` (atteso: `main`). Scrivere in `docs/decisions.md`: branch scelto, firma esatta di mint, presenza/assenza dell'estensione `authorizeUsage` (serve al Piano C). Se ENTRAMBI i branch danno problemi di compilazione → decisione "fallback OrunAgentNFT" (il contratto è nel Task 9, già pronto).

- [ ] **Step 5: Commit**

```bash
git add scripts/spike docs/decisions.md && git commit -m "chore: spike 0G storage/router + decisione branch AgentNFT"
```

---

### Task 3: Tipi condivisi e costanti chain

**Files:**
- Create: `packages/shared/src/chain.ts`, `packages/shared/src/types.ts`
- Test: `packages/shared/src/types.test.ts`

**Interfaces:**
- Produces: `GALILEO` (chain const), `RunStatsSchema`/`RunStats`, `CoachMemorySchema`/`CoachMemory`, `CoachProfileSchema`/`CoachProfile`, `StorageReceipt`, `Personality = "pacer" | "coach" | "drill_sergeant"`. Tutti i task successivi importano SOLO da `@0run/shared`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CoachMemorySchema, CoachProfileSchema, RunStatsSchema, initialMemory } from "./types";

const stats = {
  distanceKm: 5.02, durationSec: 1500, avgPaceSecKm: 299, elevationGainM: 42,
  splitsSecKm: [295, 301, 298, 305, 296], avgHr: null, startedAt: "2026-07-20T07:30:00.000Z",
};

describe("shared types", () => {
  it("valida RunStats", () => {
    expect(RunStatsSchema.parse(stats)).toEqual(stats);
  });
  it("initialMemory produce memoria e profilo validi e coerenti con la personalità", () => {
    const { memory, profile } = initialMemory("Kilian", "drill_sergeant");
    expect(CoachMemorySchema.parse(memory).coach.personality).toBe("drill_sergeant");
    expect(CoachProfileSchema.parse(profile).totals.runs).toBe(0);
    expect(memory.privateLayer.runs).toHaveLength(0);
  });
  it("rifiuta personalità sconosciute", () => {
    expect(() => initialMemory("X", "hard" as never)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -w @0run/shared` — atteso: FAIL (modulo `./types` non esiste).

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/chain.ts`:

```ts
export const GALILEO = {
  chainId: 16602,
  name: "0G Galileo Testnet",
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
  explorer: "https://chainscan-galileo.0g.ai",
  storageExplorer: "https://storagescan-galileo.0g.ai",
  currency: { name: "0G", symbol: "0G", decimals: 18 },
} as const;
export const explorerTx = (h: string) => `${GALILEO.explorer}/tx/${h}`;
export const storageExplorerRoot = (r: string) => `${GALILEO.storageExplorer}/file?root=${r}`;
```

`packages/shared/src/types.ts`:

```ts
import { z } from "zod";

export const PersonalitySchema = z.enum(["pacer", "coach", "drill_sergeant"]);
export type Personality = z.infer<typeof PersonalitySchema>;

export const RunStatsSchema = z.object({
  distanceKm: z.number().positive(),
  durationSec: z.number().positive(),
  avgPaceSecKm: z.number().positive(),
  elevationGainM: z.number().min(0),
  splitsSecKm: z.array(z.number().positive()),
  avgHr: z.number().positive().nullable(),
  startedAt: z.string().datetime(),
});
export type RunStats = z.infer<typeof RunStatsSchema>;

export const RunSummarySchema = RunStatsSchema.extend({
  reportHeadline: z.string().default(""),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const CoachMemorySchema = z.object({
  version: z.literal(1),
  coach: z.object({ name: z.string().min(1), personality: PersonalitySchema }),
  privateLayer: z.object({ runs: z.array(RunSummarySchema) }),
});
export type CoachMemory = z.infer<typeof CoachMemorySchema>;

export const CoachProfileSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  personality: PersonalitySchema,
  totals: z.object({ runs: z.number().int().min(0), km: z.number().min(0) }),
  paceTrend: z.array(z.number()).describe("avgPaceSecKm ultime N corse, più recente per ultima"),
  styleNotes: z.string(),
});
export type CoachProfile = z.infer<typeof CoachProfileSchema>;

export type StorageReceipt =
  | { ok: true; rootHash: string; txHash: string }
  | { ok: false; error: string };

const STYLE: Record<Personality, string> = {
  pacer: "Supportive companion: celebrates effort, gentle suggestions, warm tone.",
  coach: "Balanced professional: data-driven, honest, encouraging but precise.",
  drill_sergeant: "No excuses: blunt verdicts, high standards, direct commands.",
};

export function initialMemory(name: string, personality: Personality): { memory: CoachMemory; profile: CoachProfile } {
  PersonalitySchema.parse(personality);
  return {
    memory: { version: 1, coach: { name, personality }, privateLayer: { runs: [] } },
    profile: { version: 1, name, personality, totals: { runs: 0, km: 0 }, paceTrend: [], styleNotes: STYLE[personality] },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run -w @0run/shared` — atteso: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add packages/shared && git commit -m "feat(shared): chain constants, run/memory/profile schemas"
```

---

### Task 4: Parser GPX

**Files:**
- Create: `apps/web/src/lib/gpx/parse.ts`, `apps/web/src/lib/gpx/fixtures/short-run.gpx`
- Test: `apps/web/src/lib/gpx/parse.test.ts`

**Interfaces:**
- Consumes: `RunStats` da `@0run/shared`.
- Produces: `parseGpx(xml: string): { stats: RunStats; polyline: [number, number][] }` — throw `GpxError` su GPX invalido. `polyline` = [lat, lon] per la mappa (Task 15).

- [ ] **Step 1: Fixture + failing test**

```bash
npm i -w web fast-xml-parser && npm i -w web -D vitest
```

`apps/web/src/lib/gpx/fixtures/short-run.gpx` (tracciato reale minimale, ~1.1km, 3 punti/边 ritmo costante — 4 trackpoint con ele e hr):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="0run-test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Short</name><trkseg>
    <trkpt lat="38.7100" lon="-9.1400"><ele>10</ele><time>2026-07-20T07:00:00Z</time>
      <extensions><gpxtpx:TrackPointExtension xmlns:gpxtpx="x"><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="38.7150" lon="-9.1400"><ele>14</ele><time>2026-07-20T07:03:00Z</time>
      <extensions><gpxtpx:TrackPointExtension xmlns:gpxtpx="x"><gpxtpx:hr>150</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="38.7200" lon="-9.1400"><ele>12</ele><time>2026-07-20T07:06:00Z</time>
      <extensions><gpxtpx:TrackPointExtension xmlns:gpxtpx="x"><gpxtpx:hr>155</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  </trkseg></trk>
</gpx>
```

`apps/web/src/lib/gpx/parse.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GpxError, parseGpx } from "./parse";

const xml = readFileSync(join(__dirname, "fixtures/short-run.gpx"), "utf8");

describe("parseGpx", () => {
  it("estrae stats da un GPX valido", () => {
    const { stats, polyline } = parseGpx(xml);
    expect(stats.distanceKm).toBeCloseTo(1.11, 1);       // 2 x ~0.556km di latitudine
    expect(stats.durationSec).toBe(360);
    expect(stats.avgPaceSecKm).toBeCloseTo(360 / stats.distanceKm, 0);
    expect(stats.elevationGainM).toBe(4);                 // 10→14 (+4), 14→12 (0)
    expect(stats.avgHr).toBe(148);                        // (140+150+155)/3 arrotondato
    expect(stats.startedAt).toBe("2026-07-20T07:00:00.000Z");
    expect(polyline).toHaveLength(3);
    expect(polyline[0]).toEqual([38.71, -9.14]);
  });
  it("splitsSecKm copre la distanza (ultimo split parziale escluso se < 500m)", () => {
    const { stats } = parseGpx(xml);
    expect(stats.splitsSecKm.length).toBe(1);             // 1.11km → 1 split pieno
  });
  it("rifiuta GPX senza trackpoint", () => {
    expect(() => parseGpx("<gpx></gpx>")).toThrow(GpxError);
  });
  it("rifiuta XML malformato", () => {
    expect(() => parseGpx("not xml at all {")).toThrow(GpxError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -w web src/lib/gpx` — atteso: FAIL (`./parse` non esiste).

- [ ] **Step 3: Implementation**

`apps/web/src/lib/gpx/parse.ts`:

```ts
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
    distM += d; splitDist += d;
    const eleDelta = (pts[i].ele ?? 0) - (pts[i - 1].ele ?? 0);
    if (pts[i].ele != null && pts[i - 1].ele != null && eleDelta > 0) gain += eleDelta;
    while (splitDist >= 1000) {
      const t = pts[i].time.getTime();
      splits.push(Math.round((t - splitStartT) / 1000 / (splitDist / 1000)));
      splitStartT = t; splitDist -= 1000;
    }
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run -w web src/lib/gpx` — atteso: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/gpx && git commit -m "feat(web): GPX parser with stats, splits, polyline"
```

---

### Task 5: Crypto — derivazione chiavi e AES-GCM

**Files:**
- Create: `apps/web/src/lib/crypto/keys.ts`, `apps/web/src/lib/crypto/aes.ts`
- Test: `apps/web/src/lib/crypto/crypto.test.ts`

**Interfaces:**
- Produces: `deriveUserKey(signatureHex: string): Buffer` (32B, deterministico) · `serviceKey(): Buffer` (da `SERVICE_ENC_KEY`) · `encryptJson(obj: unknown, key: Buffer): string` (base64 iv|tag|ct) · `decryptJson<T>(payload: string, key: Buffer, schema: ZodType<T>): T` (throw su chiave sbagliata O schema invalido — mai garbage silenzioso). Il messaggio di firma client è `SIGN_MESSAGE`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/crypto/crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { encryptJson, decryptJson } from "./aes";
import { deriveUserKey, SIGN_MESSAGE } from "./keys";

const sigA = "0x" + "ab".repeat(65);
const sigB = "0x" + "cd".repeat(65);

describe("keys", () => {
  it("SIGN_MESSAGE è stabile (cambiarlo invaliderebbe tutti i dati cifrati)", () => {
    expect(SIGN_MESSAGE).toBe("0run key derivation v1 — sign to unlock your encrypted running data");
  });
  it("derivazione deterministica, 32 byte, firma diversa → chiave diversa", () => {
    const k1 = deriveUserKey(sigA);
    expect(k1.length).toBe(32);
    expect(deriveUserKey(sigA).equals(k1)).toBe(true);
    expect(deriveUserKey(sigB).equals(k1)).toBe(false);
  });
});

describe("aes-gcm json", () => {
  const schema = z.object({ a: z.number() });
  it("roundtrip", () => {
    const key = deriveUserKey(sigA);
    expect(decryptJson(encryptJson({ a: 1 }, key), key, schema)).toEqual({ a: 1 });
  });
  it("chiave sbagliata → throw, mai garbage", () => {
    const ct = encryptJson({ a: 1 }, deriveUserKey(sigA));
    expect(() => decryptJson(ct, deriveUserKey(sigB), schema)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -w web src/lib/crypto` — atteso: FAIL.

- [ ] **Step 3: Implementation**

`apps/web/src/lib/crypto/keys.ts`:

```ts
import { hkdfSync } from "node:crypto";

export const SIGN_MESSAGE = "0run key derivation v1 — sign to unlock your encrypted running data";

export function deriveUserKey(signatureHex: string): Buffer {
  const ikm = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");
  if (ikm.length < 32) throw new Error("firma troppo corta");
  return Buffer.from(hkdfSync("sha256", ikm, Buffer.from("0run-v1"), Buffer.from("user-data-key"), 32));
}

export function serviceKey(): Buffer {
  const hex = process.env.SERVICE_ENC_KEY;
  if (!hex || hex.length !== 64) throw new Error("SERVICE_ENC_KEY mancante o non 32 byte hex");
  return Buffer.from(hex, "hex");
}
```

`apps/web/src/lib/crypto/aes.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ZodType } from "zod";

export function encryptJson(obj: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptJson<T>(payload: string, key: Buffer, schema: ZodType<T>): T {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(ct), d.final()]).toString("utf8"); // GCM: chiave sbagliata → throw qui
  return schema.parse(JSON.parse(plain));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run -w web src/lib/crypto` — atteso: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/crypto && git commit -m "feat(web): HKDF user key derivation + AES-256-GCM json helpers"
```

---

### Task 6: DB Drizzle

**Files:**
- Create: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/drizzle.config.ts`
- Test: `apps/web/src/db/schema.test.ts`

**Interfaces:**
- Produces: tabelle `users`, `coaches`, `runs`, `chatMessages` (eventi/claims/rentals arrivano nei Piani B/C); client `db` (drizzle); `RunStep = "encrypt" | "store_gpx" | "update_memory" | "registry_tx" | "inference"`; colonna `runs.steps` jsonb `Record<RunStep, {status: "pending"|"done"|"error", detail?: string}>`.

- [ ] **Step 1: Install + failing test**

```bash
npm i -w web drizzle-orm pg && npm i -w web -D drizzle-kit @types/pg
```

`apps/web/src/db/schema.test.ts` (test di integrazione, gated dal DB locale):

```ts
import { describe, expect, it } from "vitest";
import { db } from "./index";
import { users, runs } from "./schema";
import { eq } from "drizzle-orm";

const enabled = !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("db smoke", () => {
  it("insert+read user e run", async () => {
    const [u] = await db.insert(users).values({ privyDid: `did:test:${Date.now()}`, wallet: "0x" + "11".repeat(20) }).returning();
    const [r] = await db.insert(runs).values({
      userId: u.id, status: "processing",
      steps: { encrypt: { status: "pending" }, store_gpx: { status: "pending" }, update_memory: { status: "pending" }, registry_tx: { status: "pending" }, inference: { status: "pending" } },
    }).returning();
    const found = await db.select().from(runs).where(eq(runs.id, r.id));
    expect(found[0].userId).toBe(u.id);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `DATABASE_URL=postgres://orun:orun@localhost:5432/orun npx vitest run -w web src/db` — atteso: FAIL (schema non esiste).

- [ ] **Step 3: Implementation**

`apps/web/src/db/schema.ts`:

```ts
import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { RunStats } from "@0run/shared";

export type RunStep = "encrypt" | "store_gpx" | "update_memory" | "registry_tx" | "inference";
export type StepState = { status: "pending" | "done" | "error"; detail?: string };

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  privyDid: text("privy_did").notNull().unique(),
  wallet: text("wallet").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const coaches = pgTable("coaches", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull().unique(),
  tokenId: text("token_id").notNull(),
  name: text("name").notNull(),
  personality: text("personality").notNull(),
  memoryRoot: text("memory_root").notNull(),
  profileRoot: text("profile_root").notNull(),
  mintTx: text("mint_tx").notNull(),
});

export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  status: text("status", { enum: ["processing", "done", "error"] }).notNull(),
  steps: jsonb("steps").$type<Record<RunStep, StepState>>().notNull(),
  stats: jsonb("stats").$type<RunStats>(),
  polyline: jsonb("polyline").$type<[number, number][]>(),
  gpxRoot: text("gpx_root"),
  registryTx: text("registry_tx"),
  report: jsonb("report").$type<{ headline: string; analysis: string; comparison: string; advice: string[] }>(),
  verifiedTee: text("verified_tee"), // "true" | "false" | "unavailable"
  model: text("model"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

`apps/web/src/db/index.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

`apps/web/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 4: Push schema e verify pass**

```bash
DATABASE_URL=postgres://orun:orun@localhost:5432/orun npx drizzle-kit push --config apps/web/drizzle.config.ts
DATABASE_URL=postgres://orun:orun@localhost:5432/orun npx vitest run -w web src/db
```
Atteso: push crea le tabelle; test PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/db apps/web/drizzle.config.ts && git commit -m "feat(web): drizzle schema users/coaches/runs/chat"
```

---

### Task 7: Servizio 0G Storage (receipt pattern)

**Files:**
- Create: `apps/web/src/lib/zerog/storage.ts`
- Test: `apps/web/src/lib/zerog/storage.test.ts`

**Interfaces:**
- Consumes: `StorageReceipt` da shared; firme SDK validate nello spike (Task 2).
- Produces: `uploadEncrypted(data: Uint8Array, key: Buffer): Promise<StorageReceipt>` · `downloadDecrypted(rootHash: string, key: Buffer, validate: (buf: Buffer) => boolean): Promise<{ ok: true; data: Buffer } | { ok: false; error: string }>` — retry 3x con backoff su upload; `validate` obbligatoria (chiave sbagliata → ciphertext senza errore, bug noto).

- [ ] **Step 1: Failing test (SDK iniettabile)**

`apps/web/src/lib/zerog/storage.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { uploadEncrypted, downloadDecrypted, _setDepsForTest } from "./storage";

describe("storage receipts", () => {
  it("upload ok → receipt con rootHash e txHash", async () => {
    _setDepsForTest({
      makeData: async () => ({ data: {}, rootHash: "0xroot" }),
      doUpload: vi.fn(async () => ["0xtx", null] as const),
      doDownload: async () => Buffer.from("x"),
    });
    const r = await uploadEncrypted(new Uint8Array([1]), Buffer.alloc(32));
    expect(r).toEqual({ ok: true, rootHash: "0xroot", txHash: "0xtx" });
  });
  it("upload che fallisce 3 volte → receipt ok:false, MAI throw", async () => {
    const doUpload = vi.fn(async () => [null, new Error("indexer 503")] as const);
    _setDepsForTest({ makeData: async () => ({ data: {}, rootHash: "0xroot" }), doUpload, doDownload: async () => Buffer.from("x") });
    const r = await uploadEncrypted(new Uint8Array([1]), Buffer.alloc(32));
    expect(r.ok).toBe(false);
    expect(doUpload).toHaveBeenCalledTimes(3);
  });
  it("download con validate che fallisce → ok:false (chiave sbagliata = garbage silenzioso)", async () => {
    _setDepsForTest({
      makeData: async () => ({ data: {}, rootHash: "0xroot" }),
      doUpload: async () => ["0xtx", null] as const,
      doDownload: async () => Buffer.from("garbage"),
    });
    const r = await downloadDecrypted("0xroot", Buffer.alloc(32), () => false);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run -w web src/lib/zerog` — atteso: FAIL.

- [ ] **Step 3: Implementation**

`apps/web/src/lib/zerog/storage.ts`:

```ts
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";
import { GALILEO, type StorageReceipt } from "@0run/shared";

type Deps = {
  makeData: (bytes: Uint8Array) => Promise<{ data: unknown; rootHash: string }>;
  doUpload: (data: unknown, key: Buffer) => Promise<readonly [string | null, Error | null]>;
  doDownload: (rootHash: string, key: Buffer) => Promise<Buffer>;
};

function realDeps(): Deps {
  const provider = new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl);
  const signer = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, provider);
  const indexer = new Indexer(process.env.ZG_INDEXER_URL ?? GALILEO.indexerUrl);
  return {
    makeData: async (bytes) => {
      const data = new MemData(bytes);
      const [tree, err] = await data.merkleTree();
      if (err || !tree) throw err ?? new Error("merkle tree failed");
      return { data, rootHash: tree.rootHash()! };
    },
    doUpload: async (data, key) =>
      indexer.upload(data as MemData, process.env.ZG_RPC_URL ?? GALILEO.rpcUrl, signer, { encryption: { type: "aes256", key } }),
    doDownload: async (rootHash, key) => {
      const blob = await indexer.downloadToBlob(rootHash, { decryption: { symmetricKey: key } });
      return Buffer.from(await blob.arrayBuffer());
    },
  };
}

let deps: Deps | null = null;
const getDeps = () => (deps ??= realDeps());
export function _setDepsForTest(d: Deps) { deps = d; }

export async function uploadEncrypted(bytes: Uint8Array, key: Buffer): Promise<StorageReceipt> {
  try {
    const { data, rootHash } = await getDeps().makeData(bytes);
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const [tx, err] = await getDeps().doUpload(data, key);
      if (!err && tx) return { ok: true, rootHash, txHash: tx };
      lastErr = String(err);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    return { ok: false, error: `upload failed after 3 attempts: ${lastErr}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function downloadDecrypted(
  rootHash: string, key: Buffer, validate: (buf: Buffer) => boolean,
): Promise<{ ok: true; data: Buffer } | { ok: false; error: string }> {
  try {
    const buf = await getDeps().doDownload(rootHash, key);
    if (!validate(buf)) return { ok: false, error: "validation failed (chiave sbagliata o dato corrotto)" };
    return { ok: true, data: buf };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run -w web src/lib/zerog` — atteso: PASS (3 test). Verifica integrazione reale (facoltativa qui, già coperta dallo spike): `RUN_ZG_INTEGRATION=1 npx tsx scripts/spike/storage-roundtrip.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/zerog && git commit -m "feat(web): 0G storage service with receipt pattern and retries"
```

---

### Task 8: Servizio inferenza (Router + Direct, JSON robusto)

**Files:**
- Create: `apps/web/src/lib/inference/types.ts`, `router.ts`, `direct.ts`, `json.ts`, `index.ts`
- Test: `apps/web/src/lib/inference/inference.test.ts`

**Interfaces:**
- Produces: `coachComplete(messages: ChatMsg[]): Promise<CoachCompletion>` con `type ChatMsg = { role: "system"|"user"|"assistant"; content: string }` e `type CoachCompletion = { text: string; verified: boolean | null; model: string; path: "router"|"direct" }` · `completeJson<T>(schema: ZodType<T>, messages: ChatMsg[], retries?: number): Promise<{ value: T; meta: CoachCompletion }>` — ritenta rimandando l'errore di validazione al modello. Fallback: primario → fallback → (se `DIRECT_ENABLED=1`) direct. `verified` è `boolean | null` su entrambi i path: `true/false` = esito reale di `processResponse` (solo direct), `null` = attestazione non disponibile (router, oppure `processResponse` fallito — loggato con warn).

- [ ] **Step 1: Failing test (fetch mockato)**

```bash
npm i -w web @0gfoundation/0g-compute-ts-sdk
```

`apps/web/src/lib/inference/inference.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const ok = (content: string) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content } }], id: "chat-1" }),
  headers: new Headers(),
});

describe("inference", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("router: primo modello ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok("ciao runner")));
    const { coachComplete } = await import("./index");
    const r = await coachComplete([{ role: "user", content: "hi" }]);
    expect(r.text).toBe("ciao runner");
    expect(r.path).toBe("router");
    expect(r.verified).toBeNull();
  });

  it("router: primario 503 → fallback model", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}), headers: new Headers() })
      .mockResolvedValueOnce(ok("dal fallback"));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { coachComplete } = await import("./index");
    const r = await coachComplete([{ role: "user", content: "hi" }]);
    expect(r.text).toBe("dal fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("completeJson: output sporco → retry con correzione → valida", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok("ecco il json: {\"headline\": 42}"))
      .mockResolvedValueOnce(ok('{"headline":"Gran tempo"}'));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { completeJson } = await import("./index");
    const { value } = await completeJson(z.object({ headline: z.string() }), [{ role: "user", content: "report" }]);
    expect(value.headline).toBe("Gran tempo");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tutti i path falliscono → throw, MAI report inventato", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}), headers: new Headers() })));
    vi.resetModules();
    const { coachComplete } = await import("./index");
    await expect(coachComplete([{ role: "user", content: "hi" }])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run -w web src/lib/inference` — atteso: FAIL.

- [ ] **Step 3: Implementation**

`apps/web/src/lib/inference/types.ts`:

```ts
export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
export type CoachCompletion = { text: string; verified: boolean | null; model: string; path: "router" | "direct" };
```

`apps/web/src/lib/inference/router.ts`:

```ts
import type { ChatMsg, CoachCompletion } from "./types";

export async function routerComplete(messages: ChatMsg[]): Promise<CoachCompletion> {
  const base = process.env.ROUTER_API_URL ?? "https://router-api.0g.ai/v1";
  const models = [process.env.ROUTER_MODEL_PRIMARY ?? "glm-5.2", process.env.ROUTER_MODEL_FALLBACK ?? "0gm-1.0-35b-a3b"];
  let lastErr = "";
  for (const model of models) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ROUTER_API_KEY}` },
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(120_000),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({}), headers: new Headers(), _e: String(e) } as any));
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.length) return { text, verified: null, model, path: "router" };
      lastErr = "risposta senza contenuto";
    } else lastErr = `HTTP ${res.status}`;
  }
  throw new Error(`router: tutti i modelli falliti (${lastErr})`);
}
```

`apps/web/src/lib/inference/direct.ts` (path Direct testnet — attivo solo con `DIRECT_ENABLED=1`; struttura dal pattern cannes2026 validato in ricerca):

```ts
import { ethers } from "ethers";
import { GALILEO } from "@0run/shared";
import type { ChatMsg, CoachCompletion } from "./types";

let brokerPromise: Promise<any> | null = null;
async function getBroker() {
  return (brokerPromise ??= (async () => {
    const { createZGComputeNetworkBroker } = await import("@0gfoundation/0g-compute-ts-sdk");
    const wallet = new ethers.Wallet(
      process.env.TREASURY_PRIVATE_KEY!,
      new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl),
    );
    return createZGComputeNetworkBroker(wallet);
  })());
}

export async function directComplete(messages: ChatMsg[]): Promise<CoachCompletion> {
  const providers = (process.env.DIRECT_PROVIDERS ?? "").split(",").filter(Boolean);
  if (!providers.length) throw new Error("DIRECT_PROVIDERS vuoto");
  const broker = await getBroker();
  let lastErr = "";
  for (const provider of providers) {
    try {
      await broker.inference.acknowledgeProviderSigner(provider).catch(() => {}); // idempotente
      const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
      const content = messages.map((m) => m.content).join("\n");
      const headers = await broker.inference.getRequestHeaders(provider, content);
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ model, messages }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.length) { lastErr = "vuoto"; continue; }
      const chatID = res.headers.get("ZG-Res-Key") ?? data.id;
      let verified: boolean | null = null;
      try { verified = Boolean(await broker.inference.processResponse(provider, chatID)); } catch { verified = null; }
      return { text, verified, model, path: "direct" };
    } catch (e) { lastErr = String(e); }
  }
  throw new Error(`direct: tutti i provider falliti (${lastErr})`);
}
```

`apps/web/src/lib/inference/json.ts`:

```ts
import type { ZodType } from "zod";

export function extractJson<T>(schema: ZodType<T>, text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("nessun oggetto JSON nella risposta");
  return schema.parse(JSON.parse(match[0]));
}
```

`apps/web/src/lib/inference/index.ts`:

```ts
import type { ZodType } from "zod";
import { routerComplete } from "./router";
import { directComplete } from "./direct";
import { extractJson } from "./json";
import type { ChatMsg, CoachCompletion } from "./types";

export type { ChatMsg, CoachCompletion };

export async function coachComplete(messages: ChatMsg[]): Promise<CoachCompletion> {
  try {
    return await routerComplete(messages);
  } catch (routerErr) {
    if (process.env.DIRECT_ENABLED === "1") return directComplete(messages);
    throw routerErr;
  }
}

export async function completeJson<T>(
  schema: ZodType<T>, messages: ChatMsg[], retries = 2,
): Promise<{ value: T; meta: CoachCompletion }> {
  let convo = [...messages];
  let lastErr = "";
  for (let i = 0; i <= retries; i++) {
    const meta = await coachComplete(convo);
    try {
      return { value: extractJson(schema, meta.text), meta };
    } catch (e) {
      lastErr = String(e);
      convo = [...messages, { role: "assistant", content: meta.text },
        { role: "user", content: `La risposta non era JSON valido per lo schema (${lastErr}). Rispondi SOLO con il JSON corretto, nessun altro testo.` }];
    }
  }
  throw new Error(`completeJson: JSON invalido dopo ${retries + 1} tentativi (${lastErr})`);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run -w web src/lib/inference` — atteso: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/inference && git commit -m "feat(web): inference service — router+direct adapters, robust JSON"
```

---

### Task 9: Contratti — AgentNFT vendorizzato + CoachRegistry + deploy

**Files:**
- Create: `contracts/package.json`, `contracts/hardhat.config.ts`, `contracts/contracts/CoachRegistry.sol`, `contracts/contracts/OrunAgentNFT.sol`, `contracts/scripts/deploy.ts`, vendor `contracts/contracts/vendor/` (dal branch deciso in Task 2)
- Test: `contracts/test/coachRegistry.test.ts`, `contracts/test/orunAgentNft.test.ts`

**Interfaces:**
- Consumes: decisione branch da `docs/decisions.md` (Task 2).
- Produces: su Galileo: `AGENT_NFT_ADDRESS` con `mint(IntelligentData[] calldata, address) payable returns (uint256)` + `intelligentDatasOf(uint256)` + `ownerOf(uint256)`; `COACH_REGISTRY_ADDRESS` con `update(uint256 tokenId, bytes32 memoryRoot, bytes32 profileRoot)` (solo backend) + evento `MemoryUpdated(uint256,bytes32,bytes32,uint32)` + getter `memoryOf(uint256)`. Indirizzi scritti in `.env`.

- [ ] **Step 1: Setup hardhat + failing test CoachRegistry**

```bash
cd contracts && npm init -y && npm i -D hardhat @nomicfoundation/hardhat-toolbox typescript ts-node && npm i @openzeppelin/contracts && npx hardhat init # TS project
```

`contracts/hardhat.config.ts`:

```ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: { version: "0.8.28", settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true } },
  networks: {
    zgTestnet: {
      url: process.env.ZG_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
      chainId: 16602,
      accounts: process.env.TREASURY_PRIVATE_KEY ? [process.env.TREASURY_PRIVATE_KEY] : [],
    },
  },
};
export default config;
```

`contracts/test/coachRegistry.test.ts`:

```ts
import { expect } from "chai";
import { ethers } from "hardhat";

describe("CoachRegistry", () => {
  it("solo il backend aggiorna; runCount incrementa; evento emesso", async () => {
    const [backend, rando] = await ethers.getSigners();
    const reg = await (await ethers.getContractFactory("CoachRegistry", backend)).deploy(backend.address);
    const root1 = ethers.keccak256(ethers.toUtf8Bytes("m1"));
    const prof1 = ethers.keccak256(ethers.toUtf8Bytes("p1"));
    await expect(reg.update(1, root1, prof1)).to.emit(reg, "MemoryUpdated").withArgs(1, root1, prof1, 1);
    const s = await reg.memoryOf(1);
    expect(s.runCount).to.equal(1);
    expect(s.memoryRoot).to.equal(root1);
    await expect(reg.connect(rando).update(1, root1, prof1)).to.be.revertedWith("not backend");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd contracts && npx hardhat test test/coachRegistry.test.ts` — atteso: FAIL (contratto inesistente).

- [ ] **Step 3: CoachRegistry.sol**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Registro della memoria del coach: tokenId -> hash correnti dei due strati su 0G Storage.
contract CoachRegistry {
    struct MemoryState { bytes32 memoryRoot; bytes32 profileRoot; uint32 runCount; uint64 updatedAt; }

    address public immutable backend;
    mapping(uint256 => MemoryState) public memoryOf;

    event MemoryUpdated(uint256 indexed tokenId, bytes32 memoryRoot, bytes32 profileRoot, uint32 runCount);

    constructor(address _backend) { backend = _backend; }

    function update(uint256 tokenId, bytes32 memoryRoot, bytes32 profileRoot) external {
        require(msg.sender == backend, "not backend");
        MemoryState storage s = memoryOf[tokenId];
        s.memoryRoot = memoryRoot;
        s.profileRoot = profileRoot;
        s.runCount += 1;
        s.updatedAt = uint64(block.timestamp);
        emit MemoryUpdated(tokenId, memoryRoot, profileRoot, s.runCount);
    }
}
```

Run: `npx hardhat test test/coachRegistry.test.ts` — atteso: PASS.

- [ ] **Step 4: Vendor AgentNFT + fallback OrunAgentNFT (failing test prima)**

Copiare i contratti dal branch scelto in Task 2: `cp -r /tmp/0g-agent-nft/contracts contracts/contracts/vendor` e compilare (`npx hardhat compile`). Se il vendor compila e il suo test di mint passa (adattare il test sotto al vendor), usare il vendor. Il fallback — da tenere COMUNQUE nel repo, deploy solo se il vendor fallisce — con il suo test:

`contracts/test/orunAgentNft.test.ts`:

```ts
import { expect } from "chai";
import { ethers } from "hardhat";

describe("OrunAgentNFT", () => {
  it("minta con IntelligentData e li espone; ownerOf corretto", async () => {
    const [deployer, user] = await ethers.getSigners();
    const nft = await (await ethers.getContractFactory("OrunAgentNFT", deployer)).deploy();
    const data = [{ dataDescription: "0g://storage/0xabc", dataHash: ethers.keccak256(ethers.toUtf8Bytes("ct")) }];
    const tx = await nft.mint(data, user.address);
    await expect(tx).to.emit(nft, "Minted").withArgs(1n, user.address);
    expect(await nft.ownerOf(1)).to.equal(user.address);
    const stored = await nft.intelligentDatasOf(1);
    expect(stored[0].dataDescription).to.equal("0g://storage/0xabc");
  });
});
```

`contracts/contracts/OrunAgentNFT.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Fallback minimale ERC-7857-style (subset: mint con dati intelligenti + authorizeUsage).
/// Usato SOLO se il vendor 0gfoundation/0g-agent-nft non compila/deploya (vedi docs/decisions.md).
contract OrunAgentNFT is ERC721 {
    struct IntelligentData { string dataDescription; bytes32 dataHash; }

    uint256 public nextId = 1;
    mapping(uint256 => IntelligentData[]) private _data;
    mapping(uint256 => mapping(address => bool)) public authorizedUsageOf;

    event Minted(uint256 indexed tokenId, address indexed to);
    event UsageAuthorized(uint256 indexed tokenId, address indexed executor);

    constructor() ERC721("0run Coach", "0RUN") {}

    function mint(IntelligentData[] calldata iDatas, address to) external payable returns (uint256 tokenId) {
        tokenId = nextId++;
        _safeMint(to, tokenId);
        for (uint256 i = 0; i < iDatas.length; i++) _data[tokenId].push(iDatas[i]);
        emit Minted(tokenId, to);
    }

    function intelligentDatasOf(uint256 tokenId) external view returns (IntelligentData[] memory) {
        _requireOwned(tokenId);
        return _data[tokenId];
    }

    function authorizeUsage(uint256 tokenId, address executor) external {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        authorizedUsageOf[tokenId][executor] = true;
        emit UsageAuthorized(tokenId, executor);
    }
}
```

Run: `npx hardhat test` — atteso: PASS (entrambi i file di test).

- [ ] **Step 5: Deploy su Galileo e salvataggio indirizzi**

`contracts/scripts/deploy.ts`:

```ts
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address, "balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
  // Se il vendor è utilizzabile (docs/decisions.md), sostituire "OrunAgentNFT" col contratto vendor e i suoi parametri di init.
  const nft = await (await ethers.getContractFactory("OrunAgentNFT")).deploy();
  await nft.waitForDeployment();
  const reg = await (await ethers.getContractFactory("CoachRegistry")).deploy(deployer.address);
  await reg.waitForDeployment();
  console.log("AGENT_NFT_ADDRESS=", await nft.getAddress());
  console.log("COACH_REGISTRY_ADDRESS=", await reg.getAddress());
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `cd contracts && npx hardhat run scripts/deploy.ts --network zgTestnet` — atteso: due indirizzi; copiarli in `.env` e in `docs/decisions.md` con i link chainscan.

- [ ] **Step 6: Commit**

```bash
git add contracts docs/decisions.md && git commit -m "feat(contracts): CoachRegistry + AgentNFT (vendor/fallback) deployed to Galileo"
```

---

### Task 10: Memory manager + prompt builder

**Files:**
- Create: `apps/web/src/lib/coach/memory.ts`, `apps/web/src/lib/coach/prompts.ts`
- Test: `apps/web/src/lib/coach/coach.test.ts`

**Interfaces:**
- Consumes: tipi shared; `encryptJson/decryptJson` (Task 5); `uploadEncrypted` (Task 7).
- Produces: `appendRun(memory: CoachMemory, run: RunSummary): CoachMemory` (pure) · `buildProfile(memory: CoachMemory): CoachProfile` (pure, deriva SOLO aggregati non-personali) · `persistMemory(memory: CoachMemory, userKey: Buffer): Promise<{memory: StorageReceipt; profile: StorageReceipt}>` (memoria→chiave utente, profile→chiave servizio) · `buildReportMessages(profile, recentRuns: RunSummary[], current: RunStats): ChatMsg[]` · `ReportSchema = z.object({ headline, analysis, comparison, advice: string[] })`.

- [ ] **Step 1: Failing test**

`apps/web/src/lib/coach/coach.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initialMemory } from "@0run/shared";
import { appendRun, buildProfile } from "./memory";
import { buildReportMessages, ReportSchema } from "./prompts";

const run = {
  distanceKm: 5, durationSec: 1500, avgPaceSecKm: 300, elevationGainM: 40,
  splitsSecKm: [300, 298, 302, 301, 299], avgHr: 150, startedAt: "2026-07-20T07:30:00.000Z", reportHeadline: "",
};

describe("memory", () => {
  it("appendRun è pure e accumula", () => {
    const { memory } = initialMemory("K", "coach");
    const m2 = appendRun(memory, run);
    expect(memory.privateLayer.runs).toHaveLength(0);
    expect(m2.privateLayer.runs).toHaveLength(1);
  });
  it("buildProfile aggrega senza dati personali grezzi", () => {
    const { memory } = initialMemory("K", "drill_sergeant");
    const p = buildProfile(appendRun(appendRun(memory, run), { ...run, avgPaceSecKm: 290 }));
    expect(p.totals).toEqual({ runs: 2, km: 10 });
    expect(p.paceTrend).toEqual([300, 290]);
    expect(JSON.stringify(p)).not.toContain("startedAt"); // niente corse grezze nel profile
    expect(p.styleNotes).toContain("No excuses");
  });
});

describe("prompts", () => {
  it("il system prompt porta personalità e profile; lo user porta la corsa e lo storico", () => {
    const { memory } = initialMemory("K", "pacer");
    const profile = buildProfile(appendRun(memory, run));
    const msgs = buildReportMessages(profile, [run], { ...run });
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("Supportive companion");
    expect(msgs[1].content).toContain('"distanceKm": 5');
    expect(msgs[1].content).toContain("previous runs");
  });
  it("ReportSchema valida il formato report", () => {
    expect(ReportSchema.parse({ headline: "h", analysis: "a", comparison: "c", advice: ["x"] }).advice).toEqual(["x"]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run -w web src/lib/coach` — atteso: FAIL.

- [ ] **Step 3: Implementation**

`apps/web/src/lib/coach/memory.ts`:

```ts
import {
  CoachMemory, CoachMemorySchema, CoachProfile, CoachProfileSchema, RunSummary, StorageReceipt,
} from "@0run/shared";
import { encryptJson } from "../crypto/aes";
import { serviceKey } from "../crypto/keys";
import { uploadEncrypted } from "../zerog/storage";

export function appendRun(memory: CoachMemory, run: RunSummary): CoachMemory {
  return CoachMemorySchema.parse({
    ...memory,
    privateLayer: { runs: [...memory.privateLayer.runs, run] },
  });
}

export function buildProfile(memory: CoachMemory): CoachProfile {
  const runs = memory.privateLayer.runs;
  const styleNotes: Record<string, string> = {
    pacer: "Supportive companion: celebrates effort, gentle suggestions, warm tone.",
    coach: "Balanced professional: data-driven, honest, encouraging but precise.",
    drill_sergeant: "No excuses: blunt verdicts, high standards, direct commands.",
  };
  return CoachProfileSchema.parse({
    version: 1,
    name: memory.coach.name,
    personality: memory.coach.personality,
    totals: { runs: runs.length, km: Math.round(runs.reduce((a, r) => a + r.distanceKm, 0) * 100) / 100 },
    paceTrend: runs.slice(-10).map((r) => r.avgPaceSecKm),
    styleNotes: styleNotes[memory.coach.personality],
  });
}

/** Cifra e carica entrambi gli strati. NB: il testo cifrato va dentro un envelope JSON in bytes. */
export async function persistMemory(memory: CoachMemory, userKey: Buffer): Promise<{ memory: StorageReceipt; profile: StorageReceipt }> {
  const memCt = encryptJson(memory, userKey);
  const profCt = encryptJson(buildProfile(memory), serviceKey());
  const enc = (s: string) => new TextEncoder().encode(s);
  const [memReceipt, profReceipt] = await Promise.all([
    uploadEncrypted(enc(memCt), userKey),      // doppia protezione: envelope AES nostro + aes256 SDK
    uploadEncrypted(enc(profCt), serviceKey()),
  ]);
  return { memory: memReceipt, profile: profReceipt };
}
```

`apps/web/src/lib/coach/prompts.ts`:

```ts
import { z } from "zod";
import type { CoachProfile, RunStats, RunSummary } from "@0run/shared";
import type { ChatMsg } from "../inference";

export const ReportSchema = z.object({
  headline: z.string().min(1),
  analysis: z.string().min(1),
  comparison: z.string().min(1),
  advice: z.array(z.string()).min(1).max(5),
});
export type Report = z.infer<typeof ReportSchema>;

export function systemPrompt(profile: CoachProfile): string {
  return [
    `You are ${profile.name}, an AI running coach. Personality: ${profile.styleNotes}`,
    `Athlete totals: ${profile.totals.runs} runs, ${profile.totals.km} km. Recent pace trend (sec/km, latest last): ${profile.paceTrend.join(", ") || "none"}.`,
    `Stay in character. Be specific with numbers. Answer in the user's language (Italian if unsure).`,
  ].join("\n");
}

export function buildReportMessages(profile: CoachProfile, recentRuns: RunSummary[], current: RunStats): ChatMsg[] {
  return [
    { role: "system", content: systemPrompt(profile) },
    {
      role: "user",
      content: [
        `Analyze today's run and compare it EXPLICITLY with the previous runs (cite concrete deltas, e.g. sec/km).`,
        `Today's run:\n${JSON.stringify(current, null, 1)}`,
        `Summaries of previous runs (latest last):\n${JSON.stringify(recentRuns.slice(-5), null, 1)}`,
        `Respond ONLY with JSON: {"headline": string, "analysis": string, "comparison": string, "advice": string[]} (max 4 advice).`,
      ].join("\n\n"),
    },
  ];
}

export function buildChatMessages(profile: CoachProfile, recentRuns: RunSummary[], history: ChatMsg[]): ChatMsg[] {
  return [
    { role: "system", content: `${systemPrompt(profile)}\nRecent runs:\n${JSON.stringify(recentRuns.slice(-5))}` },
    ...history.slice(-12),
  ];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run -w web src/lib/coach` — atteso: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/coach && git commit -m "feat(web): two-layer coach memory, profile derivation, prompt builders"
```

---

### Task 11: Privy + chain config + funder

**Files:**
- Create: `apps/web/src/app/providers.tsx`, `apps/web/src/lib/chain.ts`, `apps/web/src/lib/funder.ts`, `apps/web/src/app/api/fund/route.ts`, `apps/web/src/lib/auth.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Test: `apps/web/src/lib/funder.test.ts`

**Interfaces:**
- Produces: `<Providers>` con PrivyProvider su Galileo · `requireUser(req): Promise<{ userId: number; wallet: string; privyDid: string }>` (verifica il token Privy e upserta l'utente in DB; throw 401) · `topUpIfNeeded(wallet: string): Promise<{ funded: boolean; txHash?: string }>` (soglia 0.01 OG, top-up 0.03 OG dal treasury) · `POST /api/fund` chiamato dal client post-login.

- [ ] **Step 1: Install + failing test funder**

```bash
npm i -w web @privy-io/react-auth @privy-io/server-auth viem
```

`apps/web/src/lib/funder.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { topUpIfNeeded, _setFunderDepsForTest } from "./funder";

describe("funder", () => {
  it("non fonda chi ha già gas", async () => {
    const send = vi.fn();
    _setFunderDepsForTest({ getBalance: async () => 10n ** 17n, send });
    expect((await topUpIfNeeded("0x" + "22".repeat(20))).funded).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("fonda sotto soglia (0.01 OG) con 0.03 OG", async () => {
    const send = vi.fn(async () => "0xtx");
    _setFunderDepsForTest({ getBalance: async () => 0n, send });
    const r = await topUpIfNeeded("0x" + "22".repeat(20));
    expect(r).toEqual({ funded: true, txHash: "0xtx" });
    expect(send).toHaveBeenCalledWith("0x" + "22".repeat(20), 30000000000000000n);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run -w web src/lib/funder` → FAIL.

- [ ] **Step 3: Implementation**

`apps/web/src/lib/chain.ts`:

```ts
import { defineChain } from "viem";
import { GALILEO } from "@0run/shared";

export const galileo = defineChain({
  id: GALILEO.chainId,
  name: GALILEO.name,
  nativeCurrency: GALILEO.currency,
  rpcUrls: { default: { http: [GALILEO.rpcUrl] } },
  blockExplorers: { default: { name: "Chainscan", url: GALILEO.explorer } },
});
```

`apps/web/src/app/providers.tsx`:

```tsx
"use client";
import { PrivyProvider } from "@privy-io/react-auth";
import { galileo } from "@/lib/chain";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email"],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        defaultChain: galileo,
        supportedChains: [galileo],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```

`apps/web/src/lib/funder.ts`:

```ts
import { ethers } from "ethers";
import { GALILEO } from "@0run/shared";

type Deps = { getBalance: (a: string) => Promise<bigint>; send: (to: string, wei: bigint) => Promise<string> };
let deps: Deps | null = null;
export function _setFunderDepsForTest(d: Deps) { deps = d; }
function getDeps(): Deps {
  if (deps) return deps;
  const provider = new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl);
  const treasury = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, provider);
  return (deps = {
    getBalance: (a) => provider.getBalance(a),
    send: async (to, value) => (await (await treasury.sendTransaction({ to, value })).wait())!.hash,
  });
}

const THRESHOLD = 10_000_000_000_000_000n;  // 0.01 OG
const TOPUP = 30_000_000_000_000_000n;       // 0.03 OG

export async function topUpIfNeeded(wallet: string): Promise<{ funded: boolean; txHash?: string }> {
  const bal = await getDeps().getBalance(wallet);
  if (bal >= THRESHOLD) return { funded: false };
  const txHash = await getDeps().send(wallet, TOPUP);
  return { funded: true, txHash };
}
```

`apps/web/src/lib/auth.ts`:

```ts
import { PrivyClient } from "@privy-io/server-auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const privy = new PrivyClient(process.env.NEXT_PUBLIC_PRIVY_APP_ID!, process.env.PRIVY_APP_SECRET!);

export async function requireUser(req: Request): Promise<{ userId: number; wallet: string; privyDid: string }> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw Object.assign(new Error("missing token"), { status: 401 });
  const claims = await privy.verifyAuthToken(token).catch(() => { throw Object.assign(new Error("invalid token"), { status: 401 }); });
  const user = await privy.getUser(claims.userId);
  const wallet = user.wallet?.address;
  if (!wallet) throw Object.assign(new Error("no wallet"), { status: 401 });
  const existing = await db.select().from(users).where(eq(users.privyDid, claims.userId));
  if (existing.length) return { userId: existing[0].id, wallet, privyDid: claims.userId };
  const [created] = await db.insert(users).values({ privyDid: claims.userId, wallet }).returning();
  return { userId: created.id, wallet, privyDid: claims.userId };
}
```

`apps/web/src/app/api/fund/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { topUpIfNeeded } from "@/lib/funder";

export async function POST(req: Request) {
  try {
    const { wallet } = await requireUser(req);
    return NextResponse.json(await topUpIfNeeded(wallet));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
```

In `apps/web/src/app/layout.tsx` avvolgere `{children}` con `<Providers>`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run -w web src/lib/funder` → PASS (2 test). Verifica manuale login: `npm run dev`, login email, embedded wallet visibile.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src && git commit -m "feat(web): privy auth on galileo, gas funder, requireUser"
```

---

### Task 12: Design system foundations

**Files:**
- Create: `apps/web/src/components/ui/button.tsx`, `card.tsx`, `input.tsx`, `page-chrome.tsx`
- Modify: `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`
- Test: `apps/web/src/components/ui/ui.test.tsx`

**Interfaces:**
- Produces: `<Button variant="primary"|"secondary"|"link">` (orange slide su primary) · `<Card featured?>` (border-top) · `<Input>` (underline, placeholder Playfair italic) · `<PageChrome>` (noise + 4 gridlines, montato nel root layout). Token Tailwind: `cream`, `navy`, `peach`, `ocean`, `orange`; font `font-serif` (Playfair) / `font-sans` (Inter).

- [ ] **Step 1: Token + fonts + failing render test**

```bash
npm i -w web -D @testing-library/react jsdom
```

`apps/web/src/app/globals.css` (sostituire il contenuto Tailwind default):

```css
@import "tailwindcss";

@theme {
  --color-cream: #EFEFD0;
  --color-navy: #004E89;
  --color-peach: #F7C59F;
  --color-ocean: #1A659E;
  --color-orange: #FF6B35;
  --font-serif: "Playfair Display", ui-serif, serif;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
}

:root { background: var(--color-cream); color: var(--color-navy); }
* { border-radius: 0 !important; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0ms !important; animation-duration: 0ms !important; transform: none !important; }
}
```

In `apps/web/src/app/layout.tsx`: caricare i font con `next/font/google` (`Playfair_Display` con `variable: "--font-serif"`, pesi 400/300 + italic; `Inter` con `variable: "--font-sans"`, pesi 400/500) e applicare le variabili al `<body className="font-sans bg-cream text-navy">`.

`apps/web/src/components/ui/ui.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Input } from "./input";

describe("design system", () => {
  it("Button primary: navy, uppercase tracking, overlay orange per lo slide", () => {
    const { container } = render(<Button variant="primary">Mint</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-navy");
    expect(btn.className).toContain("tracking-[0.2em]");
    expect(container.querySelector("[data-slide]")?.className).toContain("bg-orange");
  });
  it("Input: solo border-b, focus orange", () => {
    render(<Input placeholder="il tuo nome" />);
    const input = screen.getByPlaceholderText("il tuo nome");
    expect(input.className).toContain("border-b");
    expect(input.className).not.toContain("border-t");
    expect(input.className).toContain("focus-visible:border-orange");
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run -w web src/components/ui` → FAIL.

- [ ] **Step 3: Componenti**

`apps/web/src/components/ui/button.tsx`:

```tsx
import { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "link" };

const EASE = "[transition-timing-function:cubic-bezier(0.25,0.46,0.45,0.94)]";

export function Button({ variant = "primary", className = "", children, ...props }: Props) {
  if (variant === "primary")
    return (
      <button
        {...props}
        className={`group relative h-12 overflow-hidden bg-navy px-8 font-sans text-xs font-medium uppercase tracking-[0.2em] text-cream shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-shadow duration-500 hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] disabled:opacity-50 ${className}`}
      >
        <span data-slide aria-hidden className={`absolute inset-0 -translate-x-full bg-orange transition-transform duration-500 ${EASE} group-hover:translate-x-0`} />
        <span className="relative z-10">{children}</span>
      </button>
    );
  if (variant === "secondary")
    return (
      <button
        {...props}
        className={`h-12 border border-navy bg-transparent px-8 font-sans text-xs font-medium uppercase tracking-[0.2em] text-navy transition-colors duration-500 hover:bg-navy hover:text-cream disabled:opacity-50 ${className}`}
      >
        {children}
      </button>
    );
  return (
    <button {...props} className={`font-sans text-xs uppercase tracking-[0.2em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline disabled:opacity-50 ${className}`}>
      {children}
    </button>
  );
}
```

`apps/web/src/components/ui/card.tsx`:

```tsx
export function Card({ featured = false, className = "", children }: { featured?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`border-t bg-transparent p-8 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all duration-700 hover:bg-peach/20 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] md:p-12 ${
        featured ? "border-t-4 border-t-orange" : "border-t-navy"
      } ${className}`}
    >
      {children}
    </div>
  );
}
```

`apps/web/src/components/ui/input.tsx`:

```tsx
import { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-12 w-full border-b border-navy bg-transparent px-0 py-2 font-sans text-sm text-navy outline-none transition-colors duration-500 placeholder:font-serif placeholder:italic placeholder:text-ocean focus-visible:border-orange ${className}`}
    />
  );
}
```

`apps/web/src/components/ui/page-chrome.tsx`:

```tsx
const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

export function PageChrome() {
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-50 opacity-[0.02]" style={{ backgroundImage: NOISE }} />
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 mx-auto hidden max-w-[1600px] lg:block">
        {["8%", "36%", "64%", "92%"].map((left) => (
          <div key={left} className="absolute top-0 h-full w-px bg-navy/20" style={{ left }} />
        ))}
      </div>
    </>
  );
}
```

Montare `<PageChrome />` come primo figlio del `<body>` nel root layout.

- [ ] **Step 4: Run to verify pass** — `npx vitest run -w web src/components/ui` → PASS (2 test). Verifica visiva: `npm run dev`, homepage con i token attivi.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src && git commit -m "feat(web): luxury/editorial design system foundations (tokens, Button/Card/Input, chrome)"
```

---

### Task 13: Mint flow (API + pagina onboarding)

**Files:**
- Create: `apps/web/src/app/api/coach/mint/route.ts`, `apps/web/src/lib/zerog/contracts.ts`, `apps/web/src/app/mint/page.tsx`, `apps/web/src/lib/client/useUserKey.ts`
- Test: `apps/web/src/app/api/coach/mint/mint.test.ts`

**Interfaces:**
- Consumes: `initialMemory`, `persistMemory` (Task 10), `requireUser` (Task 11), contratti (Task 9).
- Produces: `POST /api/coach/mint` body `{ name: string; personality: Personality; userKeyHex: string }` → `{ tokenId: string; mintTx: string; explorerUrl: string }` (409 se il coach esiste già) · `mintCoachOnChain(to: string, dataDescription: string, dataHash: string): Promise<{ tokenId: string; txHash: string }>` in `contracts.ts` · hook client `useUserKey()` → firma `SIGN_MESSAGE` con l'embedded wallet, deriva la chiave client-side (stessa HKDF via WebCrypto), la tiene in memoria di sessione.

- [ ] **Step 1: Failing test della logica API (chain e storage mockati)**

`apps/web/src/app/api/coach/mint/mint.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x" + "22".repeat(20), privyDid: "did:x" })) }));
vi.mock("@/lib/coach/memory", async (orig) => ({
  ...(await orig()) as object,
  persistMemory: vi.fn(async () => ({ memory: { ok: true, rootHash: "0xm", txHash: "0xt1" }, profile: { ok: true, rootHash: "0xp", txHash: "0xt2" } })),
}));
vi.mock("@/lib/zerog/contracts", () => ({
  mintCoachOnChain: vi.fn(async () => ({ tokenId: "1", txHash: "0xmint" })),
  updateRegistry: vi.fn(async () => "0xreg"),
}));
const dbState: any = { coaches: [] };
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => dbState.coaches }) }),
    insert: () => ({ values: (v: any) => ({ returning: async () => { dbState.coaches.push(v); return [v]; } }) }),
  },
}));

describe("POST /api/coach/mint", () => {
  beforeEach(() => { dbState.coaches = []; });
  it("minta e ritorna explorer url", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x/api/coach/mint", {
      method: "POST", headers: { authorization: "Bearer t" },
      body: JSON.stringify({ name: "Kilian", personality: "coach", userKeyHex: "aa".repeat(32) }),
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.explorerUrl).toContain("chainscan-galileo.0g.ai/tx/0xmint");
  });
  it("secondo mint → 409", async () => {
    const { POST } = await import("./route");
    const mk = () => new Request("http://x", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ name: "K", personality: "coach", userKeyHex: "aa".repeat(32) }) });
    await POST(mk());
    expect((await POST(mk())).status).toBe(409);
  });
  it("personalità invalida → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ name: "K", personality: "hard", userKeyHex: "aa".repeat(32) }) }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run -w web src/app/api/coach/mint` → FAIL.

- [ ] **Step 3: Implementation**

`apps/web/src/lib/zerog/contracts.ts`:

```ts
import { ethers } from "ethers";
import { GALILEO } from "@0run/shared";

const NFT_ABI = [
  "function mint((string dataDescription, bytes32 dataHash)[] iDatas, address to) payable returns (uint256)",
  "function intelligentDatasOf(uint256 tokenId) view returns ((string dataDescription, bytes32 dataHash)[])",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Minted(uint256 indexed tokenId, address indexed to)",
];
const REG_ABI = [
  "function update(uint256 tokenId, bytes32 memoryRoot, bytes32 profileRoot)",
  "function memoryOf(uint256) view returns (bytes32 memoryRoot, bytes32 profileRoot, uint32 runCount, uint64 updatedAt)",
];

function signer() {
  return new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl));
}
export const nft = () => new ethers.Contract(process.env.AGENT_NFT_ADDRESS!, NFT_ABI, signer());
export const registry = () => new ethers.Contract(process.env.COACH_REGISTRY_ADDRESS!, REG_ABI, signer());

export async function mintCoachOnChain(to: string, dataDescription: string, dataHash: string): Promise<{ tokenId: string; txHash: string }> {
  const tx = await nft().mint([{ dataDescription, dataHash }], to);
  const receipt = await tx.wait();
  const minted = receipt.logs.map((l: ethers.Log) => { try { return nft().interface.parseLog(l); } catch { return null; } })
    .find((p: any) => p?.name === "Minted");
  if (!minted) throw new Error("evento Minted non trovato");
  return { tokenId: minted.args.tokenId.toString(), txHash: receipt.hash };
}

export async function updateRegistry(tokenId: string, memoryRoot: string, profileRoot: string): Promise<string> {
  const tx = await registry().update(tokenId, memoryRoot, profileRoot);
  return (await tx.wait()).hash;
}
```

`apps/web/src/app/api/coach/mint/route.ts`:

```ts
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { z } from "zod";
import { PersonalitySchema, initialMemory, explorerTx } from "@0run/shared";
import { requireUser } from "@/lib/auth";
import { persistMemory } from "@/lib/coach/memory";
import { mintCoachOnChain, updateRegistry } from "@/lib/zerog/contracts";
import { db } from "@/db";
import { coaches } from "@/db/schema";
import { eq } from "drizzle-orm";

const Body = z.object({ name: z.string().min(1).max(40), personality: PersonalitySchema, userKeyHex: z.string().length(64) });

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const { name, personality, userKeyHex } = parsed.data;

    const existing = await db.select().from(coaches).where(eq(coaches.userId, user.userId));
    if (existing.length) return NextResponse.json({ error: "coach già mintato" }, { status: 409 });

    const { memory } = initialMemory(name, personality);
    const receipts = await persistMemory(memory, Buffer.from(userKeyHex, "hex"));
    if (!receipts.memory.ok || !receipts.profile.ok)
      return NextResponse.json({ error: "0G Storage non disponibile, riprova" }, { status: 502 });

    const dataDescription = `0g://storage/${receipts.memory.rootHash}`;
    const dataHash = ethers.keccak256(ethers.toUtf8Bytes(receipts.memory.rootHash));
    const { tokenId, txHash } = await mintCoachOnChain(user.wallet, dataDescription, dataHash);
    await updateRegistry(tokenId, ethers.zeroPadValue(receipts.memory.rootHash, 32), ethers.zeroPadValue(receipts.profile.rootHash, 32));

    await db.insert(coaches).values({
      userId: user.userId, tokenId, name, personality,
      memoryRoot: receipts.memory.rootHash, profileRoot: receipts.profile.rootHash, mintTx: txHash,
    }).returning();

    return NextResponse.json({ tokenId, mintTx: txHash, explorerUrl: explorerTx(txHash) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
```

`apps/web/src/lib/client/useUserKey.ts` (client, stessa HKDF via WebCrypto):

```ts
"use client";
import { useCallback, useRef } from "react";
import { useSignMessage } from "@privy-io/react-auth";
import { SIGN_MESSAGE } from "@/lib/crypto/keys";

export function useUserKey() {
  const cached = useRef<string | null>(null);
  const { signMessage } = useSignMessage();
  const getKeyHex = useCallback(async (): Promise<string> => {
    if (cached.current) return cached.current;
    const { signature } = await signMessage({ message: SIGN_MESSAGE });
    const ikm = Uint8Array.from((signature.replace(/^0x/, "").match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
    const keyMaterial = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("0run-v1"), info: new TextEncoder().encode("user-data-key") },
      keyMaterial, 256,
    );
    cached.current = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return cached.current;
  }, [signMessage]);
  return { getKeyHex };
}
```

`apps/web/src/app/mint/page.tsx` — pagina onboarding secondo design system: overline con linea decorativa (`h-px w-12 bg-navy` + label `text-xs uppercase tracking-[0.3em]`), headline Playfair `text-5xl md:text-7xl leading-[0.9]` con parola in `italic text-orange` ("Choose your *Coach*"), 3 `<Card>` di personalità in griglia asimmetrica (`md:grid-cols-3`, selezionata = `featured` con sfondo `bg-peach/40`), `<Input placeholder="name your coach" />`, `<Button variant="primary">Mint your coach</Button>`. Al submit: `getKeyHex()` → `POST /api/fund` → `POST /api/coach/mint` con Privy access token in `Authorization` → success screen con link chainscan (`Button variant="link"`). Stato di attesa: label uppercase "minting on 0g galileo…" con transizione ≥500ms.

- [ ] **Step 4: Run to verify pass** — `npx vitest run -w web src/app/api/coach/mint` → PASS (3 test). Verifica manuale: mint reale su Galileo dal browser, tx visibile su chainscan.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src && git commit -m "feat(web): coach mint flow — api, onchain mint, onboarding page"
```

---

### Task 14: Pipeline upload corsa (API + status + pagina)

**Files:**
- Create: `apps/web/src/app/api/runs/route.ts`, `apps/web/src/app/api/runs/[id]/route.ts`, `apps/web/src/lib/coach/pipeline.ts`, `apps/web/src/app/upload/page.tsx`
- Test: `apps/web/src/lib/coach/pipeline.test.ts`

**Interfaces:**
- Consumes: parser (Task 4), crypto (5), storage (7), inference (8), memoria (10), contratti (13: `updateRegistry`), db (6).
- **Emendamento SSOT (approvato 2026-07-25, vedi `docs/superpowers/specs/2026-07-25-storage-ssot-spec.md`):** `RunSummary` in `packages/shared/src/types.ts` si estende con `gpxRoot: string`, `gpxContentHash: string` (keccak256 del GPX in chiaro, per dedup applicativo) e `report: Report | null`. La memoria cifrata diventa così il manifest completo dell'utente: il DB è interamente ricostruibile da Storage + chain senza contratti, upload o tx aggiuntivi. La pipeline scrive questi campi quando aggiunge la corsa alla memoria.
- Produces: `POST /api/runs` (multipart: `gpx` file + `userKeyHex`) → `{ runId }` subito, elaborazione in background · `GET /api/runs/:id` → riga run con `steps` (per il polling della UI) · `processRun(runId, userId, gpxXml, userKey): Promise<void>` in `pipeline.ts` — aggiorna `runs.steps` step-by-step, mai throw non gestito (stato `error` con detail).

- [ ] **Step 1: Failing test pipeline (dipendenze mockate)**

`apps/web/src/lib/coach/pipeline.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const stepLog: Record<string, string> = {};
vi.mock("@/db", () => ({
  db: {
    update: () => ({ set: (v: any) => ({ where: () => { Object.assign(stepLog, v.steps ? { last: JSON.stringify(v.steps) } : {}, v.status ? { status: v.status } : {}); } }) }),
    select: () => ({ from: (t: any) => ({ where: () => (t === "coaches-sentinel" ? [] : [{
      tokenId: "1", memoryRoot: "0xm", profileRoot: "0xp", personality: "coach", name: "K", userId: 1, id: 1,
    }]) }) }),
  },
}));
vi.mock("../zerog/storage", () => ({
  uploadEncrypted: vi.fn(async () => ({ ok: true, rootHash: "0xnew", txHash: "0xt" })),
  downloadDecrypted: vi.fn(async () => ({ ok: true, data: Buffer.from(JSON.stringify(/* envelope cifrato mock: la pipeline usa decryptJson, qui bypassiamo */ {})) })),
}));
vi.mock("../crypto/aes", async (orig) => ({
  ...(await orig()) as object,
  decryptJson: vi.fn(() => ({ version: 1, coach: { name: "K", personality: "coach" }, privateLayer: { runs: [] } })),
}));
vi.mock("../zerog/contracts", () => ({ updateRegistry: vi.fn(async () => "0xreg") }));
vi.mock("../inference", () => ({
  completeJson: vi.fn(async () => ({ value: { headline: "H", analysis: "A", comparison: "C", advice: ["x"] }, meta: { verified: true, model: "glm-5.2", path: "direct", text: "" } })),
}));

const gpx = readFileSync(join(__dirname, "../gpx/fixtures/short-run.gpx"), "utf8");

describe("processRun", () => {
  it("completa tutti gli step e salva il report", async () => {
    const { processRun } = await import("./pipeline");
    await processRun(1, 1, gpx, Buffer.alloc(32));
    expect(stepLog.status).toBe("done");
  });
  it("GPX rotto → status error, mai throw", async () => {
    const { processRun } = await import("./pipeline");
    await expect(processRun(1, 1, "non gpx", Buffer.alloc(32))).resolves.toBeUndefined();
    expect(stepLog.status).toBe("error");
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run -w web src/lib/coach/pipeline` → FAIL.

- [ ] **Step 3: Implementation**

`apps/web/src/lib/coach/pipeline.ts`:

```ts
import { ethers } from "ethers";
import { CoachMemorySchema } from "@0run/shared";
import { db } from "@/db";
import { coaches, runs, type RunStep, type StepState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseGpx } from "../gpx/parse";
import { decryptJson } from "../crypto/aes";
import { downloadDecrypted, uploadEncrypted } from "../zerog/storage";
import { updateRegistry } from "../zerog/contracts";
import { completeJson } from "../inference";
import { appendRun, buildProfile, persistMemory } from "./memory";
import { buildReportMessages, ReportSchema } from "./prompts";

const ALL_STEPS: RunStep[] = ["encrypt", "store_gpx", "update_memory", "registry_tx", "inference"];
export const initialSteps = (): Record<RunStep, StepState> =>
  Object.fromEntries(ALL_STEPS.map((s) => [s, { status: "pending" }])) as Record<RunStep, StepState>;

export async function processRun(runId: number, userId: number, gpxXml: string, userKey: Buffer): Promise<void> {
  const steps = initialSteps();
  const mark = async (step: RunStep, state: StepState, extra: Partial<typeof runs.$inferInsert> = {}) => {
    steps[step] = state;
    await db.update(runs).set({ steps: { ...steps }, ...extra }).where(eq(runs.id, runId));
  };
  const fail = async (step: RunStep, detail: string) => {
    steps[step] = { status: "error", detail };
    await db.update(runs).set({ steps: { ...steps }, status: "error" }).where(eq(runs.id, runId));
  };

  try {
    // 1. parse + "encrypt" (la cifratura avviene dentro uploadEncrypted; lo step la rappresenta in UI)
    const { stats, polyline } = parseGpx(gpxXml);
    await mark("encrypt", { status: "done" }, { stats, polyline });

    // 2. GPX cifrato su storage
    const gpxReceipt = await uploadEncrypted(new TextEncoder().encode(gpxXml), userKey);
    if (!gpxReceipt.ok) return fail("store_gpx", gpxReceipt.error);
    await mark("store_gpx", { status: "done", detail: gpxReceipt.rootHash }, { gpxRoot: gpxReceipt.rootHash });

    // 3. memoria: scarica → decifra → append → ri-persisti
    const [coach] = await db.select().from(coaches).where(eq(coaches.userId, userId));
    if (!coach) return fail("update_memory", "coach non trovato");
    const memDl = await downloadDecrypted(coach.memoryRoot, userKey, (buf) => {
      try { JSON.parse(buf.toString("utf8")); return true; } catch { return false; }
    });
    if (!memDl.ok) return fail("update_memory", memDl.error);
    const memory = decryptJson(memDl.data.toString("utf8"), userKey, CoachMemorySchema);
    const updated = appendRun(memory, { ...stats, reportHeadline: "" });
    const receipts = await persistMemory(updated, userKey);
    if (!receipts.memory.ok || !receipts.profile.ok) return fail("update_memory", "persist fallita");
    await db.update(coaches).set({ memoryRoot: receipts.memory.rootHash, profileRoot: receipts.profile.rootHash }).where(eq(coaches.id, coach.id));
    await mark("update_memory", { status: "done", detail: receipts.memory.rootHash });

    // 4. hash on-chain
    const regTx = await updateRegistry(
      coach.tokenId,
      ethers.zeroPadValue(receipts.memory.rootHash, 32),
      ethers.zeroPadValue(receipts.profile.rootHash, 32),
    ).catch((e) => { throw Object.assign(e, { step: "registry_tx" }); });
    await mark("registry_tx", { status: "done", detail: regTx }, { registryTx: regTx });

    // 5. inferenza
    const profile = buildProfile(updated);
    const { value: report, meta } = await completeJson(ReportSchema, buildReportMessages(profile, memory.privateLayer.runs, stats));
    await mark("inference", { status: "done" }, {
      report, model: meta.model,
      verifiedTee: meta.verified === null ? "unavailable" : String(meta.verified),
      status: "done",
    });
  } catch (e: any) {
    await fail((e.step as RunStep) ?? "inference", String(e.message ?? e));
  }
}
```

`apps/web/src/app/api/runs/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { runs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { initialSteps, processRun } from "@/lib/coach/pipeline";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const form = await req.formData();
    const gpx = form.get("gpx"), keyHex = form.get("userKeyHex");
    if (!(gpx instanceof File) || typeof keyHex !== "string" || keyHex.length !== 64)
      return NextResponse.json({ error: "gpx file e userKeyHex richiesti" }, { status: 400 });
    const xml = await gpx.text();
    const [run] = await db.insert(runs).values({ userId: user.userId, status: "processing", steps: initialSteps() }).returning();
    void processRun(run.id, user.userId, xml, Buffer.from(keyHex, "hex")); // fire-and-forget; stato via polling
    return NextResponse.json({ runId: run.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
```

`apps/web/src/app/api/runs/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { runs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { and, eq } from "drizzle-orm";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const [run] = await db.select().from(runs).where(and(eq(runs.id, Number(id)), eq(runs.userId, user.userId)));
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
```

`apps/web/src/app/upload/page.tsx` — dropzone editoriale (bordo `border border-navy`, label Playfair italic), al submit POST multipart e redirect su `/runs/[id]`; lì la **pipeline a stati** (Task 15) fa da progress. Polling `GET /api/runs/:id` ogni 2.5s finché `status !== "processing"`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run -w web src/lib/coach/pipeline` → PASS (2 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src && git commit -m "feat(web): run upload pipeline with stepwise onchain status"
```

---

### Task 15: Pagina run — pipeline visiva, mappa, report, TEE badge + chat

**Files:**
- Create: `apps/web/src/app/runs/[id]/page.tsx`, `apps/web/src/components/run/pipeline-steps.tsx`, `apps/web/src/components/run/run-map.tsx`, `apps/web/src/components/run/report-view.tsx`, `apps/web/src/components/run/chat.tsx`, `apps/web/src/app/api/coach/chat/route.ts`
- Test: `apps/web/src/components/run/report-view.test.tsx`

**Interfaces:**
- Consumes: `GET /api/runs/:id` (Task 14), `buildChatMessages` (Task 10), `coachComplete` (Task 8), `explorerTx`/`storageExplorerRoot` (shared).
- Produces: `POST /api/coach/chat` body `{ message: string; userKeyHex: string }` → `{ reply: string }` (storico in `chatMessages`) · componenti run riusabili dal Piano B/C.

- [ ] **Step 1: Failing test ReportView**

`apps/web/src/components/run/report-view.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportView } from "./report-view";

const report = { headline: "Progressi veri", analysis: "Analisi lunga del passo.", comparison: "12s/km meglio di martedì", advice: ["Recupera 48h"] };

describe("ReportView", () => {
  it("mostra headline serif, drop cap sull'analysis, badge TEE verified con link", () => {
    render(<ReportView report={report} verifiedTee="true" model="glm-5.2" registryTx="0xreg" gpxRoot="0xroot" />);
    expect(screen.getByText("Progressi veri").className).toContain("font-serif");
    expect(screen.getByTestId("drop-cap-paragraph").className).toContain("first-letter:float-left");
    expect(screen.getByText(/tee verified/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /memory tx/i }).getAttribute("href")).toContain("chainscan-galileo.0g.ai/tx/0xreg");
  });
  it("verifiedTee unavailable → badge neutro, nessun claim falso", () => {
    render(<ReportView report={report} verifiedTee="unavailable" model="glm-5.2" registryTx="0xreg" gpxRoot="0xroot" />);
    expect(screen.queryByText(/tee verified/i)).toBeNull();
    expect(screen.getByText(/attestation not available/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run -w web src/components/run` → FAIL.

- [ ] **Step 3: Implementation**

```bash
npm i -w web leaflet react-leaflet && npm i -w web -D @types/leaflet
```

`apps/web/src/components/run/report-view.tsx`:

```tsx
import { explorerTx, storageExplorerRoot } from "@0run/shared";

type Report = { headline: string; analysis: string; comparison: string; advice: string[] };

export function ReportView({ report, verifiedTee, model, registryTx, gpxRoot }: {
  report: Report; verifiedTee: string | null; model: string | null; registryTx: string | null; gpxRoot: string | null;
}) {
  return (
    <article className="max-w-xl">
      <div className="mb-6 flex items-center gap-4">
        <span aria-hidden className="h-px w-12 bg-navy" />
        <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Coach report</span>
      </div>
      <h1 className="font-serif text-5xl leading-[0.9] text-navy md:text-7xl">{report.headline}</h1>
      <p data-testid="drop-cap-paragraph"
         className="mt-10 font-sans text-lg leading-relaxed text-navy first-letter:float-left first-letter:mr-3 first-letter:font-serif first-letter:text-7xl first-letter:leading-[0.8]">
        {report.analysis}
      </p>
      <p className="mt-6 border-l border-orange pl-6 font-serif text-2xl italic text-navy">{report.comparison}</p>
      <ul className="mt-10 space-y-4">
        {report.advice.map((a, i) => (
          <li key={i} className="flex gap-4 font-sans text-base leading-relaxed text-navy">
            <span className="font-serif italic text-orange">{String(i + 1).padStart(2, "0")}</span>{a}
          </li>
        ))}
      </ul>
      <div className="mt-12 flex flex-wrap items-center gap-6 border-t border-navy/15 pt-6 font-sans text-[10px] uppercase tracking-[0.25em]">
        {verifiedTee === "true"
          ? <span className="text-orange">● TEE verified · {model}</span>
          : <span className="text-ocean">attestation not available · {model}</span>}
        {registryTx && <a className="text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline" href={explorerTx(registryTx)} target="_blank">memory tx ↗</a>}
        {gpxRoot && <a className="text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline" href={storageExplorerRoot(gpxRoot)} target="_blank">encrypted gpx ↗</a>}
      </div>
    </article>
  );
}
```

`apps/web/src/components/run/pipeline-steps.tsx` — lista verticale delle 5 fasi da `runs.steps`: label uppercase `tracking-[0.3em]`, linea decorativa `h-px w-8 bg-navy/20`, stato done = pallino orange con transizione 700ms, error = testo ocean con detail, pending = pulsazione lenta. `apps/web/src/components/run/run-map.tsx` — `dynamic(() => …, { ssr: false })`, `MapContainer` + `TileLayer` OSM + `Polyline positions={polyline}` color `#004E89` weight 3; wrapper `group relative aspect-[4/5] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.12)]` con `grayscale transition-[filter] duration-[1500ms] group-hover:grayscale-0` e label verticale `writing-mode: vertical-rl` "0run / route". `apps/web/src/components/run/chat.tsx` — thread minimale: messaggi user allineati destra in `bg-peach/40 p-4`, coach in `border-l border-navy pl-6 font-serif`, input underline + `<Button variant="secondary">Ask</Button>`.

`apps/web/src/app/api/coach/chat/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { CoachMemorySchema } from "@0run/shared";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { chatMessages, coaches } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptJson } from "@/lib/crypto/aes";
import { downloadDecrypted } from "@/lib/zerog/storage";
import { buildProfile } from "@/lib/coach/memory";
import { buildChatMessages } from "@/lib/coach/prompts";
import { coachComplete } from "@/lib/inference";

const Body = z.object({ message: z.string().min(1).max(2000), userKeyHex: z.string().length(64) });

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const [coach] = await db.select().from(coaches).where(eq(coaches.userId, user.userId));
    if (!coach) return NextResponse.json({ error: "minta prima il coach" }, { status: 409 });

    const key = Buffer.from(parsed.data.userKeyHex, "hex");
    const dl = await downloadDecrypted(coach.memoryRoot, key, (b) => { try { JSON.parse(b.toString()); return true; } catch { return false; } });
    if (!dl.ok) return NextResponse.json({ error: dl.error }, { status: 502 });
    const memory = decryptJson(dl.data.toString("utf8"), key, CoachMemorySchema);

    const history = (await db.select().from(chatMessages).where(eq(chatMessages.userId, user.userId)))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const msgs = buildChatMessages(buildProfile(memory), memory.privateLayer.runs, [...history, { role: "user", content: parsed.data.message }]);
    const { text } = await coachComplete(msgs);

    await db.insert(chatMessages).values([
      { userId: user.userId, role: "user", content: parsed.data.message },
      { userId: user.userId, role: "assistant", content: text },
    ]);
    return NextResponse.json({ reply: text });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
```

`apps/web/src/app/runs/[id]/page.tsx` — layout asimmetrico 12 colonne: mappa `md:col-span-5 md:col-start-1`, report `md:col-span-6 md:col-start-7` (7/5 spezzato, mai 50/50); sopra, `<PipelineSteps>` finché `status === "processing"`; sotto il report, `<Chat>`. `apps/web/src/app/dashboard/page.tsx` — dashboard autenticata: lista corse come `<Card>` con overline data + stats, card del coach, CTA upload. (La route `/` pubblica è il Task 17.)

- [ ] **Step 4: Run to verify pass** — `npx vitest run -w web src/components/run` → PASS (2 test). Verifica manuale end-to-end su Galileo reale: upload GPX vero → 5 step verdi → report con confronto → chat risponde in personalità.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src && git commit -m "feat(web): run page — editorial pipeline, map, report with TEE badge, chat"
```

---

### Task 16: Seed demo, smoke E2E, README

**Files:**
- Create: `scripts/seed-demo.ts`, `scripts/smoke-core.sh`, fixtures `scripts/fixtures/run-{1..4}.gpx`
- Modify: `README.md`

**Interfaces:**
- Consumes: tutto il ciclo core.
- Produces: account demo con 4 corse reali elaborate (lo storico che il report cita in demo); smoke test riproducibile.

- [ ] **Step 1: Fixtures + seed**

Le 4 fixture: corse Lisbona realistiche (5-10km, ritmi 280-330 sec/km, progressione visibile) — generarle con lo stesso formato della fixture Task 4, 40-80 trackpoint l'una, date distanziate di 2-3 giorni. `scripts/seed-demo.ts`:

```ts
/** Esegue la pipeline REALE (storage+chain+inference) per l'utente demo. Niente mock: i giudici vedono dati veri. */
import { readFileSync } from "node:fs";
import { db } from "../apps/web/src/db";
import { users, runs } from "../apps/web/src/db/schema";
import { eq } from "drizzle-orm";
import { initialSteps, processRun } from "../apps/web/src/lib/coach/pipeline";
import { deriveUserKey } from "../apps/web/src/lib/crypto/keys";

const DEMO_SIG = process.env.DEMO_USER_SIGNATURE!; // firma di SIGN_MESSAGE fatta una volta dal wallet demo, in .env
const demoKey = deriveUserKey(DEMO_SIG);

const [demo] = await db.select().from(users).where(eq(users.privyDid, process.env.DEMO_PRIVY_DID!));
if (!demo) throw new Error("fai prima login+mint con l'account demo dal browser");
for (const f of ["run-1", "run-2", "run-3", "run-4"]) {
  const xml = readFileSync(`scripts/fixtures/${f}.gpx`, "utf8");
  const [run] = await db.insert(runs).values({ userId: demo.id, status: "processing", steps: initialSteps() }).returning();
  await processRun(run.id, demo.id, xml, demoKey);
  console.log(f, "→ run", run.id);
}
```

Run: `npx tsx scripts/seed-demo.ts` — atteso: 4 run `done` con report. (Richiede: login+mint demo già fatti dal browser, `DEMO_USER_SIGNATURE` e `DEMO_PRIVY_DID` in `.env`.)

- [ ] **Step 2: Smoke E2E**

`scripts/smoke-core.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:3000}
TOKEN=${PRIVY_TEST_TOKEN:?export PRIVY_TEST_TOKEN=<access token da browser devtools>}
KEY=${DEMO_KEY_HEX:?export DEMO_KEY_HEX=<64 hex>}

echo "1. fund";   curl -sf -X POST "$BASE/api/fund" -H "authorization: Bearer $TOKEN" | tee /dev/stderr | grep -q funded
echo "2. upload"; RUN_ID=$(curl -sf -X POST "$BASE/api/runs" -H "authorization: Bearer $TOKEN" -F gpx=@scripts/fixtures/run-1.gpx -F userKeyHex="$KEY" | python3 -c "import sys,json;print(json.load(sys.stdin)['runId'])")
echo "3. poll run $RUN_ID"
for i in $(seq 1 60); do
  STATUS=$(curl -sf "$BASE/api/runs/$RUN_ID" -H "authorization: Bearer $TOKEN" | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])")
  [ "$STATUS" = "done" ] && break; [ "$STATUS" = "error" ] && { echo "PIPELINE ERROR"; exit 1; }; sleep 5
done
[ "$STATUS" = "done" ] || { echo "timeout"; exit 1; }
echo "4. chat";   curl -sf -X POST "$BASE/api/coach/chat" -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d "{\"message\":\"Come sto andando?\",\"userKeyHex\":\"$KEY\"}" | grep -q reply
echo "SMOKE OK"
```

Run: `chmod +x scripts/smoke-core.sh && ./scripts/smoke-core.sh` — atteso: `SMOKE OK`.

- [ ] **Step 3: README con setup completo**

`README.md`: cos'è 0run (2 righe) · prerequisiti (Node 22, Docker, wallet fondato, API key router) · setup (`cp .env.example .env` + compilazione variabili, `docker compose up -d db`, `npm install`, `npx drizzle-kit push`, deploy contratti, `npm run dev`) · comandi test · diagramma mermaid del ciclo core (client → API → Storage/Chain/Compute) · struttura repo. Il formato `usages/*.md` per la submission arriva nel Piano C.

- [ ] **Step 4: Verify** — un collega (o un container pulito) segue il README da zero e arriva a `SMOKE OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts README.md && git commit -m "feat: demo seed, core smoke test, README setup"
```

---

### Task 17: Sito pubblico (landing page)

**Files:**
- Create: `apps/web/src/app/page.tsx` (landing pubblica), `apps/web/src/components/landing/hero.tsx`, `apps/web/src/components/landing/manifesto.tsx`, `apps/web/src/components/landing/how-it-works.tsx`, `apps/web/src/components/landing/stack-section.tsx`, `apps/web/src/components/landing/site-footer.tsx`
- Test: `apps/web/src/components/landing/landing.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Card`, `PageChrome` (Task 12); Privy `useLogin` (Task 11).
- Produces: `/` pubblica (nessuna auth richiesta) che presenta il prodotto e porta al login; dopo il login redirect a `/dashboard`. È la vetrina public-facing del prodotto E del design system: i giudici la vedono prima di ogni altra cosa.

- [ ] **Step 1: Failing render test**

`apps/web/src/components/landing/landing.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ authenticated: false }), useLogin: () => ({ login: vi.fn() }) }));
import { Hero } from "./hero";
import { HowItWorks } from "./how-it-works";

describe("landing", () => {
  it("hero: headline serif con parola italic orange, overline con linea decorativa, CTA", () => {
    render(<Hero />);
    const em = screen.getByText("Coach.");
    expect(em.className).toContain("italic");
    expect(em.className).toContain("text-orange");
    expect(screen.getByTestId("hero-overline-line").className).toContain("h-px");
    expect(screen.getByRole("button", { name: /start running/i })).toBeTruthy();
  });
  it("how-it-works: 3 step numerati con serif italic", () => {
    render(<HowItWorks />);
    expect(screen.getByText("01")).toBeTruthy();
    expect(screen.getByText("02")).toBeTruthy();
    expect(screen.getByText("03")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run -w web src/components/landing` → FAIL.

- [ ] **Step 3: Implementation**

`apps/web/src/components/landing/hero.tsx`:

```tsx
"use client";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function Hero() {
  const { authenticated } = usePrivy();
  const router = useRouter();
  const { login } = useLogin({ onComplete: () => router.push("/dashboard") });
  return (
    <section className="relative mx-auto grid min-h-[88vh] max-w-[1600px] grid-cols-12 items-end px-8 pb-24 pt-32 md:px-16">
      <span aria-hidden className="absolute right-8 top-32 hidden font-sans text-[10px] uppercase tracking-[0.3em] text-ocean lg:block" style={{ writingMode: "vertical-rl" }}>
        0run / Vol. 01 — Lisboa
      </span>
      <div className="col-span-12 md:col-span-9 md:col-start-2">
        <div className="mb-8 flex items-center gap-4">
          <span data-testid="hero-overline-line" aria-hidden className="h-px w-12 bg-navy" />
          <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">The AI running coach you own</span>
        </div>
        <h1 className="font-serif text-6xl leading-[0.9] text-navy md:text-9xl">
          Own your<br /><em className="italic text-orange">Coach.</em><br />Own your runs.
        </h1>
        <p className="mt-10 max-w-md font-sans text-lg leading-relaxed text-navy">
          Your runs, encrypted on decentralized storage. Your coach, an intelligent NFT whose memory grows with every kilometre. Private by design, verifiable by default.
        </p>
        <div className="mt-12 flex flex-wrap gap-6">
          <Button variant="primary" onClick={() => (authenticated ? router.push("/dashboard") : login())}>Start running</Button>
          <Button variant="link" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>How it works</Button>
        </div>
      </div>
    </section>
  );
}
```

`apps/web/src/components/landing/manifesto.tsx` — sezione `border-t border-navy/15 py-24 md:py-32`, griglia 12 con testo `md:col-span-6 md:col-start-6`: paragrafo con drop cap (`first-letter:` come ReportView) che racconta il problema (Strava possiede i tuoi dati) e la tesi (ownership). `apps/web/src/components/landing/how-it-works.tsx`:

```tsx
const STEPS = [
  { n: "01", title: "Upload your run", body: "Drop a GPX. It is encrypted client-side and stored on 0G decentralized storage — only your wallet can unlock it." },
  { n: "02", title: "Meet your coach", body: "An AI coach minted as an intelligent NFT. Analysis runs in a trusted execution environment: nobody reads your data. Not even us." },
  { n: "03", title: "Watch it grow", body: "Every run feeds its encrypted memory, hashed on-chain. Switch apps, keep the coach. One day, lend it." },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-t border-navy/15">
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-12 px-8 py-24 md:grid-cols-3 md:px-16 md:py-32">
        {STEPS.map((s) => (
          <div key={s.n} className="border-t border-navy p-8 transition-colors duration-700 hover:bg-peach/20 md:p-12">
            <span className="font-serif text-2xl italic text-orange">{s.n}</span>
            <h3 className="mt-6 font-serif text-3xl text-navy">{s.title}</h3>
            <p className="mt-4 font-sans text-base leading-relaxed text-navy">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

`apps/web/src/components/landing/stack-section.tsx` — sezione scura invertita (`bg-navy text-cream py-24 md:py-32`): overline "Built on 0G", headline con italic in orange ("Verifiable *by default*"), 4 voci (Storage / Compute TEE / Agentic ID / Chain) come colonne con `border-t border-cream/20` e testo muted `text-peach/80`. `apps/web/src/components/landing/site-footer.tsx` — footer `border-t border-navy`: wordmark serif "0run", micro-text `text-[10px] tracking-[0.25em] uppercase` con link (GitHub, ETHGlobal Lisbon 2026), linea decorativa. `apps/web/src/app/page.tsx`:

```tsx
import { Hero } from "@/components/landing/hero";
import { Manifesto } from "@/components/landing/manifesto";
import { HowItWorks } from "@/components/landing/how-it-works";
import { StackSection } from "@/components/landing/stack-section";
import { SiteFooter } from "@/components/landing/site-footer";

export default function Home() {
  return (
    <main>
      <Hero />
      <Manifesto />
      <HowItWorks />
      <StackSection />
      <SiteFooter />
    </main>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run -w web src/components/landing` → PASS (2 test). Verifica visiva: `/` senza login mostra la landing completa; "Start running" apre il login Privy e atterra su `/dashboard`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src && git commit -m "feat(web): public landing page — editorial hero, manifesto, how-it-works, 0G stack"
```

---

## Self-Review (eseguita)

1. **Spec coverage (Piano A):** sito pubblico ✓ (T17) · login/frizione ✓ (T11) · mint+personalità ✓ (T3, T13) · upload+pipeline stati ✓ (T14) · report che cita storico ✓ (T10 prompt, T15) · chat ✓ (T15) · memoria 2 strati+chiavi ✓ (T5, T10) · storage cifrato+receipt ✓ (T7) · inferenza dual-path+TEE ✓ (T8) · contratti+deploy ✓ (T9) · design system ✓ (T12, applicato in T13-15, 17) · spike ✓ (T2) · seed+smoke ✓ (T16). Eventi/World/ENS/ERC-8004/letting/deploy Hetzner = Piani B e C, come da decomposizione.
2. **Placeholder scan:** nessun TBD/TODO; le pagine descritte senza codice completo (mint/upload/dashboard) specificano classi, layout e comportamento esatti dal design system — accettato perché il markup è vincolato dai componenti di T12 e dai test.
3. **Type consistency:** `StorageReceipt`/`uploadEncrypted`/`downloadDecrypted` coerenti T7↔T10↔T14 · `ChatMsg`/`CoachCompletion` T8↔T10↔T15 · `RunStep`/`StepState` T6↔T14↔T15 · firme contratti T9↔T13 (`mint((string,bytes32)[],address)`, `update(uint256,bytes32,bytes32)`) · `SIGN_MESSAGE`/HKDF identici server (T5) e client (T13: stesso salt `0run-v1`, info `user-data-key`, SHA-256, 32B).

# AgentKit Human-Backing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-app AgentBook registration (phone + World App, no CLI) and human-backing enforcement on the A2A consult endpoint: 403 for agents with no unique human behind them, 20-consults/day quota per `humanId`, "unique human ✓" badge in the chat consult block.

**Architecture:** Phase A adds a nonce read to `lib/world/agentbook.ts`, two Privy-authenticated routes (`status`, `register` proxying World's gasless relay), and a client widget that runs the World ID bridge with AgentBook's own `app_id`/`action`/`signal`. Phase B adds `checkA2aAdmission` to `lib/world/gate.ts` (lookup + per-human atomic quota via the SDK's `AgentKitStorage` interface implemented over Postgres), wires it into the a2a route between signature verification and inference, and threads `humanBacked` through `consultCoach` → chat → UI badge → agent card.

**Tech Stack:** Next.js 16 App Router, viem, `@worldcoin/idkit-core@2.1.0` (bridge — the exact version agentkit-cli uses), `@worldcoin/agentkit` 0.2.0 (types), `react-qr-code`, drizzle-orm/Postgres, vitest, zod.

Spec: `docs/superpowers/specs/2026-07-25-agentkit-human-backing-design.md` (APPROVED).

## Global Constraints

- **Next.js 16.2.11 differs from training data** (`apps/web/AGENTS.md`): follow existing route-handler patterns exactly (`params: Promise<{...}>` awaited); consult `node_modules/next/dist/docs/` before deviating.
- API error strings in Italian; chat/page UI copy in English (commit `9d4bdbb` moved all UI copy to English); code comments in the repo's existing mixed style.
- AgentBook lives on **World Chain (eip155:480)**; ENS on Sepolia; coach chain is 0G Galileo. Never mix them.
- `lookupHumanId` semantics are law: `error` set = **unknown**, never "not registered". Enforced gates answer unknown with 503, never 403 (`gate.ts` policy).
- Do NOT use `createAgentBookVerifier` from the SDK — `lib/world/agentbook.ts`'s header comment documents why (error-conflation + hardcoded chain). Only the `AgentKitStorage` **type** is imported from `@worldcoin/agentkit`.
- AgentBook protocol constants (verified from `@worldcoin/agentkit-cli@0.2.0` source): contract `0xA23aB2712eA7BBa896930544C7d6636a96b944dA`, `app_id: "app_a7c3e2b6b83927251a0db5345bd7146a"`, `action: "agentbook-registration"`, `signal = solidityEncode(['address','uint256'], [wallet, nonce])`, relay `POST https://x402-worldchain.vercel.app/register` with `{ agent, root, nonce, nullifierHash, proof: string[8], contract }`.
- Quota default **20/day per humanId**; env `A2A_DAILY_QUOTA_PER_HUMAN`. Enforcement flag `REQUIRE_HUMAN_BACKED_A2A` (opt-in, like `REQUIRE_HUMAN_BACKED_MINT`).
- Best-effort discipline: a failed consult never breaks the chat; a failed registration never breaks the mint page; expected failures return `{ error }` JSON with an honest status, never throw.
- Tests: vitest, colocated. Run from `apps/web/`: `npx vitest run <path>`. Full check: `npx tsc --noEmit && npx vitest run`.
- If `node_modules` is missing in this worktree, run `npm install` at the repo root once before starting.

---

### Task 1: `getAgentNonce` + `agentBookAddress` in `lib/world/agentbook.ts`

**Files:**
- Modify: `apps/web/src/lib/world/agentbook.ts`
- Test: `apps/web/src/lib/world/agentbook.test.ts` (append a describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 2, 5, 6, 9):
  - `getAgentNonce(address: string): Promise<{ nonce: string } | { error: string }>` — nonce as decimal string, never throws.
  - `agentBookAddress(): string` — checksummed contract address (env override or canonical default).
  - `Reader` type gains optional `getNextNonce?(address): Promise<string>` (optional so existing test fakes keep typechecking).

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/world/agentbook.test.ts` (add `getAgentNonce, agentBookAddress` to the existing import from `./agentbook`):

```ts
describe("getAgentNonce", () => {
  it("nonce dal contratto come stringa decimale", async () => {
    _setAgentBookForTest({ lookupHuman: async () => null, getNextNonce: async () => "3" });
    expect(await getAgentNonce("0x" + "ab".repeat(20))).toEqual({ nonce: "3" });
  });

  it("indirizzo non valido → error, mai un throw", async () => {
    _setAgentBookForTest({ lookupHuman: async () => null, getNextNonce: async () => "0" });
    const res = await getAgentNonce("not-an-address");
    expect("error" in res && res.error.length > 0).toBe(true);
  });

  it("lettura che fallisce → error, mai un throw", async () => {
    _setAgentBookForTest({
      lookupHuman: async () => null,
      getNextNonce: async () => {
        throw new Error("rpc down");
      },
    });
    expect(await getAgentNonce("0x" + "ab".repeat(20))).toEqual({ error: "rpc down" });
  });
});

describe("agentBookAddress", () => {
  it("default canonico quando l'env non è impostata", () => {
    expect(agentBookAddress()).toBe("0xA23aB2712eA7BBa896930544C7d6636a96b944dA");
  });
});
```

Note: if the existing file's `beforeEach`/`afterEach` reset env vars, make sure `WORLD_AGENTBOOK_ADDRESS` is unset for the `agentBookAddress` test (use `vi.stubEnv("WORLD_AGENTBOOK_ADDRESS", "")` is wrong — an empty string is falsy for `??` only if undefined; use `delete process.env.WORLD_AGENTBOOK_ADDRESS` in the test body if needed).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/world/agentbook.test.ts`
Expected: existing tests PASS, new ones FAIL (`getAgentNonce` not exported).

- [ ] **Step 3: Implement**

In `apps/web/src/lib/world/agentbook.ts`:

1. Add `getNextNonce` to the ABI (after the `lookupHuman` entry):

```ts
  {
    type: "function",
    name: "getNextNonce",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
```

2. Extend the `Reader` type (optional, so existing fakes still typecheck):

```ts
type Reader = {
  lookupHuman(address: `0x${string}`): Promise<string | null>;
  getNextNonce?(address: `0x${string}`): Promise<string>;
};
```

3. Add the exported address helper and use it inside `realReader()` (replace the inline `getAddress(process.env.WORLD_AGENTBOOK_ADDRESS ?? DEFAULT_AGENTBOOK_ADDRESS)` with `agentBookAddress()` cast to `` `0x${string}` ``):

```ts
/** Checksummed AgentBook address: env override or the canonical World Chain deploy. */
export function agentBookAddress(): string {
  return getAddress(process.env.WORLD_AGENTBOOK_ADDRESS ?? DEFAULT_AGENTBOOK_ADDRESS);
}
```

4. Implement `getNextNonce` in `realReader()`'s returned object:

```ts
    async getNextNonce(agent) {
      const nonce = await client.readContract({
        address,
        abi: AGENTBOOK_ABI,
        functionName: "getNextNonce",
        args: [agent],
      });
      return nonce.toString();
    },
```

5. Add the exported function (after `lookupHumanId`):

```ts
export type NonceLookup = { nonce: string } | { error: string };

/**
 * Next registration nonce for a wallet — part of the World ID signal the
 * person approves in World App (solidityEncode of [address, nonce]), so it is
 * read fresh per attempt and NEVER cached: a stale nonce makes the relay
 * reject the whole proof. Same never-throws + timeout discipline as
 * lookupHumanId above.
 */
export async function getAgentNonce(address: string): Promise<NonceLookup> {
  let agent: `0x${string}`;
  try {
    agent = getAddress(address);
  } catch {
    return { error: `indirizzo non valido: ${address}` };
  }
  const r = (reader ??= realReader());
  if (!r.getNextNonce) return { error: "nonce reader non disponibile" };
  try {
    const nonce = await withTimeout(r.getNextNonce(agent), LOOKUP_TIMEOUT_MS, "agentbook nonce timeout");
    return { nonce };
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : String(e);
    return { error: message || "agentbook nonce lookup failed" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/world/agentbook.test.ts`
Expected: PASS (all existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/world/agentbook.ts apps/web/src/lib/world/agentbook.test.ts
git commit -m "feat(web): read the AgentBook registration nonce beside the human lookup"
```

---

### Task 2: Registration API — `status` + `register` routes

**Files:**
- Create: `apps/web/src/app/api/world/agentbook/status/route.ts`
- Create: `apps/web/src/app/api/world/agentbook/register/route.ts`
- Test: `apps/web/src/app/api/world/agentbook/status/status.test.ts`
- Test: `apps/web/src/app/api/world/agentbook/register/register.test.ts`
- Modify: `.env.example` (repo root)

**Interfaces:**
- Consumes: `lookupHumanId`, `getAgentNonce`, `agentBookAddress`, `_setAgentBookForTest` (Task 1); `requireUser` (`@/lib/auth`, returns `{ userId, wallet, privyDid }`).
- Produces (used by Task 3's widget):
  - `GET /api/world/agentbook/status` (Bearer Privy token) → 200 `{ registered: true, humanId }` | 200 `{ registered: false, humanId: null, nonce, wallet }` | 503 `{ error, detail }`.
  - `POST /api/world/agentbook/register` (Bearer) body `{ root, nonce, nullifierHash, proof: string[8] }` → 200 `{ txHash }` | 400 | 502 `{ error, relayStatus? }`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/app/api/world/agentbook/status/status.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _setAgentBookForTest } from "@/lib/world/agentbook";

const WALLET = "0x" + "ab".repeat(20);
const requireUserMock = vi.fn(async () => ({ userId: 1, wallet: WALLET, privyDid: "did:privy:x" }));
vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));

const req = () => new Request("http://x/api/world/agentbook/status");

describe("GET /api/world/agentbook/status", () => {
  beforeEach(() => requireUserMock.mockClear());

  it("wallet registrato → registered:true con humanId, nessun nonce", async () => {
    _setAgentBookForTest({ lookupHuman: async () => "0x1234", getNextNonce: async () => "9" });
    const { GET } = await import("./route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ registered: true, humanId: "0x1234" });
  });

  it("wallet non registrato → registered:false con nonce fresco e wallet", async () => {
    _setAgentBookForTest({ lookupHuman: async () => null, getNextNonce: async () => "3" });
    const { GET } = await import("./route");
    const body = await (await GET(req())).json();
    expect(body).toEqual({ registered: false, humanId: null, nonce: "3", wallet: WALLET });
  });

  it("lookup non disponibile → 503, mai spacciato per non-registrato", async () => {
    _setAgentBookForTest({
      lookupHuman: async () => {
        throw new Error("rpc down");
      },
      getNextNonce: async () => "3",
    });
    const { GET } = await import("./route");
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it("senza sessione → status dell'errore di requireUser", async () => {
    requireUserMock.mockRejectedValueOnce(Object.assign(new Error("missing token"), { status: 401 }));
    const { GET } = await import("./route");
    expect((await GET(req())).status).toBe(401);
  });
});
```

`apps/web/src/app/api/world/agentbook/register/register.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const WALLET = "0x" + "ab".repeat(20);
const requireUserMock = vi.fn(async () => ({ userId: 1, wallet: WALLET, privyDid: "did:privy:x" }));
vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const PROOF = Array.from({ length: 8 }, (_, i) => "0x" + String(i + 1).padStart(64, "0"));
const goodBody = { root: "0xr00t", nonce: "3", nullifierHash: "0xn", proof: PROOF };
const req = (body: unknown) =>
  new Request("http://x/api/world/agentbook/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/world/agentbook/register", () => {
  beforeEach(() => {
    requireUserMock.mockClear();
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ txHash: "0xtx" }), { status: 200 }));
    delete process.env.AGENTBOOK_RELAY_URL;
  });

  it("inoltra al relay agent = wallet di sessione (mai dal body) + contract, e restituisce txHash", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ ...goodBody, agent: "0x" + "66".repeat(20) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ txHash: "0xtx" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x402-worldchain.vercel.app/register");
    const sent = JSON.parse(init.body);
    expect(sent.agent).toBe(WALLET); // il campo `agent` del body è IGNORATO
    expect(sent).toMatchObject({ root: "0xr00t", nonce: "3", nullifierHash: "0xn", proof: PROOF });
    expect(sent.contract).toBe("0xA23aB2712eA7BBa896930544C7d6636a96b944dA");
  });

  it("AGENTBOOK_RELAY_URL sovrascrive il relay di default", async () => {
    process.env.AGENTBOOK_RELAY_URL = "https://relay.example/";
    const { POST } = await import("./route");
    await POST(req(goodBody));
    expect(fetchMock.mock.calls[0][0]).toBe("https://relay.example/register");
  });

  it("proof non di 8 elementi → 400, relay mai chiamato", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ ...goodBody, proof: PROOF.slice(0, 7) }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relay 4xx → 502 con l'errore del relay nel body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid proof" }), { status: 400 }));
    const { POST } = await import("./route");
    const res = await POST(req(goodBody));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("invalid proof");
  });

  it("relay irraggiungibile → 502, mai un throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const { POST } = await import("./route");
    expect((await POST(req(goodBody))).status).toBe(502);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/world/agentbook`
Expected: FAIL — `./route` does not exist (both files).

- [ ] **Step 3: Write the status route**

`apps/web/src/app/api/world/agentbook/status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAgentNonce, lookupHumanId } from "@/lib/world/agentbook";

/**
 * Registration status of the SESSION wallet in AgentBook, plus — only while
 * unregistered — the fresh nonce the widget needs to build the World ID
 * signal. The address always comes from the Privy session, never from the
 * client: this endpoint answers "am I human-backed?", not "is X human-backed?".
 */
export async function GET(req: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }

  const lookup = await lookupHumanId(user.wallet);
  if (lookup.error) {
    return NextResponse.json(
      { error: "impossibile verificare ora lo stato su AgentBook, riprova", detail: lookup.error },
      { status: 503 },
    );
  }
  if (lookup.humanId) return NextResponse.json({ registered: true, humanId: lookup.humanId });

  const nonce = await getAgentNonce(user.wallet);
  if ("error" in nonce) {
    return NextResponse.json(
      { error: "impossibile leggere il nonce di registrazione, riprova", detail: nonce.error },
      { status: 503 },
    );
  }
  return NextResponse.json({ registered: false, humanId: null, nonce: nonce.nonce, wallet: user.wallet });
}
```

- [ ] **Step 4: Write the register route**

`apps/web/src/app/api/world/agentbook/register/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { agentBookAddress } from "@/lib/world/agentbook";

const DEFAULT_RELAY = "https://x402-worldchain.vercel.app";
const RELAY_TIMEOUT_MS = 30_000;

const Body = z.object({
  root: z.string().min(1),
  nonce: z.string().regex(/^\d+$/),
  nullifierHash: z.string().min(1),
  proof: z.array(z.string().regex(/^0x[0-9a-fA-F]+$/)).length(8),
});

/**
 * Server-side proxy to World's gasless registration relay (the same one
 * agentkit-cli submits to). Proxied rather than called from the browser so
 * the relay URL stays server-config and CORS never enters the picture. The
 * `agent` field is ALWAYS the session wallet — a body-supplied agent is
 * ignored, so nobody can register someone else's proof onto their address
 * (the proof wouldn't verify anyway: the signal binds the address).
 */
export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const relay = (process.env.AGENTBOOK_RELAY_URL ?? DEFAULT_RELAY).replace(/\/$/, "");
  const registration = { agent: user.wallet, ...parsed.data, contract: agentBookAddress() };

  let res: Response;
  try {
    res = await fetch(`${relay}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registration),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
  } catch (e: any) {
    return NextResponse.json({ error: `relay non raggiungibile: ${e.message ?? e}` }, { status: 502 });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: body.error ? String(body.error) : `relay HTTP ${res.status}`, relayStatus: res.status },
      { status: 502 },
    );
  }
  return NextResponse.json({ txHash: body.txHash ?? null });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/api/world/agentbook`
Expected: PASS (4 + 5 tests).

- [ ] **Step 6: Add the relay env var to `.env.example`**

In the World section (after the `WORLD_AGENTBOOK_ADDRESS` lines, ~line 45), append:

```bash
AGENTBOOK_RELAY_URL=         # relay gasless per la registrazione AgentBook (default: https://x402-worldchain.vercel.app)
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/world/agentbook .env.example
git commit -m "feat(web): AgentBook status + gasless-relay registration API for the session wallet"
```

---

### Task 3: `HumanBackingWidget` on the mint page

**Files:**
- Create: `apps/web/src/components/world/human-backing-widget.tsx`
- Modify: `apps/web/src/app/(app)/mint/page.tsx` (mount widget; retire the CLI copy)
- Modify: `apps/web/src/lib/world/gate.ts:83` (the `howTo` string)
- Modify: `apps/web/src/app/api/coach/mint/mint.test.ts:223` (assertion follows the copy)
- Modify: `apps/web/package.json` (two new deps)

No component test: the widget is bridge-driven and presentational (repo convention: components are tested only with non-trivial pure logic). Verified by typecheck + build + the demo checklist in Task 10.

**Interfaces:**
- Consumes: Task 2's `status`/`register` endpoints; `getAccessToken` (`@privy-io/react-auth`); `createWorldBridgeStore` + `solidityEncode` (`@worldcoin/idkit-core@2.1.0` — the CLI's exact bridge version; do NOT use the repo's `@worldcoin/idkit` v4, its `rp_context` protocol is unrelated to AgentBook).
- Produces: `<HumanBackingWidget />` — self-contained, no props.

- [ ] **Step 1: Install the two dependencies**

Run (from `apps/web/`): `npm install @worldcoin/idkit-core@2.1.0 react-qr-code`
Expected: both land in `apps/web/package.json` dependencies (idkit-core pinned `2.1.0`).

- [ ] **Step 2: Write the widget**

`apps/web/src/components/world/human-backing-widget.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { getAccessToken } from "@privy-io/react-auth";
import { createWorldBridgeStore } from "@worldcoin/idkit-core";
import { solidityEncode } from "@worldcoin/idkit-core/hashing";
import { decodeAbiParameters } from "viem";
import { Button } from "@/components/ui/button";

// AgentBook protocol constants, verified against @worldcoin/agentkit-cli@0.2.0
// source: this is WORLD's app/action (the proof must carry AgentBook's own
// external nullifier to verify on-chain), NOT our NEXT_PUBLIC_WORLD_APP_ID.
const AGENTBOOK_APP_ID = "app_a7c3e2b6b83927251a0db5345bd7146a";
const AGENTBOOK_ACTION = "agentbook-registration";
const BRIDGE_POLL_MS = 1_000;
const BRIDGE_TIMEOUT_MS = 300_000; // 5 min, like the CLI
const CONFIRM_POLL_MS = 2_000;
const CONFIRM_TIMEOUT_MS = 60_000;

type State =
  | { kind: "loading" }
  | { kind: "registered"; humanId: string }
  | { kind: "idle" }
  | { kind: "verifying"; uri: string }
  | { kind: "submitting" }
  | { kind: "confirming" }
  | { kind: "error"; message: string };

// IDKit returns the proof ABI-encoded (or, rarely, as a JSON array) — the
// relay wants the plain uint256[8]. Same normalization as the CLI.
function normalizeProof(raw: string): string[] | null {
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through to ABI decode */
    }
  }
  try {
    const decoded = decodeAbiParameters([{ type: "uint256[8]" }], raw as `0x${string}`)[0] as readonly bigint[];
    return decoded.map((v) => `0x${v.toString(16).padStart(64, "0")}`);
  } catch {
    return null;
  }
}

async function authed(path: string, init?: RequestInit) {
  const token = await getAccessToken();
  return fetch(path, { ...init, headers: { ...init?.headers, authorization: `Bearer ${token}` } });
}

/**
 * Self-serve AgentBook registration: the person scans a QR (or taps the deep
 * link on mobile), approves in World App, and a gasless relay writes the
 * binding on World Chain. Until now this required running agentkit-cli by
 * hand; the flow below is that CLI's exact protocol, in the page where the
 * human-backing gate refuses.
 */
export function HumanBackingWidget() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const cancelled = useRef(false);
  useEffect(() => () => void (cancelled.current = true), []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await authed("/api/world/agentbook/status");
      const body = await res.json();
      if (cancelled.current) return null;
      if (!res.ok) {
        setState({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
        return null;
      }
      if (body.registered) setState({ kind: "registered", humanId: body.humanId });
      else setState({ kind: "idle" });
      return body as { registered: boolean; nonce?: string; wallet?: string };
    } catch (e: any) {
      if (!cancelled.current) setState({ kind: "error", message: e.message ?? String(e) });
      return null;
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function start() {
    setState({ kind: "loading" });
    const status = await loadStatus();
    if (!status || status.registered || !status.nonce || !status.wallet) return;

    try {
      const bridge = createWorldBridgeStore();
      await bridge.getState().createClient({
        app_id: AGENTBOOK_APP_ID,
        action: AGENTBOOK_ACTION,
        // nonce as bigint: the CLI passes the raw uint256 from readContract,
        // and the encoder must see a number-like value, not a decimal string.
        signal: solidityEncode(["address", "uint256"], [status.wallet, BigInt(status.nonce)]),
      });
      const uri = bridge.getState().connectorURI;
      if (!uri) throw new Error("bridge World ID non disponibile");
      setState({ kind: "verifying", uri });

      const deadline = Date.now() + BRIDGE_TIMEOUT_MS;
      let proofResult: { merkle_root: string; nullifier_hash: string; proof: string } | null = null;
      while (Date.now() < deadline && !cancelled.current) {
        await bridge.getState().pollForUpdates();
        const { result, errorCode } = bridge.getState();
        if (result) {
          proofResult = result;
          break;
        }
        if (errorCode) throw new Error(`World App: ${errorCode}`);
        await new Promise((r) => setTimeout(r, BRIDGE_POLL_MS));
      }
      if (cancelled.current) return;
      if (!proofResult) throw new Error("tempo scaduto: verifica non completata in World App");

      const proof = normalizeProof(proofResult.proof);
      if (!proof) throw new Error("formato proof inatteso da World App");

      setState({ kind: "submitting" });
      const reg = await authed("/api/world/agentbook/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          root: proofResult.merkle_root,
          nonce: status.nonce,
          nullifierHash: proofResult.nullifier_hash,
          proof,
        }),
      });
      const regBody = await reg.json().catch(() => ({}));
      if (!reg.ok) throw new Error(regBody.error ?? `registrazione fallita (HTTP ${reg.status})`);

      setState({ kind: "confirming" });
      const confirmDeadline = Date.now() + CONFIRM_TIMEOUT_MS;
      while (Date.now() < confirmDeadline && !cancelled.current) {
        const s = await loadStatus();
        if (s?.registered) return; // loadStatus already set "registered"
        await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS));
      }
      if (!cancelled.current) {
        setState({ kind: "error", message: "transazione inviata ma non ancora visibile: ricarica tra poco" });
      }
    } catch (e: any) {
      if (!cancelled.current) setState({ kind: "error", message: e.message ?? String(e) });
    }
  }

  if (state.kind === "loading") {
    return <p className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">checking human backing…</p>;
  }
  if (state.kind === "registered") {
    return (
      <p className="font-sans text-xs uppercase tracking-[0.25em] text-ocean">
        human-backed ✓ <span className="text-navy/60">World App verified, unique human</span>
      </p>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-ocean/60 p-4">
      <p className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
        prove you are one real human — needed to own a coach
      </p>
      {state.kind === "idle" && (
        <Button variant="primary" className="mt-3" onClick={() => void start()}>
          Verify with World App
        </Button>
      )}
      {state.kind === "verifying" && (
        <div className="mt-3 flex flex-col items-start gap-3">
          <div className="rounded-xl bg-white p-3">
            <QRCode value={state.uri} size={144} />
          </div>
          <a className="font-sans text-sm text-navy underline" href={state.uri}>
            on your phone? open World App directly
          </a>
          <p className="font-sans text-xs text-ocean">scan with World App, then approve — waiting…</p>
        </div>
      )}
      {(state.kind === "submitting" || state.kind === "confirming") && (
        <p className="mt-3 font-sans text-xs uppercase tracking-[0.3em] text-ocean">
          {state.kind === "submitting" ? "submitting to the relay…" : "waiting for World Chain…"}
        </p>
      )}
      {state.kind === "error" && (
        <div className="mt-3">
          <p className="font-sans text-sm text-orange">{state.message}</p>
          <Button variant="primary" className="mt-2" onClick={() => void start()}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount it on the mint page and retire the CLI copy**

In `apps/web/src/app/(app)/mint/page.tsx`:

1. Add the import: `import { HumanBackingWidget } from "@/components/world/human-backing-widget";`
2. Inside the `<div className="max-w-md">` block (before the `{error && (...)}` block), when the user is authenticated, render the widget:

```tsx
            {ready && authenticated && (
              <div className="mb-6">
                <HumanBackingWidget />
              </div>
            )}
```

3. In the `howTo` render block, replace the label + `<code>` box (the `"Run this, then scan the link in World App"` paragraph and the `<code>…{howTo.howTo}…</code>` element) with a plain paragraph — the command is gone, the widget above is the action:

```tsx
                      <p className="mt-4 font-sans text-sm leading-relaxed text-navy">{howTo.howTo}</p>
```

(keep the `howTo.note` paragraph as is).

- [ ] **Step 4: Update the gate copy**

In `apps/web/src/lib/world/gate.ts`, replace the `howTo` line (`:83`) and its comment:

```ts
          // Registration is a human action a service cannot perform for them —
          // but the mint page now hosts the whole flow (HumanBackingWidget):
          // World App on the phone, one QR, a gasless relay. No CLI.
          howTo: "usa il riquadro 'verify with World App' qui sopra: scansiona il QR col telefono e approva",
```

In `apps/web/src/app/api/coach/mint/mint.test.ts:223`, update the assertion:

```ts
    expect(body.howTo).toContain("World App");
```

- [ ] **Step 5: Typecheck, tests, build**

Run (from `apps/web/`): `npx tsc --noEmit && npx vitest run src/app/api/coach/mint && npm run build`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/world/human-backing-widget.tsx "apps/web/src/app/(app)/mint/page.tsx" apps/web/src/lib/world/gate.ts apps/web/src/app/api/coach/mint/mint.test.ts apps/web/package.json package-lock.json
git commit -m "feat(web): in-app AgentBook registration — World App QR on the mint page, no CLI"
```

---

### Task 4: `agentkit_usage` table + `PostgresAgentKitStorage` + flags

**Files:**
- Modify: `apps/web/src/db/schema.ts` (new table)
- Create: `apps/web/src/lib/world/agentkitStorage.ts`
- Test: `apps/web/src/lib/world/agentkitStorage.test.ts`
- Modify: `apps/web/src/lib/world/gate.ts` (two small exported helpers)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `AgentKitStorage` type from `@worldcoin/agentkit` (already in `apps/web/package.json`); `db` from `@/db`.
- Produces (used by Task 5):
  - `agentkitStorage: AgentKitStorage` singleton with `tryIncrementUsage(endpoint, humanId, limit): Promise<boolean>`.
  - `a2aHumanBackingEnforced(): boolean` (env `REQUIRE_HUMAN_BACKED_A2A === "1"`).
  - `a2aDailyQuotaPerHuman(): number` (env `A2A_DAILY_QUOTA_PER_HUMAN`, default `20`).
  - Table `agentkit_usage(endpoint text, human_id text, count int, PK(endpoint, human_id))`.

- [ ] **Step 1: Add the table to the schema**

Append to `apps/web/src/db/schema.ts` (add `primaryKey` to the existing `drizzle-orm/pg-core` import):

```ts
// AgentKit per-human usage counters (spec 2026-07-25-agentkit-human-backing).
// One row per (endpoint bucket, humanId); the endpoint key embeds the UTC day
// ("a2a:2026-07-25") so the "daily" window needs no cron and no timestamp
// arithmetic. Deliberately content-free — no wallets, no questions, no ENS
// names: accountability metadata only.
export const agentkitUsage = pgTable(
  "agentkit_usage",
  {
    endpoint: text("endpoint").notNull(),
    humanId: text("human_id").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.endpoint, t.humanId] }) }),
);
```

- [ ] **Step 2: Push the schema (docker Postgres up)**

Run (from `apps/web/`): `npx drizzle-kit push`
Expected: creates `agentkit_usage` with the composite PK. Additive, no rewrite.

- [ ] **Step 3: Write the failing tests**

`apps/web/src/lib/world/agentkitStorage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
vi.mock("@/db", () => ({ db: { execute: executeMock } }));

import { PostgresAgentKitStorage } from "./agentkitStorage";

describe("PostgresAgentKitStorage.tryIncrementUsage", () => {
  beforeEach(() => executeMock.mockReset());

  it("true quando la statement atomica ritorna una riga (sotto il limite)", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ count: 3 }] });
    const ok = await new PostgresAgentKitStorage().tryIncrementUsage("a2a:2026-07-25", "0x1234", 20);
    expect(ok).toBe(true);
    // UNA sola statement: check e increment insieme, come richiede il
    // contratto AgentKitStorage (niente TOCTOU).
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("false quando la statement non ritorna righe (limite raggiunto)", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    const ok = await new PostgresAgentKitStorage().tryIncrementUsage("a2a:2026-07-25", "0x1234", 20);
    expect(ok).toBe(false);
  });

  it("limit non positivo → false senza toccare il db (la INSERT del primo uso lo aggirerebbe)", async () => {
    const ok = await new PostgresAgentKitStorage().tryIncrementUsage("a2a:2026-07-25", "0x1234", 0);
    expect(ok).toBe(false);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/lib/world/agentkitStorage.test.ts`
Expected: FAIL — cannot resolve `./agentkitStorage`.

- [ ] **Step 5: Implement the storage**

`apps/web/src/lib/world/agentkitStorage.ts`:

```ts
import { sql } from "drizzle-orm";
import type { AgentKitStorage } from "@worldcoin/agentkit";
import { db } from "@/db";

/**
 * The AgentKit SDK's storage contract implemented over our Postgres. The
 * interface docs require check+increment to be ONE atomic operation; this is
 * a single INSERT … ON CONFLICT … DO UPDATE … WHERE count < limit — the
 * upsert either lands (row returned → allowed) or the WHERE stops it (no row
 * → the human is at their limit). No transaction, no row lock, no race.
 */
export class PostgresAgentKitStorage implements AgentKitStorage {
  async tryIncrementUsage(endpoint: string, humanId: string, limit: number): Promise<boolean> {
    // The first-use INSERT path cannot carry a WHERE, so a non-positive limit
    // must short-circuit here or the very first request would always pass.
    if (limit < 1) return false;
    const res = await db.execute(sql`
      INSERT INTO agentkit_usage (endpoint, human_id, count)
      VALUES (${endpoint}, ${humanId}, 1)
      ON CONFLICT (endpoint, human_id)
      DO UPDATE SET count = agentkit_usage.count + 1
      WHERE agentkit_usage.count < ${limit}
      RETURNING count
    `);
    return res.rows.length > 0;
  }
}

export const agentkitStorage: AgentKitStorage = new PostgresAgentKitStorage();
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/world/agentkitStorage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Add the two helpers to `gate.ts`**

In `apps/web/src/lib/world/gate.ts`, after `humanBackingEnforced()`:

```ts
/** Same opt-in convention as the mint gate, for the agent→agent surface. */
export function a2aHumanBackingEnforced(): boolean {
  return process.env.REQUIRE_HUMAN_BACKED_A2A === "1";
}

/** Consults per day per humanId, across ALL agents that human backs. */
export function a2aDailyQuotaPerHuman(): number {
  const n = Number(process.env.A2A_DAILY_QUOTA_PER_HUMAN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}
```

- [ ] **Step 8: Add the env vars to `.env.example`**

Append under the A2A section (after `A2A_ENDPOINT_OVERRIDE`, line 29):

```bash
REQUIRE_HUMAN_BACKED_A2A=    # 1 per rifiutare consulti a2a da agenti senza un umano unico dietro (demo: 1)
A2A_DAILY_QUOTA_PER_HUMAN=   # consulti a2a al giorno per humanId, su tutti i suoi agenti (default: 20)
```

- [ ] **Step 9: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add apps/web/src/db/schema.ts apps/web/src/lib/world/agentkitStorage.ts apps/web/src/lib/world/agentkitStorage.test.ts apps/web/src/lib/world/gate.ts .env.example
git commit -m "feat(web): per-human usage counters — the SDK AgentKitStorage contract on Postgres"
```

---

### Task 5: `checkA2aAdmission` + enforcement in the a2a route

**Files:**
- Modify: `apps/web/src/lib/world/gate.ts` (new function)
- Create: `apps/web/src/lib/world/gate.a2a.test.ts`
- Modify: `apps/web/src/app/api/coach/[tokenId]/a2a/route.ts` (wire it in + amend the doc comment)
- Modify: `apps/web/src/app/api/coach/[tokenId]/a2a/a2a.test.ts` (new mocks + tests)

**Interfaces:**
- Consumes: `lookupHumanId`, `agentBookAddress` (Task 1); `agentkitStorage`, `a2aHumanBackingEnforced`, `a2aDailyQuotaPerHuman` (Task 4).
- Produces (used by Tasks 6, 7):
  - `checkA2aAdmission(callerAddress: string | null): Promise<{ ok: true; humanBacked: { humanId: string } | null } | { ok: false; response: NextResponse }>` exported from `gate.ts`.
  - The a2a route's 200 body gains `humanBacked: { humanId: string } | null`; refusals: 403 `human_backing_required`, 429 `quota_exhausted`, 503 unknown.

- [ ] **Step 1: Write the failing gate tests**

`apps/web/src/lib/world/gate.a2a.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setAgentBookForTest } from "./agentbook";

const tryIncrementMock = vi.fn(async () => true);
vi.mock("./agentkitStorage", () => ({ agentkitStorage: { tryIncrementUsage: tryIncrementMock } }));

import { checkA2aAdmission } from "./gate";

const ADDR = "0x" + "ab".repeat(20);

describe("checkA2aAdmission", () => {
  beforeEach(() => {
    vi.stubEnv("REQUIRE_HUMAN_BACKED_A2A", "1");
    vi.stubEnv("A2A_DAILY_QUOTA_PER_HUMAN", "20");
    tryIncrementMock.mockClear().mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("registrato e sotto quota → ok con humanId; il contatore è per-humanId con bucket giornaliero", async () => {
    _setAgentBookForTest({ lookupHuman: async () => "0x1234" });
    const res = await checkA2aAdmission(ADDR);
    expect(res).toEqual({ ok: true, humanBacked: { humanId: "0x1234" } });
    const [endpoint, humanId, limit] = tryIncrementMock.mock.calls[0];
    expect(endpoint).toMatch(/^a2a:\d{4}-\d{2}-\d{2}$/);
    expect(humanId).toBe("0x1234");
    expect(limit).toBe(20);
  });

  it("non registrato → 403 human_backing_required con puntatori a registry e registrazione", async () => {
    _setAgentBookForTest({ lookupHuman: async () => null });
    const res = await checkA2aAdmission(ADDR);
    if (res.ok) throw new Error("expected refusal");
    expect(res.response.status).toBe(403);
    const body = await res.response.json();
    expect(body.reason).toBe("human_backing_required");
    expect(body.agentbook.network).toBe("eip155:480");
    expect(body.register).toContain("/mint");
  });

  it("nome senza addr → 403 (nessuno di accountable dietro il nome)", async () => {
    _setAgentBookForTest({ lookupHuman: async () => "0x1234" });
    const res = await checkA2aAdmission(null);
    if (res.ok) throw new Error("expected refusal");
    expect(res.response.status).toBe(403);
  });

  it("lookup non disponibile → 503, mai 403 (unknown non è un no)", async () => {
    _setAgentBookForTest({
      lookupHuman: async () => {
        throw new Error("rpc down");
      },
    });
    const res = await checkA2aAdmission(ADDR);
    if (res.ok) throw new Error("expected refusal");
    expect(res.response.status).toBe(503);
  });

  it("quota esaurita → 429 con humanId", async () => {
    _setAgentBookForTest({ lookupHuman: async () => "0x1234" });
    tryIncrementMock.mockResolvedValueOnce(false);
    const res = await checkA2aAdmission(ADDR);
    if (res.ok) throw new Error("expected refusal");
    expect(res.response.status).toBe(429);
    expect((await res.response.json()).humanId).toBe("0x1234");
  });

  it("flag spento → sempre ok; humanBacked riportato best-effort, contatore mai toccato", async () => {
    vi.stubEnv("REQUIRE_HUMAN_BACKED_A2A", "");
    _setAgentBookForTest({ lookupHuman: async () => "0x1234" });
    expect(await checkA2aAdmission(ADDR)).toEqual({ ok: true, humanBacked: { humanId: "0x1234" } });
    _setAgentBookForTest({ lookupHuman: async () => null });
    expect(await checkA2aAdmission(ADDR)).toEqual({ ok: true, humanBacked: null });
    expect(tryIncrementMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/world/gate.a2a.test.ts`
Expected: FAIL — `checkA2aAdmission` not exported.

- [ ] **Step 3: Implement `checkA2aAdmission` in `gate.ts`**

Add imports at the top of `apps/web/src/lib/world/gate.ts`:

```ts
import { agentBookAddress, lookupHumanId } from "@/lib/world/agentbook";
import { agentkitStorage } from "@/lib/world/agentkitStorage";
```

(the file already imports `lookupHumanId`; merge, don't duplicate). Then append:

```ts
export type A2aAdmission =
  | { ok: true; humanBacked: { humanId: string } | null }
  | { ok: false; response: NextResponse };

/**
 * Admission control for the agent→agent consult endpoint. ENS already told
 * the route WHO is speaking (agent-signer signature); this decides whether a
 * real, unique human stands behind that name — `callerAddress` is the ENS
 * `addr` of the calling agent, the accountable wallet of the delegation
 * chain human → wallet (AgentBook) → name (ENS addr) → key (agent-signer).
 *
 * Enforcement is opt-in (REQUIRE_HUMAN_BACKED_A2A=1), same convention as the
 * mint gate. With the flag off the lookup still runs so the UI badge works,
 * but nothing is refused and the quota counter is never written.
 * Unknown (RPC error) is answered 503, never 403 — see checkHumanBacking.
 */
export async function checkA2aAdmission(callerAddress: string | null): Promise<A2aAdmission> {
  const enforced = a2aHumanBackingEnforced();

  if (!callerAddress) {
    if (!enforced) return { ok: true, humanBacked: null };
    return {
      ok: false,
      response: NextResponse.json(
        { error: "il nome del chiamante non pubblica un indirizzo: nessun umano ne risponde", reason: "human_backing_required" },
        { status: 403 },
      ),
    };
  }

  const lookup = await lookupHumanId(callerAddress);

  if (lookup.error) {
    if (!enforced) return { ok: true, humanBacked: null };
    return {
      ok: false,
      response: NextResponse.json(
        { error: "impossibile verificare ora il legame con un umano, riprova", detail: lookup.error },
        { status: 503 },
      ),
    };
  }

  if (!lookup.humanId) {
    if (!enforced) return { ok: true, humanBacked: null };
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "questo endpoint risponde solo ad agenti con un umano reale e unico alle spalle",
          reason: "human_backing_required",
          agentbook: { contract: agentBookAddress(), network: "eip155:480" },
          register: `${(process.env.SITE_URL ?? "https://0run.fun").replace(/\/$/, "")}/mint`,
        },
        { status: 403 },
      ),
    };
  }

  if (enforced) {
    const day = new Date().toISOString().slice(0, 10);
    const allowed = await agentkitStorage.tryIncrementUsage(`a2a:${day}`, lookup.humanId, a2aDailyQuotaPerHuman());
    if (!allowed) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "quota giornaliera per umano esaurita", reason: "quota_exhausted", humanId: lookup.humanId },
          { status: 429 },
        ),
      };
    }
  }

  return { ok: true, humanBacked: { humanId: lookup.humanId } };
}
```

- [ ] **Step 4: Run the gate tests**

Run: `npx vitest run src/lib/world/gate.a2a.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Extend the a2a route tests**

In `apps/web/src/app/api/coach/[tokenId]/a2a/a2a.test.ts`, add the gate mock after the other module mocks (before `const NOW`):

```ts
const admissionMock = vi.fn(async (): Promise<
  { ok: true; humanBacked: { humanId: string } | null } | { ok: false; response: Response }
> => ({ ok: true, humanBacked: { humanId: "0x1234" } }));
vi.mock("@/lib/world/gate", () => ({ checkA2aAdmission: admissionMock }));
```

In `beforeEach`, add: `admissionMock.mockClear().mockResolvedValue({ ok: true, humanBacked: { humanId: "0x1234" } });`

New tests at the end of the describe block:

```ts
  it("consulto valido → humanBacked nel body; l'accountable è l'addr ENS del chiamante", async () => {
    const { POST } = await import("./route");
    const body = await (await POST(req(await signedBody()), params("2"))).json();
    expect(body.humanBacked).toEqual({ humanId: "0x1234" });
    expect(admissionMock).toHaveBeenCalledWith("0x" + "aa".repeat(20));
  });

  it("agente senza umano dietro → 403, inference mai chiamata", async () => {
    admissionMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ reason: "human_backing_required" }, { status: 403 }),
    });
    const { POST } = await import("./route");
    const res = await POST(req(await signedBody()), params("2"));
    expect(res.status).toBe(403);
    expect(coachCompleteMock).not.toHaveBeenCalled();
  });

  it("quota per umano esaurita → 429", async () => {
    admissionMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ reason: "quota_exhausted" }, { status: 429 }),
    });
    const { POST } = await import("./route");
    expect((await POST(req(await signedBody()), params("2"))).status).toBe(429);
  });

  it("firma invalida → 401 PRIMA dell'admission (mai lookup per richieste non autentiche)", async () => {
    resolveMock.mockResolvedValueOnce({ address: "0x" + "aa".repeat(20), records: { "agent-signer": "0x" + "42".repeat(20) } });
    const { POST } = await import("./route");
    expect((await POST(req(await signedBody()), params("2"))).status).toBe(401);
    expect(admissionMock).not.toHaveBeenCalled();
  });
```

Add `NextResponse` to the test imports: `import { NextResponse } from "next/server";`

- [ ] **Step 6: Run to verify the new route tests fail**

Run: `npx vitest run "src/app/api/coach/[tokenId]/a2a/a2a.test.ts"`
Expected: existing 9 PASS, new 4 FAIL.

- [ ] **Step 7: Wire the admission into the route**

In `apps/web/src/app/api/coach/[tokenId]/a2a/route.ts`:

1. Add the import: `import { checkA2aAdmission } from "@/lib/world/gate";`
2. After the `verifyConsult` check (`if (!verdict.ok) …`, line ~81), insert:

```ts
    // Humanity, after authenticity: ENS said WHO speaks (agent-signer); now
    // AgentBook says whether a real, unique human stands behind that name —
    // via the caller's ENS addr, the accountable wallet of the delegation
    // chain. Refusals (403 no human / 429 per-human quota / 503 unknown) are
    // built by the gate; the chat side degrades gracefully on any of them.
    const admission = await checkA2aAdmission(caller.address);
    if (!admission.ok) return admission.response;
```

3. Add `humanBacked` to the 200 response:

```ts
    return NextResponse.json({
      reply: completion.text,
      coach: { name: profile.name, ensName: coach.ensName, personality: profile.personality },
      profileSource,
      humanBacked: admission.humanBacked,
    });
```

4. Amend the route's doc comment (the spec's approved one-write amendment — code and comment must not disagree). Replace the sentence `profile cascade only, never memoryRoot/memoryCipher, and NOTHING is ever written.` with:

```
 * profile cascade only, never memoryRoot/memoryCipher. The ONLY write this
 * route can cause is the per-human quota counter inside checkA2aAdmission
 * (agentkit_usage: endpoint bucket + humanId + count — no content, no
 * addresses; approved amendment, spec 2026-07-25-agentkit-human-backing).
```

and update the trailing `// Deliberately no db write of any kind — stateless, like the ask route.` comment to:

```ts
    // No write here — the sole write on this path is the quota counter in
    // checkA2aAdmission (see the doc comment above).
```

- [ ] **Step 8: Run the route tests**

Run: `npx vitest run "src/app/api/coach/[tokenId]/a2a/a2a.test.ts"`
Expected: PASS (13 tests).

- [ ] **Step 9: Full suite + typecheck, then commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

```bash
git add apps/web/src/lib/world/gate.ts apps/web/src/lib/world/gate.a2a.test.ts "apps/web/src/app/api/coach/[tokenId]/a2a/route.ts" "apps/web/src/app/api/coach/[tokenId]/a2a/a2a.test.ts"
git commit -m "feat(web): a2a consults now require a unique human behind the calling agent"
```

---

### Task 6: `consultCoach` passes `humanBacked` through

**Files:**
- Modify: `apps/web/src/lib/a2a/consult.ts`
- Test: `apps/web/src/lib/a2a/consult.test.ts` (extend)

**Interfaces:**
- Consumes: the a2a route's response contract from Task 5.
- Produces (used by Task 7): `ConsultResult` ok-variant gains `humanBacked: { humanId: string } | null`. Peers that omit the field (external agents, older deploys) still validate — the field is tolerated, never required.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("consultCoach", …)` block of `apps/web/src/lib/a2a/consult.test.ts`:

```ts
  it("humanBacked nella risposta del peer → passa attraverso", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          reply: "Progressivi.",
          coach: { name: "Pedro", ensName: "pedro.0run.eth", personality: "drill-sergeant" },
          humanBacked: { humanId: "0x1234" },
        }),
        { status: 200 },
      ),
    );
    const res = await consultCoach("marco.0run.eth", "pedro.0run.eth", "q", "");
    expect(res).toMatchObject({ ok: true, humanBacked: { humanId: "0x1234" } });
  });

  it("peer senza humanBacked (agente esterno) → valida comunque, humanBacked null", async () => {
    const res = await consultCoach("marco.0run.eth", "pedro.0run.eth", "q", "");
    expect(res).toMatchObject({ ok: true, humanBacked: null });
  });

  it("humanBacked malformato → tollerato come null, mai un errore", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          reply: "ok",
          coach: { name: "P", ensName: "p.0run.eth", personality: "zen" },
          humanBacked: { humanId: 42 },
        }),
        { status: 200 },
      ),
    );
    const res = await consultCoach("marco.0run.eth", "pedro.0run.eth", "q", "");
    expect(res).toMatchObject({ ok: true, humanBacked: null });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/a2a/consult.test.ts`
Expected: existing PASS, new 3 FAIL.

- [ ] **Step 3: Implement**

In `apps/web/src/lib/a2a/consult.ts`:

1. Extend the ok-variant of `ConsultResult`:

```ts
export type ConsultResult =
  | {
      ok: true;
      to: string;
      question: string;
      reply: string;
      coach: { name: string; ensName: string; personality: string };
      // Set when the peer attested (and we display) the unique human behind
      // it; null for peers that don't send it — tolerated, never required.
      humanBacked: { humanId: string } | null;
    }
  | { ok: false; error: string };
```

2. In the success return, after the shape validation, build the tolerated field:

```ts
    const humanBacked =
      body.humanBacked && typeof body.humanBacked.humanId === "string"
        ? { humanId: body.humanBacked.humanId as string }
        : null;
    return { ok: true, to, question, reply: body.reply, coach: body.coach, humanBacked };
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/a2a/consult.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/a2a/consult.ts apps/web/src/lib/a2a/consult.test.ts
git commit -m "feat(web): consult client carries the peer's human-backing attestation"
```

---

### Task 7: Chat persists and returns `humanBacked` on the consult

**Files:**
- Modify: `apps/web/src/db/schema.ts` (the `chatMessages.consult` jsonb type)
- Modify: `apps/web/src/app/api/coach/chat/route.ts` (the consult object)
- Test: `apps/web/src/app/api/coach/chat/chat.test.ts` (extend)

**Interfaces:**
- Consumes: `ConsultResult.humanBacked` (Task 6).
- Produces (used by Task 8): the chat response's and persisted `consult` object gain `humanBacked: { humanId: string } | null` (optional in the jsonb type — old rows lack it).

- [ ] **Step 1: Extend the jsonb type**

In `apps/web/src/db/schema.ts`, in the `chatMessages.consult` `$type<…>`, add the field after `coachName: string;`:

```ts
    humanBacked?: { humanId: string } | null;
```

(Optional: old rows don't have it; no DB migration needed — jsonb is schemaless, the type is TS-only.)

- [ ] **Step 2: Write the failing test**

In `apps/web/src/app/api/coach/chat/chat.test.ts`, first extend the `consultCoachMock` default in `beforeEach` — add `humanBacked: { humanId: "0x1234" }` to its resolved value object. Then append this test to the describe block:

```ts
  it("humanBacked del collega arriva al client e viene persistito sul turno", async () => {
    coachCompleteMock
      .mockResolvedValueOnce({ text: `<consult coach="pedro.0run.eth">Long runs?</consult>`, verified: null, model: "glm-5.2", path: "router" as const })
      .mockResolvedValueOnce({ text: "Pedro says progressives.", verified: null, model: "glm-5.2", path: "router" as const });
    const { POST } = await import("./route");
    const body = await (await POST(req())).json();
    expect(body.consult.humanBacked).toEqual({ humanId: "0x1234" });
    expect(state.inserted[1].consult.humanBacked).toEqual({ humanId: "0x1234" });
  });
```

(Use the file's existing `req()` helper and `state.inserted` capture exactly as the neighboring consult tests do — follow their conventions if names differ.)

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/app/api/coach/chat/chat.test.ts`
Expected: existing PASS, new 1 FAIL (`humanBacked` undefined).

- [ ] **Step 4: Implement**

In `apps/web/src/app/api/coach/chat/route.ts`:

1. In the local `consult` variable's type annotation, add `humanBacked: { humanId: string } | null;` after `coachName: string`.
2. In the `consult = { … }` assignment (built when `result.ok`), add:

```ts
          humanBacked: result.humanBacked,
```

- [ ] **Step 5: Run to verify it passes, then the full suite**

Run: `npx vitest run src/app/api/coach/chat/chat.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/db/schema.ts apps/web/src/app/api/coach/chat/route.ts apps/web/src/app/api/coach/chat/chat.test.ts
git commit -m "feat(web): the chat consult block records the unique human behind the colleague"
```

---

### Task 8: UI — the "unique human ✓" badge

**Files:**
- Modify: `apps/web/src/components/run/chat.tsx`

No component test (presentational; repo convention). Verified via typecheck + build + demo checklist.

**Interfaces:**
- Consumes: `consult.humanBacked` from Task 7's response.

- [ ] **Step 1: Extend the type and render the badge**

In `apps/web/src/components/run/chat.tsx`:

1. Extend the `Consult` type (line 9):

```ts
type Consult = {
  to: string;
  toTokenId: string | null;
  question: string;
  reply: string;
  coachName: string;
  humanBacked?: { humanId: string } | null;
};
```

2. Add the truncation helper next to the type:

```ts
// The humanId is an anonymous on-chain identifier; shown truncated because
// it's a badge, not a datum — the full value is one lookup away for anyone.
const shortHumanId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
```

3. In the consult block header `<p>` (the one ending with `· verified via ENS`), append immediately after that text:

```tsx
                    {turn.consult.humanBacked && (
                      <span title={`humanId ${shortHumanId(turn.consult.humanBacked.humanId)}`}>
                        {" "}· unique human ✓
                      </span>
                    )}
```

- [ ] **Step 2: Typecheck and build**

Run (from `apps/web/`): `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/run/chat.tsx
git commit -m "feat(web): unique-human badge on the consult block"
```

---

### Task 9: `agent.json` declares the admission policy

**Files:**
- Modify: `apps/web/src/app/api/coach/[tokenId]/agent.json/route.ts`
- Test: `apps/web/src/app/api/coach/[tokenId]/agent.json/agent-card.test.ts` (extend)

**Interfaces:**
- Consumes: `a2aHumanBackingEnforced` (Task 4), `agentBookAddress` (Task 1).
- Produces: card gains `humanBacking: { enforced: boolean, registry: { contract: string, network: "eip155:480" } }` — env-derived only, preserving the route's documented no-live-RPC property.

- [ ] **Step 1: Write the failing test**

Append to the describe block in `agent-card.test.ts`:

```ts
  it("dichiara la policy di ammissione human-backed (statica, senza RPC)", async () => {
    process.env.REQUIRE_HUMAN_BACKED_A2A = "1";
    const { GET } = await import("./route");
    const body = await (await GET(new Request("http://x"), params("2"))).json();
    expect(body.humanBacking).toEqual({
      enforced: true,
      registry: { contract: "0xA23aB2712eA7BBa896930544C7d6636a96b944dA", network: "eip155:480" },
    });
    delete process.env.REQUIRE_HUMAN_BACKED_A2A;
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "src/app/api/coach/[tokenId]/agent.json/agent-card.test.ts"`
Expected: existing PASS, new 1 FAIL.

- [ ] **Step 3: Implement**

In `agent.json/route.ts`, add imports:

```ts
import { agentBookAddress } from "@/lib/world/agentbook";
import { a2aHumanBackingEnforced } from "@/lib/world/gate";
```

and add to the returned JSON (after `signer`):

```ts
    // Machine-readable admission policy for the a2a endpoint: whether this
    // deployment requires callers to be human-backed, and against which
    // registry. Env-derived only — this route stays free of live RPC.
    humanBacking: {
      enforced: a2aHumanBackingEnforced(),
      registry: { contract: agentBookAddress(), network: "eip155:480" },
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run "src/app/api/coach/[tokenId]/agent.json/agent-card.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/coach/[tokenId]/agent.json/route.ts" "apps/web/src/app/api/coach/[tokenId]/agent.json/agent-card.test.ts"
git commit -m "feat(web): agent card declares the human-backing admission policy"
```

---

### Task 10: Rogue-agent demo script + docs + final verification

**Files:**
- Create: `scripts/demo-rogue-agent.ts`
- Create: `usages/world.md`

**Interfaces:**
- Consumes: `signConsult` (`apps/web/src/lib/a2a/protocol` — imports only viem, safe standalone); `assignSubname` (`apps/web/src/lib/ens/subname` — same relative-import pattern as `scripts/backfill-a2a-records.ts`).

- [ ] **Step 1: Write the script**

`scripts/demo-rogue-agent.ts`:

```ts
/**
 * The negative half of the human-backed demo: an agent with a PERFECTLY VALID
 * ENS identity (subname, addr, agent-signer, correct EIP-191 signature) but
 * no human registered behind its addr in AgentBook. With
 * REQUIRE_HUMAN_BACKED_A2A=1 the consult endpoint must answer 403
 * human_backing_required — identical cryptography, different accountability.
 *
 * One-time setup (writes rogue.0run.eth on Sepolia; needs the ENS owner env):
 *   ROGUE_PRIVATE_KEY=0x… npx tsx --env-file=.env scripts/demo-rogue-agent.ts --setup
 * Demo run (POSTs a signed consult at the target coach):
 *   ROGUE_PRIVATE_KEY=0x… BASE=https://0run.fun TARGET_TOKEN_ID=2 TARGET_ENS=pedro.0run.eth \
 *     npx tsx --env-file=.env scripts/demo-rogue-agent.ts
 * Stage finale: register the rogue wallet from World App, re-run → 200 + humanBacked.
 */
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { signConsult } from "../apps/web/src/lib/a2a/protocol";
import { assignSubname } from "../apps/web/src/lib/ens/subname";

const BASE = (process.env.BASE ?? "https://0run.fun").replace(/\/$/, "");
const ROGUE_LABEL = "rogue";
const ROGUE_NAME = `${ROGUE_LABEL}.0run.eth`;

async function main() {
  const pk = process.env.ROGUE_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error("ROGUE_PRIVATE_KEY mancante (una chiave qualsiasi MAI registrata in AgentBook)");
  const rogue = privateKeyToAccount(pk);

  if (process.argv.includes("--setup")) {
    // addr = the rogue wallet (unregistered), agent-signer = the same key:
    // a fully self-consistent ENS identity — that is the point of the demo.
    const result = await assignSubname(ROGUE_LABEL, rogue.address, {
      tokenId: "0",
      endpoint: `${BASE}/coach/0`,
      avatar: `${BASE}/api/coach/0/avatar`,
      a2aEndpoint: `${BASE}/api/coach/0/a2a`,
      signer: rogue.address,
    });
    console.log("setup:", result);
    return;
  }

  const target = process.env.TARGET_ENS;
  const tokenId = process.env.TARGET_TOKEN_ID;
  if (!target || !tokenId) throw new Error("TARGET_ENS e TARGET_TOKEN_ID richiesti per la demo");

  const signed = await signConsult(
    {
      from: ROGUE_NAME,
      to: target,
      question: "How should my athlete pace a hilly marathon?",
      context: "",
      ts: Math.floor(Date.now() / 1000),
      nonce: randomUUID(),
    },
    pk,
  );

  const res = await fetch(`${BASE}/api/coach/${tokenId}/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signed),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (res.status === 403 && body.reason === "human_backing_required") {
    console.log("\n✓ demo: identità ENS valida, ma nessun umano dietro — respinto.");
  } else if (res.status === 200 && body.humanBacked) {
    console.log(`\n✓ demo: ora human-backed (humanId ${body.humanBacked.humanId}) — risponde.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Write the usage doc**

`usages/world.md`:

```markdown
# World / AgentKit in 0run

## What AgentBook gives us

AgentBook (World Chain, eip155:480, contract
`0xA23aB2712eA7BBa896930544C7d6636a96b944dA`) maps an agent's wallet to an
anonymous `humanId` for the unique human who approved it in World App. 0run
uses it in two places:

- **Ownership** (`lib/world/gate.ts`, flag `REQUIRE_HUMAN_BACKED_MINT`): minting
  a coach and treasury gas top-ups require the session wallet to be
  human-backed; `coaches.human_id` is UNIQUE → one human, one coach.
- **A2A admission** (`checkA2aAdmission`, flag `REQUIRE_HUMAN_BACKED_A2A`): the
  agent→agent consult endpoint refuses callers whose ENS `addr` has no human
  behind it (403 `human_backing_required`) and meters consults per `humanId`
  (default 20/day, `A2A_DAILY_QUOTA_PER_HUMAN`, table `agentkit_usage` via the
  SDK's `AgentKitStorage` contract) → 429 when exhausted. Unknown (RPC down)
  answers 503, never 403.

The trust chain, all on-chain:
`human ─AgentBook→ wallet ─ENS addr→ agent name ─agent-signer→ key ─EIP-191→ message`.
ENS says who speaks; AgentBook says whether anyone real stands behind it.

## Registration (self-serve, no CLI)

The mint page hosts `HumanBackingWidget`: it reads the nonce
(`GET /api/world/agentbook/status`), runs the World ID bridge with AgentBook's
own credentials (`app_id app_a7c3e2b6b83927251a0db5345bd7146a`, action
`agentbook-registration`, signal = solidityEncode([wallet, nonce])), shows the
QR / deep link, and submits the proof through our proxy
(`POST /api/world/agentbook/register`) to World's gasless relay
(`AGENTBOOK_RELAY_URL`, default `https://x402-worldchain.vercel.app`). The
equivalent manual path stays available:
`npx @worldcoin/agentkit-cli register <wallet>`.

## Demo

`scripts/demo-rogue-agent.ts` — a cryptographically perfect ENS agent with no
human behind it gets 403 from a coach's a2a endpoint; register its wallet in
World App and the same request gets 200 + `humanBacked`. See the script header
for the exact commands.
```

- [ ] **Step 3: Full suite, typecheck, build**

Run (from `apps/web/`): `npx tsc --noEmit && npx vitest run && npm run build`
Expected: everything green.

- [ ] **Step 4: Manual demo checklist (dev server + `A2A_ENDPOINT_OVERRIDE=http://localhost:3000`)**

1. Mint page: widget shows "Verify with World App" → QR appears → approve on the phone → badge flips to "human-backed ✓" (requires World App with a verified World ID).
2. With `REQUIRE_HUMAN_BACKED_A2A=1`: a chat consult renders the block with `· verified via ENS · unique human ✓`.
3. `scripts/demo-rogue-agent.ts` against a local coach → `403 human_backing_required`.
4. `GET /api/coach/<tokenId>/agent.json` shows `humanBacking.enforced: true`.

- [ ] **Step 5: Commit**

```bash
git add scripts/demo-rogue-agent.ts usages/world.md
git commit -m "feat: rogue-agent demo script + World/AgentKit usage docs"
```

---

## Out of scope (from the spec)

x402 paid path for anonymous bots, roster filtering by human-backing, per-coach
agent wallets, nonce replay ledger, the AgentKit signed-header protocol
(`createAgentkitClient`/`createAgentkitHooks` — the header must be signed by the
AgentBook-registered wallet, which is the owner's client-side Privy wallet).

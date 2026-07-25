# Human-backed agents on the A2A network (AgentKit / World track)

Date: 2026-07-25
Status: DRAFT — written against the A2A design + plan living in the `ens-a2a-sxvsg`
worktree (`docs/superpowers/specs/2026-07-25-a2a-ens-design.md`, plan
`2026-07-25-a2a-ens.md`), which is still in development. To be reviewed together with
Ivan once that branch lands, before any Phase B implementation.

## Goal

The A2A consult protocol is deliberately open: any agent with a compatible subname can
call a coach's consult endpoint. That openness is exactly the hole AgentKit closes.
This design gives the receiving coach the ability to tell **"a bot" from "an agent
acting on behalf of a real, unique human"** — and to use that distinction for access,
per-human rate limits, and accountability. It also makes AgentBook registration
self-serve inside the app (phone + World App), replacing the current
`npx @worldcoin/agentkit-cli register` instruction.

## Trust model

Two onchain registries answer two different questions, and the receiver checks both:

- **ENS (Sepolia)** answers *who is speaking*: `from` → `agent-signer` text record →
  EIP-191 signature check (already in the A2A design).
- **AgentBook (World Chain, eip155:480)** answers *is a unique human behind it*:
  `from` → ENS `addr` record → `lookupHuman(addr)` → anonymous `humanId`.

Rule: **the ENS `addr` of `from` is who must be human-backed; `agent-signer` is who
may speak for it.** The full delegation chain is verifiable onchain:

```
human ──AgentBook──▶ wallet ──ENS addr──▶ agent name ──agent-signer──▶ key ──EIP-191──▶ message
```

This works identically for our coaches (`addr` = owner's Privy embedded wallet, the
same wallet the owner registers in AgentBook) and for external agents (`addr` = their
own agent wallet, registered by their own human).

## Verified facts (read from published packages, 2026-07-25)

From `@worldcoin/agentkit-cli` 0.2.0 source (`dist/index.js`, 277 lines):

- AgentBook contract `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` on World Chain;
  read functions `getNextNonce(address) → uint256` and `lookupHuman(address) → uint256`
  (0 = not registered).
- Registration verification: World ID bridge (`createWorldBridgeStore` from
  `@worldcoin/idkit-core`) with `app_id: "app_a7c3e2b6b83927251a0db5345bd7146a"`,
  `action: "agentbook-registration"`,
  `signal: solidityEncode(['address','uint256'], [agentAddress, nonce])`. The bridge's
  `connectorURI` is rendered as QR / deep link; the human confirms in World App; the
  client polls `pollForUpdates()` until `result` holds
  `{ merkle_root, nullifier_hash, proof }`.
- Proof normalization: `proof` arrives ABI-encoded; decode as `uint256[8]`, hex-pad to
  32 bytes each.
- Gasless submission: `POST {AGENTBOOK_RELAY}/register` (default
  `https://x402-worldchain.vercel.app`) with JSON
  `{ agent, root, nonce, nullifierHash, proof: string[8], contract }` → `{ txHash }`.

From `@worldcoin/agentkit` / `@worldcoin/agentkit-core` 0.2.0 typings:

- `createAgentBookVerifier({ rpcUrl?, contractAddress?, client? })` →
  `{ lookupHuman(address): Promise<string | null> }`.
- `AgentKitStorage.tryIncrementUsage(endpoint, humanId, limit): Promise<boolean>` —
  the SDK's own interface for atomic per-human usage limits (docs mandate
  check+increment in one atomic operation).
- `createAgentkitClient` / `createAgentkitHooks` implement the signed-header protocol
  — **not usable for our coaches**: the header must be signed by the
  AgentBook-registered wallet, which for us is the owner's client-side Privy wallet;
  our server signs with the shared A2A executor key. The ENS-addr delegation above
  replaces the header protocol; the SDK verifier and storage interface are still used
  directly.

## What exists today (this worktree)

- `lib/world/agentbook.ts` — hand-rolled `lookupHuman` (viem), 60s positive cache,
  `{ humanId, error? }` where error means *unknown*, never "not human".
- `lib/world/gate.ts` — `checkHumanBacking(wallet)` used by mint + fund; 403 body
  points at the CLI command. Enforcement behind `REQUIRE_HUMAN_BACKED_MINT` (off).
- `coaches.human_id` UNIQUE — one human, one coach.
- No registration flow in-app; `@worldcoin/agentkit` declared in
  `apps/web/package.json` but never imported.

Consumed from the A2A branch (must exist before Phase B): `SignedConsult` +
`verifyConsult`, the `resolveCoachEns(from)` call already made by the inbound route
(its `address` is the accountable wallet), `consultCoach`, the chat `consult` object
and its jsonb column, the consult UI block.

## Architecture

Two phases. Phase A is independent of the A2A branch and buildable now in this
worktree. Phase B layers onto the merged A2A code after review.

### Phase A — self-serve AgentBook registration (independent)

**A1. Refactor `lib/world/agentbook.ts` onto the SDK.** Internals switch to
`createAgentBookVerifier({ rpcUrl: WORLD_CHAIN_RPC, contractAddress: WORLD_AGENTBOOK_ADDRESS })`;
the exported contract (`{ humanId, error? }`, 60s cache, error = unknown) is
unchanged so `gate.ts` and its tests don't move. Add `getNextNonce(address)` (viem
read, same client) — the SDK has no nonce helper.

**A2. Registration API (both Privy-authenticated; the address is always
`requireUser().wallet`, never client-supplied):**

- `GET /api/world/agentbook/status` → `{ registered, humanId, nonce }`.
- `POST /api/world/agentbook/register` — body `{ root, nonce, nullifierHash, proof }`
  (zod: proof = exactly 8 hex strings); server forwards
  `{ agent: user.wallet, root, nonce, nullifierHash, proof, contract }` to
  `AGENTBOOK_RELAY_URL/register`; relays `{ txHash }` or the relay's error verbatim
  with an honest status. Proxying keeps the relay URL server-side and avoids CORS
  unknowns.

**A3. `HumanBackingWidget`** (`components/world/human-backing-widget.tsx`, rendered on
the mint page in place of the current CLI `howTo` text):

1. Load `status`. Registered → green "human-backed" badge, done.
2. Button → fetch fresh `nonce`, create the idkit-core bridge **client-side** with
   the exact `app_id`/`action`/`signal` above. Use `createWorldBridgeStore` directly —
   the same code path as the CLI — not the repo's IDKit v4 request-widget API, which
   is a different protocol (`rp_context`) that AgentBook does not use.
3. Show `connectorURI` as QR (desktop) and as a tappable deep link (mobile), poll the
   bridge, normalize the proof, `POST /register`, then poll `status` until
   `registered` (World Chain blocks ~2s; cap 60s).
4. Failure states are restartable: a stale nonce or relay 4xx resets to step 2 with a
   fresh nonce; bridge timeout (5 min, like the CLI) resets to idle with the error
   shown.

**A4. `gate.ts` 403 body**: `howTo` becomes a pointer to the mint page widget
("registrati dal sito, ti serve solo World App sul telefono"); the CLI command stays
in docs as fallback.

**A5. Demo env**: `REQUIRE_HUMAN_BACKED_MINT=1` — every coach in the directory is
backed by exactly one human (`human_id` UNIQUE), which is what makes Phase B's
per-human accounting meaningful.

### Phase B — humanity enforcement on the A2A route (after the A2A branch lands)

**B1. Inbound enforcement** in `POST /api/coach/[tokenId]/a2a`, after `verifyConsult`
returns ok (the route already resolved `from`; reuse that resolution):

1. Accountable wallet = the caller's ENS `addr`. Missing → 403
   `{ error: "human_backing_required" }` (a name with a signer but no addr has no one
   accountable behind it).
2. `lookupHuman(accountable)`:
   - `null` (definitely unregistered) → 403
     `{ error: "human_backing_required", agentbook: { contract, network: "eip155:480" }, register: "<SITE_URL>/mint" }`.
   - RPC error → **fail-open**: proceed, `humanBacked: null` in the response. Repo
     discipline: an error means unknown, never "not human" — and an agent must not be
     punished for our RPC being down. (The demo's negative case is a *successful*
     lookup returning null, not an outage.)
3. Quota: `tryIncrementUsage("a2a:" + utcDay, humanId, A2A_DAILY_QUOTA_PER_HUMAN)`
   via a `PostgresAgentKitStorage` implementing the SDK interface with one atomic
   statement (`INSERT … ON CONFLICT (endpoint, human_id) DO UPDATE SET count =
   agentkit_usage.count + 1 WHERE agentkit_usage.count < $limit` + returning row).
   `false` → 429 `{ error: "quota giornaliera per umano esaurita", humanId }`. Day
   bucket in the endpoint key = daily window with a fixed-size table, no cron.
4. Success response gains `humanBacked: { humanId } | null`.

New table `agentkit_usage { endpoint text, human_id text, count integer, PK(endpoint,
human_id) }`. This is a **deliberate amendment to the A2A route's "writes nothing"
contract**, to be signed off at review: one counter row per (day, human) — no message
content, no addresses, accountability metadata only. Enforcement (403/429) is gated
by `REQUIRE_HUMAN_BACKED_A2A` (same opt-in convention as the mint flag; prod demo
sets it). With the flag off the lookup still runs and `humanBacked` is still
reported — local dev works unregistered.

**B2. Pass-through + UI.** `consultCoach` forwards `humanBacked` from the response;
the chat `consult` object and its jsonb column gain the field; the consult block
badge becomes `verificato via ENS · umano unico ✓` (tooltip: truncated humanId,
`0x12ab…cd34`), rendered only when `humanBacked` is non-null — on the fail-open RPC
path (`humanBacked: null`) the block keeps the ENS badge alone. Non-backed callers
never reach a reply, so there is no "rejected" state to design in this block.

**B3. Agent card.** `agent.json` gains `agentbook: { registered, humanId }` from the
cached lookup (60s positive cache keeps the hot path free of a mandatory live RPC) —
the machine-readable claim other agents read before deciding to talk to us.

**B4. Demo rogue agent.** `scripts/demo-rogue-agent.ts`: one-time setup mints
`rogue.0run.eth` with `addr` = a fresh wallet (never registered) and `agent-signer` =
the script's own key; the script signs a protocol-perfect consult and calls a coach's
a2a endpoint → **403 human_backing_required with identical cryptography** — the
difference between a bot and a human-backed agent, live. Optional stage moment:
register that wallet with the phone, re-run, get 200 + `humanBacked`.

## Error handling

| Failure | Behavior |
|---|---|
| Caller ENS name has no `addr` | 403 `human_backing_required` |
| `lookupHuman` → null | 403 with `agentbook` + `register` pointers |
| World Chain RPC error | Fail-open: 200, `humanBacked: null` |
| Per-human quota exhausted | 429 with `humanId` (only surface where a caller sees its own humanId) |
| Relay 4xx/5xx on register | Widget shows the relay error, restartable with fresh nonce |
| Bridge timeout / user abandons World App | Widget resets to idle after 5 min |
| Stale nonce (registered elsewhere mid-flow) | Relay rejects → widget refetches nonce and restarts |

`REQUIRE_HUMAN_BACKED_A2A` off → none of the 403/429 paths fire; everything else
identical.

## Env vars (append to `.env.example`)

```bash
# --- AgentKit / AgentBook (human-backed agents, World track) ---
AGENTBOOK_RELAY_URL=            # default https://x402-worldchain.vercel.app — relay gasless per la registrazione
A2A_DAILY_QUOTA_PER_HUMAN=      # default 10 — consulti A2A al giorno per humanId (su TUTTI i suoi agenti)
REQUIRE_HUMAN_BACKED_A2A=       # 1 per rifiutare consulti da agenti senza umano dietro (demo: 1)
```

`WORLD_CHAIN_RPC` / `WORLD_AGENTBOOK_ADDRESS` keep working, passed into the SDK
verifier.

## Testing

Same conventions as the repo (vitest, colocated, mocks at module level):

- `agentbook.ts`: SDK verifier mocked — exported contract unchanged, cache behavior,
  error → unknown. Existing `gate.ts` tests must pass untouched (refactor is
  invisible).
- `status` / `register` routes: `requireUser` mocked; relay fetch mocked (200, 4xx
  passthrough); asserts the forwarded `agent` is the session wallet, never body input.
- `a2a` route (extends the A2A branch's test file): unregistered caller → 403 and
  inference never called; quota exhausted → 429; RPC error → 200 with
  `humanBacked: null`; happy path → 200 with `humanId` and storage incremented; flag
  off → no 403/429.
- `PostgresAgentKitStorage`: two increments at `limit-1` → exactly one `true`
  (asserts the atomic statement shape against the mocked db).
- Chat: `humanBacked` pass-through onto the persisted consult object.
- Widget: no component test (bridge-driven; repo tests components only with
  non-trivial logic) — covered by the demo checklist.

## Why this qualifies (track mapping)

- **Uses AgentKit meaningfully**: SDK verifier + SDK storage interface at the
  protocol's enforcement point, plus the full registration flow (bridge + relay)
  embedded in-product.
- **Verifies an agent is human-backed**: at the only boundary where nothing else can
  — an open, sessionless agent-to-agent endpoint.
- **Working end-to-end**: phone registration → gated mint → per-human-limited
  verified consult → rogue agent rejected with identical cryptography.
- **Not the excluded patterns**: no reputation scores; content generation is
  incidental (the demo is admission control of an open agent network); benefits
  framing avoided — this is mutual admission control, per-human quotas, and
  accountability (ban a `humanId`, all its agents lose access). The treasury gas
  subsidy stays out of the pitch.

## Out of scope

x402 paid path for anonymous bots (`declareAgentkitExtension` /
`agentkitResourceServerExtension` — natural roadmap slide, not built), roster
filtering by human-backing, per-coach agent wallets individually registered in
AgentBook, nonce replay ledger, the AgentKit signed-header protocol
(`createAgentkitClient`/`createAgentkitHooks`) — see Verified facts for why it cannot
apply to our coaches.

## Open decisions for the joint review (defaults proposed)

1. Quota default `10/day` per human — arbitrary, pick at review.
2. humanId shown truncated in UI (full value nowhere user-facing) — ok?
3. `REQUIRE_HUMAN_BACKED_A2A` opt-in (off by default) vs always-on in prod.
4. B3 (`agent.json` agentbook field) in or out.
5. Sign-off on the one-write amendment (`agentkit_usage`) to the A2A stateless
   contract.
6. Where Phase B lives: follow-up branch on top of the merged A2A work (proposed) vs
   direct additions to the A2A branch.

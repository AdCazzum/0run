# Human-backed agents on the A2A network (AgentKit / World track)

Date: 2026-07-25
Status: APPROVED by Ivan (conversation review, 2026-07-25) — v2 revised against the
A2A implementation as merged on main (`baf4d28`, reviewed at `919fdc4`) and merged
into this branch. v1 was written against the A2A design doc before the code existed;
three of its calls are corrected below (see "Corrections from v1"). All open
decisions resolved — see the final section.

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
  EIP-191 signature check (implemented: `lib/a2a/protocol.ts` +
  `api/coach/[tokenId]/a2a/route.ts:73-81`).
- **AgentBook (World Chain, eip155:480)** answers *is a unique human behind it*:
  `from` → ENS `addr` record → `lookupHumanId(addr)` → anonymous `humanId`
  (implemented for mint/fund: `lib/world/agentbook.ts`; NOT yet consulted by the a2a
  route).

Rule: **the ENS `addr` of `from` is who must be human-backed; `agent-signer` is who
may speak for it.** The full delegation chain is verifiable onchain:

```
human ──AgentBook──▶ wallet ──ENS addr──▶ agent name ──agent-signer──▶ key ──EIP-191──▶ message
```

This works identically for our coaches (`addr` = owner's Privy embedded wallet, the
same wallet the owner registers in AgentBook) and for external agents (`addr` = their
own agent wallet, registered by their own human). The a2a route already has the
caller's `addr` in hand — `resolveCoachEns(msg.from).address` at `route.ts:75` — so
the humanity check adds **zero extra RPC on the ENS side**.

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

- `AgentKitStorage.tryIncrementUsage(endpoint, humanId, limit): Promise<boolean>` —
  the SDK's own interface for atomic per-human usage limits (docs mandate
  check+increment in one atomic operation). We implement this interface over
  Postgres.
- `createAgentBookVerifier` exists but is **deliberately not used** — see below.
- `createAgentkitClient` / `createAgentkitHooks` implement the signed-header protocol
  — **not usable for our coaches**: the header must be signed by the
  AgentBook-registered wallet, which for us is the owner's client-side Privy wallet;
  our server signs with the shared A2A executor key. The ENS-addr delegation above
  replaces the header protocol.

## Corrections from v1 (what main already decided)

1. **No SDK-verifier refactor.** v1's Phase A1 replaced `agentbook.ts` internals with
   `createAgentBookVerifier`. Main's `lib/world/agentbook.ts` (rewritten since) rejects
   that helper with documented reasons: it collapses RPC outages into `null`
   (conflating "could not ask" with "not registered" — poison for an authorization
   gate) and hardcodes chain 480 for any `rpcUrl`. It also renders `humanId` with
   `toHex` exactly as agentkit-core does, so ids stay string-compatible either way.
   **Keep `lookupHumanId` as the one lookup path.** A1 shrinks to: add a
   `getNextNonce` read beside it.
2. **No fail-open under enforcement.** v1's B1 said "RPC error → fail-open". Main's
   `gate.ts` establishes the repo policy: unknown is neither yes nor no — when the
   gate is enforced, unknown → **503 "riprova"**; only when not enforced does it
   proceed (with a warn). B1 now follows the same policy; the chat already degrades
   gracefully on any consult failure (`consultCoach` never throws, chat says "could
   not be reached"), so a 503 during an RPC blip costs one degraded consult, not a
   broken chat.
3. **No lookup in `agent.json`.** v1's B3 added `agentbook: { registered, humanId }`
   to the card. The card route documents a property worth keeping: "derivable
   entirely from the public row + env: no private data, no live RPC on this hot
   path". A lookup (even 60s-cached) breaks it on every cache miss. Replaced by a
   static `humanBacking` policy block (env-derived, no RPC).

## What exists today (main @ baf4d28, merged here)

- `lib/a2a/protocol.ts` — `ConsultPayload`/`SignedConsult`, canonical digest, EIP-191
  sign/verify vs the ENS `agent-signer`, `a2aAccount()` (null-safe on bad key).
- `api/coach/[tokenId]/a2a/route.ts` — inbound consult: cheap ts/to pre-checks
  (`:66-71`), live `resolveCoachEns(msg.from)` (`:75` — **`caller.address` already
  available**), `verifyConsult` (`:80`), profile cascade, one inference, stateless
  (`:109` "Deliberately no db write"), `{ reply, coach, profileSource }`.
- `lib/a2a/consult.ts` — outbound: ENS discovery of `agent-endpoint[a2a]`,
  `A2A_ENDPOINT_OVERRIDE` origin swap, signed POST, 45s timeout, never throws,
  **strict response-shape validation** (`:60-67`) before trusting a peer's 200.
- `api/coach/chat/route.ts` — marker parse with roster guard (`:142` — never consult
  a name we didn't offer), `consultCoach` call, second inference, `consult` object
  (`:158-165`) persisted on the assistant turn (`chat_messages.consult` jsonb) and
  returned to the client.
- `components/run/chat.tsx` — consult block UI ("verificato via ENS" badge, avatar,
  link), markdown reply (fix `919fdc4`).
- `api/coach/[tokenId]/agent.json/route.ts` — public card, no live RPC by design.
- `lib/world/agentbook.ts` — `lookupHumanId`: direct viem read, 4s cap, positive-only
  60s cache, `{ humanId, error? }` where error = unknown, never denial.
- `lib/world/gate.ts` — mint/fund gate, opt-in via `REQUIRE_HUMAN_BACKED_MINT`,
  unknown→503 when enforced, 403 `human_backing_required` with the CLI `howTo`
  (`:83`), rendered by `mint/page.tsx:251-260`.
- `lib/features.ts` — UI-visibility flags (`NEXT_PUBLIC_FEATURE_*`); enforcement
  flags stay server-side env like `humanBackingEnforced()` (`gate.ts:28`).
- `scripts/backfill-a2a-records.ts` + `setTextRecords` in `lib/ens/subname.ts` —
  reusable for the rogue-agent demo setup.

## Architecture

Two phases, both now buildable in this worktree (the A2A merge resolved v1's
coordination question).

### Phase A — self-serve AgentBook registration

**A1. `getNextNonce` beside `lookupHumanId`.** Same file, same client/config/timeout
discipline (`lib/world/agentbook.ts`): `getNextNonce(address): Promise<{ nonce:
string } | { error: string }>`. No cache (a nonce is consumed by design). No other
change to the module.

**A2. Registration API (both Privy-authenticated; the address is always
`requireUser().wallet`, never client-supplied):**

- `GET /api/world/agentbook/status` → `{ registered, humanId, nonce }` (nonce
  omitted when already registered).
- `POST /api/world/agentbook/register` — body `{ root, nonce, nullifierHash, proof }`
  (zod: proof = exactly 8 hex strings); server forwards
  `{ agent: user.wallet, root, nonce, nullifierHash, proof, contract }` to
  `AGENTBOOK_RELAY_URL/register`; relays `{ txHash }` or the relay's error verbatim
  with an honest status. Proxying keeps the relay URL server-side and avoids CORS
  unknowns.

**A3. `HumanBackingWidget`** (`components/world/human-backing-widget.tsx`, rendered on
the mint page in place of the `howTo` block at `mint/page.tsx:251-260`):

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

**A4. `gate.ts` 403 body** (`:83`): `howTo` becomes "registrati dalla pagina mint —
ti serve solo World App sul telefono" (the widget lives there); the CLI command stays
in docs as fallback. `mint/page.tsx` renders the widget instead of the command box.

**A5. Demo env**: `REQUIRE_HUMAN_BACKED_MINT=1` — every coach in the directory is
backed by exactly one human (`human_id` UNIQUE), which is what makes Phase B's
per-human accounting meaningful.

### Phase B — humanity enforcement on the A2A route

**B1. Inbound enforcement** in `api/coach/[tokenId]/a2a/route.ts`, inserted between
`verifyConsult` ok (`:81`) and `loadConsultProfile` (`:83`), reusing the resolution
already in hand:

1. Accountable wallet = `caller.address` (the ENS `addr` of `from`, `route.ts:75`).
   Missing → 403 `{ error: "human_backing_required" }` (a name with a signer but no
   addr has no one accountable behind it).
2. `lookupHumanId(caller.address)`:
   - `humanId` present → proceed to quota.
   - `humanId: null`, no error (definitely unregistered) → 403
     `{ error: "human_backing_required", agentbook: { contract, network: "eip155:480" }, register: "<SITE_URL>/mint" }`.
   - `error` set (unknown) → **503** `{ error: "impossibile verificare ora il legame
     con un umano, riprova", detail }` — same policy as `gate.ts:48-63`; the calling
     chat degrades gracefully.
3. Quota: `tryIncrementUsage("a2a:" + utcDay, humanId, A2A_DAILY_QUOTA_PER_HUMAN)`
   via a `PostgresAgentKitStorage` implementing the SDK's `AgentKitStorage` interface
   (type imported from `@worldcoin/agentkit`) with one atomic statement
   (`INSERT … ON CONFLICT (endpoint, human_id) DO UPDATE SET count =
   agentkit_usage.count + 1 WHERE agentkit_usage.count < $limit` + returning row).
   `false` → 429 `{ error: "quota giornaliera per umano esaurita", humanId }`. Day
   bucket in the endpoint key = daily window with a fixed-size table, no cron.
4. Success response gains `humanBacked: { humanId } | null` (null only when
   enforcement is off and the lookup was unknown).

All of 1-3 run only when `a2aHumanBackingEnforced()` (new, beside
`humanBackingEnforced()` in `gate.ts`, env `REQUIRE_HUMAN_BACKED_A2A`) — with the
flag off, the lookup still runs best-effort and `humanBacked` is still reported, so
local dev works unregistered and the UI badge can be demoed without enforcement.

New table `agentkit_usage { endpoint text, human_id text, count integer, PK(endpoint,
human_id) }`. This is a **deliberate amendment to the a2a route's "writes nothing"
contract** (`route.ts:109`), to be signed off at review: one counter row per (day,
human) — no message content, no addresses, accountability metadata only. The route's
doc comment gets updated in the same commit, so code and comment never disagree.

**B2. Pass-through + UI.** `consultCoach` forwards `humanBacked` from the response —
as an **optional tolerated field** in the shape validation at `consult.ts:60-67`
(peers that don't send it must keep validating). `ConsultResult`, the chat `consult`
object (`chat/route.ts:158-165`), and the `chat_messages.consult` jsonb type gain
`humanBacked: { humanId: string } | null`. The consult block in
`components/run/chat.tsx` renders `· umano unico ✓` beside "verificato via ENS" only
when `humanBacked` is non-null (tooltip: truncated humanId `0x12ab…cd34`); absent →
ENS badge alone. Non-backed callers never reach a reply, so there is no "rejected"
state in this block.

**B3. Agent card policy block.** `agent.json` gains a static, env-derived (no RPC —
preserving the route's documented property) block:
`humanBacking: { enforced: boolean, registry: { contract, network: "eip155:480" } }`
— the machine-readable admission policy another agent reads before deciding to call
us.

**B4. Demo rogue agent.** `scripts/demo-rogue-agent.ts` (structure mirrors
`backfill-a2a-records.ts`): one-time setup mints `rogue.0run.eth` via
`assignSubname`/`setTextRecords` with `addr` = a fresh wallet (never registered) and
`agent-signer` = the script's own key; the script signs a protocol-perfect consult
and calls a coach's a2a endpoint → **403 human_backing_required with identical
cryptography** — the difference between a bot and a human-backed agent, live.
Optional stage moment: register that wallet with the phone, re-run, get 200 +
`humanBacked`.

## Error handling

| Failure | Behavior |
|---|---|
| Caller ENS name has no `addr` | 403 `human_backing_required` (enforced only) |
| `lookupHumanId` → null, no error | 403 with `agentbook` + `register` pointers (enforced only) |
| `lookupHumanId` → error (unknown) | Enforced: 503 "riprova" (gate.ts policy). Not enforced: proceed, `humanBacked: null` |
| Per-human quota exhausted | 429 with `humanId` (only surface where a caller sees its own humanId) — enforced only |
| Relay 4xx/5xx on register | Widget shows the relay error, restartable with fresh nonce |
| Bridge timeout / user abandons World App | Widget resets to idle after 5 min |
| Stale nonce (registered elsewhere mid-flow) | Relay rejects → widget refetches nonce and restarts |

Every 4xx/5xx above flows back through `consultCoach`'s existing `ok:false` path —
the chat says the colleague could not be reached and the athlete's turn completes.

## Env vars (append to `.env.example`)

```bash
# --- AgentKit / AgentBook (human-backed agents, World track) ---
AGENTBOOK_RELAY_URL=            # default https://x402-worldchain.vercel.app — relay gasless per la registrazione
A2A_DAILY_QUOTA_PER_HUMAN=      # default 20 — consulti A2A al giorno per humanId (su TUTTI i suoi agenti)
REQUIRE_HUMAN_BACKED_A2A=       # 1 per rifiutare consulti da agenti senza umano dietro (demo: 1)
```

`WORLD_CHAIN_RPC` / `WORLD_AGENTBOOK_ADDRESS` keep working (read by
`lib/world/agentbook.ts`).

## Testing

Same conventions as the repo (vitest, colocated, mocks at module level; the a2a and
chat test files already exist and get extended):

- `agentbook.ts`: `getNextNonce` — success, timeout→error, invalid address; existing
  `lookupHumanId` tests untouched.
- `status` / `register` routes: `requireUser` mocked; relay fetch mocked (200, 4xx
  passthrough); asserts the forwarded `agent` is the session wallet, never body input.
- `a2a` route (extends `a2a.test.ts`, with `_setAgentBookForTest`): enforced +
  unregistered → 403 and inference never called; enforced + lookup error → 503;
  enforced + quota exhausted → 429; happy path → 200 with `humanId` and storage
  incremented; flag off → 200 regardless, `humanBacked` reported best-effort.
- `PostgresAgentKitStorage`: two increments at `limit-1` → exactly one `true`
  (asserts the atomic statement shape against the mocked db).
- `consultCoach` (extends `consult.test.ts`): peer response without `humanBacked`
  still validates; with it, passes through.
- Chat (extends `chat.test.ts`): `humanBacked` lands on the persisted consult object.
- Widget: no component test (bridge-driven; repo tests components only with
  non-trivial logic) — covered by the demo checklist.

## Why this qualifies (track mapping)

- **Uses AgentKit meaningfully**: the full AgentKit registration protocol (World ID
  bridge + AgentBook + gasless relay) embedded in-product, AgentBook as the
  enforcement registry at the protocol boundary, and the SDK's `AgentKitStorage`
  contract implemented for per-human limits. (We read the registry directly instead
  of via `createAgentBookVerifier` for documented correctness reasons —
  `agentbook.ts` header — worth one honest line in the pitch.)
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

## Decisions (resolved at review, 2026-07-25)

1. Quota: **20/day** per human.
2. humanId in UI: **truncated** (tooltip on the "umano unico ✓" badge).
3. `REQUIRE_HUMAN_BACKED_A2A`: **opt-in flag, set to 1 in prod/demo** (same
   convention as `REQUIRE_HUMAN_BACKED_MINT`).
4. The one-write amendment (`agentkit_usage`) to the a2a stateless contract:
   **approved** — route doc comment updated in the same commit.
5. Phase order: **A then B**.

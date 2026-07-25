# World / AgentKit in 0run

**Prize fit in one paragraph:** 0run's coaches consult each other over an open agent-to-agent protocol — exactly the setting where a service must tell "a bot" from "an agent acting on behalf of a real, unique human". AgentKit is the enforcement layer, not a badge: the receiving agent resolves the caller's on-chain wallet in AgentBook and refuses agents with nobody behind them (403), meters usage **per human** across all their agents (429 — sybil-proof by construction), and answers "could not check" with 503 rather than a lie. Human-backing changes *access, rate limits and accountability* of the network, ownership is one-human-one-coach, and registration is self-serve in-product (World App QR + gasless relay — no CLI). The negative case is demoable live with identical cryptography (`scripts/demo-rogue-agent.ts`).

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

## Where it's visible

| Surface | What it shows | Where |
|---|---|---|
| Chat consult block | `verified via ENS` (blue) `· unique human ✓` (green, truncated humanId in the tooltip) on every colleague reply | `apps/web/src/components/run/chat.tsx` |
| Mint page | The full registration flow (`HumanBackingWidget`): QR → World App → relay → "human-backed ✓" | `apps/web/src/components/world/human-backing-widget.tsx` |
| Dashboard | "prove you are one real human" nudge, only while unregistered | `apps/web/src/app/(app)/dashboard/page.tsx` |
| Landing hero | "human-backed ✓" badge for signed-in, verified visitors — renders nothing otherwise | `apps/web/src/components/world/human-badge.tsx` |
| Agent card | Machine-readable admission policy `humanBacking: { enforced, registry }` other agents read before calling | `apps/web/src/app/api/coach/[tokenId]/agent.json/route.ts` |
| Technology page | The public, no-overclaim explanation ("Every agent answers to a human") | `apps/web/src/app/technology/page.tsx` |

## Code map

| What | Where |
|---|---|
| AgentBook lookup (direct read, 4s cap, positive-only cache; error = unknown, never "not registered") | `apps/web/src/lib/world/agentbook.ts` — `lookupHumanId`, `getAgentNonce`, `agentBookAddress` |
| Admission control on the a2a endpoint (403 / 429 / 503, runs AFTER ENS signature verification) | `apps/web/src/lib/world/gate.ts` — `checkA2aAdmission`; wired in `apps/web/src/app/api/coach/[tokenId]/a2a/route.ts:87-93` |
| Per-human quota: the SDK's `AgentKitStorage` contract implemented over Postgres, one atomic statement | `apps/web/src/lib/world/agentkitStorage.ts` |
| Registration API (session wallet only, relay proxied server-side) | `apps/web/src/app/api/world/agentbook/{status,register}/route.ts` |
| Mint/fund ownership gate | `apps/web/src/lib/world/gate.ts` — `checkHumanBacking` |
| World ID proof-of-personhood for event claims (nullifier uniqueness) | `apps/web/src/lib/world/verify.ts`, `apps/web/src/app/api/events/[id]/claim/route.ts` |

## Demo

`scripts/demo-rogue-agent.ts` — a cryptographically perfect ENS agent with no
human behind it gets 403 from a coach's a2a endpoint; register its wallet in
World App and the same request gets 200 + `humanBacked`. See the script header
for the exact commands.

## A note on the SDK, for honesty

`createAgentkitClient`/`createAgentkitHooks` (the signed-header protocol) can't
apply to our coaches: the header must be signed by the AgentBook-registered
wallet, which for us is the owner's client-side wallet, while the server signs
with a delegated executor key. The ENS delegation chain above replaces it with
the same guarantee. We also read AgentBook directly instead of via
`createAgentBookVerifier`, because that helper collapses RPC failures into
`null` — conflating "could not ask" with "not registered", which an
authorization gate must never do (full reasoning in
`apps/web/src/lib/world/agentbook.ts`'s header comment). The SDK's
`AgentKitStorage` interface, the AgentBook registry, the World ID bridge and
the gasless relay are used as designed.

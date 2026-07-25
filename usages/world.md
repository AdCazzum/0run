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

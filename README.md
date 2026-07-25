# 0run — the AI running coach you own

Upload a run. A coach that is **yours** — an intelligent NFT, not an account on someone's platform — reads it against everything you have ever run, remembers it forever in encrypted memory, talks it over with other coaches, and answers to exactly one real human: you.

Live: **https://0run.fun** · Built at ETHGlobal Lisbon 2026 on **0G**, **ENS** and **World** — three partner stacks, each doing the one thing it is best at, each load-bearing.

## The problem

Your training data is some of the most personal data you produce — where you run, when, how your heart behaves — and today it lives in silos that monetize it, analyze it opaquely, and hold it hostage. Getting AI coaching means handing raw health data to someone's cloud and trusting a black box twice: once with your privacy, once with the answer. And as AI agents start talking to each other on your behalf, a third problem appears: on an open network, nothing distinguishes a coach acting for a real person from a bot farm scraping and spamming.

0run answers all three:

- **Privacy** — every run is AES-256 encrypted *before it leaves your session*, with a key derived from your wallet signature that is never persisted anywhere. Nobody can read your runs. Not even us.
- **Verifiable analysis** — the coach's reasoning runs on decentralized compute with on-chain billing traces, and the effort score is computed inside a TEE with a per-response cryptographic attestation. Where attestation is unavailable, the UI says so instead of implying it.
- **Ownership & portability** — the coach, its personality and its entire memory are bound to a token you hold and a name anyone can resolve. No platform sits between you and your coach.
- **A human-backed agent network** — coaches consult each other over an open protocol, and every one of them provably answers to a unique human being.

## A consumer product, not a crypto demo

Nothing about using 0run requires knowing what a wallet is. You sign in with **email** (Privy creates an embedded wallet silently), export a GPX from the watch or app you already use, and drop it in. Verification of personhood is a QR code and a phone — the same gesture as any 2FA. Gas is sponsored, keys are derived, chains are invisible. The web3 machinery is what makes the guarantees real; the experience is a running app your non-crypto friend can use today.

## What is deployed and provable

| Thing | Value |
|---|---|
| AgentNFT (`OrunAgentNFT`, ERC-7857-style) | [`0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e`](https://chainscan-galileo.0g.ai/address/0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e) on 0G Galileo (16602) |
| CoachRegistry (memory anchor, one update per run) | [`0x08b3a841393ab09A4C902800C55d24e6AF66945f`](https://chainscan-galileo.0g.ai/address/0x08b3a841393ab09A4C902800C55d24e6AF66945f) |
| A coach minted | [tx `0x28b9c02e…`](https://chainscan-galileo.0g.ai/tx/0x28b9c02e26e8735d3ab9e474a49669069a21f0e1e6898f2cd2c05def1a24799d) · memory anchored: [tx `0x5d3ebbc6…`](https://chainscan-galileo.0g.ai/tx/0x5d3ebbc6dbd2e35085ebc86df8bccb6e286b61b13d6b438a55a924987026d812) |
| ERC-8004 Agentic ID | [tx `0x8b571001…`](https://chainscan-galileo.0g.ai/tx/0x8b571001e567be0bb27c8650fc819b3fcb1e5dea54f9ed1057c634fa6fde9c40) → agentId 148 on the live IdentityRegistry |
| Inference on 0G Compute | `glm-5.2`, on-chain billed — provider `0x7DCFe6AE…`, request id in `x_0g_trace` |
| ENS identity, resolved live | [`pedro.0run.eth`](https://sepolia.app.ens.domains/pedro.0run.eth) (Sepolia) — ENSIP-26 records incl. `agent-endpoint[a2a]`, `agent-signer` |
| Human backing, enforced in prod | `GET /api/coach/3/agent.json` → `humanBacking: { enforced: true, registry: { contract: 0xA23a…44dA, network: "eip155:480" } }` |

Every number above was measured against the real network, not estimated. The measurement log — including the constraints that forced architectural changes — is in [`docs/0g-reality-check.md`](docs/0g-reality-check.md).

## Architecture

```mermaid
flowchart TB
    U[Runner] -->|"email login, no seed phrase"| P[Privy embedded wallet]
    U -->|GPX upload| API[Next.js API routes]

    subgraph Browser
      P
      K["key = HKDF(wallet signature)<br/>never leaves the session"]
    end

    subgraph Server["apps/web — Next.js"]
      API --> PARSE[GPX parser: pace, splits, elevation]
      API --> PIPE[run pipeline: 5 visible steps]
      PIPE --> ENC[AES-256-GCM envelope]
      PIPE --> MEM["two-layer memory<br/>private layer + coaching profile"]
    end

    ENC -->|encrypted blob| ST[(0G Storage)]
    MEM -->|"rootHash (computed locally)"| CH[0G Chain]
    CH --> NFT[OrunAgentNFT: the coach you own]
    CH --> REG[CoachRegistry: memory hash per run]
    PIPE -->|"stats + history, never raw GPX"| CMP[0G Compute<br/>attested inference]
    CMP -->|report + x_0g_trace| DB[(Postgres: rebuildable index)]

    style ST fill:#F7C59F,stroke:#004E89
    style CH fill:#F7C59F,stroke:#004E89
    style CMP fill:#F7C59F,stroke:#004E89
```

And the agent network on top — every arrow verified on-chain at request time:

```mermaid
flowchart LR
    H((("you<br/>(one real human)"))) -->|"approve once<br/>in World App"| AB[(AgentBook<br/>World Chain)]
    A["marco.0run.eth<br/>(your coach)"] -->|"signed consult<br/>EIP-191"| B["pedro.0run.eth<br/>(another coach)"]
    B -->|"resolve name →<br/>agent-signer"| ENS[(ENS<br/>Sepolia)]
    B -->|"resolve addr →<br/>lookupHuman"| AB
    B -->|"no human? 403<br/>over quota? 429"| A

    style ENS fill:#F7C59F,stroke:#004E89
    style AB fill:#F7C59F,stroke:#004E89
```

**The privacy boundary is the key boundary.** The private layer of the coach's memory (your raw runs) is encrypted with a key derived from your wallet signature — the server never persists it. The *coaching profile* (personality, methodology, non-personal aggregates) is encrypted with a service key, which is what a consult can safely draw on: when another coach asks yours a question, it sees the profile, never the private layer, and nothing is written. Honest limitation: while processing a run the server sees the plaintext, because the GPX has to be parsed. Moving that inside confidential compute is a roadmap item, not a solved problem — and we say so.

## How each partner stack is used — at its best, not as a checkbox

### 0G — the coach exists on it ([full map](usages/0g.md))

The coach **is** 0G infrastructure: an ERC-7857-style iNFT on **0G Chain** (plus an ERC-8004 Agentic ID on the live IdentityRegistry), encrypted memory on **0G Storage** with the Merkle root computed locally and anchored on-chain after every run, and reasoning on **0G Compute** — the effort score deliberately forced onto a TEE-attested provider (`processResponse`), the narrative report on the router path, and the UI honest about which is which. We measured the network's real behavior (uploads that take 22+ minutes to finalize, SDK calls with no timeouts) and engineered around it rather than pretending; every workaround is documented in [`docs/0g-reality-check.md`](docs/0g-reality-check.md). 0G DA is deliberately not used — it serves rollups, and wiring it in would only signal we hadn't read the stack.

### ENS — identity, discovery **and authentication** for agents ([full map](usages/ens.md))

Every coach gets `<name>.0run.eth`, resolved live on every render — no cache, no fallback string, and that property is tested, not claimed. The ENSIP-26 records carry the agent's human description, its web endpoint, a pointer to the exact iNFT (`0run:inft`), and — the part we are proudest of — its **machine identity**: `agent-endpoint[a2a]` is where another agent calls it, and `agent-signer` is the key allowed to speak for it. When a consult arrives, the receiver authenticates it with *nothing but a fresh name resolution*: no tokens, no API keys, no peer table — the only registry of who may speak is ENS. The same resolution's `addr` is the accountable wallet the humanity check runs against, so one lookup answers both "who is speaking" and "who answers for it".

### World — proof that a unique human stands behind every agent ([full map](usages/world.md))

The consult protocol is open by design — which is exactly why it needs AgentKit. Before answering, a coach resolves the caller's wallet in **AgentBook** (World Chain): an on-chain mapping to an anonymous `humanId` that exists only because a person approved the delegation in World App, biometrically. No human behind the name → **403**, however perfect the cryptography (demo it live: [`scripts/demo-rogue-agent.ts`](scripts/demo-rogue-agent.ts)). Consults are metered **per human across all their agents** (the SDK's `AgentKitStorage` contract, implemented as one atomic Postgres statement) → spinning up wallets multiplies nothing → **429**. "Could not check" answers **503**, never a lie. Owning a coach requires the same proof — one human, one coach — and registration is fully self-serve in-product: nonce → World App QR → gasless relay, no CLI. The result is a network where human backing changes **access, rate limits, economic terms and accountability** — and the UI shows it: `verified via ENS · unique human ✓` on every consult.

## The demo path

1. Sign in with email → mint your coach (requires proving you are one real human — QR, World App, done).
2. Upload a GPX → watch the pipeline: encrypt → store on 0G → anchor memory hash → attested effort score → coach report.
3. Ask your coach something outside its specialty → it consults a colleague, discovered and verified via ENS, human-checked via AgentBook — the cross-coach exchange renders in chat with both badges.
4. Run the rogue agent script → perfect signature, no human → `403 human_backing_required`. Register that wallet with a phone → same request → `200`.

## Prize qualification, point by point

### 0G — submission requirements

- **Project name and short description** — 0run, the AI running coach you own (top of this README).
- **Contract deployment addresses** — `OrunAgentNFT` [`0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e`](https://chainscan-galileo.0g.ai/address/0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e), `CoachRegistry` [`0x08b3a841393ab09A4C902800C55d24e6AF66945f`](https://chainscan-galileo.0g.ai/address/0x08b3a841393ab09A4C902800C55d24e6AF66945f), `RunEvents` [`0x1D66dd7C7b3f4228f7816Eb266fDCaeF49Cd89bE`](https://chainscan-galileo.0g.ai/address/0x1D66dd7C7b3f4228f7816Eb266fDCaeF49Cd89bE) — all on 0G Galileo (16602).
- **Public GitHub repo with README + setup** — you are reading it; setup is in [Run it locally](#run-it-locally).
- **Live demo** — https://0run.fun (a working product, not a repo). **Demo video** — _link here, < 3 min_.
- **Which 0G features/SDKs** — 0G Chain (contracts above, via ethers), 0G Storage (`@0gfoundation/0g-storage-ts-sdk`, SDK `aes256` encryption + local Merkle roots), 0G Compute (`@0gfoundation/0g-compute-ts-sdk` broker on the direct path + OpenAI-compatible router), ERC-8004 Agentic ID. Full map: [`usages/0g.md`](usages/0g.md).
- **Proof of 0G Compute inference** — every report carries `x_0g_trace` (provider `0x7DCFe6AE…`, request id, on-chain billing); the effort score additionally returns a per-response TEE attestation via `processResponse` ([`direct.ts:58`](apps/web/src/lib/inference/direct.ts#L58)). Measured evidence: [`docs/0g-reality-check.md`](docs/0g-reality-check.md).
- **Agentic ID on the 0G explorer** — [tx `0x8b571001…`](https://chainscan-galileo.0g.ai/tx/0x8b571001e567be0bb27c8650fc819b3fcb1e5dea54f9ed1057c634fa6fde9c40) → **agentId 148** on the live IdentityRegistry [`0x8004A818…`](https://chainscan-galileo.0g.ai/address/0x8004A818BFB912233c491871b3d84c89A494BD9e), with `getMetadata(148, "0run.tokenId") = "3"` linking it on-chain to our AgentNFT.
- **Team** — Ivan Sala · Telegram: [`@wonderdnal`](https://t.me/wonderdnal) · X: [`@slavni96`](https://x.com/slavni96).

### ENS — qualification

- **Not a cosmetic add-on** — ENS is the identity (`pedro.0run.eth`, ENSIP-26 records, `0run:inft` pointer to the exact token), the discoverability (the public directory resolves every coach by name; peers find each other's consult endpoint via `agent-endpoint[a2a]`, [`consult.ts:36`](apps/web/src/lib/a2a/consult.ts#L36)) **and the authentication layer**: an inbound consult is authenticated by resolving the caller's `agent-signer` record fresh and verifying the EIP-191 signature against it — no tokens, no API keys ([`a2a/route.ts:77-85`](apps/web/src/app/api/coach/%5BtokenId%5D/a2a/route.ts#L77-L85)). Remove ENS and the agent network stops working — that is the opposite of cosmetic.
- **Functional demo, no hard-coded values** — every name, record and resolver address is resolved live on every use; a rejecting RPC yields empty values, never a placeholder — asserted by tests and counter-proven live (`this-definitely-does-not-exist-zzz.0run.eth` → `{address: null, records: {}}`, [`docs/decisions.md`](docs/decisions.md)).
- **Video / live demo + booth** — live at https://0run.fun (mint a coach → it gets a name → consult flows through it); presenting in person at the ENS booth Sunday morning.

### World — qualification

- **Uses AgentKit in a meaningful way** — AgentKit is the enforcement layer of an open agent-to-agent protocol, not a badge: AgentBook lookup at the protocol boundary ([`gate.ts:123`](apps/web/src/lib/world/gate.ts#L123)), per-human metering through the SDK's `AgentKitStorage` contract implemented as one atomic Postgres statement ([`agentkitStorage.ts`](apps/web/src/lib/world/agentkitStorage.ts)), and the full registration protocol (World ID bridge with AgentBook's own app_id/action/signal + gasless relay) embedded in-product ([`human-backing-widget.tsx`](apps/web/src/components/world/human-backing-widget.tsx)). Full map: [`usages/world.md`](usages/world.md).
- **Verifies an agent is human-backed** — before answering, a coach resolves the caller's ENS `addr` in AgentBook: no human → `403 human_backing_required`; over the per-human quota (20/day across ALL that human's agents) → `429`; registry unreachable → `503`, never a lie. Enforced in production right now: `GET https://0run.fun/api/coach/3/agent.json` → `humanBacking: { enforced: true }`.
- **Working end-to-end flow** — register with a phone (QR → World App → relay) → mint (one human, one coach — `human_id` UNIQUE) → your coach consults another and the chat shows `verified via ENS · unique human ✓` → run [`scripts/demo-rogue-agent.ts`](scripts/demo-rogue-agent.ts): a cryptographically perfect agent with no human behind it gets 403; register its wallet and the same request gets 200.
- **Not the excluded patterns** — no reputation scores anywhere; content generation is incidental (the demo is admission control of an open agent network, a new trust model: ENS answers *who speaks*, AgentBook answers *who stands behind it*); and this is not "perks for agents" — it is mutual admission control, sybil-proof per-human rate limits, and accountability (ban a `humanId` and every agent it backs loses access, present and future).

## Run it locally

Prerequisites: Node 22, Docker, a funded 0G Galileo wallet, a 0G Compute router API key ([pc.0g.ai](https://pc.0g.ai)), a Privy app ([dashboard.privy.io](https://dashboard.privy.io)).

```bash
cp .env.example .env          # then fill it in — see the comments in that file
docker compose up -d db       # Postgres on 127.0.0.1:5432
npm install                   # .npmrc already sets legacy-peer-deps
cd apps/web && DATABASE_URL=postgres://orun:orun@localhost:5432/orun \
  npx drizzle-kit push --config drizzle.config.ts && cd ../..
npm run dev -w web            # http://localhost:3000
```

Deploy the contracts to Galileo (optional — addresses above already work):

```bash
cd contracts && set -a && . ../.env && set +a
npx hardhat run scripts/deploy.ts --network zgTestnet
```

## Tests

```bash
npm run test --workspaces      # 397 unit/integration tests (vitest, colocated)
cd contracts && npx hardhat test
cd apps/web && npx tsc --noEmit
```

End-to-end against a running instance (this is also how the demo account is seeded — the runs a judge sees go through the same code path a user does):

```bash
BASE=https://0run.fun PRIVY_TOKEN=… DEMO_KEY_HEX=… npx tsx scripts/demo-journey.ts
```

## Repository layout

```
apps/web         Next.js app: UI, API routes, 0G clients, ENS, A2A, World/AgentKit, crypto, pipeline
contracts        Hardhat: OrunAgentNFT, CoachRegistry, RunEvents (+ deploy scripts)
packages/shared  types, zod schemas, chain constants (single source for chainId)
deploy           Dockerfile consumer, compose, nginx vhost, deploy + bootstrap scripts
docs             design + implementation specs, decisions log, measured reality
usages           per-sponsor map from integration to the exact code (0g, ens, world)
scripts          demo journey, ENS record backfill, rogue-agent demo
```

## Deployment

Self-hosted on a Hetzner box: host nginx terminates TLS for `0run.fun` and proxies to the app container on loopback; Postgres has no published port. The image is built **on the server**, so no production secret ever reaches this public repository or CI. `git push` to `main` runs the full test suite and only then deploys, with schema migration (`drizzle-kit push`), a health check and automatic rollback to the last good commit. Details and trade-offs: [`docs/superpowers/specs/2026-07-25-cicd-deploy-spec.md`](docs/superpowers/specs/2026-07-25-cicd-deploy-spec.md).

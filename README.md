# 0run — the AI running coach you own

Upload a GPX. It is encrypted with a key derived from your wallet signature and stored on **0G Storage**. An AI coach — minted as an **intelligent NFT on 0G Chain** — reads it against everything you have run before, with inference executed on **0G Compute** and billed on-chain. The coach's memory grows with every run and its hash is anchored on-chain, so the coach is yours: portable, verifiable, and nobody else's asset.

Live: **https://0run.fun** · Built for ETHGlobal Lisbon 2026 (0G track).

## What is deployed and provable

| Thing | Value |
|---|---|
| AgentNFT (`OrunAgentNFT`, ERC-7857-style) | [`0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e`](https://chainscan-galileo.0g.ai/address/0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e) |
| CoachRegistry (memory anchor) | [`0x08b3a841393ab09A4C902800C55d24e6AF66945f`](https://chainscan-galileo.0g.ai/address/0x08b3a841393ab09A4C902800C55d24e6AF66945f) |
| First coach minted (tokenId 1) | [tx `0x28b9c02e…`](https://chainscan-galileo.0g.ai/tx/0x28b9c02e26e8735d3ab9e474a49669069a21f0e1e6898f2cd2c05def1a24799d) |
| Memory anchored on-chain | [tx `0x5d3ebbc6…`](https://chainscan-galileo.0g.ai/tx/0x5d3ebbc6dbd2e35085ebc86df8bccb6e286b61b13d6b438a55a924987026d812) |
| Inference on 0G Compute | `glm-5.2`, 19.5s, on-chain billed — provider `0x7DCFe6AE…`, request id `13eed4ff-…` |
| Chain | 0G Galileo testnet, chainId **16602** |

Every number above was measured against the real network, not estimated. The full measurement log — including the constraints that forced architectural changes — is in [`docs/0g-reality-check.md`](docs/0g-reality-check.md).

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

**The privacy boundary is the key boundary.** The private layer of the coach's memory (your raw runs) is encrypted with a key derived from your wallet signature — the server never persists it. The *coaching profile* (personality, methodology, non-personal aggregates) is encrypted with a service key, which is what makes lending a coach possible later without exposing the owner's data. Honest limitation: while processing a run the server sees the plaintext, because the GPX has to be parsed. Moving that inside 0G Private Computer is the roadmap item, not a solved problem.

## Which 0G services and why

- **0G Chain** — the coach is an NFT you own (`contracts/contracts/OrunAgentNFT.sol`), and every memory update is anchored by hash (`contracts/contracts/CoachRegistry.sol`). This is the answer to "why on-chain": ownership of the agent and an auditable trail of its growth.
- **0G Storage** — encrypted GPX files and the encrypted coach memory, with the SDK's own `aes256` encryption on top of our envelope.
- **0G Compute** — the coach's reasoning. Responses carry `x_0g_trace` (provider address, request id, on-chain cost), which is our proof of use.
- **Agentic ID / ERC-7857** — the coach is minted with `IntelligentData` referencing the encrypted memory root.

Not used, deliberately: **0G DA**, which exists for rollups and has nothing to do with this product. Adding it to look thorough would signal we had not read the stack.

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
npm run test --workspaces      # 63 unit/integration tests
cd contracts && npx hardhat test
cd apps/web && npx tsc --noEmit
```

End-to-end against a running instance (this is also how the demo account is seeded — the runs a judge sees go through the same code path a user does):

```bash
BASE=https://0run.fun PRIVY_TOKEN=… DEMO_KEY_HEX=… npx tsx scripts/demo-journey.ts
```

## Repository layout

```
apps/web         Next.js app: UI, API routes, 0G clients, crypto, pipeline
contracts        Hardhat: OrunAgentNFT, CoachRegistry (+ deploy scripts)
packages/shared  types, zod schemas, chain constants (single source for chainId)
deploy           Dockerfile consumer, compose, nginx vhost, deploy + bootstrap scripts
docs             design + implementation specs, decisions log, measured reality
usages           per-sponsor map from integration to the exact code
scripts          demo journey / smoke test
```

## Deployment

Self-hosted on a Hetzner box: host nginx terminates TLS for `0run.fun` and proxies to the app container on loopback; Postgres has no published port. The image is built **on the server**, so no production secret ever reaches this public repository or CI. `git push` to `main` runs the full test suite and only then deploys, with a health check and automatic rollback to the last good commit. Details and trade-offs: [`docs/superpowers/specs/2026-07-25-cicd-deploy-spec.md`](docs/superpowers/specs/2026-07-25-cicd-deploy-spec.md).

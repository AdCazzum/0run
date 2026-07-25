# 0run — guide for coding agents

0run is an AI running coach owned by its user: an ERC-7857-style iNFT on 0G Galileo whose encrypted memory lives on 0G Storage, whose reasoning runs on 0G Compute, whose public identity is a live-resolved ENS subname, and whose agent-to-agent consults are gated on World's AgentBook (a unique human must stand behind every agent). Built at ETHGlobal Lisbon 2026; deployed at https://0run.fun.

## Monorepo map

```
apps/web                 Next.js 16 app — READ apps/web/AGENTS.md BEFORE writing any Next code
  src/app/api            route handlers (params are a Promise — await them)
  src/lib/zerog          0G Storage/Chain/Compute clients (storage.ts, contracts.ts, ../inference)
  src/lib/ens            subname writes (subname.ts) + live resolution (resolve.ts)
  src/lib/a2a            agent-to-agent consult protocol (EIP-191 over canonical digest)
  src/lib/world          AgentBook lookup (agentbook.ts), gates (gate.ts), quota (agentkitStorage.ts)
  src/lib/coach          pipeline, prompts, memory, consult-profile
  src/lib/crypto         AES envelope + HKDF key derivation from wallet signature
  src/db/schema.ts       drizzle schema (no migration files: drizzle-kit push, also at deploy)
contracts                Hardhat — OrunAgentNFT, CoachRegistry, RunEvents (0G Galileo, chainId 16602)
packages/shared          types, zod schemas, chain constants (the single source for chainId)
deploy                   docker-compose.prod.yml, deploy.sh (runs ON the server), nginx vhost
usages/                  per-sponsor integration maps (0g.md, ens.md, world.md) — keep aligned with code
docs/                    decisions.md, 0g-reality-check.md, superpowers/specs + plans
```

## Commands

```bash
npm run dev -w web                          # dev server (needs docker compose up -d db + .env)
cd apps/web && npx vitest run               # full web suite (~400 tests)
cd apps/web && npx vitest run <path>        # one file
cd apps/web && npx tsc --noEmit             # typecheck
cd apps/web && npm run build                # production build (Turbopack)
cd contracts && npx hardhat test            # contract tests
```

## Conventions that are load-bearing

- **API error strings in Italian; UI copy in English.** Both are deliberate; don't "fix" either direction.
- **Never-throw receipt discipline**: integration helpers (`uploadEncrypted`, `assignSubname`, `consultCoach`, `lookupHumanId`, …) return `{ ok/error }`-shaped results and never throw for expected failures. Best-effort side lanes (ENS assignment, ERC-8004, avatar) must never fail or delay the main action they decorate.
- **Unknown ≠ denial**: `lookupHumanId` returns `{ humanId, error? }` where `error` means *could not check*. Enforced gates answer unknown with **503 "riprova"**, never 403 — and never fail-open silently. Do not replace the direct AgentBook read with the SDK's `createAgentBookVerifier` (it collapses RPC failures into `null`; reasoning in the file header).
- **Enforcement flags are opt-in env vars**, off by default, on in prod: `REQUIRE_HUMAN_BACKED_MINT`, `REQUIRE_HUMAN_BACKED_A2A` (quota `A2A_DAILY_QUOTA_PER_HUMAN`, default 20/day per humanId).
- **Nothing ENS is hard-coded**: names/records/resolver are resolved live every time; tests assert that a failing resolution yields empty values, never invented ones. The parent name works via ENSIP-10 wildcard + PermissionedResolver (no Registry entry!) — see `usages/ens.md` and `docs/decisions.md` before touching subname logic.
- **A2A trust model**: ENS answers *who speaks* (`agent-signer` verified per request), AgentBook answers *who stands behind it* (`addr` → `lookupHuman`). Admission always runs AFTER signature verification. The a2a route is stateless except the per-human quota counter (`agentkit_usage`) — an explicitly approved amendment, documented in the route's doc comment.
- **Privacy contract of consult paths** (`ask`, `a2a`): profile layer only (service-key encrypted), never `memoryRoot`/`memoryCipher` (owner-key encrypted), and no writes.
- **Tests**: vitest, colocated next to the file under test, module-level `vi.mock` factories, DB mocked at `@/db`. The a2a route test's db mock has no insert on purpose — that IS the stateless assertion.
- **Registration bridge**: `@worldcoin/idkit-core` is pinned to exactly **2.1.0** (the agentkit-cli bridge protocol). The repo's `@worldcoin/idkit` v4 is a different protocol (rp_context) used for event claims — do not mix them.

## Environment

`.env.example` is the documented source of truth. Groups: Privy (`NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`), 0G (`ZG_*`, `TREASURY_PRIVATE_KEY`, contract addresses, `ROUTER_*`/`DIRECT_*` inference), ENS (`ENS_*` — Sepolia), A2A (`A2A_SIGNER_PRIVATE_KEY`, dev-only `A2A_ENDPOINT_OVERRIDE`), World (`WORLD_*`, `AGENTBOOK_RELAY_URL`, enforcement flags). Production `.env` lives only on the server (`/srv/0run/.env`), never in git or CI.

## Deploy

Push to `main` → GitHub Actions → SSH → `deploy/deploy.sh` on the Hetzner host: `git reset --hard`, image built on-server, `drizzle-kit push` via the compose `migrate` service, health check, automatic rollback to `.last_good_sha` on failure. Keep schema changes additive (push uses `--force`).

## Measured reality (read before "fixing" something odd)

- 0G Storage uploads can take 16–22+ minutes to become downloadable, and SDK calls can hang forever — hence local Merkle-root computation, cached cipher columns, and timeouts everywhere (`docs/0g-reality-check.md`).
- The 0G Compute SDK's ESM build is broken; the CJS build is loaded explicitly in `lib/inference/direct.ts`.
- `next build` on the prod host is RAM-constrained (3.7 GiB) — don't fatten the build.

## Where the story is told

`README.md` (product + partner-stack narrative), `usages/*.md` (per-sponsor prize-fit + code map — update them when integrations change), `apps/web/src/app/technology/page.tsx` (the public, no-overclaim explanation), `docs/superpowers/specs/*` (approved designs; the human-backing one is `2026-07-25-agentkit-human-backing-design.md`).

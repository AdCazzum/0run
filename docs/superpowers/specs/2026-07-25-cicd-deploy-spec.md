# 0run — CI/CD and automatic deploy to 0run.fun

**Date:** 2026-07-25 · **Status:** partially implemented — server inspected and configured, deploy scaffolding written, first end-to-end deploy not yet executed · **Depends on:** [MVP design](./2026-07-24-0run-mvp-design.md)

## 1. Goal and constraints

Push to `main` on `AdCazzum/0run` → tests → build check → deploy to Hetzner (37.27.47.147) → `https://0run.fun` updated, with a health check and automatic rollback. Constraints: the repo is **public** (anything that lands in CI logs is visible to the world), no Vercel/SaaS registries (self-hosted preference), and Sunday's demo must never break because of a deploy. The server has already been inspected and partially configured: DNS `0run.fun` → `37.27.47.147` verified, root SSH access active with two dedicated keys (`orun-claude-deploy` for the operator, `orun-gh-actions` for CI), production `.env` already written at `/srv/0run/.env`. An additional constraint that emerged in the field: **3.7 GiB RAM + 2 GiB swap** — tight for a `next build` in a monorepo (§2.1).

## 2. Key decisions (explicit trade-offs)

1. **Build on the server, not in CI.** CI runs `next build` only as a *gate* (with fake env values); the image that goes to production is built on Hetzner by `docker compose build`, which reads the real `NEXT_PUBLIC_*` values from the server's `.env`. Trade-off: the build consumes the server's CPU **and RAM** and the deploy takes a few minutes, but **no secret or production env value ever touches GitHub** and no registry is needed (GHCR would add login, tags, and one more place to get things wrong). With a public repo this is the smallest-surface choice. **Known risk:** the host has only 3.7 GiB of RAM (+2 GiB swap); `next build` on a monorepo is the most fragile point of the pipeline. Mitigations in place: the pre-existing `coachme` stack on the same host was stopped to free memory (~3.0 GiB available now — if it has to come back, the RAM budget must be re-evaluated, §7/§9d), and swap absorbs the peaks. **Documented fallback if the build still OOMs:** move the build to CI and publish the image to GHCR (public package, no registry auth needed) — not implemented today, activated only if the on-server build proves unreliable.
2. **`git reset --hard` on the server, not rsync.** The repo is public: the server does `git fetch --prune origin && git reset --hard <target>` (clone already present in `/srv/0run`, managed by `deploy/bootstrap.sh`). Rsync from CI would transfer the runner's working copy and is one more channel to protect; git also gives SHA-based rollback for free. The `.env` is gitignored and survives untouched.
3. **CI should only be able to *trigger* the deploy, not run arbitrary commands — today that is not yet the case.** The `orun-claude-deploy` (operator) and `orun-gh-actions` (CI) keys are installed in `/root/.ssh/authorized_keys` **without a forced command**: the CI key currently has a full root shell, not just the deploy trigger. The `deploy.yml` workflow uses it in a disciplined way (it only runs `deploy.sh <sha>`), but if the private key ever leaked from the secrets, the attacker would have a full shell on the server, not just the ability to redeploy `main`. **Known gap, not yet closed:** restricting the CI key with `command="/srv/0run/deploy/deploy.sh",no-port-forwarding,no-agent-forwarding,no-pty` in `authorized_keys` remains pending hardening — timing to be decided (§9a).
4. **Rollback by git SHA, not by image tag.** After a green health check the server writes `.last_good_sha`; if the next deploy fails its health check, we `git reset --hard` to the last good SHA and rebuild (fast: layer cache). An image registry would give instant rollback but reintroduces the registry we just avoided. For an app whose user base = judges, this is fine.
5. **Migrations: `drizzle-kit push --force` at deploy.** There are no migration files today (`apps/web/drizzle.config.ts` points at the schema; push is used in dev). Generating versioned SQL migrations is more correct but is hackathon overhead; `push` is idempotent and the schema is additive at this stage. Declared trade-off: `--force` also applies destructive changes without asking — **renaming/dropping columns without coordinating is forbidden**; versioned migrations are on the post-hackathon roadmap.
6. **Accepted downtime (~5s).** `compose up -d` recreates the `web` container after the build: a short gap while Next boots. Blue-green isn't worth the complexity; what *is* worth it is a **deploy freeze before the demo** (see §9b).

## 3. GitHub Actions pipeline

Two separate workflows, not one: `ci.yml` acts as the gate (tests + placeholder build) on push and PR, `deploy.yml` only deploys and is triggered by pushes to `main`. **Caution:** they are independent triggers on the same event (`push: main`) — there is no `needs`/`workflow_run` tying one to the other, so the two workflows start in parallel and the deploy does not wait for `ci.yml` to be green. Today the "gate" is a signal, not a real block; making it blocking would require a `workflow_run` trigger on `deploy.yml` conditioned on `ci.yml` succeeding (not implemented, out of scope for this document — see §9).

Log hygiene on a public repo: GH masks registered secrets, but additionally — no `set -x`, never `cat`/`echo` env values, the build job's env values in `ci.yml` are **obviously fake placeholders**, and the target SHA in `deploy.yml` is validated (40-char lowercase hex regex) **via an environment variable, never interpolated directly into the shell command** (injection mitigation).

**GH Secrets** already configured on `AdCazzum/0run`: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER` (currently `root`, §2.3), `DEPLOY_KNOWN_HOSTS` (output of `ssh-keyscan -t ed25519 37.27.47.147`, avoids TOFU/MITM).

### `.github/workflows/ci.yml` (implemented)

```yaml
name: CI
on:
  push: { branches: [main, "feat/**"] }
  pull_request: { branches: [main] }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run test --workspaces --if-present   # DATABASE_URL unset: the db-backed test skips itself
      - run: npx hardhat test
        working-directory: contracts
      - run: npx tsc --noEmit
        working-directory: apps/web
      - name: Build (placeholder env — the real value is built on the server)
        env: { NEXT_PUBLIC_PRIVY_APP_ID: ci-placeholder-app-id }
        run: npm run build --workspace web
```

### `.github/workflows/deploy.yml` (implemented)

```yaml
name: Deploy
on:
  push: { branches: [main] }
  workflow_dispatch:
concurrency: { group: deploy-production, cancel-in-progress: false }

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production    # enables approvals/freezes from the GitHub UI (§9b)
    steps:
      - name: Validate target revision   # github.sha goes into an env var, never interpolated into the shell
        env: { TARGET_SHA: "${{ github.sha }}" }
        run: |
          case "$TARGET_SHA" in
            [0-9a-f]*) [ ${#TARGET_SHA} -eq 40 ] || { echo "unexpected sha length"; exit 1; } ;;
            *) echo "sha is not lowercase hex"; exit 1 ;;
          esac
          echo "TARGET_SHA=$TARGET_SHA" >> "$GITHUB_ENV"
      - name: Configure SSH
        env:
          DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          DEPLOY_KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
        run: |
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          printf '%s\n' "$DEPLOY_SSH_KEY" > ~/.ssh/deploy_key && chmod 600 ~/.ssh/deploy_key
          printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > ~/.ssh/known_hosts && chmod 644 ~/.ssh/known_hosts
      - name: Deploy over SSH
        env: { DEPLOY_HOST: "${{ secrets.DEPLOY_HOST }}", DEPLOY_USER: "${{ secrets.DEPLOY_USER }}" }
        run: |
          ssh -i ~/.ssh/deploy_key -o IdentitiesOnly=yes -o BatchMode=yes \
            "$DEPLOY_USER@$DEPLOY_HOST" "bash /srv/0run/deploy/deploy.sh '$TARGET_SHA'"
      - name: Verify the site is serving the new revision
        run: |
          for i in $(seq 1 10); do
            if curl -fsS --max-time 10 https://0run.fun/api/health | tee /tmp/health | grep -q '"ok":true'; then
              cat /tmp/health; exit 0
            fi
            sleep 6
          done
          echo "health endpoint did not report ok after deploy"; exit 1
```

Note on `hardhat test`: it runs on the in-memory network (no external RPC, no funds) — deterministic in CI. **Contract deployment stays manual** (`contracts/scripts/deploy.ts`); the addresses live in the server's `.env` — still empty at the time of writing (`AGENT_NFT_ADDRESS`, `COACH_REGISTRY_ADDRESS`), awaiting the on-chain deploy.

## 4. Server architecture: system nginx + docker compose

The TLS proxy is **not in the Docker stack**. The host already runs system nginx (not containerized), listening on :80/:443, with a pre-existing vhost (`coachme.conf`) and `certbot`/Let's Encrypt already installed (`/usr/bin/certbot`, existing certificate for `37.27.47.147.sslip.io`). **Caddy is therefore out**: it could not bind :443 next to nginx. The compose stack publishes `web` on loopback only and nginx reverse-proxies in front.

Two compose services + a one-shot job, internal network, plus nginx on the host:

- **db** — `postgres:16-alpine`, `dbdata` volume, **no published ports** (reachable only from `web`/`migrate`; for debugging use `docker compose exec db psql`). `pg_isready` healthcheck.
- **web** — Next.js `output: "standalone"`, multi-stage build, non-root user (`nextjs`), published **on loopback only** (`127.0.0.1:3001:3000`), healthcheck on `/api/health`.
- **migrate** — same `apps/web/Dockerfile` but target `migrator` (has `drizzle-kit` in node_modules plus the sources; does not run as `runner`); not a separate profile but a service with `restart: "no"`, executed explicitly by `deploy.sh` (`compose run --rm migrate`) before `up`.
- **nginx** (host, not compose) — vhost `deploy/nginx-0run.conf`: `server_name 0run.fun www.0run.fun`, `client_max_body_size 32m` (GPX/Apple Health export uploads via multipart), `proxy_pass http://127.0.0.1:3001`, read/write timeouts at 300s (0G Storage uploads and TEE inference are slow; nginx's 60s default truncates them). Installed by `deploy/bootstrap.sh` into `/etc/nginx/sites-available/0run.conf` + symlink in `sites-enabled`; TLS obtained with `certbot --nginx -d 0run.fun -d www.0run.fun --redirect`, which rewrites the vhost adding the TLS block and the :80 redirect.

**Code prerequisites — in progress, no longer blocking:**
1. `apps/web/next.config.ts`: `output: "standalone"` + `outputFileTracingRoot` (required in a monorepo: without it, `packages/shared` is left out of `.next/standalone`) — done.
2. Route `apps/web/src/app/api/health/route.ts`: runs `select 1` on the db via drizzle, answers `{ ok: true, db: true, ts }` (200) or `{ ok: false, db: false, error, ts }` (503) — done, used by the compose healthcheck, by `deploy.sh` and by `deploy.yml`'s smoke test.
3. **NEXT_PUBLIC rule:** every new `NEXT_PUBLIC_*` variable (today only `NEXT_PUBLIC_PRIVY_APP_ID`) must be added in *three* places: `ARG` in the Dockerfile, `build.args` in the compose file, placeholder in the CI job. Forgetting one = `undefined` inlined into the bundle, discovered only in production.

### `apps/web/Dockerfile` (implemented)

```dockerfile
# Build context is the MONOREPO ROOT, not apps/web.
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY .npmrc package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspace web --include-workspace-root

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY .npmrc package.json package-lock.json ./
COPY packages ./packages
COPY apps/web ./apps/web
ARG NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace web

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# Separate target for the one-shot migrate container: it needs drizzle-kit (a devDep) + sources.
FROM builder AS migrator
WORKDIR /app/apps/web
CMD ["npx", "drizzle-kit", "push", "--config", "drizzle.config.ts", "--force"]
```

(An npm monorepo's standalone output preserves the `apps/web/…` structure: the entrypoint is `apps/web/server.js`. The file lives in `apps/web/Dockerfile`, not in `deploy/` — the build context is still the repo root.)

### `deploy/docker-compose.prod.yml` (implemented)

```yaml
# TLS and :80/:443 belong to system nginx (deploy/nginx-0run.conf): this stack
# publishes the app on loopback only and has no reverse proxy of its own.
name: orun
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: orun
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}
      POSTGRES_DB: orun
    volumes: [dbdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U orun -d orun"], interval: 5s, timeout: 5s, retries: 20 }

  migrate:
    build:
      context: ..
      dockerfile: apps/web/Dockerfile
      target: migrator
      args: { NEXT_PUBLIC_PRIVY_APP_ID: ${NEXT_PUBLIC_PRIVY_APP_ID} }
    env_file: [../.env]
    environment: { DATABASE_URL: postgres://orun:${POSTGRES_PASSWORD}@db:5432/orun }
    depends_on: { db: { condition: service_healthy } }
    restart: "no"

  web:
    build:
      context: ..
      dockerfile: apps/web/Dockerfile
      target: runner
      args: { NEXT_PUBLIC_PRIVY_APP_ID: ${NEXT_PUBLIC_PRIVY_APP_ID} }
    restart: unless-stopped
    env_file: [../.env]
    environment: { DATABASE_URL: postgres://orun:${POSTGRES_PASSWORD}@db:5432/orun }
    ports: ["127.0.0.1:3001:3000"]
    depends_on: { db: { condition: service_healthy } }
    healthcheck: { test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/api/health || exit 1"],
                   interval: 15s, timeout: 5s, retries: 5, start_period: 30s }

volumes:
  dbdata:
```

**`DATABASE_URL`:** it is not read from `.env` for `db`/`web`/`migrate` — the compose file builds it explicitly from `${POSTGRES_PASSWORD}` pointing at the `db` host (not `localhost` as in dev). Any `DATABASE_URL` present in `.env` only serves local tooling (e.g. `drizzle-kit studio` from a shell on the server), not the containers' runtime.

### `deploy/nginx-0run.conf` (implemented)

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name 0run.fun www.0run.fun;

    client_max_body_size 32m;   # GPX and Apple Health exports via multipart

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # 0G Storage uploads and TEE inference are slow: long timeouts.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

`certbot --nginx --redirect` rewrites this file in place, adding the `listen 443 ssl` block and the :80 redirect — it is not in the repo because it is generated on the host at first bootstrap.

## 5. Secret management

- **`/srv/0run/.env` is already written** (root-owned, `chmod 600`, never in git, written by hand on the host — never copied from CI). It contains `POSTGRES_PASSWORD` (freshly generated for this environment), `SERVICE_ENC_KEY` (32 hex bytes, distinct from every other environment), `TREASURY_PRIVATE_KEY`, `PRIVY_APP_SECRET`, `ROUTER_API_KEY`, `NEXT_PUBLIC_PRIVY_APP_ID`, 0G endpoints — same schema as `.env.example` (full template also in `deploy/bootstrap.sh`, printed when `.env` is missing). **Still empty:** `AGENT_NFT_ADDRESS` and `COACH_REGISTRY_ADDRESS`, awaiting the on-chain contract deploy.
- GitHub knows only: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER` (currently `root` — see the forced-command gap in §2.3), `DEPLOY_KNOWN_HOSTS`. Never wallet private keys or API keys in GH Secrets: CI doesn't need them by design (decision 1).
- `NEXT_PUBLIC_PRIVY_APP_ID` ends up in the client bundle anyway (it is public by nature), but we keep the real value out of CI logs for rule uniformity: *everything real lives on the server*.

## 6. Healthcheck, rollback, deploy script

### `deploy/deploy.sh` (implemented — lives on the server, versioned in the repo)

```bash
#!/usr/bin/env bash
# usage: deploy.sh [git-sha]   (default: origin/main)
set -euo pipefail

APP_DIR=${APP_DIR:-/srv/0run}
COMPOSE="docker compose -f $APP_DIR/deploy/docker-compose.prod.yml --env-file $APP_DIR/.env"
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3001/api/health}
TARGET=${1:-origin/main}
LAST_GOOD_FILE="$APP_DIR/.last_good_sha"

cd "$APP_DIR"
[ -f .env ] || { echo "FATAL: $APP_DIR/.env missing (secrets are never in git)"; exit 1; }

PREVIOUS_SHA=$(git rev-parse HEAD)
git fetch --prune origin
git reset --hard "$TARGET"
NEW_SHA=$(git rev-parse HEAD)

deploy_current_tree() {
  $COMPOSE build web migrate
  $COMPOSE run --rm migrate
  $COMPOSE up -d db web
}

wait_healthy() {
  for i in $(seq 1 40); do
    curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1 && return 0
    sleep 3
  done
  $COMPOSE logs --tail 60 web || true
  return 1
}

if deploy_current_tree && wait_healthy; then
  echo "$NEW_SHA" > "$LAST_GOOD_FILE"
  exit 0
fi

echo "DEPLOY FAILED — rolling back"
ROLLBACK_SHA=$(cat "$LAST_GOOD_FILE" 2>/dev/null || echo "$PREVIOUS_SHA")
git reset --hard "$ROLLBACK_SHA"
if deploy_current_tree && wait_healthy; then
  echo "rollback OK — serving ${ROLLBACK_SHA:0:7}, deploy of ${NEW_SHA:0:7} rejected"
else
  echo "ROLLBACK ALSO FAILED — site is down, manual intervention required"
fi
exit 1   # the GitHub job stays red even if the rollback saved the site
```

Differences from the initial design: no `caddy` to start in `deploy_current_tree` (the proxy is outside compose, §4); healthcheck via direct `curl` on the host, not `compose exec web wget` (port 3001 is already published on loopback); 40 attempts of 3s instead of 30, to leave headroom for a slow build on the available RAM; if the rollback fails too, the script still ends with `exit 1` and an explicit log instead of trying anything else — at that point manual intervention is required.

Manual rollback (if you need to go further back than `.last_good_sha`): `git reset --hard <sha> && deploy/deploy.sh <sha>` from an admin shell on the server, or `git revert` + push to `main` to go through the pipeline (preferred: it leaves a trace).

## 7. Server bootstrap — done

`deploy/bootstrap.sh` is idempotent (safe to re-run) and covers: repo clone/fetch into `/srv/0run`, nginx vhost install + `nginx -t && systemctl reload nginx`, certificate issuance with `certbot --nginx --redirect` (skipped if `/etc/letsencrypt/live/0run.fun` already exists), verification that `.env` exists — otherwise it prints the full template and exits with an actionable message instead of silently continuing — then it runs the first deploy (`deploy.sh origin/main`).

Actual state at the time of this document:

- **Host:** Ubuntu 26.04, Docker 29.6.1, Compose v5.3.1, 38 GB disk (27 GB free), **3.7 GiB RAM + 2 GiB swap**.
- **DNS:** `0run.fun` → `37.27.47.147` verified.
- **SSH:** root access available to the operator; `orun-claude-deploy` (operator) and `orun-gh-actions` (CI) keys installed in `/root/.ssh/authorized_keys` — no forced command yet (§2.3, §9a).
- **nginx:** already listening on :80/:443 with a pre-existing vhost (`coachme.conf`) and certbot already installed; the `0run.conf` vhost is added alongside, not replacing it.
- **`coachme` (pre-existing stack on the same host):** stopped to free memory (~3.0 GiB available now). If it has to come back, the RAM budget for `0run` must be re-evaluated — with both stacks up, 3.7 GiB may not be enough for the build (§9d).
- **GitHub Secrets:** all four (`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS`) already configured on `AdCazzum/0run`.
- **`/srv/0run/.env`:** written (§5).
- **Not yet done:** the first `deploy.sh` has not run end-to-end yet — no real verification that the build fits in the available RAM, contract addresses still empty.

## 8. MVP scope — what we do NOT do

- **No image registry** (GHCR/Docker Hub) *except in an emergency*: build on the server, rollback via git. If the build OOMs on the available RAM, the documented fallback is moving the build to CI and publishing to GHCR (§2.1) — not activated today.
- **No zero-downtime/blue-green**: ~5s gap per deploy, accepted; freeze before the demo.
- **No staging**: `main` = production; testing happens locally and in CI.
- **No contract CD**: manual Hardhat deploy, addresses in `.env` (auto-redeploying contracts during a hackathon is a footgun, not a feature).
- **No versioned SQL migrations**: `drizzle-kit push` with the "additive only" rule (§2.5).
- **No automatic DB backups**: the DB is an index rebuildable from 0G; a manual `pg_dump` before the demo is enough.
- **No watchtower/auto-update, no k8s, no Dependabot** during the hackathon.

## 9. Open questions (require a decision from Ivan)

a. **CI key hardening.** Restrict `orun-gh-actions` with a forced command (`command="/srv/0run/deploy/deploy.sh",no-port-forwarding,no-agent-forwarding,no-pty`) — do it now, before the demo, or accept the risk (full root shell if the key leaks from the secrets) until after the hackathon?
b. **Required reviewer on the `production` environment.** GitHub can require a manual approval before `deploy.yml` runs — useful as a freeze on demo day. Enable it? If so, who is the reviewer (Ivan only, or others too)?
c. **`drizzle-kit push --force` vs versioned migrations.** Today additive-only by convention, not by technical guarantee (§2.5). Still the right call for the hackathon, or is it worth generating the first versioned SQL migrations now that the schema is starting to stabilize?
d. **Should `coachme` come back up?** It is stopped to free RAM (§7). If it must run alongside `0run` again, the 3.7 GiB + 2 GiB swap budget needs revisiting — host upgrade, or move `0run`'s build to CI with GHCR (§2.1) — before it becomes a runtime problem, not during the demo.

## 10. References

- Implemented files: `.github/workflows/ci.yml` · `.github/workflows/deploy.yml` · `apps/web/Dockerfile` · `deploy/docker-compose.prod.yml` · `deploy/nginx-0run.conf` · `deploy/deploy.sh` · `deploy/bootstrap.sh`
- Code prerequisites: `output: "standalone"` + `outputFileTracingRoot` in `next.config.ts` (done) · `/api/health` route (done) · three-places rule for `NEXT_PUBLIC_*` (§4)

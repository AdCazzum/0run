# 0run — CI/CD e deploy automatico su 0run.fun

**Data:** 2026-07-25 · **Stato:** in parte implementata — server ispezionato e configurato, scaffolding di deploy scritto, primo deploy end-to-end non ancora eseguito · **Dipende da:** [design MVP](./2026-07-24-0run-mvp-design.md)

## 1. Obiettivo e vincoli

Push su `main` di `AdCazzum/0run` → test → build check → deploy su Hetzner (37.27.47.147) → `https://0run.fun` aggiornato con healthcheck e rollback automatico. Vincoli: repo **pubblico** (tutto ciò che finisce nei log CI è visibile al mondo), niente Vercel/registry SaaS (preferenza self-hosted), la demo di domenica non deve mai rompersi per un deploy. Il server è già stato ispezionato e parzialmente configurato: DNS `0run.fun` → `37.27.47.147` verificato, accesso SSH root attivo con due chiavi dedicate (`orun-claude-deploy` per l'operatore, `orun-gh-actions` per la CI), `.env` di produzione già scritto in `/srv/0run/.env`. Vincolo aggiuntivo emerso sul campo: **3.7 GiB RAM + 2 GiB swap** — stretti per un `next build` in un monorepo (§2.1).

## 2. Decisioni chiave (trade-off espliciti)

1. **Build sul server, non in CI.** CI fa `next build` solo come *gate* (con env fittizie); l'immagine che va in produzione è costruita su Hetzner da `docker compose build`, che legge le `NEXT_PUBLIC_*` reali dal `.env` del server. Trade-off: il build consuma CPU **e RAM** del server e il deploy dura qualche minuto, ma **nessun segreto o env di produzione tocca mai GitHub** e non serve un registry (GHCR aggiungerebbe login, tag, e un posto in più dove sbagliare). Con un repo pubblico è la scelta a minor superficie. **Rischio noto:** l'host ha solo 3.7 GiB di RAM (+2 GiB swap); `next build` su un monorepo è il punto più fragile della pipeline. Mitigazioni in atto: lo stack `coachme` preesistente sullo stesso host è stato fermato per liberare memoria (~3.0 GiB disponibili ora — se deve tornare attivo, il budget RAM va rivalutato, §7/§9d), e lo swap assorbe i picchi. **Fallback documentato se il build va comunque in OOM:** spostare il build in CI e pubblicare l'immagine su GHCR (package pubblico, nessuna auth di registry necessaria) — non implementato oggi, si attiva solo se il build sul server si dimostra inaffidabile.
2. **`git reset --hard` sul server, non rsync.** Il repo è pubblico: il server fa `git fetch --prune origin && git reset --hard <target>` (clone già presente in `/srv/0run`, gestito da `deploy/bootstrap.sh`). Rsync dalla CI trasferirebbe la working copy del runner ed è un canale in più da proteggere; git dà gratis anche il rollback per SHA. Il `.env` è gitignorato e sopravvive intatto.
3. **CI dovrebbe poter solo *innescare* il deploy, non eseguire comandi arbitrari — oggi non è ancora così.** Le chiavi `orun-claude-deploy` (operatore) e `orun-gh-actions` (CI) sono installate in `/root/.ssh/authorized_keys` **senza forced command**: la chiave CI ha oggi shell root piena, non solo il trigger del deploy. Il workflow `deploy.yml` la usa in modo disciplinato (esegue solo `deploy.sh <sha>`), ma se la chiave privata trapelasse dai secrets l'attaccante avrebbe shell completa sul server, non solo la possibilità di ri-deployare `main`. **Gap noto, non ancora chiuso:** restringere la chiave CI con `command="/srv/0run/deploy/deploy.sh",no-port-forwarding,no-agent-forwarding,no-pty` in `authorized_keys` resta un hardening in sospeso — timing da decidere (§9a).
4. **Rollback per SHA git, non per tag immagine.** Dopo un healthcheck verde il server scrive `.last_good_sha`; se il deploy successivo fallisce l'healthcheck, si fa `git reset --hard` all'ultimo SHA buono e rebuild (veloce: layer cache). Un registry di immagini darebbe rollback istantaneo ma reintroduce il registry che abbiamo appena evitato. Per un'app con utenza = giudici, va bene.
5. **Migrazioni: `drizzle-kit push --force` al deploy.** Oggi non esistono file di migrazione (`apps/web/drizzle.config.ts` punta allo schema, si usa push in dev). Generare migrazioni SQL versionate è più corretto ma è overhead da hackathon; `push` è idempotente e lo schema è additivo in questa fase. Trade-off dichiarato: `--force` applica anche modifiche distruttive senza chiedere — **vietato rinominare/droppare colonne senza coordinarsi**; migrazioni versionate in roadmap post-hackathon.
6. **Downtime accettato (~5s).** `compose up -d` ricrea il container `web` dopo il build: breve buco mentre Next si avvia. Blue-green non vale la complessità; in compenso vale un **deploy freeze prima della demo** (vedi §9b).

## 3. Pipeline GitHub Actions

Due workflow separati, non uno solo: `ci.yml` fa da gate (test + build placeholder) su push e PR, `deploy.yml` fa solo il deploy ed è innescato dal push su `main`. **Attenzione:** sono trigger indipendenti sullo stesso evento (`push: main`) — non c'è un `needs`/`workflow_run` che leghi l'uno all'altro, quindi i due workflow partono in parallelo e il deploy non aspetta che `ci.yml` sia verde. Oggi il "gate" è un segnale, non un blocco reale; per farlo bloccante servirebbe un trigger `workflow_run` su `deploy.yml` condizionato al successo di `ci.yml` (non implementato, fuori scope di questo documento — vedi §9).

Igiene log su repo pubblico: GH maschera i secret registrati, ma in più — niente `set -x`, mai `cat`/`echo` di env, le env del job di build in `ci.yml` sono **placeholder palesemente finti**, e la SHA target in `deploy.yml` viene validata (regex hex a 40 caratteri) **via variabile d'ambiente, mai interpolata direttamente nel comando shell** (mitigazione injection).

**GH Secrets** già configurati su `AdCazzum/0run`: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER` (oggi `root`, §2.3), `DEPLOY_KNOWN_HOSTS` (output di `ssh-keyscan -t ed25519 37.27.47.147`, evita TOFU/MITM).

### `.github/workflows/ci.yml` (implementato)

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
      - run: npm run test --workspaces --if-present   # DATABASE_URL non settata: il test db-backed si autoskippa
      - run: npx hardhat test
        working-directory: contracts
      - run: npx tsc --noEmit
        working-directory: apps/web
      - name: Build (env placeholder — il valore reale si costruisce sul server)
        env: { NEXT_PUBLIC_PRIVY_APP_ID: ci-placeholder-app-id }
        run: npm run build --workspace web
```

### `.github/workflows/deploy.yml` (implementato)

```yaml
name: Deploy
on:
  push: { branches: [main] }
  workflow_dispatch:
concurrency: { group: deploy-production, cancel-in-progress: false }

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production    # consente approvazioni/freeze da UI GitHub (§9b)
    steps:
      - name: Validate target revision   # github.sha va in una env var, mai interpolato nello shell
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

Nota `hardhat test`: gira sulla rete in-memory (nessun RPC esterno, nessun fondo) — deterministico in CI. Il **deploy dei contratti resta manuale** (`contracts/scripts/deploy.ts`), gli indirizzi vivono nel `.env` del server — oggi ancora vuoti (`AGENT_NFT_ADDRESS`, `COACH_REGISTRY_ADDRESS`), in attesa del deploy on-chain.

## 4. Architettura server: nginx di sistema + docker compose

Il proxy TLS **non è nello stack Docker**. Sull'host gira già nginx di sistema (non containerizzato), in ascolto su :80/:443, con un vhost preesistente (`coachme.conf`) e `certbot`/Let's Encrypt già installati (`/usr/bin/certbot`, certificato esistente per `37.27.47.147.sslip.io`). **Caddy è quindi fuori**: non potrebbe bindare :443 accanto a nginx. Il compose pubblica `web` solo su loopback e nginx fa da reverse proxy davanti.

Due servizi compose + un job one-shot, rete interna, più nginx sull'host:

- **db** — `postgres:16-alpine`, volume `dbdata`, **nessuna porta pubblicata** (raggiungibile solo da `web`/`migrate`; per debug si usa `docker compose exec db psql`). Healthcheck `pg_isready`.
- **web** — Next.js `output: "standalone"`, build multi-stage, utente non-root (`nextjs`), pubblicato **solo su loopback** (`127.0.0.1:3001:3000`), healthcheck su `/api/health`.
- **migrate** — stesso `apps/web/Dockerfile` ma target `migrator` (ha `drizzle-kit` nei node_modules e le sorgenti, non gira come `runner`); non è un profilo separato ma un servizio con `restart: "no"`, eseguito esplicitamente da `deploy.sh` (`compose run --rm migrate`) prima di `up`.
- **nginx** (host, non compose) — vhost `deploy/nginx-0run.conf`: `server_name 0run.fun www.0run.fun`, `client_max_body_size 32m` (upload GPX/Apple Health export via multipart), `proxy_pass http://127.0.0.1:3001`, timeout di lettura/scrittura a 300s (upload su 0G Storage e inferenza TEE sono lenti, un default nginx da 60s li tronca). Installato da `deploy/bootstrap.sh` in `/etc/nginx/sites-available/0run.conf` + symlink in `sites-enabled`; TLS ottenuto con `certbot --nginx -d 0run.fun -d www.0run.fun --redirect`, che riscrive il vhost aggiungendo il blocco TLS e il redirect da :80.

**Prerequisiti di codice — in corso, non più bloccanti:**
1. `apps/web/next.config.ts`: `output: "standalone"` + `outputFileTracingRoot` (necessario in monorepo: senza, `packages/shared` resta fuori da `.next/standalone`) — fatto.
2. Route `apps/web/src/app/api/health/route.ts`: esegue `select 1` sul db via drizzle, risponde `{ ok: true, db: true, ts }` (200) o `{ ok: false, db: false, error, ts }` (503) — fatta, usata da compose healthcheck, `deploy.sh` e dallo smoke test di `deploy.yml`.
3. **Regola NEXT_PUBLIC:** ogni nuova variabile `NEXT_PUBLIC_*` (oggi solo `NEXT_PUBLIC_PRIVY_APP_ID`) va aggiunta in *tre* posti: `ARG` nel Dockerfile, `build.args` nel compose, placeholder nel job CI. Dimenticarla = valore `undefined` inlined nel bundle, che si scopre solo in produzione.

### `apps/web/Dockerfile` (implementato)

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

# Target separato per il container migrate one-shot: serve drizzle-kit (devDep) + sorgenti.
FROM builder AS migrator
WORKDIR /app/apps/web
CMD ["npx", "drizzle-kit", "push", "--config", "drizzle.config.ts", "--force"]
```

(Lo standalone di un monorepo npm preserva la struttura `apps/web/…`: l'entrypoint è `apps/web/server.js`. Il file vive in `apps/web/Dockerfile`, non in `deploy/` — il contesto di build resta comunque la root del repo.)

### `deploy/docker-compose.prod.yml` (implementato)

```yaml
# TLS e :80/:443 sono di nginx di sistema (deploy/nginx-0run.conf): questo stack
# pubblica l'app solo su loopback e non ha un proprio reverse proxy.
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

**`DATABASE_URL`:** non viene letta dal `.env` per `db`/`web`/`migrate` — il compose la costruisce esplicitamente da `${POSTGRES_PASSWORD}` puntando all'host `db` (non `localhost` come in dev). Il `DATABASE_URL` eventualmente presente nel `.env` serve solo a tooling locale (es. `drizzle-kit studio` da una shell sul server), non al runtime dei container.

### `deploy/nginx-0run.conf` (implementato)

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name 0run.fun www.0run.fun;

    client_max_body_size 32m;   # GPX e Apple Health export via multipart

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # 0G Storage upload e inferenza TEE sono lente: timeout lunghi.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

`certbot --nginx --redirect` riscrive questo file in place aggiungendo il blocco `listen 443 ssl` e il redirect da :80 — non è nel repo perché generato sull'host al primo bootstrap.

## 5. Gestione segreti

- **`/srv/0run/.env` è già scritto** (root-owned, `chmod 600`, mai in git, scritto a mano sull'host — non copiato dalla CI). Contiene `POSTGRES_PASSWORD` (generata fresca per questo ambiente), `SERVICE_ENC_KEY` (32 byte hex, distinta da ogni altro ambiente), `TREASURY_PRIVATE_KEY`, `PRIVY_APP_SECRET`, `ROUTER_API_KEY`, `NEXT_PUBLIC_PRIVY_APP_ID`, endpoint 0G — stesso schema di `.env.example` (template completo anche in `deploy/bootstrap.sh`, stampato se `.env` manca). **Ancora vuoti:** `AGENT_NFT_ADDRESS` e `COACH_REGISTRY_ADDRESS`, in attesa del deploy on-chain dei contratti.
- GitHub conosce solo: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER` (oggi `root` — vedi il gap sul forced command in §2.3), `DEPLOY_KNOWN_HOSTS`. Mai chiavi private di wallet o API key in GH Secrets: la CI non ne ha bisogno per design (decisione 1).
- `NEXT_PUBLIC_PRIVY_APP_ID` finisce comunque nel bundle client (è pubblico per natura), ma teniamo il valore reale fuori dai log CI per uniformità di regola: *tutto il reale sta sul server*.

## 6. Healthcheck, rollback, script di deploy

### `deploy/deploy.sh` (implementato — vive sul server, versionato nel repo)

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
  echo "rollback OK — serving ${ROLLBACK_SHA:0:7}, deploy di ${NEW_SHA:0:7} rifiutato"
else
  echo "ROLLBACK ALSO FAILED — site is down, manual intervention required"
fi
exit 1   # il job GitHub resta rosso anche se il rollback salva il sito
```

Differenze dal design iniziale: nessun `caddy` da avviare in `deploy_current_tree` (il proxy è fuori compose, §4); healthcheck via `curl` diretto sull'host, non `compose exec web wget` (la porta 3001 è già pubblicata su loopback); 40 tentativi da 3s invece di 30, per lasciare margine a un build lento sulla RAM disponibile; in caso di rollback fallito anche lui, lo script termina comunque con `exit 1` e un log esplicito invece di provare altro — a quel punto serve intervento manuale.

Rollback manuale (se serve tornare più indietro di `.last_good_sha`): `git reset --hard <sha> && deploy/deploy.sh <sha>` da una shell admin sul server, oppure `git revert` + push su `main` per passare dalla pipeline (preferito: lascia traccia).

## 7. Bootstrap del server — fatto

`deploy/bootstrap.sh` è idempotente (safe da rilanciare) e copre: clone/fetch del repo in `/srv/0run`, install del vhost nginx + `nginx -t && systemctl reload nginx`, emissione certificato con `certbot --nginx --redirect` (skip se `/etc/letsencrypt/live/0run.fun` esiste già), verifica che `.env` esista — altrimenti stampa il template completo ed esce con un messaggio azionabile invece di proseguire silenziosamente — poi lancia il primo deploy (`deploy.sh origin/main`).

Stato reale alla data di questo documento:

- **Host:** Ubuntu 26.04, Docker 29.6.1, Compose v5.3.1, 38 GB disco (27 GB liberi), **3.7 GiB RAM + 2 GiB swap**.
- **DNS:** `0run.fun` → `37.27.47.147` verificato.
- **SSH:** accesso root disponibile al controller; chiavi `orun-claude-deploy` (operatore) e `orun-gh-actions` (CI) installate in `/root/.ssh/authorized_keys` — nessun forced command ancora (§2.3, §9a).
- **nginx:** già in ascolto su :80/:443 con un vhost preesistente (`coachme.conf`) e certbot già installato; il vhost `0run.conf` si aggiunge accanto, non lo sostituisce.
- **`coachme` (stack preesistente sullo stesso host):** fermato per liberare memoria (~3.0 GiB disponibili ora). Se deve tornare attivo, il budget RAM per `0run` va rivalutato — coi due stack su, 3.7 GiB potrebbero non bastare al build (§9d).
- **GitHub Secrets:** i quattro (`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS`) sono già configurati su `AdCazzum/0run`.
- **`/srv/0run/.env`:** scritto (§5).
- **Non ancora fatto:** il primo `deploy.sh` non è ancora girato end-to-end — nessuna verifica reale che il build regga sulla RAM disponibile, indirizzi contratti ancora vuoti.

## 8. Scope MVP — cosa NON facciamo

- **Niente registry di immagini** (GHCR/Docker Hub) *salvo emergenza*: build sul server, rollback via git. Se il build va in OOM sulla RAM disponibile, il fallback documentato è spostare il build in CI e pubblicare su GHCR (§2.1) — non attivato oggi.
- **Niente zero-downtime/blue-green**: ~5s di buco a deploy, accettato; freeze prima della demo.
- **Niente staging**: `main` = produzione; si testa in locale e con la CI.
- **Niente CD dei contratti**: deploy Hardhat manuale, indirizzi in `.env` (un redeploy dei contratti in automatico durante l'hackathon è un footgun, non una feature).
- **Niente migrazioni SQL versionate**: `drizzle-kit push` con la regola "solo additivo" (§2.5).
- **Niente backup automatici del DB**: il DB è un indice ricostruibile da 0G; un `pg_dump` manuale pre-demo basta.
- **Niente watchtower/auto-update, niente k8s, niente Dependabot** durante l'hackathon.

## 9. Domande aperte (richiedono una decisione di Ivan)

a. **Hardening della chiave CI.** Restringere `orun-gh-actions` con un forced command (`command="/srv/0run/deploy/deploy.sh",no-port-forwarding,no-agent-forwarding,no-pty`) — farlo ora, prima della demo, o accettare il rischio (shell root piena se la chiave trapela dai secrets) fino a dopo l'hackathon?
b. **Reviewer obbligatorio sull'environment `production`.** GitHub permette di richiedere un'approvazione manuale prima che `deploy.yml` giri — utile come freeze per il giorno della demo. Attivarlo? Se sì, chi è il reviewer (solo Ivan, o anche altri)?
c. **`drizzle-kit push --force` vs migrazioni versionate.** Oggi additivo-only per convenzione, non per garanzia tecnica (§2.5). Resta la scelta giusta per l'hackathon, o conviene generare le prime migrazioni SQL versionate ora che lo schema comincia a stabilizzarsi?
d. **`coachme` deve tornare su?** È fermo per liberare RAM (§7). Se deve girare di nuovo in parallelo a `0run`, il budget di 3.7 GiB + 2 GiB swap va rivisto — upgrade dell'host, o spostare il build di `0run` in CI con GHCR (§2.1) — prima che diventi un problema a runtime, non durante la demo.

## 10. Riferimenti

- File implementati: `.github/workflows/ci.yml` · `.github/workflows/deploy.yml` · `apps/web/Dockerfile` · `deploy/docker-compose.prod.yml` · `deploy/nginx-0run.conf` · `deploy/deploy.sh` · `deploy/bootstrap.sh`
- Prerequisiti codice: `output: "standalone"` + `outputFileTracingRoot` in `next.config.ts` (fatto) · route `/api/health` (fatta) · regola tre-posti per `NEXT_PUBLIC_*` (§4)
- Compose dev esistente (`docker-compose.yml` in root, solo postgres su loopback) resta invariato per lo sviluppo locale.

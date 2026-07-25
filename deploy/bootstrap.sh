#!/usr/bin/env bash
# One-time server bootstrap for 0run. Idempotent: safe to re-run.
# Prerequisites: docker + compose, nginx, certbot on the host; DNS for 0run.fun
# already pointing here; /srv/0run/.env written by hand (never from git).
set -euo pipefail

APP_DIR=${APP_DIR:-/srv/0run}
REPO=${REPO:-https://github.com/AdCazzum/0run.git}
DOMAIN=${DOMAIN:-0run.fun}
CERT_EMAIL=${CERT_EMAIL:-slavni96@gmail.com}

log() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

log "repository at $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" remote set-url origin "$REPO"
  git -C "$APP_DIR" fetch --prune origin
else
  mkdir -p "$APP_DIR"
  git clone "$REPO" "$APP_DIR"
fi

log "nginx vhost for $DOMAIN"
install -m 644 "$APP_DIR/deploy/nginx-0run.conf" /etc/nginx/sites-available/0run.conf
ln -sfn /etc/nginx/sites-available/0run.conf /etc/nginx/sites-enabled/0run.conf
nginx -t && systemctl reload nginx

log "TLS certificate"
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "certificate already present, skipping issuance"
else
  # --nginx rewrites the vhost in place with the TLS server block + :80 redirect.
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos -m "$CERT_EMAIL" --redirect
fi

log "checking .env"
if [ ! -f "$APP_DIR/.env" ]; then
  cat <<'EOF'
MISSING: /srv/0run/.env

Create it by hand (chmod 600) with at least:
  POSTGRES_PASSWORD=            # strong, generated on this host
  DATABASE_URL=                 # overridden by compose; keep for local tooling
  ZG_RPC_URL=https://evmrpc-testnet.0g.ai
  ZG_INDEXER_URL=https://indexer-storage-testnet-turbo.0g.ai
  TREASURY_PRIVATE_KEY=
  AGENT_NFT_ADDRESS=
  COACH_REGISTRY_ADDRESS=
  ROUTER_API_URL=https://router-api.0g.ai/v1
  ROUTER_API_KEY=
  ROUTER_MODEL_PRIMARY=glm-5.2
  ROUTER_MODEL_FALLBACK=0gm-1.0-35b-a3b
  DIRECT_ENABLED=0
  SERVICE_ENC_KEY=              # 32-byte hex, distinct from any other environment
  NEXT_PUBLIC_PRIVY_APP_ID=
  PRIVY_APP_SECRET=
EOF
  exit 1
fi

log "first deploy"
bash "$APP_DIR/deploy/deploy.sh" origin/main
log "bootstrap complete — https://$DOMAIN"

#!/usr/bin/env bash
# Deploy 0run on the host. Runs ON THE SERVER, invoked by CI over SSH or by hand.
#   usage: deploy.sh [git-sha]     (default: origin/main)
# Builds the image on the host so no production secret ever reaches GitHub.
set -euo pipefail

APP_DIR=${APP_DIR:-/srv/0run}
COMPOSE="docker compose -f $APP_DIR/deploy/docker-compose.prod.yml --env-file $APP_DIR/.env"
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3001/api/health}
TARGET=${1:-origin/main}
LAST_GOOD_FILE="$APP_DIR/.last_good_sha"

log() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

cd "$APP_DIR"
[ -f .env ] || { echo "FATAL: $APP_DIR/.env missing (secrets are never in git)"; exit 1; }

PREVIOUS_SHA=$(git rev-parse HEAD)
log "fetching $TARGET (current: ${PREVIOUS_SHA:0:7})"
git fetch --prune origin
git reset --hard "$TARGET"
NEW_SHA=$(git rev-parse HEAD)
echo "now at ${NEW_SHA:0:7}"

deploy_current_tree() {
  log "building image"
  $COMPOSE build web migrate
  log "applying database schema"
  $COMPOSE run --rm migrate
  log "starting services"
  $COMPOSE up -d db web
}

wait_healthy() {
  log "waiting for health at $HEALTH_URL"
  for i in $(seq 1 40); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      echo "healthy after ${i} attempt(s)"; return 0
    fi
    sleep 3
  done
  echo "NOT healthy after 40 attempts"
  $COMPOSE logs --tail 60 web || true
  return 1
}

if deploy_current_tree && wait_healthy; then
  echo "$NEW_SHA" > "$LAST_GOOD_FILE"
  log "deploy OK (${NEW_SHA:0:7})"
  exit 0
fi

log "DEPLOY FAILED — rolling back"
ROLLBACK_SHA=$(cat "$LAST_GOOD_FILE" 2>/dev/null || echo "$PREVIOUS_SHA")
echo "rolling back to ${ROLLBACK_SHA:0:7}"
git reset --hard "$ROLLBACK_SHA"
if deploy_current_tree && wait_healthy; then
  log "rollback OK — serving ${ROLLBACK_SHA:0:7}, deploy of ${NEW_SHA:0:7} rejected"
else
  log "ROLLBACK ALSO FAILED — site is down, manual intervention required"
fi
exit 1

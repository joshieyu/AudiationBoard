#!/usr/bin/env bash
# Build locally and ship to the server: ./deploy/deploy.sh
# First run on a fresh server: ./deploy/deploy.sh --setup
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER="${AUDIATION_SERVER:-root@2.29.191.107}"
NODE_VERSION="$(node -v)"

npm run typecheck
npm run build

ssh "$SERVER" 'install -d /srv/audiation/kit'
rsync -az --delete deploy/ "$SERVER:/srv/audiation/kit/"
if [ "${1:-}" = "--setup" ]; then
  ssh "$SERVER" "NODE_VERSION=$NODE_VERSION bash /srv/audiation/kit/setup-server.sh"
fi

rsync -az --delete --exclude node_modules \
  package.json package-lock.json dist server shared "$SERVER:/srv/audiation/app/"
ssh "$SERVER" 'set -e
  chown -R audiation:audiation /srv/audiation/app
  cd /srv/audiation/app
  runuser -u audiation -- env HOME=/srv/audiation PATH=/opt/audiation-node/bin:/usr/bin:/bin \
    npm ci --omit=dev --no-audit --no-fund --loglevel=error
  systemctl restart audiation
  sleep 2
  systemctl is-active audiation
  curl -fsS -o /dev/null -w "local check: HTTP %{http_code}\n" http://127.0.0.1:8787/'

#!/usr/bin/env bash
# Build and ship to the server. GitHub Actions runs this on every push to main as the
# limited `deploy` user; you can also run it yourself (as root by default).
#   ./deploy/deploy.sh           deploy
#   ./deploy/deploy.sh --setup   first run on a fresh server (root only)
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER="${AUDIATION_SERVER:-root@2.29.191.107}"
NODE_VERSION="$(node -v)"

npm run typecheck
npm run build

if [ "${1:-}" = "--setup" ]; then
  ssh "$SERVER" 'install -d /srv/audiation/kit'
  rsync -az --delete deploy/ "$SERVER:/srv/audiation/kit/"
  ssh "$SERVER" "NODE_VERSION=$NODE_VERSION bash /srv/audiation/kit/setup-server.sh"
fi

rsync -az --delete --exclude node_modules \
  package.json package-lock.json dist server shared "$SERVER:/srv/audiation/app/"
ssh "$SERVER" 'set -e
  cd /srv/audiation/app
  install_deps="npm ci --omit=dev --no-audit --no-fund --loglevel=error"
  if [ "$(id -un)" = root ]; then
    chown -R deploy:audiation /srv/audiation/app
    runuser -u deploy -- env HOME=/home/deploy PATH=/opt/audiation-node/bin:/usr/bin:/bin $install_deps
    systemctl restart audiation
  else
    PATH=/opt/audiation-node/bin:$PATH $install_deps
    sudo -n /usr/bin/systemctl restart audiation
  fi
  sleep 2
  systemctl is-active audiation
  curl -fsS -o /dev/null -w "local check: HTTP %{http_code}\n" http://127.0.0.1:8787/'

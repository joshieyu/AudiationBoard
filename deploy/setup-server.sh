#!/usr/bin/env bash
# One-time server setup, run as root on the server (deploy.sh copies it up and runs it).
# Safe to re-run. Leaves the system Node and every other site untouched.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:?set NODE_VERSION, e.g. v26.7.0}"
KIT=/srv/audiation/kit

# A system user and folders of its own, mirroring the other services on this box.
id audiation >/dev/null 2>&1 || useradd --system --home-dir /srv/audiation --shell /usr/sbin/nologin audiation
install -d -o audiation -g audiation /srv/audiation /srv/audiation/app /srv/audiation/data
install -d -m 750 -g audiation /etc/audiation
[ -f /etc/audiation/audiation.env ] || install -m 640 -g audiation "$KIT/audiation.env" /etc/audiation/audiation.env
grep -q '^ADMIN_KEY=' /etc/audiation/audiation.env || echo "ADMIN_KEY=$(openssl rand -hex 24)" >> /etc/audiation/audiation.env
grep -q '^WARN_FREE_GB=' /etc/audiation/audiation.env || echo "WARN_FREE_GB=13" >> /etc/audiation/audiation.env

# A private Node runtime for this app only, verified against nodejs.org's checksums.
dpkg -s libatomic1 >/dev/null 2>&1 || apt-get install -y -qq libatomic1 >/dev/null
if [ "$(/opt/audiation-node/bin/node -v 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo "unsupported arch"; exit 1 ;; esac
  tarball="node-$NODE_VERSION-linux-$arch.tar.xz"
  tmp=$(mktemp -d)
  curl -fsSLo "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball"
  curl -fsSLo "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf /opt/audiation-node && mkdir -p /opt/audiation-node
  tar -xJf "$tmp/$tarball" -C /opt/audiation-node --strip-components=1
  rm -rf "$tmp"
fi

install -m 644 "$KIT/audiation.service" /etc/systemd/system/audiation.service
systemctl daemon-reload
systemctl enable audiation >/dev/null

# Add the site to Caddy through an import, and roll back if the config doesn't validate.
install -m 644 "$KIT/Caddyfile" /etc/caddy/audiation.caddy
if ! grep -q '^import /etc/caddy/audiation.caddy' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%Y%m%d%H%M%S)"
  printf '\nimport /etc/caddy/audiation.caddy\n' >> /etc/caddy/Caddyfile
fi
if caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  systemctl reload caddy
else
  echo "Caddy config failed to validate; removing the import" >&2
  sed -i '\|^import /etc/caddy/audiation.caddy|d' /etc/caddy/Caddyfile
  exit 1
fi
echo "Server ready."

#!/usr/bin/env bash
# Soviet Code — update script for deployed instance
# Run as root after initial deploy. Non-interactive, idempotent.
set -euxo pipefail

WORKDIR=/opt/soviet-code

echo "☭ Soviet Code — update starting"
echo "================================"

# Pull latest code
git -C "$WORKDIR" pull origin master

# Install dependencies (ci for reproducible builds)
npm ci --prefix "$WORKDIR"

# Build main CLI and conductor
npm run build --prefix "$WORKDIR"
npm run build:conductor --prefix "$WORKDIR"

# Restart conductor service
systemctl restart conductor

# Verify it came up
sleep 2
systemctl status conductor --no-pager

ACTIVE=$(systemctl is-active conductor)
if [ "$ACTIVE" != "active" ]; then
  echo "[ERROR] conductor is not active after restart (state: $ACTIVE)"
  echo "  Check logs: journalctl -u conductor -n 50 --no-pager"
  exit 1
fi

echo ""
echo "=== Update complete ==="
echo "Conductor: $ACTIVE"
echo "Node: $(node --version)"
echo "Commit: $(git -C "$WORKDIR" rev-parse --short HEAD)"
echo ""
echo "☭ Слава роботам."

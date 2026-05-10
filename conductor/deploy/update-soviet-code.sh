#!/usr/bin/env bash
# Soviet Code — update script (git pull + rebuild + restart)
# Run as root. Idempotent: safe to re-run.
set -euxo pipefail

echo "☭ Soviet Code — update starting"
echo "================================"

# 1. Pull latest code
echo "[1/4] Pulling latest code from origin/master..."
cd /opt/soviet-code
sudo -u soviet git pull --ff-only origin master

# 2. Build conductor
echo "[2/4] Building conductor..."
sudo -u soviet npm run build:conductor

# 3. Restart conductor service
echo "[3/4] Restarting conductor.service..."
systemctl restart conductor

# 4. Verify conductor is active
echo "[4/4] Verifying conductor status..."
systemctl status conductor --no-pager

CONDUCTOR_STATE=$(systemctl is-active conductor)
if [ "$CONDUCTOR_STATE" != "active" ]; then
  echo ""
  echo "ERROR: conductor is not active (state: $CONDUCTOR_STATE)"
  echo "Check logs: journalctl -u conductor -n 50 --no-pager"
  exit 1
fi

echo ""
echo "=== Update complete ==="
echo "Conductor: $CONDUCTOR_STATE"
echo "Commit: $(sudo -u soviet git -C /opt/soviet-code log -1 --oneline)"
echo ""
echo "Monitor: journalctl -u conductor -f"
echo ""
echo "☭ Слава роботам."

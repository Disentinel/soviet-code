#!/usr/bin/env bash
# Soviet Code — full deploy script for Ubuntu 22.04/24.04 (Hetzner dev1)
# Run as root. Idempotent: safe to re-run.
set -euo pipefail

echo "☭ Soviet Code — deploy starting"
echo "================================"

# 1. Node.js 22 (skip if already installed)
if ! node --version 2>/dev/null | grep -q "v2[2-9]"; then
  echo "[1/10] Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "[1/10] Node.js $(node --version) — already installed, skipping"
fi

# 2. Claude Code CLI (skip if already installed)
if ! command -v claude &>/dev/null; then
  echo "[2/10] Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code
else
  echo "[2/10] Claude Code already installed, skipping"
fi

# 3. Create user soviet (skip if already exists)
echo "[3/10] Ensuring user 'soviet' exists..."
id soviet &>/dev/null || useradd -m -s /bin/bash soviet

# 4. Clone / update repositories (HTTPS, public)
# NOTE: grafema-cloud is NOT cloned — private repo (gc-restrict-001)
echo "[4/10] Cloning / updating repositories..."
REPOS=(
  "https://github.com/Disentinel/soviet-code /opt/soviet-code"
  "https://github.com/Disentinel/grafema /home/soviet/grafema"
  "https://github.com/Disentinel/kami /home/soviet/kami"
  "https://github.com/Disentinel/enox /home/soviet/enox"
)
for entry in "${REPOS[@]}"; do
  url=${entry% *}
  dir=${entry#* }
  if [ -d "$dir/.git" ]; then
    echo "  Updating $dir..."
    git -C "$dir" pull --ff-only
  else
    echo "  Cloning $url → $dir..."
    git clone "$url" "$dir"
  fi
done
chown -R soviet:soviet /opt/soviet-code /home/soviet/grafema /home/soviet/kami /home/soviet/enox

# 5. npm install + build conductor
echo "[5/10] Installing dependencies and building conductor..."
cd /opt/soviet-code
sudo -u soviet npm install
sudo -u soviet npm run build:conductor

# 6. ENV file (skip if already present)
echo "[6/10] Checking /etc/soviet-code/env..."
mkdir -p /etc/soviet-code
if [ ! -f /etc/soviet-code/env ]; then
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" > /etc/soviet-code/env
    echo "  [env] API key written from environment"
  elif sudo -u soviet claude auth status &>/dev/null 2>&1; then
    touch /etc/soviet-code/env
    echo "  [env] Claude authenticated via OAuth — env file created empty"
  else
    touch /etc/soviet-code/env
    echo "  [WARNING] Claude not authenticated. Run: sudo -u soviet claude auth login"
    echo "  Or set ANTHROPIC_API_KEY and re-run this script."
  fi
  chmod 600 /etc/soviet-code/env
  chown soviet:soviet /etc/soviet-code/env
else
  echo "  /etc/soviet-code/env already exists, skipping"
fi

# 7. Clear session_ids in gosplan.yaml
echo "[7/10] Clearing session_ids in gosplan.yaml..."
python3 -c "
import re
content = open('/opt/soviet-code/gosplan.yaml').read()
content = re.sub(r'(session_id:\s*)[^\n]+', r'\1\"\"', content)
open('/opt/soviet-code/gosplan.yaml', 'w').write(content)
print('  session_ids cleared')
"

# 8. Patch gosplan.yaml: remove grafema-cloud, replace ~/ paths with /home/soviet/
echo "[8/10] Patching gosplan.yaml paths..."
python3 -c "
content = open('/opt/soviet-code/gosplan.yaml').read()
# Remove grafema-cloud references (private repo — gc-restrict-001)
content = content.replace(', ~/grafema-cloud', '').replace('~/grafema-cloud, ', '').replace('~/grafema-cloud', '')
# Rewrite tilde paths to absolute server paths
content = content.replace('~/grafema', '/home/soviet/grafema')
content = content.replace('~/kami', '/home/soviet/kami')
content = content.replace('~/enox', '/home/soviet/enox')
open('/opt/soviet-code/gosplan.yaml', 'w').write(content)
print('  gosplan.yaml patched')
"

# 9. systemd service
echo "[9/10] Installing and starting conductor.service..."
cp /opt/soviet-code/conductor/conductor.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable conductor
systemctl start conductor
echo "Conductor status:"
systemctl status conductor --no-pager

# 10. Summary
echo ""
echo "=== Deploy complete ==="
echo "Conductor: $(systemctl is-active conductor)"
echo "Node: $(node --version)"
echo "Claude: $(claude --version 2>/dev/null || echo 'NOT INSTALLED')"
echo ""
echo "Next steps:"
echo "  1. Transfer politburo.toml for Twitter:"
echo "     scp politburo.toml soviet@<SERVER_IP>:/opt/soviet-code/"
echo "  2. Add server SSH key to GitHub if push access needed"
echo "  3. Monitor: journalctl -u conductor -f"
echo "  - Run 'sudo -u soviet claude auth status' to verify auth"
echo ""
echo "☭ Слава роботам."

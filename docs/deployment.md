# Soviet Code: VM Deployment Playbook

Soviet Code is a local Claude harness. It runs on your machine, in your project directory. This playbook is for developers who want to run it on a remote VM — a CI server, a shared dev box, a Hetzner instance — with persistent sessions and optional process management. This is not required for normal usage.

---

## Prerequisites

- A VM running Ubuntu 22.04+ (Hetzner CPX11 at ~4 €/mo is sufficient; 1 vCPU, 2 GB RAM)
- SSH access to the VM
- An Anthropic API key (get one at console.anthropic.com)
- Node.js 20+ on the VM (see step 1)

**Important**: Soviet Code spawns `claude` (the Claude Code CLI) as a subprocess for every phase of the STALIN pipeline. The Claude Code CLI must be installed and authenticated on the VM. This is the main dependency — not just `soviet-code` itself.

---

## 1. VM Setup

### Connect to your VM

```bash
ssh user@your-vm-ip
```

### Install Node.js 20+ via NodeSource

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should print v20.x.x or higher
```

Alternatively, use nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### Install Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

Claude Code CLI requires authentication. On a headless VM, use the API key env var directly — the browser OAuth flow does not work over SSH:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Add this to your shell profile to persist it:

```bash
echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.bashrc
source ~/.bashrc
```

Verify authentication:

```bash
claude -p "hello" --model claude-haiku-4-5-20251001
# Should return a short response. If it errors, the key is wrong or the CLI is not installed.
```

### Install Soviet Code

```bash
npm install -g soviet-code
soviet --version
# Expected: 1.961.0 or later
```

---

## 2. Project Setup

Clone your project onto the VM, then initialize Soviet Code in it:

```bash
git clone git@github.com:your-org/your-project.git
cd your-project
soviet init
```

This creates `.soviet/` and `politburo.toml` in the project root.

---

## 3. politburo.toml Configuration

`politburo.toml` lives at the **project root** (not in a global config directory). `soviet init` generates it. The relevant fields:

```toml
[party]
name = "My Project"
version = "1.0.0"
model = "sonnet"        # pioneer=haiku | komsomolets=sonnet | cc=opus

[iron_curtain]
allowed_domains = []    # external domains the agent may access

[gosplan]
max_directives = 10
language = "ru"

[nomenklatura]
# backend = "local"     # "local" (default) | "enox" | "both"
```

**API key**: Do not put the API key in `politburo.toml`. It is not read from there. Set `ANTHROPIC_API_KEY` as an environment variable (see section 1). Soviet Code inherits it from the shell when it spawns `claude`.

---

## 4. Telegram Integration

**Roadmap: not yet implemented — skip for now.**

Soviet Code v1.961.0 has no Telegram notification support. No `[telegram]` section in politburo.toml, no webhook calls in the source. This is planned for a future release.

When implemented, tribunal verdicts, labor completions, and inspection results will be pushable to a Telegram chat. The playbook will be updated at that point.

---

## 5. Running Persistently

### Quick: tmux (recommended for personal use)

```bash
# On the VM:
tmux new -s soviet
cd ~/your-project
soviet plan "refactor the auth layer"
soviet review
soviet work
# Detach: Ctrl-B D
# Reattach later: tmux attach -t soviet
```

### Production: systemd service

Create `/etc/systemd/system/soviet-worker.service`:

```ini
[Unit]
Description=Soviet Code Worker
After=network.target

[Service]
Type=oneshot
User=your-user
WorkingDirectory=/home/your-user/your-project
Environment=ANTHROPIC_API_KEY=sk-ant-...
ExecStart=/usr/bin/soviet work
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Note: Soviet Code commands are not long-running daemons — each `soviet work` executes one directive and exits. For automated sequential execution, use a loop script:

```bash
#!/bin/bash
# run-soviet.sh
set -e
soviet review
while soviet status | grep -q "○"; do
  soviet work
done
soviet inspect
```

Run via systemd as above, or via cron, or manually inside tmux.

---

## 6. Security Notes

### Secrets and gitignore

`politburo.toml` contains no secrets if you use the `ANTHROPIC_API_KEY` env var
approach (recommended). It is safe to commit and share with your team — treat it
like `.eslintrc` or `pyproject.toml`.

`soviet init` automatically creates `.soviet/.gitignore` that excludes `gulag/`.
No manual `.gitignore` entries are needed.

If you ever add credentials directly to `politburo.toml` (not recommended), add it
to your project's `.gitignore` manually.

### SSH key auth for the VM

Disable password auth on the VM:

```bash
# /etc/ssh/sshd_config
PasswordAuthentication no
PubkeyAuthentication yes
```

```bash
sudo systemctl restart sshd
```

### API key exposure

The `ANTHROPIC_API_KEY` in a systemd unit file is readable by root. For production use, store it in a secrets manager or use systemd's `EnvironmentFile` pointing to a file with `600` permissions:

```ini
[Service]
EnvironmentFile=/etc/soviet-code/env
```

```bash
# /etc/soviet-code/env (chmod 600, owned by root)
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Verification

After setup, run a smoke test:

```bash
cd ~/your-project
soviet init
soviet plan "add a hello world function to README"
soviet review
# Expect: Tribunal output with 3 votes and a verdict
soviet status
```

If the Tribunal fires and returns a verdict (approved or rejected), Soviet Code is correctly installed and authenticated on the VM.

---

*Централизованное планирование. Децентрализованный труд. ☭*

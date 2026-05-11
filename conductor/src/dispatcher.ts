import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, renameSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { bus } from "./log.js";
import { updateSessionId } from "./config.js";
import type { Department } from "./types.js";

const TIMEOUT_MS = 30 * 60 * 1000;
const active = new Set<string>();
const processes = new Map<string, ChildProcess>();
const dispatched = new Set<string>();
let draining = false;
let taskCount = 0;

export function getTaskCount(): number {
  return taskCount;
}

export function setDraining(): void {
  draining = true;
}

export function waitIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (active.size === 0) { resolve(); return; }
    const check = setInterval(() => {
      if (active.size === 0) { clearInterval(check); resolve(); }
    }, 1000);
  });
}

export function isActive(deptName: string): boolean {
  return active.has(deptName);
}

export async function dispatch(dept: Department, heartbeat = false): Promise<void> {
  if (dept.name === "aruji") return;
  if (draining) {
    bus.emit("log", {
      ts: new Date().toISOString(),
      dept: dept.name,
      event: "skip",
      detail: "draining",
    });
    return;
  }
  if (active.has(dept.name)) {
    bus.emit("log", {
      ts: new Date().toISOString(),
      dept: dept.name,
      event: "skip",
      detail: "already active",
    });
    return;
  }

  const inboxPath = resolve(process.cwd(), dept.inbox);
  const triggeredFiles = existsSync(inboxPath)
    ? readdirSync(inboxPath).filter(
        (f) => f.endsWith(".md") && !f.startsWith(".") && !dispatched.has(`${dept.name}:${f}`),
      )
    : [];
  if (triggeredFiles.length === 0 && !heartbeat) return;

  for (const f of triggeredFiles) {
    const key = `${dept.name}:${f}`;
    dispatched.add(key);
    setTimeout(() => dispatched.delete(key), 35 * 60 * 1000);
  }

  active.add(dept.name);
  taskCount++;
  const started = Date.now();
  const trigger = heartbeat ? "heartbeat (no inbox files)" : triggeredFiles.join(", ");

  const rolePath = resolve(process.cwd(), dept.role);
  let roleContent: string;
  try {
    roleContent = await readFile(rolePath, "utf-8");
    bus.emit("log", {
      ts: new Date().toISOString(),
      dept: dept.name,
      event: "role_read",
      detail: `role.md read (${roleContent.length} bytes)`,
    });
  } catch {
    roleContent = `You are the ${dept.name} department.`;
  }

  const handoffPath = resolve(process.cwd(), `depts/${dept.name}/handoff.md`);
  let handoff = "";
  try {
    handoff = await readFile(handoffPath, "utf-8");
  } catch { /* no handoff = fresh start */ }

  // Load optional context files (dossier, backstory, self-profile, etc.)
  const contextFiles = ["dossier.md", "backstory.md", "self-profile.md"];
  let contextBlock = "";
  for (const cf of contextFiles) {
    try {
      const content = await readFile(resolve(process.cwd(), `depts/${dept.name}/${cf}`), "utf-8");
      if (content.trim()) contextBlock += `\n---\n## ${cf}\n${content}\n`;
    } catch { /* file doesn't exist — skip */ }
  }

  const useHeartbeatModel = heartbeat && dept.heartbeatModel;
  const effectiveModel = useHeartbeatModel ? dept.heartbeatModel! : dept.model;

  const tickType = heartbeat
    ? (useHeartbeatModel
      ? "TRIAGE TICK (cheap model). Check inboxes of all departments for pending work. If ANY department has unprocessed .md files — write a task to the appropriate inbox. If nothing to do — output one line: IDLE. Do NOT do research, do NOT call MCP tools. Just check files and dispatch."
      : "Heartbeat tick — no new inbox files. Check: Linear, backlog, KB gaps, proactive proposals. Do NOT idle.")
    : `New tick triggered by: ${trigger}\nProcess your inbox now.`;

  const prompt = `${roleContent}\n\n${handoff ? `---\n## Previous session handoff\n${handoff}\n` : ""}${contextBlock}---\n${tickType}`;

  const args = ["-p", "--verbose", "--output-format", "stream-json", "--model", effectiveModel];

  // Heartbeat on cheap model — don't resume session, fresh context
  if (useHeartbeatModel) {
    // Skip --resume, use minimal tools
    if (dept.allowedTools.length > 0) {
      args.push("--allowedTools", "Read", "Write", "Glob");
    }
  } else {
    if (dept.allowedTools.length > 0) {
      args.push("--allowedTools", ...dept.allowedTools);
    }

    for (const dir of dept.extraDirs) {
      const expanded = dir.replace(/^~/, process.env.HOME ?? "~");
      args.push("--add-dir", expanded);
    }

    args.push(
      "--append-system-prompt",
      "SECURITY (enforced by principal): "
        + "Do NOT access ~/.ssh, ~/.aws, ~/.config or any dot-directories. "
        + "NEVER touch .restart-requested — operator only. "
        + "NEVER write smoke-test files to other departments' inboxes. "
        + "Do NOT read or use API keys, tokens, or secrets. "
        + "Do NOT create or modify cloud resources. "
        + "Do NOT access files outside the project and allowed directories. "
        + `Write ONLY to depts/${dept.name}/ and target department inboxes for message delivery.`,
    );

    if (dept.sessionId) {
      args.push("--resume", dept.sessionId);
    }
  }

  args.push(prompt);

  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: dept.name,
    event: "start",
    trigger,
  });

  const proc = spawn("claude", args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: resolve(process.cwd()),
  });
  processes.set(dept.name, proc);

  let output = "";
  let stdoutBuffer = "";

  proc.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    output += text;
    stdoutBuffer += text;

    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop()!;

    for (const line of lines) {
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        bus.emit("claude", {
          ts: new Date().toISOString(),
          dept: dept.name,
          ...event,
        });

        if (!dept.sessionId && event.session_id) {
          dept.sessionId = event.session_id;
          updateSessionId(dept.name, event.session_id);
          bus.emit("log", {
            ts: new Date().toISOString(),
            dept: dept.name,
            event: "session_assigned",
            detail: event.session_id,
          });
        }
      } catch {
        bus.emit("log", {
          ts: new Date().toISOString(),
          dept: dept.name,
          event: "parse_error",
          detail: line.slice(0, 200),
        });
      }
    }
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    bus.emit("log", {
      ts: new Date().toISOString(),
      dept: dept.name,
      event: "stderr",
      detail: chunk.toString().trim(),
    });
  });

  const timeout = setTimeout(() => {
    bus.emit("log", {
      ts: new Date().toISOString(),
      dept: dept.name,
      event: "timeout",
      detail: `killed after ${TIMEOUT_MS / 1000}s`,
      duration: Date.now() - started,
    });
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 5000);
  }, TIMEOUT_MS);

  proc.on("error", (err) => {
    clearTimeout(timeout);
    active.delete(dept.name);
    processes.delete(dept.name);
    bus.emit("log", {
      ts: new Date().toISOString(),
      dept: dept.name,
      event: "spawn_error",
      detail: err.message,
    });
  });

  proc.on("close", async (code) => {
    clearTimeout(timeout);
    active.delete(dept.name);
    processes.delete(dept.name);
    bus.emit("log", {
      ts: new Date().toISOString(),
      dept: dept.name,
      event: "done",
      code,
      duration: Date.now() - started,
    });

    const ceoInbox = resolve(process.cwd(), "depts/ceo/inbox");
    if (existsSync(ceoInbox)) {
      const kbPattern = /KB hit:/i;
      for (const f of await readdir(ceoInbox)) {
        if (!f.endsWith(".md")) continue;
        try {
          const fPath = resolve(ceoInbox, f);
          if ((await stat(fPath)).mtimeMs < started) continue;
          const content = await readFile(fPath, "utf-8");
          if (!content.includes(`from: ${dept.name}`)) continue;
          if (!kbPattern.test(content)) {
            bus.emit("log", {
              ts: new Date().toISOString(),
              dept: dept.name,
              event: "warn_kb_missing",
              detail: `${f} report missing KB-first line`,
            });
          }
        } catch { /* skip unreadable files */ }
      }
    }

    const processedDir = resolve(process.cwd(), `depts/${dept.name}/processed`);
    mkdirSync(processedDir, { recursive: true });
    for (const f of triggeredFiles) {
      const inboxFile = resolve(process.cwd(), dept.inbox, f);
      if (existsSync(inboxFile)) {
        try {
          renameSync(inboxFile, resolve(processedDir, f));
          bus.emit("log", {
            ts: new Date().toISOString(),
            dept: dept.name,
            event: "auto_processed",
            detail: f,
          });
        } catch {
          bus.emit("log", {
            ts: new Date().toISOString(),
            dept: dept.name,
            event: "warn_unprocessed",
            detail: `failed to move ${f} to processed/`,
          });
        }
      }
    }

    if (existsSync(inboxPath)) {
      const remaining = readdirSync(inboxPath).filter(
        (f) => f.endsWith(".md") && !f.startsWith("."),
      );
      if (remaining.length > 0) {
        bus.emit("log", {
          ts: new Date().toISOString(),
          dept: dept.name,
          event: "rescan",
          detail: `${remaining.length} file(s) pending: ${remaining.join(", ")}`,
        });
        dispatch(dept);
      }
    }
  });

  void output; // suppress unused var warning
}

export function shutdown(): Promise<void> {
  if (processes.size === 0) return Promise.resolve();

  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: "conductor",
    event: "shutdown",
    detail: `killing ${processes.size} active process(es): ${[...processes.keys()].join(", ")}`,
  });

  return new Promise((resolve) => {
    let remaining = processes.size;
    for (const [, proc] of processes) {
      proc.kill("SIGTERM");
      proc.on("close", () => {
        remaining--;
        if (remaining === 0) resolve();
      });
    }
    setTimeout(() => {
      for (const [, proc] of processes) {
        if (!proc.killed) proc.kill("SIGKILL");
      }
      resolve();
    }, 5000);
  });
}

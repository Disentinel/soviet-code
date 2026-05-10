import { watch, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { bus } from "./log.js";
import { loadConfig } from "./config.js";
import { dispatch, isActive } from "./dispatcher.js";
import type { Department } from "./types.js";

const DEBOUNCE_MS = 2000;
const pending = new Map<string, NodeJS.Timeout>();
const watched = new Set<string>();
let config_broken = false;

function watchInbox(dept: Department): void {
  if (dept.name === "aruji") return;
  if (watched.has(dept.name)) return;

  const inboxPath = resolve(process.cwd(), dept.inbox);

  if (!existsSync(inboxPath)) {
    mkdirSync(inboxPath, { recursive: true });
  }

  watch(inboxPath, (eventType, filename) => {
    if (!filename || !filename.endsWith(".md")) return;
    if (filename.startsWith(".")) return;

    clearTimeout(pending.get(dept.name));
    pending.set(
      dept.name,
      setTimeout(() => {
        pending.delete(dept.name);
        if (!isActive(dept.name) && !config_broken) {
          dispatch(dept);
        }
      }, DEBOUNCE_MS),
    );
  });

  watched.add(dept.name);

  const existing = readdirSync(inboxPath).filter(
    (f) => f.endsWith(".md") && !f.startsWith("."),
  );
  if (existing.length > 0) {
    bus.emit("log", {
      ts: new Date().toISOString(),
      dept: dept.name,
      event: "inbox_backlog",
      detail: `${existing.length} file(s): ${existing.join(", ")}`,
    });
    if (!isActive(dept.name) && !config_broken) {
      dispatch(dept);
    }
  }

  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: dept.name,
    event: "watching",
    detail: inboxPath,
  });
}

let knownDepts: Department[] = [];

const SCAN_INTERVAL_MS = 5 * 60 * 1000;

function fullInboxScan(): void {
  if (config_broken) return;
  for (const dept of knownDepts) {
    if (dept.name === "aruji" || isActive(dept.name)) continue;
    const inboxPath = resolve(process.cwd(), dept.inbox);
    if (!existsSync(inboxPath)) continue;
    const files = readdirSync(inboxPath).filter(
      (f) => f.endsWith(".md") && !f.startsWith("."),
    );
    if (files.length > 0) {
      bus.emit("log", {
        ts: new Date().toISOString(),
        dept: dept.name,
        event: "periodic_scan",
        detail: `${files.length} file(s): ${files.join(", ")}`,
      });
      dispatch(dept);
    }
  }
}

const CEO_HEARTBEAT_MS = 30 * 60 * 1000;

function gensekHeartbeat(): void {
  if (config_broken) return;
  const gensek = knownDepts.find((d) => d.name === "gensek");
  if (!gensek || isActive("gensek")) return;

  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: "gensek",
    event: "heartbeat",
    detail: "periodic anti-idle tick",
  });
  dispatch(gensek, true);
}

const KOMISSAR_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const KOMISSAR_CHECK_MS = 30 * 60 * 1000; // check every 30 min if it's time

function komissarHeartbeat(): void {
  if (config_broken) return;
  const komissar = knownDepts.find((d) => d.name === "komissar");
  if (!komissar || isActive("komissar")) return;

  // Check last reflection timestamp from processed files
  const processedPath = resolve(process.cwd(), "depts/komissar/processed");
  let lastReflectionMs = 0;
  try {
    const files = readdirSync(processedPath).filter((f) => f.startsWith("komissar-"));
    for (const f of files) {
      const fPath = resolve(processedPath, f);
      const mtime = require("node:fs").statSync(fPath).mtimeMs;
      if (mtime > lastReflectionMs) lastReflectionMs = mtime;
    }
  } catch { /* no processed dir yet */ }

  const elapsed = Date.now() - lastReflectionMs;
  if (elapsed < KOMISSAR_INTERVAL_MS) return; // too soon since last reflection

  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: "komissar",
    event: "heartbeat",
    detail: `reflection due (${Math.round(elapsed / 3600000)}h since last)`,
  });
  dispatch(komissar, true);
}

export function watchDepartments(depts: Department[]): void {
  knownDepts = depts;
  for (const dept of depts) {
    watchInbox(dept);
  }
  setInterval(fullInboxScan, SCAN_INTERVAL_MS);
  setInterval(gensekHeartbeat, CEO_HEARTBEAT_MS);
  setInterval(komissarHeartbeat, KOMISSAR_CHECK_MS);
}

export function watchConfig(onReload: (depts: Department[]) => void): void {
  const configFile = process.env.GOSPLAN_FILE ?? "gosplan.yaml";
  const configPath = resolve(process.cwd(), configFile);
  let debounce: NodeJS.Timeout | undefined;

  watch(configPath, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        const fresh = loadConfig();
        const newDepts = fresh.filter((d) => !watched.has(d.name) && d.name !== "aruji");

        for (const existing of knownDepts) {
          const updated = fresh.find((d) => d.name === existing.name);
          if (updated) {
            existing.sessionId = updated.sessionId;
          }
        }

        if (config_broken) {
          config_broken = false;
          bus.emit("log", {
            ts: new Date().toISOString(),
            dept: "conductor",
            event: "config_restored",
            detail: "gosplan.yaml valid again — dispatches unblocked",
          });
        }

        if (newDepts.length > 0) {
          knownDepts.push(...newDepts);
          for (const dept of newDepts) {
            watchInbox(dept);
          }
          bus.emit("log", {
            ts: new Date().toISOString(),
            dept: "conductor",
            event: "config_reload",
            detail: `new departments: ${newDepts.map((d) => d.name).join(", ")}`,
          });
          onReload(knownDepts);
        }
      } catch (err) {
        config_broken = true;
        bus.emit("log", {
          ts: new Date().toISOString(),
          dept: "conductor",
          event: "config_broken",
          detail: `parse error — dispatches blocked: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }, 1000);
  });
}

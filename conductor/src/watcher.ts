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

const CEO_HEARTBEAT_MS = 10 * 60 * 1000;

function ceoHeartbeat(): void {
  if (config_broken) return;
  const ceo = knownDepts.find((d) => d.name === "ceo");
  if (!ceo || isActive("ceo")) return;

  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: "ceo",
    event: "heartbeat",
    detail: "periodic anti-idle tick",
  });
  dispatch(ceo, true);
}

export function watchDepartments(depts: Department[]): void {
  knownDepts = depts;
  for (const dept of depts) {
    watchInbox(dept);
  }
  setInterval(fullInboxScan, SCAN_INTERVAL_MS);
  setInterval(ceoHeartbeat, CEO_HEARTBEAT_MS);
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

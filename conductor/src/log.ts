import { EventEmitter } from "node:events";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LogEntry } from "./types.js";

export const bus = new EventEmitter();
bus.setMaxListeners(50);

const DISPATCH_EVENTS = new Set(["start", "done", "skip", "spawn_error", "timeout"]);

bus.on("log", (entry: LogEntry) => {
  const line = `${entry.ts} [${entry.dept}] ${entry.event}${entry.trigger ? ` — ${entry.trigger}` : ""}${entry.duration ? ` (${entry.duration}ms)` : ""}`;
  console.log(line);
  const logFile = resolve(process.cwd(), "conductor.log");
  appendFileSync(logFile, JSON.stringify(entry) + "\n");

  if (DISPATCH_EVENTS.has(entry.event)) {
    const eventsFile = resolve(process.cwd(), "conductor.events.jsonl");
    appendFileSync(eventsFile, JSON.stringify(entry) + "\n");
  }
});

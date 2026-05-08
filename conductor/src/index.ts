import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { watch, existsSync, unlinkSync } from "node:fs";
import { loadConfig, loadGosplanSection } from "./config.js";
import { watchDepartments, watchConfig } from "./watcher.js";
import { startBridge } from "./bridge.js";
import { startDashboard } from "./dashboard.js";
import { shutdown, setDraining, waitIdle } from "./dispatcher.js";
import { bus } from "./log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
process.chdir(ROOT);

bus.emit("log", {
  ts: new Date().toISOString(),
  dept: "conductor",
  event: "boot",
  detail: `root=${ROOT}`,
});

const depts = loadConfig();

bus.emit("log", {
  ts: new Date().toISOString(),
  dept: "conductor",
  event: "loaded",
  detail: `${depts.length} departments: ${depts.map((d) => d.name).join(", ")}`,
});

const PORT = parseInt(process.env.SOVIET_PORT ?? process.env.MULTIFORA_PORT ?? "8109");
startDashboard(depts, PORT);
watchDepartments(depts);

const gosplan = loadGosplanSection();
if (gosplan.telegram?.bot_token) {
  startBridge(gosplan.telegram, ROOT).catch((err: Error) =>
    bus.emit("log", {
      ts: new Date().toISOString(),
      dept: "bridge",
      event: "start_error",
      detail: err.message,
    }),
  );
}
watchConfig((updatedDepts) => {
  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: "conductor",
    event: "depts_updated",
    detail: `${updatedDepts.length} departments`,
  });
});

async function onShutdown(signal: string): Promise<void> {
  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: "conductor",
    event: "shutting_down",
    detail: signal,
  });
  await shutdown();
  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: "conductor",
    event: "exit",
  });
  process.exit(0);
}

process.on("SIGINT", () => onShutdown("SIGINT"));
process.on("SIGTERM", () => onShutdown("SIGTERM"));

const RESTART_SIGNAL = resolve(ROOT, ".restart-requested");
let drainStarted = false;

async function handleRestartSignal(): Promise<void> {
  if (drainStarted || !existsSync(RESTART_SIGNAL)) return;
  drainStarted = true;
  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: "conductor",
    event: "drain_start",
    detail: ".restart-requested detected",
  });
  setDraining();
  await waitIdle();
  unlinkSync(RESTART_SIGNAL);
  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: "conductor",
    event: "restart",
    detail: "drain complete, exiting for launchd restart",
  });
  process.exit(0);
}

watch(ROOT, (_, filename) => {
  if (filename === ".restart-requested") handleRestartSignal();
});

if (existsSync(RESTART_SIGNAL)) handleRestartSignal();

bus.emit("log", {
  ts: new Date().toISOString(),
  dept: "conductor",
  event: "ready",
  detail: "watching inboxes + gosplan.yaml, dashboard up",
});

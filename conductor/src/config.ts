import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import type { Config, Department, GosplanSection } from "./types.js";

function configPath(): string {
  return resolve(process.cwd(), process.env.GOSPLAN_FILE ?? "gosplan.yaml");
}

export function loadConfig(): Department[] {
  const raw = readFileSync(configPath(), "utf-8");
  const config: Config = YAML.parse(raw);

  return Object.entries(config.departments).map(([name, dept]) => ({
    name,
    sessionId: dept.session_id,
    role: dept.role,
    inbox: dept.inbox,
    outbox: dept.outbox,
    description: dept.description,
    model: dept.model ?? "sonnet",
    heartbeatModel: dept.heartbeat_model ?? null,
    allowedTools: dept.allowed_tools ?? [],
    extraDirs: dept.extra_dirs ?? [],
  }));
}

export function loadGosplanSection(): GosplanSection {
  const raw = readFileSync(configPath(), "utf-8");
  const parsed = YAML.parse(raw) as { gosplan?: GosplanSection };
  return parsed.gosplan ?? {};
}

export function updateSessionId(deptName: string, sessionId: string): void {
  const path = configPath();
  const raw = readFileSync(path, "utf-8");
  const config: Config = YAML.parse(raw);
  config.departments[deptName].session_id = sessionId;
  writeFileSync(path, YAML.stringify(config));
}

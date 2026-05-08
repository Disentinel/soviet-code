import { readFileSync } from "fs";

export interface NomenklaturaConfig {
  backend?: "local" | "enox" | "both";
  enox_domain?: string;
  enox_mcp_command?: string;
  enox_mcp_args?: string[];
}

export interface GosplanConfig {
  port?: number;
  departments_file?: string;
  telegram?: {
    bot_token: string;
    chat_id: string;
    notify_on: string[];
  };
}

export interface Config {
  party?: { name?: string; version?: string; model?: string };
  nomenklatura?: NomenklaturaConfig;
  gosplan?: GosplanConfig;
}

function parseTOML(content: string): Config {
  const result: Record<string, Record<string, unknown>> = {};
  let sectionPath: string[] = [];

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const sectionMatch = /^\[(\w+(?:\.\w+)*)\]$/.exec(line);
    if (sectionMatch) {
      sectionPath = sectionMatch[1].split(".");
      let cur = result as Record<string, unknown>;
      for (const seg of sectionPath) {
        if (!cur[seg] || typeof cur[seg] !== "object") cur[seg] = {};
        cur = cur[seg] as Record<string, unknown>;
      }
      continue;
    }

    if (sectionPath.length === 0) continue;
    const kvMatch = /^(\w+)\s*=\s*(.+)$/.exec(line);
    if (!kvMatch) continue;

    const [, key, rawVal] = kvMatch;
    const val = rawVal.trim().replace(/\s*#.*$/, "").trim();

    let parsed: unknown;
    if (val.startsWith('"') && val.endsWith('"')) {
      parsed = val.slice(1, -1);
    } else if (val.startsWith("[") && val.endsWith("]")) {
      parsed = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    } else if (val === "true") {
      parsed = true;
    } else if (val === "false") {
      parsed = false;
    } else if (val !== "" && !isNaN(Number(val))) {
      parsed = Number(val);
    } else {
      parsed = val;
    }

    let cur = result as Record<string, unknown>;
    for (const seg of sectionPath) {
      cur = cur[seg] as Record<string, unknown>;
    }
    cur[key] = parsed;
  }

  return result as unknown as Config;
}

export function loadConfig(): Config {
  try {
    return parseTOML(readFileSync("politburo.toml", "utf-8"));
  } catch {
    return {};
  }
}

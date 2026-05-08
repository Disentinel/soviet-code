import { readFileSync } from "fs";

export interface NomenklaturaConfig {
  backend?: "local" | "enox" | "both";
  enox_domain?: string;
  enox_mcp_command?: string;
  enox_mcp_args?: string[];
}

export interface Config {
  party?: { name?: string; version?: string; model?: string };
  nomenklatura?: NomenklaturaConfig;
}

function parseTOML(content: string): Config {
  const result: Record<string, Record<string, unknown>> = {};
  let section = "";

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const sectionMatch = /^\[(\w+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      result[section] ??= {};
      continue;
    }

    if (!section) continue;
    const kvMatch = /^(\w+)\s*=\s*(.+)$/.exec(line);
    if (!kvMatch) continue;

    const [, key, rawVal] = kvMatch;
    const val = rawVal.trim().replace(/\s*#.*$/, "").trim();

    if (val.startsWith('"') && val.endsWith('"')) {
      result[section][key] = val.slice(1, -1);
    } else if (val.startsWith("[") && val.endsWith("]")) {
      result[section][key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    } else if (val === "true") {
      result[section][key] = true;
    } else if (val === "false") {
      result[section][key] = false;
    } else if (val !== "" && !isNaN(Number(val))) {
      result[section][key] = Number(val);
    } else {
      result[section][key] = val;
    }
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

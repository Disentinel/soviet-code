import { existsSync, readFileSync, writeFileSync } from "fs";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Config } from "./config.js";

export interface NomenklaturaEntry {
  phase: string;
  event: string;
  [key: string]: unknown;
}

interface NomenklaturaBackend {
  record(entry: NomenklaturaEntry): Promise<void>;
  close(): Promise<void>;
}

const LOCAL_FILE = ".soviet/nomenklatura.json";

// ── LocalBackend ──────────────────────────────────────────────────────────────

class LocalBackend implements NomenklaturaBackend {
  async record(entry: NomenklaturaEntry): Promise<void> {
    let list: object[] = [];
    if (existsSync(LOCAL_FILE)) {
      try {
        list = JSON.parse(readFileSync(LOCAL_FILE, "utf-8")) as object[];
      } catch { /* corrupted file — start fresh */ }
    }
    list.push({ ts: new Date().toISOString(), ...entry });
    writeFileSync(LOCAL_FILE, JSON.stringify(list, null, 2), "utf-8");
  }

  async close(): Promise<void> {}
}

// ── EnoxBackend ───────────────────────────────────────────────────────────────

class EnoxBackend implements NomenklaturaBackend {
  private client: Client | null = null;
  private connected = false;
  private failed = false;
  private local = new LocalBackend();
  private projectName: string;

  constructor(private config: Config) {
    this.projectName = config.party?.name ?? "Unknown Project";
  }

  private async connect(): Promise<void> {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );

    const cfg = this.config.nomenklatura ?? {};
    const transport = new StdioClientTransport({
      command: cfg.enox_mcp_command ?? "npx",
      args: cfg.enox_mcp_args ?? ["-y", "@enox/mcp-server"],
    });

    this.client = new Client({ name: "soviet-code", version: "1.963.0" }, {});
    await this.client.connect(transport);
    this.connected = true;
  }

  private prefix(s: string): string {
    return `Soviet Code: ${this.projectName} — ${s}`;
  }

  private toAssertion(entry: NomenklaturaEntry): Record<string, unknown> | null {
    const today = new Date().toISOString().slice(0, 10);
    const pn = this.projectName;

    switch (`${entry.phase}:${entry.event}`) {
      case "АЛЛОКАЦИЯ:pyatiletka_created":
        return {
          source_name: this.prefix(`Pyatiletka: ${String(entry.title ?? "")}`),
          source_type: "task",
          target_name: `Soviet Code: ${pn}`,
          target_type: "effort",
          relation: "part_of",
          confidence: 1,
          context: `Created ${String(entry.ts ?? today)}. Directives: ${String(entry.count ?? 0)}`,
        };

      case "ТРИБУНАЛ:tribunal_verdict": {
        const votes = (
          entry.votes as Array<{ reviewer: string; vote: string; reason: string }> ?? []
        )
          .map((v) => `${v.reviewer}: ${v.vote} — ${v.reason}`)
          .join("; ");
        return {
          source_name: this.prefix(`Tribunal ${today}`),
          source_type: "event",
          target_name: this.prefix(`Pyatiletka: ${String(entry.pyatiletka_title ?? "")}`),
          target_type: "task",
          relation: "about",
          confidence: Number(entry.approved_count ?? 0) / 3,
          context: `Verdict: ${String(entry.verdict ?? "")}. ${String(entry.approved_count ?? 0)}/3 approved. ${votes}`,
        };
      }

      case "ЛЕЙБОР:directive_done":
        return {
          source_name: this.prefix(`Directive: ${String(entry.id ?? "")} ${String(entry.title ?? "")}`),
          source_type: "task",
          target_name: this.prefix(`Pyatiletka: ${String(entry.pyatiletka_title ?? "")}`),
          target_type: "task",
          relation: "part_of",
          confidence: 1,
          context: `Completed ${today}. ID: ${String(entry.id ?? "")}, priority: ${String(entry.priority ?? "normal")}`,
        };

      case "ИНСПЕКЦИЯ:inspection_done":
        return {
          source_name: this.prefix(`Inspection ${today}`),
          source_type: "event",
          target_name: this.prefix(`Pyatiletka: ${String(entry.pyatiletka_title ?? "")}`),
          target_type: "task",
          relation: "about",
          confidence: 1,
          context: String(entry.summary ?? "").slice(0, 400),
        };

      case "ЧИСТКА:purge":
        return {
          source_name: this.prefix(`Purge ${today}`),
          source_type: "event",
          target_name: `Soviet Code: ${pn}`,
          target_type: "effort",
          relation: "about",
          confidence: 1,
          context: `Purged ${today}. Hard: ${String(entry.hard ?? false)}. Backup: ${String(entry.backup ?? "")}`,
        };

      case "РЕАБИЛИТАЦИЯ:rehabilitated": {
        const backupFile = String(entry.source ?? "");
        const backupTs = backupFile.replace(/-pyatiletka\.json$/, "");
        const purgeDate = backupTs
          ? new Date(Number(backupTs)).toISOString().slice(0, 10)
          : today;
        return {
          source_name: this.prefix(`Pyatiletka: ${String(entry.pyatiletka_title ?? "")}`),
          source_type: "task",
          target_name: this.prefix(`Purge ${purgeDate}`),
          target_type: "event",
          relation: "supersedes",
          confidence: 1,
          context: `Rehabilitated from ${backupFile}. Tribunal status reset.`,
        };
      }

      default:
        return null;
    }
  }

  async record(entry: NomenklaturaEntry): Promise<void> {
    if (this.failed) {
      await this.local.record(entry);
      return;
    }
    try {
      if (!this.connected) await this.connect();
      const assertion = this.toAssertion(entry);
      if (assertion) {
        await this.client!.callTool({ name: "add_assertion", arguments: assertion });
      }
    } catch (e) {
      this.failed = true;
      console.warn(
        `☭ Номенклатура Enox недоступна: запись в локальный файл (${(e as Error).message})`,
      );
      await this.local.record(entry);
    }
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch { /* ignore */ }
  }
}

// ── BothBackend ───────────────────────────────────────────────────────────────

class BothBackend implements NomenklaturaBackend {
  private local = new LocalBackend();
  private enox: EnoxBackend;

  constructor(config: Config) {
    this.enox = new EnoxBackend(config);
  }

  async record(entry: NomenklaturaEntry): Promise<void> {
    await Promise.allSettled([this.local.record(entry), this.enox.record(entry)]);
  }

  async close(): Promise<void> {
    await this.enox.close();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _backend: NomenklaturaBackend = new LocalBackend();

export async function initBackend(config: Config): Promise<void> {
  const b = config.nomenklatura?.backend ?? "local";
  if (b === "enox") _backend = new EnoxBackend(config);
  else if (b === "both") _backend = new BothBackend(config);
  else _backend = new LocalBackend();
}

export async function record(entry: NomenklaturaEntry): Promise<void> {
  await _backend.record(entry);
}

export async function closeBackend(): Promise<void> {
  await _backend.close();
}

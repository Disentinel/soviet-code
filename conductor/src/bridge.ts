import {
  watch,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve } from "node:path";
import { bus } from "./log.js";
import type { TelegramConfig } from "./types.js";

const TG_MAX = 4096;

interface TgMessage {
  message_id: number;
  text?: string;
  chat: { id: number };
  date: number;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

interface TgResponse {
  ok: boolean;
  result: TgUpdate[];
}

function apiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

function log(event: string, detail?: string): void {
  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: "bridge",
    event,
    ...(detail !== undefined ? { detail } : {}),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stripFrontmatter(content: string): string {
  const match = /^---\n[\s\S]*?\n---\n([\s\S]*)$/.exec(content);
  return match ? match[1].trim() : content.trim();
}

function parseFrontmatterField(content: string, field: string): string | undefined {
  const block = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!block) return undefined;
  const fieldMatch = new RegExp(`^${field}:\\s*(.+)$`, "m").exec(block[1]);
  return fieldMatch ? fieldMatch[1].trim() : undefined;
}

function truncate(text: string): string {
  if (text.length <= TG_MAX) return text;
  return text.slice(0, TG_MAX - 15) + "\n[...обрезано]";
}

async function flushOutbox(
  token: string,
  chatId: string,
  outboxPath: string,
  processedPath: string,
): Promise<void> {
  const files = readdirSync(outboxPath).filter(
    (f) => f.endsWith(".md") && !f.startsWith("."),
  );
  for (const filename of files) {
    const filePath = resolve(outboxPath, filename);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    const body = truncate(stripFrontmatter(content));
    if (!body) continue;

    try {
      const res = await fetch(apiUrl(token, "sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: body }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${errBody}`);
      }
      renameSync(filePath, resolve(processedPath, filename));
      log("sent", filename);
    } catch (err) {
      log(
        "send_error",
        `${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Leave in outbox — will retry on next fs.watch event
    }
  }
}

function watchOutbox(token: string, chatId: string, workdir: string): void {
  const outboxPath = resolve(workdir, "depts/tovarishch/outbox");
  const processedPath = resolve(workdir, "depts/tovarishch/processed");

  if (!existsSync(outboxPath)) mkdirSync(outboxPath, { recursive: true });
  if (!existsSync(processedPath)) mkdirSync(processedPath, { recursive: true });

  // Drain any files already waiting
  void flushOutbox(token, chatId, outboxPath, processedPath);

  watch(outboxPath, (_, filename) => {
    if (!filename || !filename.endsWith(".md") || filename.startsWith(".")) return;
    void flushOutbox(token, chatId, outboxPath, processedPath);
  });

  log("outbox_watching", outboxPath);
}

async function flushTelegramInbox(
  token: string,
  chatId: string,
  inboxPath: string,
  processedPath: string,
): Promise<void> {
  const files = readdirSync(inboxPath).filter(
    (f) => f.endsWith(".md") && !f.startsWith("."),
  );
  for (const filename of files) {
    const filePath = resolve(inboxPath, filename);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    if (parseFrontmatterField(content, "deliver_via") !== "telegram") continue;

    const body = truncate(stripFrontmatter(content));
    if (!body) {
      renameSync(filePath, resolve(processedPath, filename));
      continue;
    }

    try {
      const res = await fetch(apiUrl(token, "sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: body }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${errBody}`);
      }
      renameSync(filePath, resolve(processedPath, filename));
      log("sent_from_inbox", filename);
    } catch (err) {
      log(
        "send_error",
        `${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function watchInbox(token: string, chatId: string, workdir: string): void {
  const inboxPath = resolve(workdir, "depts/tovarishch/inbox");
  const processedPath = resolve(workdir, "depts/tovarishch/processed");

  if (!existsSync(inboxPath)) mkdirSync(inboxPath, { recursive: true });
  if (!existsSync(processedPath)) mkdirSync(processedPath, { recursive: true });

  // Drain any deliver_via:telegram files already waiting
  void flushTelegramInbox(token, chatId, inboxPath, processedPath);

  watch(inboxPath, (_, filename) => {
    if (!filename || !filename.endsWith(".md") || filename.startsWith(".")) return;
    void flushTelegramInbox(token, chatId, inboxPath, processedPath);
  });

  log("inbox_watching", inboxPath);
}

async function pollLoop(
  token: string,
  chatId: string,
  workdir: string,
): Promise<void> {
  const inboxPath = resolve(workdir, "depts/tovarishch/inbox");
  if (!existsSync(inboxPath)) mkdirSync(inboxPath, { recursive: true });

  let lastOffset = 0;
  let backoff = 5_000;

  log("polling_start", `chat_id=${chatId}`);

  for (;;) {
    try {
      const url = `${apiUrl(token, "getUpdates")}?offset=${lastOffset}&timeout=25`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });

      if (res.status === 401) {
        log("auth_error", "invalid bot_token (401) — bridge stopped");
        return;
      }

      if (!res.ok) {
        throw new Error(`getUpdates HTTP ${res.status}`);
      }

      const data = (await res.json()) as TgResponse;
      if (!data.ok) throw new Error("getUpdates returned ok=false");

      backoff = 5_000; // reset backoff on success

      for (const update of data.result) {
        const msg = update.message;

        // No text content — ack and skip
        if (!msg?.text) {
          lastOffset = update.update_id + 1;
          continue;
        }

        // Security: reject messages not from configured chat_id
        if (String(msg.chat.id) !== String(chatId)) {
          lastOffset = update.update_id + 1;
          continue;
        }

        const ts = new Date(msg.date * 1000).toISOString();
        const filename = `tg-${msg.message_id}.md`;
        const filePath = resolve(inboxPath, filename);

        const fileContent = [
          "---",
          "from: telegram",
          `ts: ${ts}`,
          `chat_id: ${msg.chat.id}`,
          `message_id: ${msg.message_id}`,
          "---",
          "",
          msg.text,
          "",
        ].join("\n");

        // Write file FIRST, advance offset only after successful write
        writeFileSync(filePath, fileContent, "utf-8");
        log("received", `message_id=${msg.message_id}`);

        lastOffset = update.update_id + 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("poll_error", `${msg} — retry in ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

export async function startBridge(
  telegram: TelegramConfig,
  workdir: string,
): Promise<void> {
  if (!telegram.bot_token) return;

  log("start", `chat_id=${telegram.chat_id}`);
  watchOutbox(telegram.bot_token, telegram.chat_id, workdir);
  watchInbox(telegram.bot_token, telegram.chat_id, workdir);
  // Clear any active webhook to avoid 409 on getUpdates
  await fetch(apiUrl(telegram.bot_token, "deleteWebhook")).catch(() => {});
  // pollLoop runs indefinitely — intentionally fire-and-forget
  void pollLoop(telegram.bot_token, telegram.chat_id, workdir);
}

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
import { isActive, getTaskCount } from "./dispatcher.js";
import type { TelegramConfig, TelegramRoute, Department } from "./types.js";

const TG_MAX = 4096;
const conductorStart = Date.now();
let lastHeartbeatTs: Date | null = null;
let rateLimitUntil = 0; // epoch ms — skip sends while Date.now() < rateLimitUntil

interface TgPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TgMessage {
  message_id: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  chat: { id: number };
  from?: { id: number; username?: string; is_bot?: boolean };
  reply_to_message?: { from?: { id: number; is_bot?: boolean } };
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

async function downloadPhoto(token: string, fileId: string, destPath: string): Promise<void> {
  const getFileRes = await fetch(apiUrl(token, `getFile?file_id=${fileId}`), {
    signal: AbortSignal.timeout(10_000),
  });
  if (!getFileRes.ok) throw new Error(`getFile HTTP ${getFileRes.status}`);
  const fileData = (await getFileRes.json()) as { ok: boolean; result?: { file_path: string } };
  if (!fileData.ok || !fileData.result?.file_path) throw new Error("getFile: no file_path");
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
  const imgRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(30_000) });
  if (!imgRes.ok) throw new Error(`photo download HTTP ${imgRes.status}`);
  writeFileSync(destPath, Buffer.from(await imgRes.arrayBuffer()));
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

function isPlaceholderChatId(chatId: string): boolean {
  return chatId.startsWith("TBD") || chatId === "";
}

async function flushOutbox(
  token: string,
  defaultChatId: string,
  outboxPath: string,
  processedPath: string,
): Promise<void> {
  if (isPlaceholderChatId(defaultChatId)) return;

  const files = readdirSync(outboxPath).filter(
    (f) => f.endsWith(".md") && !f.startsWith("."),
  );
  for (const filename of files) {
    if (Date.now() < rateLimitUntil) continue; // rate-limited — leave in outbox, retry later

    const filePath = resolve(outboxPath, filename);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    const targetChatId = parseFrontmatterField(content, "target_chat_id") ?? defaultChatId;
    const replyTo = parseFrontmatterField(content, "reply_to_message_id");
    const body = truncate(stripFrontmatter(content));
    if (!body) continue;

    try {
      const payload: Record<string, unknown> = { chat_id: targetChatId, text: body };
      if (replyTo) payload.reply_to_message_id = Number(replyTo);
      const res = await fetch(apiUrl(token, "sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 429) {
        const errJson = await res.json().catch(() => ({})) as { parameters?: { retry_after?: number } };
        const retryAfter = errJson.parameters?.retry_after ?? 30;
        rateLimitUntil = Date.now() + retryAfter * 1_000;
        log("rate_limited", `retry_after=${retryAfter}s — pausing outbox`);
        continue; // leave in outbox — will retry after rateLimitUntil
      }
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

function watchAllOutboxes(
  token: string,
  routes: TelegramRoute[],
  workdir: string,
): void {
  for (const route of routes) {
    const outboxPath = resolve(workdir, `depts/${route.dept}/outbox`);
    const processedPath = resolve(workdir, `depts/${route.dept}/processed`);

    if (!existsSync(outboxPath)) mkdirSync(outboxPath, { recursive: true });
    if (!existsSync(processedPath)) mkdirSync(processedPath, { recursive: true });

    let flushTimer: NodeJS.Timeout | undefined;
    let flushing = false;

    const debouncedFlush = () => {
      if (flushing) return;
      clearTimeout(flushTimer);
      flushTimer = setTimeout(async () => {
        flushing = true;
        try { await flushOutbox(token, route.chat_id, outboxPath, processedPath); }
        finally { flushing = false; }
      }, 500);
    };

    void flushOutbox(token, route.chat_id, outboxPath, processedPath);

    watch(outboxPath, (_, filename) => {
      if (!filename || !filename.endsWith(".md") || filename.startsWith(".")) return;
      debouncedFlush();
    });

    setInterval(() => debouncedFlush(), 30_000); // retry stuck files after rate limit

    log("outbox_watching", `${outboxPath} → chat_id=${route.chat_id}`);
  }
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
    if (Date.now() < rateLimitUntil) continue; // rate-limited — leave in inbox, retry later

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
      if (res.status === 429) {
        const errJson = await res.json().catch(() => ({})) as { parameters?: { retry_after?: number } };
        const retryAfter = errJson.parameters?.retry_after ?? 30;
        rateLimitUntil = Date.now() + retryAfter * 1_000;
        log("rate_limited", `retry_after=${retryAfter}s — pausing inbox delivery`);
        continue;
      }
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${errBody}`);
      }
      try {
        renameSync(filePath, resolve(processedPath, filename));
      } catch (renameErr: any) {
        if (renameErr.code !== "ENOENT") throw renameErr;
        // File already moved by a concurrent flush — OK
      }
      log("sent_from_inbox", filename);
    } catch (err) {
      log(
        "send_error",
        `${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

async function watchInbox(token: string, chatId: string, workdir: string): Promise<void> {
  const inboxPath = resolve(workdir, "depts/tovarishch/inbox");
  const processedPath = resolve(workdir, "depts/tovarishch/processed");

  if (!existsSync(inboxPath)) mkdirSync(inboxPath, { recursive: true });
  if (!existsSync(processedPath)) mkdirSync(processedPath, { recursive: true });

  // Await initial drain before setting up watcher to eliminate the race
  // between the startup flush and the first watch event.
  await flushTelegramInbox(token, chatId, inboxPath, processedPath);

  let flushTimer: NodeJS.Timeout | undefined;
  let flushing = false;

  const debouncedFlush = () => {
    if (flushing) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => {
      flushing = true;
      try { await flushTelegramInbox(token, chatId, inboxPath, processedPath); }
      finally { flushing = false; }
    }, 500);
  };

  watch(inboxPath, (_, filename) => {
    if (!filename || !filename.endsWith(".md") || filename.startsWith(".")) return;
    debouncedFlush();
  });

  setInterval(() => debouncedFlush(), 30_000); // retry stuck files after rate limit

  log("inbox_watching", inboxPath);
}

async function pollLoop(
  token: string,
  routes: TelegramRoute[],
  operatorUserId: string,
  workdir: string,
  depts: Department[],
): Promise<void> {
  // Build chat_id → route map, skipping placeholders
  const routeMap = new Map<string, TelegramRoute>();
  for (const route of routes) {
    if (!isPlaceholderChatId(route.chat_id)) {
      routeMap.set(route.chat_id, route);
    }
  }

  let lastOffset = 0;
  let backoff = 5_000;
  let firstPoll = true;
  let botUserId: number | null = null;

  // Get bot's own user ID for reply_to_bot detection
  try {
    const meRes = await fetch(apiUrl(token, "getMe"), { signal: AbortSignal.timeout(5_000) });
    const meData = (await meRes.json()) as { ok: boolean; result?: { id: number } };
    if (meData.ok && meData.result) botUserId = meData.result.id;
  } catch { /* non-fatal */ }

  log("polling_start", `routes=${[...routeMap.keys()].map(id => `${id}→${routeMap.get(id)!.dept}`).join(",")}, bot_id=${botUserId}`);

  for (;;) {
    try {
      const timeout = firstPoll ? 0 : 25;
      firstPoll = false;
      const url = `${apiUrl(token, "getUpdates")}?offset=${lastOffset}&timeout=${timeout}`;
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

        // No processable content — ack and skip
        if (!msg?.text && !msg?.photo) {
          lastOffset = update.update_id + 1;
          continue;
        }

        // Lookup route by incoming chat_id
        const route = routeMap.get(String(msg.chat.id));
        if (!route) {
          lastOffset = update.update_id + 1;
          continue;
        }

        // Handle /status command — reply to the originating chat
        if (msg.text?.trim() === "/status") {
          const report = buildStatusReport(depts);
          await fetch(apiUrl(token, "sendMessage"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: String(msg.chat.id), text: report }),
            signal: AbortSignal.timeout(10_000),
          }).catch((err) => log("status_send_error", String(err)));
          lastOffset = update.update_id + 1;
          continue;
        }

        const ts = new Date(msg.date * 1000).toISOString();
        const filename = `tg-${msg.message_id}.md`;
        const inboxPath = resolve(workdir, `depts/${route.dept}/inbox`);
        if (!existsSync(inboxPath)) mkdirSync(inboxPath, { recursive: true });
        const filePath = resolve(inboxPath, filename);

        const isOperator = msg.from != null && String(msg.from.id) === operatorUserId;
        const isReplyToBot = botUserId != null && msg.reply_to_message?.from?.id === botUserId;

        let imagePath: string | undefined;
        if (msg.photo) {
          const largest = msg.photo[msg.photo.length - 1];
          const imagesDir = resolve(inboxPath, "images");
          if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true });
          const imageFile = resolve(imagesDir, `tg-${msg.message_id}.jpg`);
          try {
            await downloadPhoto(token, largest.file_id, imageFile);
            imagePath = `depts/${route.dept}/inbox/images/tg-${msg.message_id}.jpg`;
            log("photo_saved", `message_id=${msg.message_id}`);
          } catch (err) {
            log("photo_error", `${msg.message_id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const frontmatterLines: string[] = [
          "---",
          "from: telegram",
          `ts: ${ts}`,
          `chat_id: ${msg.chat.id}`,
          `message_id: ${msg.message_id}`,
          ...(msg.from?.username ? [`username: ${msg.from.username}`] : []),
          ...(isOperator ? ["operator: true"] : []),
          ...(isReplyToBot ? ["is_reply_to_bot: true"] : []),
          ...(imagePath ? [`image: ${imagePath}`] : []),
          "---",
          "",
          msg.text ?? msg.caption ?? "",
          "",
        ];

        writeFileSync(filePath, frontmatterLines.join("\n"), "utf-8");
        log("received", `message_id=${msg.message_id} → ${route.dept}`);

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

function buildStatusReport(depts: Department[]): string {
  const uptimeSec = Math.floor(process.uptime());
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const uptimeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

  const heartbeatStr = lastHeartbeatTs
    ? lastHeartbeatTs.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : "—";

  const deptLines = depts.map((d) => {
    const status = isActive(d.name) ? "active" : "idle";
    return `  ${d.name}: ${status}`;
  });

  return [
    "☭ ГОСПЛАН — СТАТУС",
    "",
    `Conductor: работает (uptime ${uptimeStr})`,
    "Отделы:",
    ...deptLines,
    "",
    "Bridge: polling OK",
    `Последний heartbeat: ${heartbeatStr}`,
    `Задач за сессию: ${getTaskCount()}`,
  ].join("\n");
}

export async function startBridge(
  telegram: TelegramConfig,
  workdir: string,
  depts: Department[],
): Promise<void> {
  if (!telegram.bot_token) return;

  bus.on("log", (ev: { dept: string; event: string; trigger?: string }) => {
    if (ev.event === "start" && ev.trigger?.includes("heartbeat")) {
      lastHeartbeatTs = new Date();
    }
  });

  // Build effective routes: use routes[] if present, else default single-route to tovarishch
  const routes: TelegramRoute[] = telegram.routes?.length
    ? telegram.routes
    : [{ chat_id: telegram.chat_id, dept: "tovarishch" }];

  // Operator user_id is the personal chat_id (same number)
  const operatorUserId = telegram.chat_id;

  log("start", `routes=${routes.map(r => `${r.chat_id}→${r.dept}`).join(",")}`);

  watchAllOutboxes(telegram.bot_token, routes, workdir);
  // Also watch tovarishch/inbox for deliver_via:telegram outgoing notifications to principal
  await watchInbox(telegram.bot_token, telegram.chat_id, workdir);
  // Clear any active webhook to avoid 409 on getUpdates
  await fetch(apiUrl(telegram.bot_token, "deleteWebhook")).catch(() => {});
  // pollLoop runs indefinitely — intentionally fire-and-forget
  void pollLoop(telegram.bot_token, routes, operatorUserId, workdir, depts);
}

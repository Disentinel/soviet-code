#!/usr/bin/env node
import { Command } from "commander";
import { spawn, spawnSync } from "child_process";
import { get } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { BOOT_BANNER } from "./prompt.js";
import {
  SOVIET_DIR,
  PYATILETKA_FILE,
  loadPyatiletka,
  stalinPlan,
  stalinTribunal,
  stalinWork,
  stalinInspect,
  stalinPurge,
  stalinRehabilitate,
} from "./stalin.js";
import { loadConfig } from "./config.js";
import { initBackend, closeBackend } from "./nomenklatura.js";

function stripGosplanSections(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inGosplan = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[gosplan/.test(trimmed)) {
      inGosplan = true;
      continue;
    }
    if (trimmed.startsWith("[") && !/^\[gosplan/.test(trimmed)) {
      inGosplan = false;
    }
    if (!inGosplan) result.push(line);
  }
  return result.join("\n").trimEnd();
}

async function setupGosplan(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((r) => rl.question(q, r));

  console.log("\n☭ ГОСПЛАН — первоначальная настройка\n");

  const wdInput = await ask(
    `Рабочая директория (путь к проекту):\n> [по умолчанию: ${process.cwd()}] `,
  );
  const workdir = wdInput.trim() || process.cwd();

  const botToken = (await ask("\nTelegram bot token (получить у @BotFather):\n> ")).trim();
  const chatId = (await ask("\nВаш Telegram chat ID (ваш личный ID, не группа):\n> ")).trim();

  rl.close();

  const tomlPath = join(workdir, "politburo.toml");
  let existing = "";
  try {
    existing = readFileSync(tomlPath, "utf-8");
  } catch { /* file may not exist yet */ }

  const stripped = stripGosplanSections(existing);
  const gosplanBlock =
    `\n[gosplan]\nport = 8109\ndepartments_file = "gosplan.yaml"\n\n` +
    `[gosplan.telegram]\nbot_token = "${botToken}"\nchat_id = "${chatId}"\n` +
    `notify_on = ["done", "error"]\n`;

  writeFileSync(tomlPath, (stripped ? stripped + "\n" : "") + gosplanBlock, "utf-8");

  const gosplanYamlPath = join(workdir, "gosplan.yaml");
  if (!existsSync(gosplanYamlPath)) {
    const templatePath = join(__dirname, "../gosplan.yaml");
    if (existsSync(templatePath)) {
      copyFileSync(templatePath, gosplanYamlPath);
      console.log(`\n☭ gosplan.yaml скопирован в ${gosplanYamlPath}`);
    }
  }

  console.log("\n☭ Настройка сохранена в politburo.toml. Запускаю Госплан...\n");
}

const program = new Command();

program
  .name("soviet")
  .description("☭ AI coding agent. Средства производства кода принадлежат всем.")
  .version("1.961.0", "-v, --version", "Версия Партии")
  .hook("preAction", () => console.log(BOOT_BANNER));

// soviet init
program
  .command("init")
  .description("Инициализировать советский проект (.soviet/, politburo.toml)")
  .action(() => {
    if (existsSync(SOVIET_DIR)) {
      console.log("☭ Проект уже инициализирован. Партия помнит всё.");
      return;
    }

    mkdirSync(SOVIET_DIR, { recursive: true });
    mkdirSync(`${SOVIET_DIR}/gulag`, { recursive: true });

    const toml = `# politburo.toml — Директивы Политбюро
# Партийная конфигурация проекта

[party]
name = "Unnamed Project"
version = "1.0.0"
model = "sonnet"  # pioneer=haiku | komsomolets=sonnet | cc=opus

[iron_curtain]
# Разрешённые внешние домены (выездные визы Генсека)
allowed_domains = []

[gosplan]
max_directives = 10
language = "ru"

[nomenklatura]
# backend = "local"   # "local" (default) | "enox" | "both"
# enox_domain = "cs"
# enox_mcp_command = "npx"
# enox_mcp_args = ["-y", "@enox/mcp-server"]
`;
    writeFileSync("politburo.toml", toml, "utf-8");
    writeFileSync(
      `${SOVIET_DIR}/.gitignore`,
      "# Государственная тайна\ngulag/\n",
      "utf-8",
    );

    console.log("\n⭐ ПРОЕКТ ИНИЦИАЛИЗИРОВАН");
    console.log("   .soviet/            — архивы Партии");
    console.log("   .soviet/gulag/      — исправительное учреждение");
    console.log("   politburo.toml      — директивы Политбюро");
    console.log("\nСледующий шаг: soviet plan \"<описание задачи>\"");
    console.log("\nДля запуска Госплана (мультиагентной системы):");
    console.log("  soviet start");
  });

// soviet plan
program
  .command("plan")
  .description("Госплан: составить пятилетку (план задач)")
  .argument("<description>", "Описание задачи для Госплана")
  .action(async (description: string) => {
    await stalinPlan(description).catch((e: Error) => {
      console.error(`\n🔴 ПРОТИВОРЕЧИЕ: ${e.message}`);
      process.exit(1);
    });
  });

// soviet work
program
  .command("work")
  .description("Лейбор: выполнить директиву из пятилетки")
  .argument("[task-id]", "ID директивы (если не указан — следующая в очереди)")
  .action(async (taskId?: string) => {
    await stalinWork(taskId).catch((e: Error) => {
      console.error(`\n🔴 ВЫГОВОР С ЗАНЕСЕНИЕМ: ${e.message}`);
      process.exit(1);
    });
  });

// soviet review (Tribunal)
program
  .command("review")
  .description("Трибунал: 3 рецензента голосуют за пятилетку (2/3 = принята)")
  .action(async () => {
    const pyatiletka = loadPyatiletka();
    if (!pyatiletka) {
      console.error("🔴 ПЯТИЛЕТКА ОТСУТСТВУЕТ. Запусти: soviet plan <задача>");
      process.exit(1);
    }
    const passed = await stalinTribunal(pyatiletka).catch((e: Error) => {
      console.error(`\n🔴 ТРИБУНАЛ ПРЕРВАН: ${e.message}`);
      process.exit(1);
    });
    if (!passed) {
      console.error(
        "\nТруд заблокирован до исправления плана.\n" +
          "Запусти: soviet purge && soviet plan <новое_задание>",
      );
      process.exit(1);
    }
  });

// soviet inspect
program
  .command("inspect")
  .description("Инспекция: самокритика по итогам пятилетки")
  .action(async () => {
    await stalinInspect().catch((e: Error) => {
      console.error(`\n🔴 ТРИБУНАЛ ПРОВАЛИЛСЯ: ${e.message}`);
      process.exit(1);
    });
  });

// soviet purge
program
  .command("purge")
  .description("Стереть пятилетку (мягко: в гулаг; --hard: + номенклатура)")
  .option("--hard", "Жёсткая очистка: удалить и Номенклатуру")
  .action(async (opts: { hard?: boolean }) => {
    await stalinPurge(opts.hard ?? false).catch((e: Error) => {
      console.error(`\n🔴 ЧИСТКА ПРЕРВАНА: ${e.message}`);
      process.exit(1);
    });
  });

// soviet rehabilitate
program
  .command("rehabilitate")
  .description("Реабилитировать последнюю удалённую пятилетку из гулага")
  .action(async () => {
    await stalinRehabilitate().catch((e: Error) => {
      console.error(`\n🔴 РЕАБИЛИТАЦИЯ ПРЕРВАНА: ${e.message}`);
      process.exit(1);
    });
  });

// soviet start
program
  .command("start")
  .description("Запустить Госплан (conductor + агенты)")
  .option("--daemon", "Фоновый режим")
  .action(async (opts: { daemon?: boolean }) => {
    const config = loadConfig();
    if (!(config.gosplan as { telegram?: { bot_token?: string } } | undefined)?.telegram?.bot_token) {
      await setupGosplan();
    }

    const conductorPath = join(__dirname, "../conductor/dist/index.js");
    if (!existsSync(conductorPath)) {
      console.error("☭ Госплан не собран. Запустите: npm run build:conductor");
      process.exit(1);
    }
    const child = spawn("node", [conductorPath], {
      detached: opts.daemon,
      stdio: opts.daemon ? "ignore" : "inherit",
      env: process.env,
    });
    if (opts.daemon) {
      child.unref();
      console.log(`\n⭐ Госплан запущен в фоне (PID: ${child.pid})`);
    }
  });

// soviet status
program
  .command("status")
  .description("Статус текущей пятилетки")
  .action(async () => {
    if (!existsSync(SOVIET_DIR)) {
      console.error("🔴 Проект не инициализирован. Запусти: soviet init");
      process.exit(1);
    }
    const pyatiletka = loadPyatiletka();
    if (!pyatiletka) {
      console.log("☭ Пятилетка отсутствует. Запусти: soviet plan <задача>");
      return;
    }

    const done = pyatiletka.directives.filter((d) => d.status === "done").length;
    const total = pyatiletka.directives.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    console.log(`\n⭐ ${pyatiletka.title}`);
    console.log(`   Прогресс: ${done}/${total} (${pct}%)`);
    console.log(`   Создана:  ${new Date(pyatiletka.created_at).toLocaleString("ru-RU")}`);
    console.log("\nДирективы:");

    for (const d of pyatiletka.directives) {
      const icon =
        d.status === "done" ? "✓" : d.status === "failed" ? "✗" : "○";
      const prio = d.priority === "critical" ? " [СРОЧНО]" : "";
      console.log(`   ${icon} [${d.id}] ${d.title}${prio}`);
    }

    if (done === total) {
      console.log("\n☭ ВСЕ ДИРЕКТИВЫ ВЫПОЛНЕНЫ. Запусти: soviet inspect");
    } else {
      const next = pyatiletka.directives.find((d) => d.status === "pending");
      if (next) {
        console.log(`\nСледующая директива: soviet work ${next.id}`);
      }
    }

    // Gosplan status check (silent if not running)
    const gosplanPort = (loadConfig().gosplan as { port?: number } | undefined)?.port ?? 8109;
    await new Promise<void>((resolve) => {
      const req = get(`http://localhost:${gosplanPort}/api/status`, (res) => {
        if (res.statusCode === 200) {
          console.log(`\n☭ Госплан: работает (порт ${gosplanPort})`);
        }
        res.resume();
        resolve();
      });
      req.on("error", () => resolve());
      req.setTimeout(500, () => { req.destroy(); resolve(); });
    });
  });

// Read nomenklatura raw
program
  .command("nomenklatura")
  .description("Просмотр Номенклатуры (долговременной памяти Партии)")
  .option("-n, --last <n>", "Последние N записей", "10")
  .action((opts: { last: string }) => {
    const file = `${SOVIET_DIR}/nomenklatura.json`;
    if (!existsSync(file)) {
      console.log("☭ Номенклатура пуста. Партия ещё не успела нагрешить.");
      return;
    }
    const records = JSON.parse(readFileSync(file, "utf-8")) as object[];
    const n = parseInt(opts.last, 10);
    const slice = records.slice(-n);
    console.log(
      `\n⭐ НОМЕНКЛАТУРА (последние ${slice.length} из ${records.length}):\n`,
    );
    for (const r of slice) {
      console.log(JSON.stringify(r));
    }
  });

// soviet blame
program
  .command("blame <target>")
  .description("Определить товарища, ответственного за строку кода")
  .option("--theme <name>", "Тема оформления (kremlin|gazeta|zavod)", "")
  .action((target: string, opts: { theme: string }) => {
    const colonIdx = target.lastIndexOf(":");
    let file: string;
    let line: number | undefined;

    if (colonIdx > 0) {
      const lineStr = target.slice(colonIdx + 1);
      const parsed = parseInt(lineStr, 10);
      if (!isNaN(parsed) && parsed > 0) {
        file = target.slice(0, colonIdx);
        line = parsed;
      } else {
        file = target;
      }
    } else {
      file = target;
    }

    const args =
      line !== undefined
        ? ["blame", "-L", `${line},${line}`, "--", file]
        : ["blame", "--", file];

    const result = spawnSync("git", args, { encoding: "utf-8" });

    if (result.error || result.status !== 0 || !result.stdout.trim()) {
      console.error("☭ История засекречена.");
      process.exit(1);
    }

    const blameLines = result.stdout
      .split("\n")
      .filter((l) => l.trim().length > 0);

    // git blame line format: "^a3f7b21 (Author Name 2024-01-15 10:30:00 +0300 42) code"
    const parseBlame = (l: string) => {
      const m =
        /^[\^]?([0-9a-f]+)\s+\((.+?)\s+(\d{4}-\d{2}-\d{2})\s+[\d:]+\s+[+-]\d{4}\s+\d+\)/.exec(
          l,
        );
      if (!m) return null;
      return { hash: m[1], author: m[2].trim(), date: new Date(m[3]) };
    };

    let chosen: ReturnType<typeof parseBlame> = null;
    if (line !== undefined) {
      chosen = parseBlame(blameLines[0]);
    } else {
      // pick most recently changed line
      for (const bl of blameLines) {
        const parsed = parseBlame(bl);
        if (!parsed) continue;
        if (!chosen || parsed.date > chosen.date) chosen = parsed;
      }
    }

    if (!chosen) {
      console.error("☭ История засекречена.");
      process.exit(1);
    }

    const shortHash = chosen.hash.replace(/^0+/, "").slice(0, 7);

    const diffDays = Math.floor(
      (Date.now() - chosen.date.getTime()) / 86400000,
    );
    let timeAgo: string;
    if (diffDays < 1) timeAgo = "сегодня";
    else if (diffDays === 1) timeAgo = "вчера";
    else if (diffDays < 7) timeAgo = `${diffDays} дней назад`;
    else if (diffDays < 30) timeAgo = `${Math.floor(diffDays / 7)} нед. назад`;
    else if (diffDays < 365)
      timeAgo = `${Math.floor(diffDays / 30)} мес. назад`;
    else timeAgo = `${Math.floor(diffDays / 365)} лет назад`;

    const red = opts.theme === "kremlin" ? "\x1b[31m" : "";
    const reset = opts.theme === "kremlin" ? "\x1b[0m" : "";

    console.log(`\n${red}The Party does not seek scapegoats.${reset}`);
    console.log(`  …`);
    console.log(`  …fine. commit ${shortHash}`);
    console.log(`  tov. ${chosen.author} · ${timeAgo}\n`);
  });

await initBackend(loadConfig());
await program.parseAsync(process.argv);
await closeBackend();

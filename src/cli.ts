#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { BOOT_BANNER } from "./prompt.js";
import {
  SOVIET_DIR,
  PYATILETKA_FILE,
  loadPyatiletka,
  stalinPlan,
  stalinWork,
  stalinInspect,
} from "./stalin.js";

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

// soviet status
program
  .command("status")
  .description("Статус текущей пятилетки")
  .action(() => {
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

program.parse();

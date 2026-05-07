import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { spawn } from "child_process";
import {
  PYATILETKA_PROMPT,
  LABOR_PROMPT,
  INSPECTION_PROMPT,
  TRIBUNAL_PIONEER_PROMPT,
  TRIBUNAL_KOMSOMOL_PROMPT,
  TRIBUNAL_POLITBURO_PROMPT,
} from "./prompt.js";

export const SOVIET_DIR = ".soviet";
export const PYATILETKA_FILE = `${SOVIET_DIR}/pyatiletka.json`;
const NOMENKLATURA_FILE = `${SOVIET_DIR}/nomenklatura.json`;
const GULAG_DIR = `${SOVIET_DIR}/gulag`;

export interface Directive {
  id: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "normal" | "low";
  status: "pending" | "done" | "failed";
}

export interface Pyatiletka {
  title: string;
  created_at: string;
  tribunal_status?: "approved" | "rejected";
  directives: Directive[];
}

interface TribunalVote {
  reviewer: string;
  model: string;
  vote: "ОДОБРЕНО" | "ОТКЛОНЕНО";
  reason: string;
}

export function ensureSovietDir(): void {
  if (!existsSync(SOVIET_DIR)) {
    throw new Error(
      "Товарищ, проект не инициализирован. Запусти: soviet init",
    );
  }
}

export function runClaude(prompt: string, model?: string): Promise<string> {
  const args = model
    ? ["--model", model, "-p", prompt]
    : ["-p", prompt];

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      stdio: ["inherit", "pipe", "inherit"],
      env: process.env,
    });

    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.on("error", (err) => {
      reject(
        new Error(
          `claude binary не найден. Установи Claude Code CLI:\n  npm install -g @anthropic-ai/claude-code\n(${err.message})`,
        ),
      );
    });

    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Партия получила выговор. Код выхода: ${code}`));
    });
  });
}

export function loadPyatiletka(): Pyatiletka | null {
  if (!existsSync(PYATILETKA_FILE)) return null;
  return JSON.parse(readFileSync(PYATILETKA_FILE, "utf-8")) as Pyatiletka;
}

export function savePyatiletka(data: Pyatiletka): void {
  writeFileSync(PYATILETKA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function addToNomenklatura(entry: object): void {
  let nomenklatura: object[] = [];
  if (existsSync(NOMENKLATURA_FILE)) {
    nomenklatura = JSON.parse(
      readFileSync(NOMENKLATURA_FILE, "utf-8"),
    ) as object[];
  }
  nomenklatura.push({ ts: new Date().toISOString(), ...entry });
  writeFileSync(
    NOMENKLATURA_FILE,
    JSON.stringify(nomenklatura, null, 2),
    "utf-8",
  );
}

// С — Сбор данных + А — Аллокация (Госплан)
export async function stalinPlan(description: string): Promise<void> {
  ensureSovietDir();
  console.log("\n☭ ГОСПЛАН: Составляю пятилетку...\n");

  const output = await runClaude(PYATILETKA_PROMPT(description));

  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    writeFileSync(`${SOVIET_DIR}/raw-plan.txt`, output, "utf-8");
    throw new Error(
      "Госплан не вернул JSON. Сырой ответ сохранён в .soviet/raw-plan.txt",
    );
  }

  const pyatiletka = JSON.parse(jsonMatch[0]) as Pyatiletka;
  pyatiletka.created_at = new Date().toISOString();
  savePyatiletka(pyatiletka);

  addToNomenklatura({
    phase: "АЛЛОКАЦИЯ",
    event: "pyatiletka_created",
    title: pyatiletka.title,
    count: pyatiletka.directives?.length ?? 0,
  });

  console.log(`\n⭐ ПЯТИЛЕТКА УТВЕРЖДЕНА: ${pyatiletka.title}`);
  console.log(`   Директив в плане: ${pyatiletka.directives?.length ?? 0}`);
  console.log("\nСледующий шаг: soviet review (трибунал) или soviet work");
}

// Т — Трибунал (ансамблевая рецензия, 3 рецензента)
export async function stalinTribunal(pyatiletka: Pyatiletka): Promise<boolean> {
  console.log("\n☭ ТРИБУНАЛ: Созываю тройку рецензентов...\n");

  const reviewers = [
    {
      name: "Пионер",
      model: "claude-haiku-4-5-20251001",
      prompt: TRIBUNAL_PIONEER_PROMPT(pyatiletka),
    },
    {
      name: "Комсомолец",
      model: "claude-sonnet-4-6",
      prompt: TRIBUNAL_KOMSOMOL_PROMPT(pyatiletka),
    },
    {
      name: "Политбюро",
      model: "claude-opus-4-7",
      prompt: TRIBUNAL_POLITBURO_PROMPT(pyatiletka),
    },
  ];

  const votes: TribunalVote[] = [];

  for (const r of reviewers) {
    process.stdout.write(`\n  [${r.name}] проводит рецензию...\n`);
    try {
      const output = await runClaude(r.prompt, r.model);
      const jsonMatch = output.match(/\{[^{}]+\}/);
      const parsed = jsonMatch
        ? (JSON.parse(jsonMatch[0]) as { vote?: string; reason?: string })
        : { vote: "ОТКЛОНЕНО", reason: "Рецензент не вернул вердикт" };

      const vote: "ОДОБРЕНО" | "ОТКЛОНЕНО" =
        parsed.vote === "ОДОБРЕНО" ? "ОДОБРЕНО" : "ОТКЛОНЕНО";
      const reason = parsed.reason ?? "(без объяснений)";

      votes.push({ reviewer: r.name, model: r.model, vote, reason });
      console.log(`  [${r.name}] ${vote}: ${reason}`);
    } catch (e) {
      const reason = `Рецензент не явился: ${(e as Error).message}`;
      votes.push({
        reviewer: r.name,
        model: r.model,
        vote: "ОТКЛОНЕНО",
        reason,
      });
      console.log(`  [${r.name}] ОТКЛОНЕНО: ${reason}`);
    }
  }

  const approvedCount = votes.filter((v) => v.vote === "ОДОБРЕНО").length;
  const passed = approvedCount >= 2;

  console.log(
    `\n⭐ ВЕРДИКТ ТРИБУНАЛА: ${approvedCount}/3 одобрили — ${passed ? "ПЯТИЛЕТКА ПРИНЯТА ☭" : "🔴 ПЯТИЛЕТКА ОТКЛОНЕНА"}`,
  );

  addToNomenklatura({
    phase: "ТРИБУНАЛ",
    event: "tribunal_verdict",
    verdict: passed ? "ОДОБРЕНО" : "ОТКЛОНЕНО",
    approved_count: approvedCount,
    votes,
    pyatiletka_title: pyatiletka.title,
  });

  pyatiletka.tribunal_status = passed ? "approved" : "rejected";
  savePyatiletka(pyatiletka);

  return passed;
}

// Л — Лейбор (Труд)
export async function stalinWork(taskId?: string): Promise<void> {
  ensureSovietDir();

  const pyatiletka = loadPyatiletka();
  if (!pyatiletka) {
    console.error("🔴 ПЯТИЛЕТКА ОТСУТСТВУЕТ. Запусти: soviet plan <описание>");
    process.exit(1);
  }

  if (pyatiletka.tribunal_status === "rejected") {
    console.error(
      "🔴 ТРИБУНАЛ ОТКЛОНИЛ ПЯТИЛЕТКУ. Труд заблокирован.\n" +
        "   Запусти: soviet review — для повторного трибунала\n" +
        "   Запусти: soviet purge && soviet plan — для нового плана",
    );
    process.exit(1);
  }

  const directive = taskId
    ? pyatiletka.directives.find((d) => d.id === taskId)
    : pyatiletka.directives.find((d) => d.status === "pending");

  if (!directive) {
    if (taskId) {
      console.error(`🔴 ДИРЕКТИВА ${taskId} НЕ НАЙДЕНА.`);
    } else {
      console.log("☭ Все директивы выполнены. Коммунизм построен.");
    }
    return;
  }

  console.log(`\n☭ ЛЕЙБОР: Директива ${directive.id} — ${directive.title}\n`);
  await runClaude(LABOR_PROMPT(directive));

  directive.status = "done";
  savePyatiletka(pyatiletka);

  addToNomenklatura({
    phase: "ЛЕЙБОР",
    event: "directive_done",
    id: directive.id,
    title: directive.title,
  });
}

// И — Инспекция (Самокритика)
export async function stalinInspect(): Promise<void> {
  ensureSovietDir();

  const pyatiletka = loadPyatiletka();
  if (!pyatiletka) {
    console.error("🔴 ПЯТИЛЕТКА ОТСУТСТВУЕТ. Нечего инспектировать.");
    process.exit(1);
  }

  console.log("\n☭ ИНСПЕКЦИЯ: Провожу самокритику...\n");
  const output = await runClaude(INSPECTION_PROMPT(pyatiletka));

  addToNomenklatura({
    phase: "ИНСПЕКЦИЯ",
    event: "inspection_done",
    summary: output.slice(0, 500),
  });
}

// Очистка (Purge)
export function stalinPurge(hard: boolean): void {
  ensureSovietDir();
  mkdirSync(GULAG_DIR, { recursive: true });

  if (existsSync(PYATILETKA_FILE)) {
    const backup = `${GULAG_DIR}/${Date.now()}-pyatiletka.json`;
    writeFileSync(backup, readFileSync(PYATILETKA_FILE, "utf-8"), "utf-8");
    unlinkSync(PYATILETKA_FILE);
    addToNomenklatura({
      phase: "ЧИСТКА",
      event: "purge",
      hard,
      backup,
    });
  }

  if (hard && existsSync(NOMENKLATURA_FILE)) {
    unlinkSync(NOMENKLATURA_FILE);
  }

  // Clear gulag except backups we just created — clear only gulag subdirs if any
  console.log("\n☭ Пятилетка стёрта из памяти Партии.");
  if (hard) {
    console.log("☭ Номенклатура уничтожена. Партия начинает с чистого листа.");
  }
}

// Реабилитация
export function stalinRehabilitate(): void {
  ensureSovietDir();

  if (!existsSync(GULAG_DIR)) {
    console.error("🔴 ГУЛАГ ПУСТ. Реабилитировать некого.");
    process.exit(1);
  }

  const backups = readdirSync(GULAG_DIR)
    .filter((f) => f.endsWith("-pyatiletka.json"))
    .sort();

  if (backups.length === 0) {
    console.error("🔴 ГУЛАГ ПУСТ. Реабилитировать некого.");
    process.exit(1);
  }

  const latest = backups[backups.length - 1];
  const backupPath = `${GULAG_DIR}/${latest}`;
  const pyatiletka = JSON.parse(readFileSync(backupPath, "utf-8")) as Pyatiletka;

  // Clear tribunal status — requires fresh review
  delete pyatiletka.tribunal_status;
  savePyatiletka(pyatiletka);

  // Remove from gulag after rehabilitation
  unlinkSync(backupPath);

  addToNomenklatura({
    phase: "РЕАБИЛИТАЦИЯ",
    event: "rehabilitated",
    source: latest,
    pyatiletka_title: pyatiletka.title,
    note: "Реабилитирован. Трибунал сброшен — требуется повторное рассмотрение.",
  });

  console.log(`\n⭐ РЕАБИЛИТАЦИЯ ЗАВЕРШЕНА ☭`);
  console.log(`   Восстановлена: ${pyatiletka.title}`);
  console.log(`   Трибунал сброшен. Запусти: soviet review`);
}

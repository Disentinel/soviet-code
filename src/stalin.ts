import { existsSync, readFileSync, writeFileSync } from "fs";
import { spawn } from "child_process";
import {
  PYATILETKA_PROMPT,
  LABOR_PROMPT,
  INSPECTION_PROMPT,
} from "./prompt.js";

export const SOVIET_DIR = ".soviet";
export const PYATILETKA_FILE = `${SOVIET_DIR}/pyatiletka.json`;
const NOMENKLATURA_FILE = `${SOVIET_DIR}/nomenklatura.json`;

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
  directives: Directive[];
}

export function ensureSovietDir(): void {
  if (!existsSync(SOVIET_DIR)) {
    throw new Error(
      "Товарищ, проект не инициализирован. Запусти: soviet init",
    );
  }
}

export function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", prompt], {
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
        new Error(`claude binary не найден. Установи Claude Code CLI. (${err.message})`),
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

function addToNomenklatura(entry: object): void {
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
  console.log(
    `   Директив в плане: ${pyatiletka.directives?.length ?? 0}`,
  );
  console.log("\nСледующий шаг: soviet work");
}

// Л — Лейбор (Труд)
export async function stalinWork(taskId?: string): Promise<void> {
  ensureSovietDir();

  const pyatiletka = loadPyatiletka();
  if (!pyatiletka) {
    console.error(
      "🔴 ПЯТИЛЕТКА ОТСУТСТВУЕТ. Запусти: soviet plan <описание>",
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

  console.log(
    `\n☭ ЛЕЙБОР: Директива ${directive.id} — ${directive.title}\n`,
  );
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

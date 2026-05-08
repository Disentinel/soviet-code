# Госплан — Структура отделов

Госплан — встроенная многоагентная система советского кода.
Conductor (Node.js) наблюдает за inbox/ отделов и запускает агентов Claude через `claude -p --resume`.

## Отделы

| Отдел | Модель | Роль |
|-------|--------|------|
| gensek | sonnet | Генеральный Секретарь — координация, делегирование |
| razvedka | sonnet | Разведка — исследование, анализ, root cause |
| stakhanovtsy | sonnet | Стахановцы — реализация, коммиты, тесты |
| inspektsiya | haiku | Инспекция — ревью кода, контроль качества |
| agitprop | sonnet | Агитпроп — ГАЗЕТА, документация, контент |
| tovarishch | haiku | Товарищ — связь с принципалом (Telegram) |

## Структура каталогов

```
soviet-code/
  gosplan.yaml          — реестр отделов и session ID
  depts/
    {name}/
      inbox/            — входящие задачи (conductor смотрит сюда)
      outbox/           — исходящие результаты
      processed/        — обработанные сообщения (архив)
      role.md           — системный промпт агента
      handoff.md        — состояние между сессиями
```

## Коммуникация

Агенты общаются через файлы. Каждое сообщение — отдельный `.md` файл.

**Формат сообщения:**
```markdown
---
from: gensek
ts: 2026-05-09T10:00:00+03:00
task_id: gs-001
priority: high
---
Текст задачи.
```

Conductor обнаруживает новый файл в inbox/ → запускает `claude -p --resume SESSION_ID` → агент читает inbox, выполняет задачу, пишет ответ.

## Запуск

```bash
# Сборка conductor
npm run build:conductor

# Запуск (foreground)
npm run start:conductor

# Запуск в фоне через CLI
soviet start --daemon
```

## Конфигурация

`gosplan.yaml` — реестр отделов. Session ID обновляется conductor автоматически после первого запуска агента.

Переменные окружения:
- `GOSPLAN_FILE` — путь к gosplan.yaml (по умолчанию: `gosplan.yaml`)
- `SOVIET_PORT` — порт conductor (по умолчанию: 8109)

Dashboard: http://localhost:8109

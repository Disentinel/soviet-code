export interface Department {
  name: string;
  sessionId: string | null;
  role: string;
  inbox: string;
  outbox: string;
  description: string;
  model: string;
  allowedTools: string[];
  extraDirs: string[];
}

export interface Config {
  departments: Record<string, {
    session_id: string | null;
    role: string;
    inbox: string;
    outbox: string;
    description: string;
    model?: string;
    allowed_tools?: string[];
    extra_dirs?: string[];
  }>;
}

export interface TelegramConfig {
  bot_token: string;
  chat_id: string;
  notify_on: string[];
}

export interface GosplanSection {
  telegram?: TelegramConfig;
}

export interface LogEntry {
  ts: string;
  dept: string;
  event: string;
  trigger?: string;
  duration?: number;
  code?: number | null;
  detail?: string;
}

export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  content?: string;
  tool_name?: string;
  session_id?: string;
}

import { createServer, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { bus } from "./log.js";
import type { Department } from "./types.js";

const HTML = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Госплан · Soviet Code</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font: 13px/1.5 'SF Mono', 'Fira Code', monospace; background: #0d1117; color: #c9d1d9; }
  .header { padding: 16px 24px; border-bottom: 1px solid #21262d; display: flex; align-items: center; gap: 16px; }
  .header h1 { font-size: 16px; font-weight: 600; color: #f0f6fc; }
  .container { display: flex; height: calc(100vh - 53px); }
  .sidebar { width: 280px; border-right: 1px solid #21262d; padding: 16px; overflow-y: auto; }
  .main { flex: 1; display: flex; flex-direction: column; }
  .dept-card {
    padding: 12px; margin-bottom: 8px; border-radius: 6px;
    background: #161b22; border: 1px solid #21262d;
  }
  .dept-card.active { border-color: #238636; background: #0d1117; }
  .dept-name { font-weight: 600; color: #58a6ff; margin-bottom: 4px; }
  .dept-status { font-size: 11px; color: #8b949e; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .dot.idle { background: #484f58; }
  .dot.active { background: #3fb950; }
  #log {
    flex: 1; overflow-y: auto; padding: 12px 24px;
    display: flex; flex-direction: column-reverse;
  }
  .log-line {
    padding: 3px 0; border-bottom: 1px solid #161b22;
    display: flex; gap: 12px; font-size: 12px;
  }
  .log-ts { color: #484f58; min-width: 80px; }
  .log-dept { color: #58a6ff; min-width: 100px; font-weight: 600; }
  .log-event { color: #c9d1d9; }
  .log-event.start { color: #3fb950; }
  .log-event.done { color: #8b949e; }
  .log-event.error, .log-event.stderr { color: #f85149; }
  .log-event.skip { color: #d29922; }
  .log-content { color: #8b949e; max-width: 600px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .log-tool { color: #d2a8ff; }
  .status-bar {
    padding: 8px 24px; border-top: 1px solid #21262d;
    font-size: 11px; color: #8b949e; display: flex; justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="header">
    <h1>☭ Госплан · Soviet Code</h1>
    <span style="color:#8b949e;font-size:12px" id="uptime"></span>
  </div>
  <div class="container">
    <div class="sidebar" id="depts"></div>
    <div class="main">
      <div id="log"></div>
      <div class="status-bar">
        <span id="stats">events: 0</span>
        <span id="connection">connecting...</span>
      </div>
    </div>
  </div>
  <script>
    const startTime = Date.now();
    const deptState = {};
    let eventCount = 0;

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function updateDepts() {
      const container = document.getElementById('depts');
      container.innerHTML = Object.entries(deptState)
        .map(([name, state]) => {
          const isActive = state.active;
          return '<div class="dept-card ' + (isActive ? 'active' : '') + '">'
            + '<div class="dept-name"><span class="dot ' + (isActive ? 'active' : 'idle') + '"></span>' + esc(name) + '</div>'
            + '<div class="dept-status">' + esc(state.lastEvent || 'idle') + '</div>'
            + '</div>';
        }).join('');
    }

    function summarize(data) {
      if (data.event) return esc(data.trigger || data.detail || '');
      const t = data.type || '';
      if (t === 'assistant' && data.tool_name) return '<span class="log-tool">' + esc(data.tool_name) + '</span> ' + esc((data.content || '').slice(0, 80));
      if (t === 'assistant' && data.content) return '<span class="log-content">' + esc(data.content.slice(0, 120)) + '</span>';
      if (t === 'user' || t === 'result') {
        const txt = (data.content || data.output || '').slice(0, 100);
        return txt ? '<span class="log-content">' + esc(txt) + '</span>' : '';
      }
      return esc(data.subtype || data.content_type || '');
    }

    function addLog(data) {
      const log = document.getElementById('log');
      const line = document.createElement('div');
      line.className = 'log-line';
      const time = new Date(data.ts || Date.now()).toLocaleTimeString();
      const evtClass = data.event || data.type || '';
      const summary = summarize(data);
      if (!summary && !data.event) return;
      line.innerHTML = '<span class="log-ts">' + esc(time) + '</span>'
        + '<span class="log-dept">' + esc(data.dept || '-') + '</span>'
        + '<span class="log-event ' + esc(evtClass) + '">' + esc(data.event || data.type || '') + '</span>'
        + '<span>' + summary + '</span>';
      log.prepend(line);
      eventCount++;
      document.getElementById('stats').textContent = 'events: ' + eventCount;
    }

    const es = new EventSource('/events');
    es.onopen = () => { document.getElementById('connection').textContent = 'connected'; };
    es.onerror = () => { document.getElementById('connection').textContent = 'reconnecting...'; };
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.dept) {
        if (!deptState[data.dept]) deptState[data.dept] = {};
        deptState[data.dept].lastEvent = data.event + (data.trigger ? ' — ' + data.trigger : '');
        deptState[data.dept].active = data.event === 'start';
        if (data.event === 'done' || data.event === 'skip') deptState[data.dept].active = false;
        updateDepts();
      }
      addLog(data);
    };

    setInterval(() => {
      const s = Math.floor((Date.now() - startTime) / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      document.getElementById('uptime').textContent = 'uptime ' + h + 'h ' + m + 'm';
    }, 10000);
  </script>
</body></html>`;

export function startDashboard(depts: Department[], port = 8109): void {
  const clients = new Set<ServerResponse>();

  function broadcast(data: unknown): void {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      res.write(msg);
    }
  }

  bus.on("log", broadcast);
  bus.on("claude", broadcast);

  const statusPath = resolve(process.cwd(), "depts/status.md");

  createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.url === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        departments: depts.map((d) => ({
          name: d.name,
          sessionId: d.sessionId,
          description: d.description,
        })),
        statusMd: existsSync(statusPath) ? readFileSync(statusPath, "utf-8") : null,
      }));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
  }).listen(port, "127.0.0.1");

  bus.emit("log", {
    ts: new Date().toISOString(),
    dept: "conductor",
    event: "dashboard",
    detail: `http://localhost:${port}`,
  });
}

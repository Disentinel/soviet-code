// SOVIET CODE — animated terminal hero (typewriter), English only
(function () {
  const $ = (s, r = document) => r.querySelector(s);

  const SCRIPT_DATA = {
    banner: [
      '   ☭  SOVIET·CODE  v1.961  ☭',
      '   ─────────────────────────',
      '   Central Computing Committee',
      '   "From each according to their commits, to each according to their PRs"',
      '   Labor reserves: 200k tokens on the Party balance',
    ],
    phases: [
      ['S — Surveillance', 'scan'        ],
      ['T — Tribunal',     'verdict'     ],
      ['A — Allocation',   'gosplan'     ],
      ['L — Labor',        'execution'   ],
      ['I — Inspection',   'self-critique'],
      ['N — Notarization', 'signed commit'],
    ],
    task: 'comrade engineer requested: "fix the race condition in auth-middleware.ts"',
    survey: 'agents survey the codebase… 47 files inspected',
    verdict: 'commission has ruled · 12 approved · 35 to the archive',
    shot: 'SENT FOR RE-EDUCATION',
    shotDesc: '— src/legacy/passwordHasher.js (md5 — relic of capitalism)',
    plan: 'five-year plan ratified by the Politburo · 6 steps',
    toil: 'Stakhanovite brigade has begun work…',
    tests: 'all trials passed · quota exceeded',
    crit: 'self-critique: edge case located · corrected ahead of schedule',
    commit: 'pattern entered into the Cadre Registry · commit a3081ac',
    done: 'operation complete · slava robotam',
  };

  function buildScript() {
    const t = SCRIPT_DATA;
    const ph = t.phases;
    return [
      { wait: 200 },
      ...t.banner.map(l => ({ html: `<span class="red">${l}</span>`, delay: 14 })),
      { wait: 240 },
      { html: `<span class="dim">$</span> <span class="prompt">soviet</span> <span class="dim">"${t.task}"</span>`, delay: 12 },
      { wait: 240 },
      { html: `<span class="red">[1/6]</span>  <strong>${ph[0][0]}</strong>  <span class="dim">— ${ph[0][1]}</span>` },
      { html: `        ${t.survey}` },
      { html: `        <span class="dim">scanning…</span> ${'━'.repeat(28)} <span class="crt">100%</span>` },
      { wait: 200 },
      { html: `<span class="red">[2/6]</span>  <strong>${ph[1][0]}</strong>  <span class="dim">— ${ph[1][1]}</span>` },
      { html: `        ${t.verdict}` },
      { html: `        <span class="red">★ ${t.shot}</span> <span class="dim">${t.shotDesc}</span>` },
      { wait: 200 },
      { html: `<span class="red">[3/6]</span>  <strong>${ph[2][0]}</strong>  <span class="dim">— ${ph[2][1]}</span>` },
      { html: `        ${t.plan}` },
      { html: `        <span class="dim">› step 1</span> add mutex around session lookup` },
      { html: `        <span class="dim">› step 2</span> guard concurrent writes in handler` },
      { html: `        <span class="dim">› step 3</span> regression test for double-login` },
      { wait: 200 },
      { html: `<span class="red">[4/6]</span>  <strong>${ph[3][0]}</strong>  <span class="dim">— ${ph[3][1]}</span>` },
      { html: `        ${t.toil}` },
      { html: `        <span class="gold">★</span> writing  src/middleware/auth.ts            <span class="ok">+18 −4</span>` },
      { html: `        <span class="gold">★</span> writing  src/middleware/__tests__/auth.test.ts  <span class="ok">+42 −0</span>` },
      { wait: 180 },
      { html: `<span class="red">[5/6]</span>  <strong>${ph[4][0]}</strong>  <span class="dim">— ${ph[4][1]}</span>` },
      { html: `        ${t.tests}` },
      { html: `        ${t.crit}` },
      { wait: 180 },
      { html: `<span class="red">[6/6]</span>  <strong>${ph[5][0]}</strong>  <span class="dim">— ${ph[5][1]}</span>` },
      { html: `        ${t.commit}` },
      { html: `        <span class="dim">pyatiletka:</span> <span class="crt">${'█'.repeat(28)}</span> <span class="crt">100%</span> <span class="gold">— ahead of schedule!</span>` },
      { wait: 240 },
      { html: `<span class="red">★</span> ${t.done}` },
      { html: `<span class="prompt">$</span> <span class="cursor"></span>`, raw: true },
    ];
  }

  let timerId = null;
  let runId = 0;

  async function run(target) {
    const myRun = ++runId;
    target.innerHTML = '';
    const lines = buildScript();
    for (const item of lines) {
      if (myRun !== runId) return;
      if (item.wait) { await sleep(item.wait); continue; }
      const line = document.createElement('div');
      line.className = 'term-line';
      target.appendChild(line);
      if (item.raw) { line.innerHTML = item.html; await sleep(180); continue; }
      await typeHtml(line, item.html, item.delay || 7, () => myRun !== runId);
      await sleep(40);
    }
  }
  function sleep(ms) { return new Promise(r => { timerId = setTimeout(r, ms); }); }

  async function typeHtml(el, html, perChar, isStale) {
    const tokens = [];
    const re = /(<[^>]+>)|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
      if (m[1]) tokens.push({ type: 'tag', value: m[1] });
      else tokens.push({ type: 'text', value: m[2] });
    }
    let buffer = '';
    const stack = [];
    for (const tok of tokens) {
      if (isStale && isStale()) return;
      if (tok.type === 'tag') {
        buffer += tok.value;
        if (/^<\//.test(tok.value)) stack.pop();
        else if (!/\/>$/.test(tok.value)) stack.push(tok.value);
        el.innerHTML = buffer;
      } else {
        for (const ch of tok.value) {
          if (isStale && isStale()) return;
          buffer += ch;
          el.innerHTML = buffer + closingTags(stack);
          await sleep(perChar);
        }
      }
    }
    el.innerHTML = buffer;
  }
  function closingTags(stack) {
    let s = '';
    for (let i = stack.length - 1; i >= 0; i--) {
      const tag = stack[i].match(/^<(\w+)/);
      if (tag) s += `</${tag[1]}>`;
    }
    return s;
  }

  window.SOVIET_TERMINAL = {
    start(target) { run(target); },
    setLang() { /* no-op: English only */ }
  };

  document.addEventListener('DOMContentLoaded', () => {
    const target = $('#term-stream');
    if (target) run(target);
  });
})();

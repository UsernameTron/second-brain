'use strict';
// Safety-control tests: livelock detection on handoffs, the daily budget gate,
// and global pause semantics. No live API calls — these exercise the guards.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-safety-'));
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { db, nowIso, setSetting } = require('../server/db');
const { executeTool, LIVELOCK_MAX_CROSSINGS } = require('../server/orchestrator/tools');
const control = require('../server/orchestrator/control');
const { dispatchRun } = require('../server/orchestrator/queue');

const CANVAS = 'canvas-safety';
db.prepare("INSERT INTO canvases (id, name, created_at) VALUES (?, 'Safety', ?)").run(CANVAS, nowIso());
const AGENT_A = 'agent-a'; const AGENT_B = 'agent-b';
for (const [id, name] of [[AGENT_A, 'Alpha'], [AGENT_B, 'Beta']]) {
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, ?, 'research', ?)").run(id, CANVAS, name, nowIso());
}
function makeRun(agentId) {
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO runs (id, agent_id, canvas_id, instruction, status, step_budget, wall_ms_budget, created_at)
              VALUES (?, ?, ?, 'test', 'running', 10, 60000, ?)`).run(id, agentId, CANVAS, nowIso());
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
}
const agentRow = (id) => db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
const canvasRow = db.prepare('SELECT * FROM canvases WHERE id = ?').get(CANVAS);

test('livelock: the same item bouncing between a pair of agents escalates instead of dispatching', async () => {
  // Simulate the item having already crossed the pair LIVELOCK_MAX_CROSSINGS times.
  for (let i = 0; i < LIVELOCK_MAX_CROSSINGS; i++) {
    db.prepare(`INSERT INTO handoffs (id, canvas_id, run_id, from_agent_id, to_agent_id, item_key, message, ts)
                VALUES (?, ?, 'r', ?, ?, 'row-9', 'again', ?)`)
      .run(crypto.randomUUID(), CANVAS, i % 2 === 0 ? AGENT_A : AGENT_B, i % 2 === 0 ? AGENT_B : AGENT_A, nowIso());
  }
  const run = makeRun(AGENT_A);
  const result = await executeTool('handoff', { to_agent_name: 'Beta', item_key: 'row-9', message: 'take it back again' },
    { run, agent: agentRow(AGENT_A), canvas: canvasRow });
  assert.equal(result.isError, true);
  const parsed = JSON.parse(result.content);
  assert.equal(parsed.livelock, true);
  const escalation = db.prepare("SELECT * FROM escalations WHERE kind = 'livelock'").get();
  assert.ok(escalation, 'livelock escalation created');
  assert.match(escalation.question, /row-9/);
  // and no new run was dispatched for the blocked handoff
  const runs = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE trigger_kind = 'handoff'").get();
  assert.equal(runs.n, 0);
});

test('a different item between the same pair still hands off (livelock is per item)', async () => {
  const run = makeRun(AGENT_A);
  const result = await executeTool('handoff', { to_agent_name: 'Beta', item_key: 'row-10', message: 'fresh item' },
    { run, agent: agentRow(AGENT_A), canvas: canvasRow });
  assert.ok(!result.isError, `expected success, got: ${result.content}`);
  const parsed = JSON.parse(result.content);
  assert.ok(parsed.dispatched_run);
  // the dispatched run sits queued/failed (no real API key) — that's fine; the guard is what we tested
});

test('daily budget gate: when spend >= budget, new dispatches are refused', () => {
  control.setDailyBudget(0.000001, 'test');
  db.prepare(`INSERT INTO usage_daily (date, input_tokens, output_tokens, cost_usd) VALUES (?, 0, 0, 1.0)
              ON CONFLICT(date) DO UPDATE SET cost_usd = 1.0`).run(new Date().toISOString().slice(0, 10));
  assert.equal(control.budgetExceeded(), true);
  assert.throws(
    () => dispatchRun({ agentId: AGENT_A, canvasId: CANVAS, instruction: 'do work' }),
    /budget/
  );
  control.setDailyBudget(25, 'test'); // restore
  assert.equal(control.budgetExceeded(), false);
});

test('monthly usage rolls up usage_daily by month, newest first', () => {
  const ins = db.prepare(`INSERT INTO usage_daily (date, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?)
                          ON CONFLICT(date) DO UPDATE SET input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens, cost_usd=excluded.cost_usd`);
  ins.run('2001-01-01', 100, 10, 1.5);
  ins.run('2001-01-02', 200, 20, 2.5);
  ins.run('2001-02-01', 50, 5, 0.25);
  const months = control.getMonthlyUsage();
  const jan = months.find((m) => m.month === '2001-01');
  const feb = months.find((m) => m.month === '2001-02');
  assert.deepEqual({ in: jan.input_tokens, out: jan.output_tokens, cost: jan.cost_usd, days: jan.days },
    { in: 300, out: 30, cost: 4.0, days: 2 });
  assert.equal(feb.cost_usd, 0.25);
  assert.ok(months.indexOf(feb) < months.indexOf(jan), 'sorted newest first');
});

test('global pause: queued runs do not start while paused; abort registry fires', () => {
  let aborted = false;
  const controller = new AbortController();
  controller.signal.addEventListener('abort', () => { aborted = true; });
  control.registerAbort('run-live', controller);
  control.setPaused(true, 'fred@cloudtechgurus.com');
  assert.equal(control.isPaused(), true);
  assert.equal(aborted, true, 'in-flight run aborted on pause');
  // dispatch while paused: run is created and queued but must not start
  const { id } = dispatchRun({ agentId: AGENT_B, canvasId: CANVAS, instruction: 'held work' });
  const row = db.prepare('SELECT status FROM runs WHERE id = ?').get(id);
  assert.equal(row.status, 'queued');
  control.setPaused(false, 'pete@cloudtechgurus.com');
  control.unregisterAbort('run-live');
});

test('audit records pause/resume with actor', () => {
  const rows = db.prepare("SELECT actor_id, action FROM audit_log WHERE action IN ('control.pause','control.resume') ORDER BY seq").all();
  assert.ok(rows.find((r) => r.action === 'control.pause' && r.actor_id === 'fred@cloudtechgurus.com'));
  assert.ok(rows.find((r) => r.action === 'control.resume' && r.actor_id === 'pete@cloudtechgurus.com'));
});

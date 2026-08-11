'use strict';
// Run dispatch queue. Bounded concurrency so several agents genuinely work in
// parallel without unbounded API fan-out. While the global pause is on,
// queued runs stay queued and nothing starts.

const crypto = require('node:crypto');
const { db, nowIso } = require('../db');
const { audit } = require('../audit');
const bus = require('../bus');
const memory = require('../memory');
const control = require('./control');
const { executeRun } = require('./runner');

const CONCURRENCY = Number(process.env.AGENT_CONCURRENCY || 3);
const DEFAULT_STEP_BUDGET = Number(process.env.STEP_BUDGET || 12);
const DEFAULT_WALL_MS = Number(process.env.RUN_WALL_MS || 240_000);

const queue = [];
let runningCount = 0;

function dispatchRun({ agentId, canvasId, instruction, triggerKind = 'user', parentRunId = null, initialReads = [], stepBudget, wallMs, actor = 'system' }) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND canvas_id = ?').get(agentId, canvasId);
  if (!agent) throw Object.assign(new Error('agent not found on this canvas'), { status: 404 });
  if (control.budgetExceeded()) {
    const err = new Error(`daily token budget ($${control.getDailyBudget()}) is spent — new runs are suspended`);
    err.status = 429;
    throw err;
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO runs (id, agent_id, canvas_id, parent_run_id, trigger_kind, instruction, status, step_budget, wall_ms_budget, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
  ).run(id, agentId, canvasId, parentRunId, triggerKind, instruction, stepBudget || DEFAULT_STEP_BUDGET, wallMs || DEFAULT_WALL_MS, nowIso());
  if (initialReads.length) memory.recordRunReads(id, initialReads);
  audit(triggerKind === 'user' ? 'user' : 'system', actor, 'run.dispatch', { runId: id, agentId, canvasId, triggerKind });
  bus.emit('event', { type: 'run_status', canvasId, runId: id, agentId, status: 'queued' });
  queue.push(id);
  setImmediate(pump);
  return { id };
}

function pump() {
  if (control.isPaused()) return;
  while (runningCount < CONCURRENCY && queue.length > 0) {
    const runId = queue.shift();
    runningCount += 1;
    executeRun(runId)
      .catch(() => {})
      .finally(() => {
        runningCount -= 1;
        setImmediate(pump);
      });
  }
}

// Called when the owner resumes from a global pause.
function resumePump() { setImmediate(pump); }

function queueState() {
  return { queued: queue.length, running: runningCount, concurrency: CONCURRENCY, paused: control.isPaused() };
}

// On process start, close out runs orphaned by a previous process.
function recoverOrphans() {
  const orphans = db.prepare("SELECT id FROM runs WHERE status IN ('running','queued')").all();
  for (const { id } of orphans) {
    db.prepare("UPDATE runs SET status = 'failed', error = 'orphaned by server restart', ended_at = ? WHERE id = ?").run(nowIso(), id);
  }
  db.prepare("UPDATE agents SET status = 'idle' WHERE status = 'running'").run();
  return orphans.length;
}

module.exports = { dispatchRun, resumePump, queueState, recoverOrphans, DEFAULT_STEP_BUDGET, DEFAULT_WALL_MS };

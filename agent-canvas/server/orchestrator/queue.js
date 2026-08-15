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

const RUN_MODES = ['act', 'ask', 'rehearse'];

function dispatchRun({ agentId, canvasId, instruction, triggerKind = 'user', parentRunId = null, initialReads = [], stepBudget, wallMs, actor = 'system', initiatedBy = null, mode = null }) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND canvas_id = ?').get(agentId, canvasId);
  if (!agent) throw Object.assign(new Error('agent not found on this canvas'), { status: 404 });
  if (control.budgetExceeded()) {
    const err = new Error(`daily token budget ($${control.getDailyBudget()}) is spent — new runs are suspended`);
    err.status = 429;
    throw err;
  }
  if (mode !== null && !RUN_MODES.includes(mode)) throw Object.assign(new Error(`mode must be one of ${RUN_MODES.join(', ')}`), { status: 400 });
  const id = crypto.randomUUID();
  // Whose Google identity workspace tools act as: an explicit initiator wins;
  // a handoff/resume child inherits its parent's; system runs have none.
  let initiator = initiatedBy;
  // Mode inherits like initiated_by: a child run (handoff/resume) keeps its
  // parent's mode so an ask/rehearse run cannot launder mutation through a
  // handoff (belt-and-braces — handoff is itself blocked in those modes).
  let runMode = mode;
  if (parentRunId && (!initiator || !runMode)) {
    const parent = db.prepare('SELECT initiated_by, mode FROM runs WHERE id = ?').get(parentRunId);
    if (!initiator) initiator = parent?.initiated_by || null;
    if (!runMode) runMode = parent?.mode || null;
  }
  runMode = runMode || 'act';
  db.prepare(
    `INSERT INTO runs (id, agent_id, canvas_id, parent_run_id, trigger_kind, instruction, status, step_budget, wall_ms_budget, created_at, initiated_by, mode)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`
  ).run(id, agentId, canvasId, parentRunId, triggerKind, instruction, stepBudget || DEFAULT_STEP_BUDGET, wallMs || DEFAULT_WALL_MS, nowIso(), initiator, runMode);
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
      .catch((err) => {
        // A run that dies before executeRun's own handler takes over would
        // otherwise sit in 'queued' forever: silent work loss. Record it and
        // put it in front of a human.
        const message = String((err && err.message) || err).slice(0, 300);
        try {
          const row = db.prepare('SELECT status, agent_id, canvas_id, instruction FROM runs WHERE id = ?').get(runId);
          if (row && (row.status === 'queued' || row.status === 'running')) {
            db.prepare("UPDATE runs SET status = 'failed', error = ?, ended_at = ? WHERE id = ?")
              .run(`dispatch failure: ${message}`, nowIso(), runId);
            audit('system', 'queue', 'run.dispatch_failed', { runId, error: message });
            const { createEscalation } = require('./tools');
            createEscalation({
              canvasId: row.canvas_id, runId, agentId: row.agent_id, kind: 'error',
              question: `A run failed before it could start and was not retried: "${String(row.instruction).slice(0, 140)}". Error: ${message}. Re-dispatch it, or drop it?`,
              context: { error: message },
            });
          }
        } catch { /* last resort: never let the pump itself die */ }
      })
      .finally(() => {
        runningCount -= 1;
        setImmediate(pump);
      });
  }
}

// Called when the owner resumes from a global pause.
function resumePump() { setImmediate(pump); }

// Reconciler. A run is only ever 'queued' while it sits in the in-memory queue;
// if one is queued but absent from it, dispatch dropped it (an intermittent
// condition we have seen but not reproduced deterministically). Rather than
// lose that work silently — the one outcome this system must never have — pick
// it back up, and escalate if it keeps failing to start.
const reenqueued = new Map(); // runId -> attempts
const STRANDED_AFTER_MS = 60_000;
const MAX_REQUEUE = 2;

function reconcileStrandedRuns() {
  const cutoff = new Date(Date.now() - STRANDED_AFTER_MS).toISOString();
  const stranded = db.prepare(
    "SELECT id, agent_id, canvas_id, instruction FROM runs WHERE status = 'queued' AND created_at < ?"
  ).all(cutoff).filter((r) => !queue.includes(r.id));
  for (const run of stranded) {
    const attempts = (reenqueued.get(run.id) || 0) + 1;
    reenqueued.set(run.id, attempts);
    if (attempts > MAX_REQUEUE) {
      db.prepare("UPDATE runs SET status = 'failed', error = 'stranded before start; re-queue attempts exhausted', ended_at = ? WHERE id = ? AND status = 'queued'")
        .run(nowIso(), run.id);
      audit('system', 'queue', 'run.stranded_failed', { runId: run.id, attempts });
      const { createEscalation } = require('./tools');
      createEscalation({
        canvasId: run.canvas_id, runId: run.id, agentId: run.agent_id, kind: 'error',
        question: `A run never started after ${MAX_REQUEUE} attempts and was not retried further: "${String(run.instruction).slice(0, 140)}". Re-dispatch it, or drop it?`,
        context: { attempts },
      });
      reenqueued.delete(run.id);
    } else {
      audit('system', 'queue', 'run.requeued', { runId: run.id, attempts });
      queue.push(run.id);
      setImmediate(pump);
    }
  }
  return stranded.length;
}

const reconcileTimer = setInterval(reconcileStrandedRuns, 30_000);
if (reconcileTimer.unref) reconcileTimer.unref();

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

module.exports = { dispatchRun, resumePump, queueState, recoverOrphans, reconcileStrandedRuns, DEFAULT_STEP_BUDGET, DEFAULT_WALL_MS, RUN_MODES };

'use strict';
// Runtime safety controls shared by the queue and the runner:
// - the global pause switch (anyone can pause; owner-only resume is enforced
//   at the route) with an abort registry that kills in-flight model calls,
// - daily token/cost accounting and the configurable daily budget gate.

const { db, nowIso, getSetting, setSetting } = require('./../db');
const { audit } = require('./../audit');
const bus = require('./../bus');
const { costOf } = require('./anthropic');

const abortControllers = new Map(); // runId -> AbortController

function isPaused() {
  return getSetting('global_pause', '0') === '1';
}

// Pause is an epoch, not just a flag: hitting pause increments the workspace
// generation. Runs capture the epoch they started under; any tool call or
// model response arriving from an older epoch is rejected server-side, so a
// slow in-flight inference that survives the abort cannot act after the pause
// (zombie responses are dropped, not welcomed back).
function currentEpoch() {
  return Number(getSetting('pause_epoch', '0'));
}

function setPaused(paused, actor) {
  setSetting('global_pause', paused ? '1' : '0');
  if (paused) {
    setSetting('paused_by', actor);
    setSetting('pause_epoch', String(currentEpoch() + 1));
  }
  audit('user', actor, paused ? 'control.pause' : 'control.resume', { inFlightAborted: paused ? abortControllers.size : 0, epoch: currentEpoch() });
  if (paused) {
    for (const [, controller] of abortControllers) controller.abort(new Error('global pause'));
  }
  bus.emit('event', { type: 'pause_state', canvasId: null, paused, by: actor });
}

// True when an action from a run that started under `epoch` must be rejected.
function epochStale(epoch) {
  return isPaused() || currentEpoch() !== epoch;
}

function registerAbort(runId, controller) { abortControllers.set(runId, controller); }
function unregisterAbort(runId) { abortControllers.delete(runId); }

function today() { return new Date().toISOString().slice(0, 10); }

function addUsage(model, usage) {
  const cost = costOf(model, usage);
  const date = today();
  db.prepare(`
    INSERT INTO usage_daily (date, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      cost_usd = cost_usd + excluded.cost_usd
  `).run(date, usage.input_tokens || 0, usage.output_tokens || 0, cost);
  bus.emit('event', { type: 'budget', canvasId: null, usage: getDailyUsage() });
  return cost;
}

function getDailyUsage() {
  const row = db.prepare('SELECT * FROM usage_daily WHERE date = ?').get(today()) ||
    { date: today(), input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  return { ...row, budget_usd: getDailyBudget(), paused: isPaused() };
}

function getDailyBudget() {
  return Number(getSetting('daily_budget_usd', process.env.DAILY_BUDGET_USD || '25'));
}

function setDailyBudget(usd, actor) {
  setSetting('daily_budget_usd', String(usd));
  audit('user', actor, 'control.set_budget', { dailyBudgetUsd: usd });
  bus.emit('event', { type: 'budget', canvasId: null, usage: getDailyUsage() });
}

// Workspace-wide month rollups from usage_daily (kept forever, so this is
// just a GROUP BY — no separate metering). Newest first, last 12 months.
function getMonthlyUsage() {
  return db.prepare(`
    SELECT substr(date, 1, 7) AS month,
           SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
           SUM(cost_usd) AS cost_usd, COUNT(*) AS days
    FROM usage_daily GROUP BY month ORDER BY month DESC LIMIT 12
  `).all();
}

function budgetExceeded() {
  const usage = getDailyUsage();
  return usage.cost_usd >= usage.budget_usd;
}

module.exports = {
  isPaused, setPaused, currentEpoch, epochStale, registerAbort, unregisterAbort,
  addUsage, getDailyUsage, getMonthlyUsage, getDailyBudget, setDailyBudget, budgetExceeded, nowIso,
};

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

function setPaused(paused, actor) {
  setSetting('global_pause', paused ? '1' : '0');
  if (paused) setSetting('paused_by', actor);
  audit('user', actor, paused ? 'control.pause' : 'control.resume', { inFlightAborted: paused ? abortControllers.size : 0 });
  if (paused) {
    for (const [, controller] of abortControllers) controller.abort(new Error('global pause'));
  }
  bus.emit('event', { type: 'pause_state', canvasId: null, paused, by: actor });
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

function budgetExceeded() {
  const usage = getDailyUsage();
  return usage.cost_usd >= usage.budget_usd;
}

module.exports = {
  isPaused, setPaused, registerAbort, unregisterAbort,
  addUsage, getDailyUsage, getDailyBudget, setDailyBudget, budgetExceeded, nowIso,
};

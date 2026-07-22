'use strict';

/**
 * sweep-status.js
 *
 * Builds the one-line daily-sweep status shown in /today's Compounding section
 * (Phase 33 CAP-EVIDENCE-01). Reads the proof-of-fire written by
 * scripts/daily-sweep.js (state/daily-sweep-last-run.json) and returns one of:
 *   - `sweep ran HH:MM, staged N`   (last run <= 26h ago)
 *   - `sweep STALE (last ran YYYY-MM-DD)`  (> 26h ago)
 *   - `sweep NEVER RAN`             (state file missing/corrupt/unreadable)
 *
 * Fail-open: NEVER throws — a scheduler that fires silently is indistinguishable
 * from one that doesn't, so the briefing must always render SOME status rather
 * than crash on a missing/garbage file.
 *
 * @module today/sweep-status
 */

const fs = require('fs');
const path = require('path');

// One missed night + margin. A constant, not config (locked decision, plan 33-04).
const STALE_MS = 26 * 60 * 60 * 1000;

/**
 * Resolve the last-run evidence path written by daily-sweep.js. src/today/ → ../../state.
 * Honors DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE (same hook daily-sweep.js writes through).
 * @returns {string}
 */
function _lastRunPath() {
  return process.env.DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE
    || path.join(__dirname, '..', '..', 'state', 'daily-sweep-last-run.json');
}

/**
 * Compute the sweep-status line. Never throws (fail-open to 'sweep NEVER RAN').
 * @param {Date} [now=new Date()] - injectable for tests
 * @returns {string} one of the three line states
 */
function computeSweepLine(now = new Date()) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(_lastRunPath(), 'utf8'));
  } catch (_) {
    return 'sweep NEVER RAN';
  }
  if (!state || !state.ts) return 'sweep NEVER RAN';

  const ranAt = new Date(state.ts).getTime();
  if (Number.isNaN(ranAt)) return 'sweep NEVER RAN';

  const age = now.getTime() - ranAt;
  if (age > STALE_MS) {
    return `sweep STALE (last ran ${String(state.ts).slice(0, 10)})`;
  }
  const hhmm = new Date(state.ts).toTimeString().slice(0, 5);
  const staged = Number.isFinite(state.staged) ? state.staged : 0;
  return `sweep ran ${hhmm}, staged ${staged}`;
}

module.exports = { computeSweepLine };

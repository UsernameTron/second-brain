'use strict';

/**
 * classifier-health.js
 *
 * Cross-invocation health tracker for the LOCAL classifier (LM Studio / qwen),
 * cloned from voyage-health.js (Pattern 7: Adaptive Denial Tracking). Persists
 * failure counts + degraded windows AND a per-night Haiku fallback counter to
 * ~/.cache/second-brain/classifier-health.json so separate CLI/launchd processes
 * (the nightly daily-sweep, /new, memory-extractor) coordinate on a wedged local
 * endpoint instead of each burning the 60s timeout independently.
 *
 * Motivation (260721-ljn): a loaded-but-stuck local model makes every classify
 * call hit PR #83's 60s timeout. Counting those timeouts lets the sweep flip to
 * degraded FAST (skip local, go straight to Haiku), and the per-night cap keeps
 * an unattended night from racking up unbounded Haiku API calls.
 *
 * Pure fs — hits no live endpoint. Every read is fail-open (ENOENT/parse →
 * defaults, never throws) so the sweep never crashes on a missing/garbage cache.
 *
 * @module utils/classifier-health
 */

const fs = require('fs');
const path = require('path');
// Reuse the exact cache-dir resolver (CACHE_DIR_OVERRIDE-honoring) so classifier
// and voyage health share ~/.cache/second-brain without divergent idioms.
const { getSemanticCacheDir } = require('./voyage-health');

const DEGRADED_FAILURE_THRESHOLD = 3; // mirror voyage-health: 3 consecutive → degraded
const DEFAULT_DEGRADED_MINUTES = 15;

/**
 * Absolute path to classifier-health.json (its OWN file, not voyage-health.json).
 * @returns {string}
 */
function getHealthPath() {
  return path.join(getSemanticCacheDir(), 'classifier-health.json');
}

const DEFAULT_HEALTH = {
  consecutive_failures: 0,
  last_failure: null,
  last_failure_code: null,
  degraded_until: null,
  haiku_date: null, // local YYYY-MM-DD the counter belongs to
  haiku_calls: 0, // Haiku fallback calls made on haiku_date
};

/**
 * Local calendar-date key (YYYY-MM-DD). Injectable for tests / date-rollover.
 * @param {Date} [d=new Date()]
 * @returns {string}
 */
function _localDateKey(d) {
  const dt = d || new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Read the health-state file. Returns defaults on ENOENT or parse error (fail-open).
 * @returns {object}
 */
function readHealth() {
  try {
    const raw = fs.readFileSync(getHealthPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_HEALTH, ...parsed };
  } catch (_) {
    return { ...DEFAULT_HEALTH };
  }
}

/**
 * Write the health-state file atomically (tmp + rename). Creates the cache dir if missing.
 * @param {object} state
 */
function _writeHealth(state) {
  const dir = getSemanticCacheDir();
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (_) { /* dir may already exist */ }
  const tmp = getHealthPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, getHealthPath());
}

/**
 * Record a failed local-classifier call. Increments the consecutive counter; at
 * threshold, opens a degraded-mode window.
 * @param {string} code - 'http' (non-2xx/shape) | 'parse' (JSON parse) | 'timeout' (60s abort)
 * @param {number} [degradedMinutes=DEFAULT_DEGRADED_MINUTES]
 */
function recordFailure(code, degradedMinutes = DEFAULT_DEGRADED_MINUTES) {
  const state = readHealth();
  state.consecutive_failures = (state.consecutive_failures || 0) + 1;
  state.last_failure = new Date().toISOString();
  state.last_failure_code = code;
  if (state.consecutive_failures >= DEGRADED_FAILURE_THRESHOLD) {
    state.degraded_until = new Date(Date.now() + degradedMinutes * 60 * 1000).toISOString();
  }
  _writeHealth(state);
}

/**
 * Record a successful local-classifier call. Resets the counter and closes any degraded window.
 */
function recordSuccess() {
  const state = readHealth();
  state.consecutive_failures = 0;
  state.degraded_until = null;
  _writeHealth(state);
}

/**
 * Whether the local classifier is currently in a degraded window.
 * @returns {boolean}
 */
function isDegraded() {
  const state = readHealth();
  if (!state.degraded_until) return false;
  return new Date(state.degraded_until).getTime() > Date.now();
}

/**
 * Short human-readable reason for degraded mode (banner/log use).
 * @returns {string}
 */
function getDegradedReason() {
  const state = readHealth();
  if (!isDegraded()) return '';
  const code = state.last_failure_code || 'unknown';
  return `local classifier degraded (${code}) — skipping local until ${state.degraded_until}`;
}

/**
 * Increment today's Haiku fallback count. Resets to 0 first when the stored date
 * differs from today, so last night's fallbacks never cap tonight.
 * @param {string} [dateKey] - injectable local date key (defaults to today)
 */
function recordHaikuCall(dateKey) {
  const key = dateKey || _localDateKey();
  const state = readHealth();
  if (state.haiku_date !== key) {
    state.haiku_date = key;
    state.haiku_calls = 0;
  }
  state.haiku_calls = (state.haiku_calls || 0) + 1;
  _writeHealth(state);
}

/**
 * Whether today's Haiku fallback count has reached `cap`. A stored count from a
 * prior day reads as 0 (per-night reset).
 * @param {number} cap
 * @param {string} [dateKey] - injectable local date key (defaults to today)
 * @returns {boolean}
 */
function isHaikuCapReached(cap, dateKey) {
  const key = dateKey || _localDateKey();
  const state = readHealth();
  const count = state.haiku_date === key ? (state.haiku_calls || 0) : 0;
  return count >= cap;
}

module.exports = {
  getHealthPath,
  getSemanticCacheDir,
  readHealth,
  recordFailure,
  recordSuccess,
  isDegraded,
  getDegradedReason,
  recordHaikuCall,
  isHaikuCapReached,
  _localDateKey,
  DEGRADED_FAILURE_THRESHOLD,
};

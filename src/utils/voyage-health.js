'use strict';

/**
 * voyage-health.js
 *
 * Cross-invocation health tracker for Voyage AI calls (Pattern 7: Adaptive Denial Tracking).
 * Persists failure counts and degraded-mode windows to ~/.cache/second-brain/voyage-health.json
 * so repeated /recall invocations across separate CLI processes coordinate on known-bad endpoints.
 *
 * @module utils/voyage-health
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEGRADED_FAILURE_THRESHOLD = 3; // D-10: 3 consecutive failures trigger degraded mode
const DEFAULT_DEGRADED_MINUTES = 15; // D-10 default when config unreadable

/**
 * Resolve the cache directory for Phase 19 semantic artifacts.
 * Honors CACHE_DIR_OVERRIDE for test isolation; defaults to ~/.cache/second-brain.
 * @returns {string} Absolute path to the cache directory (may not exist yet)
 */
function getSemanticCacheDir() {
  if (process.env.CACHE_DIR_OVERRIDE) return process.env.CACHE_DIR_OVERRIDE;
  return path.join(os.homedir(), '.cache', 'second-brain');
}

/**
 * Absolute path to voyage-health.json.
 * @returns {string}
 */
function getHealthPath() {
  return path.join(getSemanticCacheDir(), 'voyage-health.json');
}

const DEFAULT_HEALTH = {
  consecutive_failures: 0,
  last_failure: null,
  last_failure_code: null,
  degraded_until: null,
};

/**
 * Read the health-state file. Returns defaults on ENOENT or parse error.
 * @returns {{consecutive_failures:number, last_failure:string|null, last_failure_code:string|null, degraded_until:string|null}}
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
 * Write the health-state file atomically. Creates the cache dir if missing.
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
 * Record a failed Voyage call. Increments the consecutive counter; at threshold,
 * opens a degraded-mode window of `degradedMinutes` minutes.
 * @param {string} code - Failure classification: '401'|'429'|'5xx'|'timeout'|'network'
 * @param {number} [degradedMinutes=DEFAULT_DEGRADED_MINUTES] - Window length when tripping into degraded mode
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
 * Record a successful Voyage call. Resets consecutive counter and closes any degraded window.
 */
function recordSuccess() {
  const state = readHealth();
  state.consecutive_failures = 0;
  state.degraded_until = null;
  _writeHealth(state);
}

/**
 * Check whether the tracker is currently in a degraded window.
 * @returns {boolean}
 */
function isDegraded() {
  const state = readHealth();
  if (!state.degraded_until) return false;
  return new Date(state.degraded_until).getTime() > Date.now();
}

/**
 * Short human-readable reason for degraded mode (for banner display).
 * @returns {string}
 */
function getDegradedReason() {
  const state = readHealth();
  if (!isDegraded()) return '';
  const code = state.last_failure_code || 'unknown';
  return `degraded mode (${code}) — retries paused until ${state.degraded_until}`;
}

module.exports = {
  getHealthPath,
  getSemanticCacheDir,
  readHealth,
  recordFailure,
  recordSuccess,
  isDegraded,
  getDegradedReason,
  DEGRADED_FAILURE_THRESHOLD,
};

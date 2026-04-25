'use strict';

/**
 * daily-stats.js
 *
 * Storage substrate for daily measurement rows in RIGHT/daily-stats.md.
 * One row per calendar day (America/Chicago). Idempotent same-day rewrites.
 *
 * Exports:
 *   - dateKey(now?, tz?): timezone-safe YYYY-MM-DD key
 *   - recordDailyStats(stats, opts?): write/update today's row via vault-gateway
 *   - readDailyStats(absPath): parse daily-stats.md into frontmatter + rows
 *
 * Pattern 11: All writes go through vault-gateway's vaultWriteAtomic().
 * Pattern 7:  Atomic .tmp + rename lives in vault-gateway; this module never
 *             calls fs.writeFileSync or fs.renameSync on the stats path directly.
 * Pattern 12: Lazy requires for vault-gateway and pipeline-infra inside the
 *             public API functions — no top-level side effects at require-time.
 *
 * @module daily-stats
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const matter = require('gray-matter');

// ── dateKey() ─────────────────────────────────────────────────────────────────

/**
 * Return YYYY-MM-DD for the supplied Date (or current time) in the given timezone.
 * Defaults to America/Chicago (D-08 — operator is in Fort Worth, Central time).
 *
 * Uses native Intl.DateTimeFormat (zero deps). en-CA locale produces YYYY-MM-DD natively.
 *
 * @param {Date} [now=new Date()] - Date instance to convert
 * @param {string} [tz='America/Chicago'] - IANA timezone string
 * @returns {string} Date key in `YYYY-MM-DD` form for the given timezone
 */
function dateKey(now = new Date(), tz = 'America/Chicago') {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA produces YYYY-MM-DD natively; no manual reformatting needed.
  return fmt.format(now);
}

// ── Column definitions ────────────────────────────────────────────────────────

/**
 * Canonical column order (D-04, D-05). Source of truth — rendered table matches this.
 */
const COLUMNS = [
  'date',
  'proposals',
  'promotions',
  'total_entries',
  'memory_kb',
  'recall_count',
  'avg_latency_ms',
  'avg_confidence',
];

// ── readDailyStats() ──────────────────────────────────────────────────────────

/**
 * Parse a daily-stats.md file into structured frontmatter + rows.
 * Returns { frontmatter: null, rows: [] } when the file does not exist.
 * Throws on parse failure (caller wraps in try/catch per briefing-is-the-product).
 *
 * @param {string} absPath - Absolute path to daily-stats.md
 * @returns {{ frontmatter: object|null, rows: Array<object> }}
 */
function readDailyStats(absPath) {
  let raw;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { frontmatter: null, rows: [] };
    }
    throw err;
  }

  const parsed = matter(raw);
  const frontmatter = parsed.data || {};
  const columns = frontmatter.columns || COLUMNS;
  const rows = [];

  // Parse GFM pipe table from content
  const lines = (parsed.content || '').split('\n');
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;

    // Skip header row (contains column names) and separator row (contains ---)
    if (trimmed.includes('---')) continue;
    if (!inTable) {
      // This is the header row
      inTable = true;
      continue;
    }

    // Data row: split on | and trim each cell
    const cells = trimmed
      .split('|')
      .map(c => c.trim())
      .filter((_, i, arr) => i > 0 && i < arr.length - 1); // remove leading/trailing empty

    if (cells.length !== columns.length) continue;

    const row = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = cells[i];
    }
    rows.push(row);
  }

  return { frontmatter, rows };
}

// ── renderTable() ─────────────────────────────────────────────────────────────

/**
 * Render rows as a GFM pipe table with columns in the declared order.
 *
 * @param {string[]} columns - Column names in order
 * @param {Array<object>} rows - Row data keyed by column name
 * @returns {string} GFM pipe table string (no trailing newline)
 */
function renderTable(columns, rows) {
  const header = '| ' + columns.join(' | ') + ' |';
  const separator = '| ' + columns.map(() => '---').join(' | ') + ' |';
  const dataRows = rows.map(row => {
    const cells = columns.map(col => {
      const val = row[col];
      return val === undefined || val === null ? '' : String(val);
    });
    return '| ' + cells.join(' | ') + ' |';
  });
  return [header, separator, ...dataRows].join('\n');
}

// ── _writeDailyStats() ────────────────────────────────────────────────────────

/**
 * Render and write daily-stats.md via vault-gateway's atomic writer.
 * Pattern 11: LEFT/RIGHT enforcement happens INSIDE vaultWriteAtomic — this module
 * never touches fs.writeFileSync or fs.renameSync directly on the stats path.
 *
 * @param {string} relativePath - Vault-relative path (e.g., "RIGHT/daily-stats.md")
 * @param {object} frontmatter - { schema_version, columns, last_updated, timezone }
 * @param {Array<object>} rows - one entry per calendar day, ascending order
 */
function _writeDailyStats(relativePath, frontmatter, rows) {
  const { vaultWriteAtomic } = require('./vault-gateway');
  const tableBody = renderTable(frontmatter.columns, rows);
  // gray-matter.stringify prepends YAML frontmatter to the content string
  const formatted = matter.stringify(tableBody, frontmatter);
  vaultWriteAtomic(relativePath, formatted);
}

// ── recordDailyStats() ────────────────────────────────────────────────────────

/**
 * Record (or update) today's stats row in daily-stats.md.
 * Idempotent: same-day re-call replaces the existing row (last-run-wins, D-02/D-05).
 * Different-day call appends a new row in ascending date order.
 *
 * Pattern 11: writes route through vaultWriteAtomic (never direct fs calls).
 * Pattern 12: lazy requires inside this function — no side effects at require-time.
 *
 * @param {object} stats - { proposals, promotions, totalEntries, memoryKb, recallCount, avgLatencyMs, avgConfidence }
 * @param {object} [opts={}] - { now: Date, configOverride: pipelineConfig } for testability
 */
function recordDailyStats(stats, opts = {}) {
  const { loadConfigWithOverlay } = require('./pipeline-infra');
  const { VAULT_ROOT } = require('./vault-gateway');

  const config = opts.configOverride || loadConfigWithOverlay('pipeline', { validate: true });
  if (!config.stats || !config.stats.enabled) return;

  const tz = config.stats.timezone || 'America/Chicago';
  const today = dateKey(opts.now || new Date(), tz);
  const relativePath = config.stats.path; // vault-relative — vault-gateway resolves abs
  const schemaVersion = config.stats.schemaVersion || 1;

  // Read existing file (or treat as empty) — reads stay direct (no write concern)
  const absPathForRead = path.join(VAULT_ROOT, relativePath);
  const { frontmatter: existingFrontmatter, rows: existingRows } = readDailyStats(absPathForRead);

  // Build new row for today
  const memoryKb = stats.memoryKb !== undefined && stats.memoryKb !== null
    ? Math.round(stats.memoryKb * 10) / 10
    : 0;

  const fmtOptional = (val) => (val === undefined || val === null) ? '\u2014' : val;

  const newRow = {
    date: today,
    proposals: stats.proposals !== undefined ? stats.proposals : 0,
    promotions: stats.promotions !== undefined ? stats.promotions : 0,
    total_entries: stats.totalEntries !== undefined ? stats.totalEntries : 0,
    memory_kb: memoryKb,
    recall_count: stats.recallCount !== undefined ? stats.recallCount : 0,
    avg_latency_ms: fmtOptional(stats.avgLatencyMs !== undefined ? stats.avgLatencyMs : null),
    avg_confidence: stats.avgConfidence !== undefined && stats.avgConfidence !== null
      ? Number(stats.avgConfidence).toFixed(2)
      : '\u2014',
  };

  // Idempotent merge: replace today's row or insert in ascending date order
  let rows;
  const existingIdx = existingRows.findIndex(r => r.date === today);
  if (existingIdx >= 0) {
    // Same-day re-run: replace in-place (last-run-wins)
    rows = [...existingRows];
    rows[existingIdx] = newRow;
  } else {
    // New day: insert in ascending date order
    const insertIdx = existingRows.findIndex(r => r.date > today);
    if (insertIdx === -1) {
      rows = [...existingRows, newRow];
    } else {
      rows = [
        ...existingRows.slice(0, insertIdx),
        newRow,
        ...existingRows.slice(insertIdx),
      ];
    }
  }

  // Build / update frontmatter
  const frontmatter = {
    schema_version: existingFrontmatter ? (existingFrontmatter.schema_version || schemaVersion) : schemaVersion,
    columns: COLUMNS,
    last_updated: (opts.now || new Date()).toISOString(),
    timezone: tz,
  };

  _writeDailyStats(relativePath, frontmatter, rows);
}

// ── Daily counter store ───────────────────────────────────────────────────────
//
// Accumulates per-invocation counters across separate process executions of
// /recall, /promote-memories, and /today using an atomic per-day JSON file at
// ~/.cache/second-brain/daily-counters-YYYY-MM-DD.json (Chicago dateKey).
//
// File shape: { date, proposals, promotions, recallCount,
//               confidenceSum, confidenceCount, topCosineScores[], topRrfScores[] }
//
// Pattern 7: atomic .tmp + rename, chmod 0600 — mirrors voyage-health.js _writeHealth.
// All emit functions are wrapped in try/catch — briefing-is-the-product: never throw.

/** Default counter state for a fresh day. */
const _COUNTER_DEFAULTS = {
  proposals: 0,
  promotions: 0,
  recallCount: 0,
  confidenceSum: 0,
  confidenceCount: 0,
  topCosineScores: [],
  topRrfScores: [],
};

/**
 * Resolve the counter file path for a given date.
 * Honors CACHE_DIR_OVERRIDE for test isolation.
 * @param {Date} now
 * @returns {string} absolute path to daily-counters-YYYY-MM-DD.json
 */
function _counterPath(now) {
  const cacheDir = process.env.CACHE_DIR_OVERRIDE
    || path.join(os.homedir(), '.cache', 'second-brain');
  return path.join(cacheDir, `daily-counters-${dateKey(now)}.json`);
}

/**
 * Read today's counter state. Returns defaults if file missing or unparseable.
 * @param {Date} now
 * @returns {object} counter state
 */
function _readCounters(now) {
  try {
    const raw = fs.readFileSync(_counterPath(now), 'utf8');
    return { ..._COUNTER_DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    return { date: dateKey(now), ..._COUNTER_DEFAULTS };
  }
}

/**
 * Atomically write counter state (tmp + rename, mode 0o600).
 * @param {Date} now
 * @param {object} state
 */
function _writeCounters(now, state) {
  const filePath = _counterPath(now);
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* dir may exist */ }
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

/**
 * Increment today's recall_count by 1 (D-04: explicit /recall invocations only).
 * Never throws — stats failure must not break the recall command.
 * @param {object} [opts={}] - { now: Date } for testability
 */
function recordRecallInvocation(opts = {}) {
  try {
    const now = opts.now || new Date();
    const state = _readCounters(now);
    state.recallCount = (state.recallCount || 0) + 1;
    state.date = dateKey(now);
    _writeCounters(now, state);
  } catch (_) { /* non-fatal */ }
}

/**
 * Add count to today's proposals tally.
 * @param {number} count - number of new proposals written this batch
 * @param {object} [opts={}] - { now: Date }
 */
function recordProposalsBatch(count, opts = {}) {
  try {
    const now = opts.now || new Date();
    const state = _readCounters(now);
    state.proposals = (state.proposals || 0) + count;
    state.date = dateKey(now);
    _writeCounters(now, state);
  } catch (_) { /* non-fatal */ }
}

/**
 * Record one promoted entry: increments promotions count and, if confidence is
 * a valid number, accumulates it toward avg_confidence (null-confidence
 * promotions are counted but excluded from the mean — D-03).
 * @param {number|null} confidence - memory-extractor classifier confidence
 * @param {object} [opts={}] - { now: Date }
 */
function recordPromotion(confidence, opts = {}) {
  try {
    const now = opts.now || new Date();
    const state = _readCounters(now);
    state.promotions = (state.promotions || 0) + 1;
    if (typeof confidence === 'number' && Number.isFinite(confidence)) {
      state.confidenceSum = (state.confidenceSum || 0) + confidence;
      state.confidenceCount = (state.confidenceCount || 0) + 1;
    }
    state.date = dateKey(now);
    _writeCounters(now, state);
  } catch (_) { /* non-fatal */ }
}

/**
 * Append a top-1 cosine score record (D-07: emit-only, not surfaced in stats columns this phase).
 * @param {number} score
 * @param {object} [opts={}] - { now: Date }
 */
function recordTopCosine(score, opts = {}) {
  try {
    const now = opts.now || new Date();
    const state = _readCounters(now);
    state.topCosineScores = Array.isArray(state.topCosineScores) ? state.topCosineScores : [];
    state.topCosineScores.push(score);
    state.date = dateKey(now);
    _writeCounters(now, state);
  } catch (_) { /* non-fatal */ }
}

/**
 * Append a top-1 RRF score record (D-07: emit-only, --hybrid branch).
 * @param {number} score
 * @param {object} [opts={}] - { now: Date }
 */
function recordTopRrf(score, opts = {}) {
  try {
    const now = opts.now || new Date();
    const state = _readCounters(now);
    state.topRrfScores = Array.isArray(state.topRrfScores) ? state.topRrfScores : [];
    state.topRrfScores.push(score);
    state.date = dateKey(now);
    _writeCounters(now, state);
  } catch (_) { /* non-fatal */ }
}

/**
 * Read today's accumulated counters.
 * Returns { proposals, promotions, recallCount, avgConfidence } with zeros/null defaults.
 * @param {object} [opts={}] - { now: Date }
 * @returns {{ proposals: number, promotions: number, recallCount: number, avgConfidence: number|null }}
 */
function readDailyCounters(opts = {}) {
  try {
    const now = opts.now || new Date();
    const state = _readCounters(now);
    return {
      proposals: state.proposals || 0,
      promotions: state.promotions || 0,
      recallCount: state.recallCount || 0,
      avgConfidence: (state.confidenceCount > 0)
        ? state.confidenceSum / state.confidenceCount
        : null,
    };
  } catch (_) {
    return { proposals: 0, promotions: 0, recallCount: 0, avgConfidence: null };
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  recordDailyStats, dateKey, readDailyStats,
  recordRecallInvocation, recordProposalsBatch, recordPromotion,
  recordTopCosine, recordTopRrf, readDailyCounters,
};

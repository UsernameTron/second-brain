'use strict';

/**
 * daily-stats.js
 *
 * Storage substrate for daily measurement rows in briefings/daily-stats.md.
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
  'recall_hits',
  'echo_shown',
  'echo_score',
  'vault_hygiene',
];

// ── Vault hygiene ─────────────────────────────────────────────────────────────

/**
 * Files allowed to sit at the vault root. Everything else there is drift.
 * (Dotfiles — .obsidian, .DS_Store — are skipped separately.)
 */
const ROOT_FILE_ALLOWLIST = ['CLAUDE.md'];

/**
 * Count structural drift at the vault root: loose files that belong in a folder,
 * plus top-level folders on neither the LEFT nor RIGHT list.
 *
 * vault-gateway can only block writes that route through it — Cowork sessions,
 * Obsidian, and scheduled agents elsewhere write straight to disk. Counting the
 * drift daily is what makes it visible within a day instead of a month.
 *
 * @param {object} [opts={}] - { vaultRoot, vaultPaths } for testability
 * @returns {number} loose root files + unlisted top-level folders
 */
function computeVaultHygiene(opts = {}) {
  const vaultRoot = opts.vaultRoot || require('./vault-gateway').VAULT_ROOT;
  const vaultPaths = opts.vaultPaths || require('./pipeline-infra').safeLoadVaultPaths();

  // Nested entries ("proposals/unrouted") only ever grant their top segment a home.
  const known = new Set(
    [...(vaultPaths.left || []), ...(vaultPaths.right || [])].map(p => p.split('/')[0])
  );

  let count = 0;
  for (const entry of fs.readdirSync(vaultRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (!known.has(entry.name)) count++;
    } else if (!ROOT_FILE_ALLOWLIST.includes(entry.name)) {
      count++;
    }
  }
  return count;
}

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
      const cell = cells[i];
      const asNum = Number(cell);
      row[columns[i]] = (cell !== '' && Number.isFinite(asNum)) ? asNum : cell;
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
 * @param {string} relativePath - Vault-relative path (e.g., "briefings/daily-stats.md")
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
 * @returns {void}
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
    recall_hits: stats.recallHits !== undefined ? stats.recallHits : 0,
    echo_shown: fmtOptional(stats.echoShown !== undefined ? stats.echoShown : null),
    echo_score: (stats.echoScore !== undefined && stats.echoScore !== null)
      ? Number(stats.echoScore).toFixed(2)
      : '\u2014',
    // Measured at write time unless the caller supplies it. Backfilled past days pass
    // null, because today's root clutter says nothing about last Tuesday's.
    vault_hygiene: fmtOptional(
      stats.hygieneCount !== undefined
        ? stats.hygieneCount
        : (() => { try { return computeVaultHygiene(); } catch (_) { return null; } })()
    ),
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
  recallHits: 0,
  echoShown: 0,
  echoScore: 0,
  confidenceSum: 0,
  confidenceCount: 0,
  topCosineScores: [],
  topRrfScores: [],
};

/**
 * Resolve the cache directory for counter files.
 * Precedence: CACHE_DIR_OVERRIDE > jest temp dir (JEST_WORKER_ID) > ~/.cache/second-brain.
 * The jest branch keeps the real user cache clean when tests call record*() without an override.
 * @returns {string}
 */
function _cacheDir() {
  if (process.env.CACHE_DIR_OVERRIDE) return process.env.CACHE_DIR_OVERRIDE;
  if (process.env.JEST_WORKER_ID) {
    return path.join(os.tmpdir(), 'second-brain-jest', String(process.env.JEST_WORKER_ID));
  }
  return path.join(os.homedir(), '.cache', 'second-brain');
}

/**
 * Resolve the counter file path for a given date.
 * Honors CACHE_DIR_OVERRIDE for test isolation.
 * @param {Date} now
 * @returns {string} absolute path to daily-counters-YYYY-MM-DD.json
 */
function _counterPath(now) {
  return path.join(_cacheDir(), `daily-counters-${dateKey(now)}.json`);
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
 * @returns {void}
 */
function recordRecallInvocation(opts = {}) {
  try {
    const now = opts.now || new Date();
    const state = _readCounters(now);
    state.recallCount = (state.recallCount || 0) + 1;
    if (opts.hit) state.recallHits = (state.recallHits || 0) + 1;
    state.date = dateKey(now);
    _writeCounters(now, state);
  } catch (_) { /* non-fatal */ }
}

/**
 * Record whether Memory Echo was shown in today's /today run, and its top score.
 * Overwrites (not accumulates) — one /today invocation per day is the norm (D-05).
 * @param {boolean} shown - whether the Memory Echo section rendered
 * @param {number} score - top echo score (0 when not shown or invalid)
 * @param {object} [opts={}] - { now: Date }
 * @returns {void}
 */
function recordEchoShown(shown, score, opts = {}) {
  try {
    const now = opts.now || new Date();
    const state = _readCounters(now);
    state.echoShown = shown ? 1 : 0;
    state.echoScore = (typeof score === 'number' && Number.isFinite(score)) ? score : 0;
    state.date = dateKey(now);
    _writeCounters(now, state);
  } catch (_) { /* non-fatal */ }
}

/**
 * Add count to today's proposals tally.
 * @param {number} count - number of new proposals written this batch
 * @param {object} [opts={}] - { now: Date }
 * @returns {void}
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
 * @returns {void}
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
 * @returns {void}
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
 * @returns {void}
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
 * Returns { proposals, promotions, recallCount, recallHits, echoShown, echoScore, avgConfidence }
 * with zeros/null defaults.
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
      recallHits: state.recallHits || 0,
      echoShown: state.echoShown || 0,
      echoScore: state.echoScore || 0,
      avgConfidence: (state.confidenceCount > 0)
        ? state.confidenceSum / state.confidenceCount
        : null,
    };
  } catch (_) {
    return {
      proposals: 0, promotions: 0, recallCount: 0,
      recallHits: 0, echoShown: 0, echoScore: 0,
      avgConfidence: null,
    };
  }
}

/**
 * Delete counter files whose date is older than retentionDays before `now`.
 * @param {Date} now
 * @param {string} cacheDir
 * @param {number} [retentionDays=14]
 */
function _cleanupOldCounters(now, cacheDir, retentionDays = 14) {
  const cutoffKey = dateKey(new Date(now.getTime() - retentionDays * 86400000));
  let files;
  try { files = fs.readdirSync(cacheDir); } catch (_) { return; }
  for (const f of files) {
    const m = f.match(/^daily-counters-(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && m[1] < cutoffKey) {
      try { fs.unlinkSync(path.join(cacheDir, f)); } catch (_) { /* best-effort */ }
    }
  }
}

/**
 * Flush counters from past days that never produced a daily-stats row.
 * Idempotent: recordDailyStats dedupes by date, so re-running is safe.
 * total_entries / memory_kb use current state (caller-supplied); avg_latency_ms is '—'.
 * After flushing, prunes counter files older than ~14 days.
 * Never throws — stats failure must not break /today.
 * @param {object} [opts={}] - { now?: Date, totalEntries?: number, memoryKb?: number, configOverride?: object }
 */
function flushMissedDays(opts = {}) {
  try {
    const now = opts.now || new Date();
    const todayKey = dateKey(now);
    const cacheDir = _cacheDir();

    const config = opts.configOverride
      || require('./pipeline-infra').loadConfigWithOverlay('pipeline', { validate: true });
    if (!config.stats || !config.stats.enabled) return;

    const { VAULT_ROOT } = require('./vault-gateway');
    const absStatsPath = path.join(VAULT_ROOT, config.stats.path);
    const { rows } = readDailyStats(absStatsPath);
    const existingDates = new Set(rows.map(r => r.date));

    let files;
    try { files = fs.readdirSync(cacheDir); } catch (_) { return; }
    for (const f of files) {
      const m = f.match(/^daily-counters-(\d{4}-\d{2}-\d{2})\.json$/);
      if (!m) continue;
      const dateStr = m[1];
      if (dateStr >= todayKey) continue;        // only strictly past days
      if (existingDates.has(dateStr)) continue; // already flushed (idempotent)

      let state;
      try { state = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8')); } catch (_) { continue; }
      const avgConfidence = (state.confidenceCount > 0)
        ? state.confidenceSum / state.confidenceCount : null;

      recordDailyStats({
        proposals: state.proposals || 0,
        promotions: state.promotions || 0,
        totalEntries: opts.totalEntries ?? 0,
        memoryKb: opts.memoryKb ?? 0,
        recallCount: state.recallCount || 0,
        recallHits: state.recallHits || 0,
        echoShown: state.echoShown || 0,
        echoScore: state.echoScore || 0,
        avgLatencyMs: null, // renders as em dash
        avgConfidence,
        hygieneCount: null, // unknowable for a past day — em dash, not today's count
      }, { now: new Date(dateStr + 'T12:00:00.000Z'), configOverride: opts.configOverride });
    }

    _cleanupOldCounters(now, cacheDir);
  } catch (_) { /* non-fatal — briefing-is-the-product */ }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  recordDailyStats, dateKey, readDailyStats,
  recordRecallInvocation, recordProposalsBatch, recordPromotion,
  recordTopCosine, recordTopRrf, recordEchoShown, readDailyCounters,
  flushMissedDays, computeVaultHygiene,
};

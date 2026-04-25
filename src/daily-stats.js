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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { recordDailyStats, dateKey, readDailyStats };

'use strict';
/**
 * src/today/compounding-trend.js
 *
 * Pure trend engine for Phase 31 (Prove Compounding). Turns a daily-stats row
 * series into supply/demand/utility metrics and a compounding | flat |
 * insufficient-data verdict, plus a markdown renderer for the same object.
 * No file/network I/O — both the /today section and the CLI surface consume
 * the exact same logic, guaranteeing an identical verdict for the same rows.
 *
 * Threshold semantics: these thresholds (entries +5, kb growth, recall used
 * on >=40% of days, aggregate hit rate >=60%, week-2 hit rate >= week-1 -
 * 10pts) are Pete's accepted values (2026-07-15) tuned for the FULL 14-row
 * window. A verdict computed on 7-13 rows is PROVISIONAL/DIRECTIONAL, not
 * binding -- e.g. a +5-entries floor over 7 days is a materially steeper bar
 * than over 14, biasing short windows toward `flat`. That is an honest
 * outcome; the binding verdict is calendar-gated to 14 rows (VERDICT-01
 * follow-up). The verdict object itself is unchanged at 7-13 rows -- the
 * provisional caveat is surfaced only in the rendered report, so the honesty
 * is user-visible.
 *
 * Requirements: TREND-01, TREND-02
 * @module today/compounding-trend
 */

/**
 * Coerce a potentially missing/empty value (including the em-dash '—' used
 * for unset numeric cells) to a number. Returns 0 when not finite.
 *
 * @param {*} val
 * @returns {number}
 */
function _num(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute the aggregate recall_hits/recall_count rate over a row slice.
 * Returns 0 when the slice's recall_count sum is 0 (avoids divide-by-zero).
 *
 * @param {Array<object>} slice
 * @returns {number}
 */
function _rate(slice) {
  const hits = slice.reduce((sum, r) => sum + _num(r.recall_hits), 0);
  const recalls = slice.reduce((sum, r) => sum + _num(r.recall_count), 0);
  return recalls > 0 ? hits / recalls : 0;
}

/**
 * Compute the compounding-trend verdict from daily-stats rows.
 * Pure -- no I/O. Windows by ROW COUNT (missed days are gaps, not zeros).
 *
 * @param {Array<object>} rows - parsed from readDailyStats(), ascending date order
 * @param {object} [opts]
 * @param {number} [opts.windowDays=14] - number of trailing rows to evaluate
 * @returns {{verdict: string, windowDays: number, rowCount: number, metrics: object|null, rows: Array<object>}}
 */
function computeCompoundingTrend(rows, opts = {}) {
  const windowDays = opts.windowDays || 14;
  const safeRows = Array.isArray(rows) ? rows : [];
  const windowRows = safeRows.slice(-windowDays);

  if (windowRows.length < 7) {
    return { verdict: 'insufficient-data', windowDays, rowCount: windowRows.length, metrics: null, rows: windowRows };
  }

  // ── SUPPLY (memory growing) ────────────────────────────────────────────
  const first = windowRows[0];
  const last = windowRows[windowRows.length - 1];
  const entriesDelta = _num(last.total_entries) - _num(first.total_entries);
  const kbDelta = _num(last.memory_kb) - _num(first.memory_kb);
  const supplyOk = entriesDelta >= 5 && kbDelta > 0;

  // ── DEMAND (recall used) ───────────────────────────────────────────────
  const daysWithRecall = windowRows.filter(r => _num(r.recall_count) > 0).length;
  const recallDayFraction = daysWithRecall / windowRows.length;
  const demandOk = recallDayFraction >= 0.40;

  // ── UTILITY (recall returns value) ─────────────────────────────────────
  const totalHits = windowRows.reduce((sum, r) => sum + _num(r.recall_hits), 0);
  const totalRecalls = windowRows.reduce((sum, r) => sum + _num(r.recall_count), 0);
  const hitRate = totalRecalls > 0 ? totalHits / totalRecalls : 0;
  const hitOk = hitRate >= 0.60;

  const mid = Math.floor(windowRows.length / 2);
  const week1 = windowRows.slice(0, mid);
  const week2 = windowRows.slice(mid);
  const week1HitRate = _rate(week1);
  const week2HitRate = _rate(week2);
  const trendOk = week2HitRate >= week1HitRate - 0.10;

  const utilityOk = hitOk && trendOk;

  const verdict = (supplyOk && demandOk && utilityOk) ? 'compounding' : 'flat';

  return {
    verdict,
    windowDays,
    rowCount: windowRows.length,
    metrics: {
      supply: { entriesDelta, kbDelta, ok: supplyOk },
      demand: { daysWithRecall, totalDays: windowRows.length, recallDayFraction, ok: demandOk },
      utility: { totalHits, totalRecalls, hitRate, week1HitRate, week2HitRate, hitOk, trendOk, ok: utilityOk },
    },
    rows: windowRows,
  };
}

// ── Evidence table columns (fixed order) ─────────────────────────────────────
const EVIDENCE_COLUMNS = ['date', 'total_entries', 'memory_kb', 'recall_count', 'recall_hits', 'echo_shown', 'echo_score'];

/**
 * Render a GFM pipe table for the evidence columns from windowed rows.
 * Renders '—' (or any value) as-is via String(); always renders, even at
 * insufficient-data.
 *
 * @param {Array<object>} rows
 * @returns {string}
 */
function _renderEvidenceTable(rows) {
  const header = '| ' + EVIDENCE_COLUMNS.join(' | ') + ' |';
  const separator = '| ' + EVIDENCE_COLUMNS.map(() => '---').join(' | ') + ' |';
  const dataRows = rows.map(r => '| ' + EVIDENCE_COLUMNS.map(col => String(r[col])).join(' | ') + ' |');
  return [header, separator, ...dataRows].join('\n');
}

/**
 * Render a trend object (from computeCompoundingTrend) as a markdown body
 * string (no `##` heading -- caller adds it). Pure -- no I/O.
 *
 * @param {object} trend - object returned by computeCompoundingTrend
 * @returns {string} markdown body
 */
function renderCompoundingReport(trend) {
  const parts = [];

  // ── Verdict line ──────────────────────────────────────────────────────
  let verdictLine = `**Verdict: ${trend.verdict}**`;
  if (trend.verdict === 'insufficient-data') {
    verdictLine += ` (${trend.rowCount} of 7 rows required)`;
  } else if (trend.rowCount < 14) {
    verdictLine += ` (provisional — ${trend.rowCount} of 14 rows)`;
  }
  parts.push(verdictLine);

  // ── Metrics summary (only when metrics is present) ───────────────────
  if (trend.metrics) {
    const { supply, demand, utility } = trend.metrics;
    const { entriesDelta, kbDelta } = supply;
    const bullets = [
      `- ${supply.ok ? '✓' : '✗'} Supply: entries +${entriesDelta}, memory_kb ${kbDelta >= 0 ? '+' : ''}${kbDelta}`,
      `- ${demand.ok ? '✓' : '✗'} Demand: recall used ${demand.daysWithRecall}/${demand.totalDays} days (${Math.round(demand.recallDayFraction * 100)}%)`,
      `- ${utility.ok ? '✓' : '✗'} Utility: hit rate ${Math.round(utility.hitRate * 100)}% (wk1 ${Math.round(utility.week1HitRate * 100)}% -> wk2 ${Math.round(utility.week2HitRate * 100)}%)`,
    ];
    parts.push(bullets.join('\n'));
  }

  // ── Evidence table (always rendered) ──────────────────────────────────
  parts.push(_renderEvidenceTable(trend.rows));

  return parts.join('\n\n');
}

module.exports = { computeCompoundingTrend, renderCompoundingReport };

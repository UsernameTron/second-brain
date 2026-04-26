'use strict';
/**
 * src/today/memory-health.js
 *
 * Anomaly detector for memory health. Reads parsed daily-stats rows and
 * returns a markdown body when any anomaly is detected, or null when
 * everything is normal. The null return suppresses the ## Memory Health
 * section entirely (following the Memory Echo precedent from Phase 18).
 *
 * Requirement: AGENT-MEMORY-01
 * @module today/memory-health
 */

/**
 * Coerce a potentially missing/empty value to a number.
 * Returns Number(val) when valid, otherwise 0.
 * Handles undefined, empty string, null, NaN.
 *
 * @param {*} val
 * @returns {number}
 */
function _num(val) {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

/**
 * Compute memory health verdict from daily-stats rows.
 * Returns null when no anomaly is detected (section is suppressed).
 * Returns a markdown string body when any anomaly condition is met.
 *
 * Anomaly conditions checked (all against the last `streakDays` rows):
 *   1. Zero-promotion streak: every row has promotions === 0
 *   2. Backlog growth trend: proposals strictly increase AND no promotions
 *   3. Recall usage drop: every row has recall_count === 0
 *   4. Vault plateau: total_entries unchanged across all tail rows
 *
 * @param {Array<object>} rows - parsed from readDailyStats(), ascending date order
 * @param {object|null} thresholds - from config.memoryHealth
 * @param {boolean} [thresholds.enabled=true]
 * @param {number} [thresholds.streakDays=3]
 * @returns {string|null} markdown body string or null
 */
function computeMemoryHealth(rows, thresholds) {
  // Guard: disabled config or null thresholds
  if (!thresholds || thresholds.enabled === false) {
    return null;
  }

  const streak = (thresholds && thresholds.streakDays) || 3;

  // Guard: not enough history to detect a trend
  if (!rows || rows.length < streak) {
    return null;
  }

  // Take the last `streak` rows (tail slice — most recent data)
  const tail = rows.slice(-streak);

  const alerts = [];

  // ── Condition 1: Zero-promotion streak ───────────────────────────────────
  // Every row in tail has promotions === 0
  const allZeroPromotions = tail.every(row => _num(row.promotions) === 0);
  if (allZeroPromotions) {
    alerts.push(`zero-promotion`);
  }

  // ── Condition 2: Backlog growth trend ────────────────────────────────────
  // proposals strictly increases across ALL consecutive pairs in tail
  // AND no row in tail has promotions > 0
  const noPromotions = tail.every(row => _num(row.promotions) === 0);
  let proposalsStrictlyIncreasing = true;
  for (let i = 1; i < tail.length; i++) {
    if (_num(tail[i].proposals) <= _num(tail[i - 1].proposals)) {
      proposalsStrictlyIncreasing = false;
      break;
    }
  }
  // Only flag backlog growth if zero-promotion streak is not already flagged
  // (to avoid double-counting the same root cause with slightly different signals)
  if (proposalsStrictlyIncreasing && noPromotions && !allZeroPromotions) {
    alerts.push(`backlog-growth`);
  } else if (proposalsStrictlyIncreasing && noPromotions && allZeroPromotions) {
    // If proposals are also strictly increasing while promotions are zero,
    // replace zero-promotion with the more specific backlog-growth signal
    // but keep zero-promotion as primary — backlog-growth adds extra context.
    // Per spec: multiple anomalies may both be reported. Keep zero-promotion.
    // Backlog growth is implied by zero-promotion + growing proposals.
    // Decision: report backlog-growth separately when proposals strictly increase.
    alerts.push(`backlog-growth`);
  }

  // ── Condition 3: Recall usage drop ───────────────────────────────────────
  // Every row in tail has recall_count === 0
  const allZeroRecall = tail.every(row => _num(row.recall_count) === 0);
  if (allZeroRecall) {
    alerts.push(`recall-drop`);
  }

  // ── Condition 4: Vault plateau ───────────────────────────────────────────
  // total_entries is identical across all tail rows
  const firstEntries = _num(tail[0].total_entries);
  const allSameEntries = tail.every(row => _num(row.total_entries) === firstEntries);
  if (allSameEntries) {
    alerts.push(`vault-plateau`);
  }

  // ── Return null when no anomalies ────────────────────────────────────────
  if (alerts.length === 0) {
    return null;
  }

  // ── Build markdown body ───────────────────────────────────────────────────
  const conditionDescriptions = {
    'zero-promotion': `zero promotions: Zero memory promotions for ${streak} consecutive days`,
    'backlog-growth': `backlog growth: Memory proposal backlog growing without promotions`,
    'recall-drop': `recall usage: No /recall usage for ${streak} consecutive days`,
    'vault-plateau': `vault plateau: Vault entry count unchanged for ${streak} consecutive days (${firstEntries} entries)`,
  };

  const bulletLines = alerts.map(a => `- ${conditionDescriptions[a]}`).join('\n');

  return [
    `**Anomalies detected** (last ${streak} days):`,
    '',
    bulletLines,
    '',
    'Review `daily-stats.md` and consider running `/promote-memories` or `/recall` to re-engage the memory pipeline.',
  ].join('\n');
}

module.exports = { computeMemoryHealth };

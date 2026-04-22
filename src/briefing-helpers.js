'use strict';

/**
 * briefing-helpers.js
 *
 * Data-access functions for /today briefing sections (D-67).
 * These provide the pipeline state data that Phase 4's /today command consumes.
 *
 * @module briefing-helpers
 */

const fs = require('fs');
const path = require('path');

const { readProposals } = require('./memory-proposals');

// ── Constants ────────────────────────────────────────────────────────────────

const VAULT_ROOT = process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');
const UNROUTED_DIR = () => path.join(VAULT_ROOT, 'proposals', 'unrouted');
const DEAD_LETTER_WARNING_THRESHOLD = 10; // D-38

// ── Frontmatter parser (minimal) ────────────────────────────────────────────

function parseFrontmatterStatus(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\S+):\s+(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

// ── getProposalsPendingCount ─────────────────────────────────────────────────

/**
 * Count pending memory candidates in memory-proposals.md.
 * Returns 0 when file is missing or contains no pending candidates.
 *
 * @returns {Promise<number>}
 */
async function getProposalsPendingCount() {
  try {
    const candidates = await readProposals();
    return candidates.filter((c) => c.status === 'pending').length;
  } catch (_) {
    return 0;
  }
}

// ── getDeadLetterSummary ─────────────────────────────────────────────────────

/**
 * Summarize dead-letter state in proposals/unrouted/.
 * Counts pending (status: unrouted) and frozen files.
 * Sets warning flag when total exceeds threshold (D-38).
 *
 * @returns {Promise<{ pending: number, frozen: number, total: number, warning: boolean }>}
 */
async function getDeadLetterSummary() {
  const dir = UNROUTED_DIR();
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch (_) {
    return { pending: 0, frozen: 0, total: 0, warning: false };
  }

  let pending = 0;
  let frozen = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      const fields = parseFrontmatterStatus(content);
      if (fields.status === 'frozen') {
        frozen++;
      } else {
        pending++;
      }
    } catch (_) {
      // Skip unreadable files
    }
  }

  const total = pending + frozen;
  return { pending, frozen, total, warning: total > DEAD_LETTER_WARNING_THRESHOLD };
}

// ── formatBriefingSection ────────────────────────────────────────────────────

/**
 * Format a briefing text block for /today output.
 * Returns empty string when there's nothing to report (omit section per D-67).
 *
 * @param {'proposals'|'deadletter'} type - Section type
 * @param {object} data - Data from getProposalsPendingCount or getDeadLetterSummary
 * @returns {string}
 */
function formatBriefingSection(type, data) {
  if (type === 'proposals') {
    if (!data.count || data.count === 0) return '';
    return `Memory proposals pending: ${data.count} awaiting review`;
  }

  if (type === 'deadletter') {
    if (!data.total || data.total === 0) return '';
    let line = `Unrouted: ${data.pending} pending, ${data.frozen} frozen (3+ retry failures)`;
    if (data.warning) {
      line = `WARNING: ${data.total} unrouted captures need attention\n${line}`;
    }
    return line;
  }

  return '';
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getProposalsPendingCount,
  getDeadLetterSummary,
  formatBriefingSection,
};

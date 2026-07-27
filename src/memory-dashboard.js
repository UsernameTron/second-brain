'use strict';

/**
 * memory-dashboard.js — human-readable view of the compounding memory layer.
 *
 * Regenerated whole on every real promotion. `memory/memory.md` stays the source
 * of truth; this file is a derived read surface for Obsidian, so it deliberately
 * carries no content_hash values, block anchors, or other pipeline bookkeeping —
 * the things that make memory.md unreadable to a human scrolling the vault.
 *
 * Exports:
 *   - renderDashboard(entries, meta): pure render, no I/O
 *   - writeMemoryDashboard(opts): read memory.md + proposals, write memory/dashboard.md
 *
 * @module memory-dashboard
 */

const DASHBOARD_PATH = 'memory/dashboard.md';
const RECENT_LIMIT = 10;
const SUMMARY_MAX = 120;

/**
 * Sort key for "most recently promoted": the added:: stamp when present, else the
 * entry's own date. Both are lexicographically sortable (ISO-8601 / YYYY-MM-DD).
 *
 * @param {object} entry
 * @returns {string}
 */
function _recencyKey(entry) {
  return entry.addedAt || entry.date || '';
}

/**
 * First sentence-ish of an entry, collapsed to one line and capped.
 *
 * @param {string} content
 * @returns {string}
 */
function _summarize(content) {
  const oneLine = String(content || '').replace(/\s+/g, ' ').trim();
  if (oneLine.length <= SUMMARY_MAX) return oneLine;
  return oneLine.slice(0, SUMMARY_MAX - 1).trimEnd() + '…';
}

/**
 * Render the dashboard markdown. Pure — every input is supplied by the caller.
 *
 * @param {Array<object>} entries - Parsed memory entries (memory-reader shape)
 * @param {object} [meta={}] - { pendingProposals: number, generatedAt: Date }
 * @returns {string} Full file content
 */
function renderDashboard(entries, meta = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const generatedAt = meta.generatedAt || new Date();
  const pending = meta.pendingProposals ?? 0;

  const byRecency = [...list].sort((a, b) => _recencyKey(b).localeCompare(_recencyKey(a)));
  const lastPromotion = byRecency.length > 0 ? _recencyKey(byRecency[0]) : null;

  const counts = new Map();
  for (const e of list) {
    const cat = e.category || 'UNCATEGORIZED';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  const sortedCounts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const lines = [
    '# Memory Dashboard',
    '',
    `> Generated ${generatedAt.toISOString()} from \`memory/memory.md\`. Regenerated on every promotion — edit memory.md, not this file.`,
    '',
    '## At a glance',
    '',
    `- **Entries:** ${list.length}`,
    `- **Pending proposals:** ${pending}`,
    `- **Last promotion:** ${lastPromotion || 'never'}`,
    '',
    '## Categories',
    '',
  ];

  if (sortedCounts.length === 0) {
    lines.push('_No entries yet._');
  } else {
    lines.push('| Category | Entries |', '| --- | --- |');
    for (const [cat, n] of sortedCounts) lines.push(`| ${cat} | ${n} |`);
  }

  lines.push('', `## Last ${RECENT_LIMIT} promoted`, '');

  const recent = byRecency.slice(0, RECENT_LIMIT);
  if (recent.length === 0) {
    lines.push('_No entries yet._');
  } else {
    for (const e of recent) {
      const when = (e.addedAt || e.date || '').slice(0, 10) || 'undated';
      lines.push(`- **${when}** · ${e.category || 'UNCATEGORIZED'} — ${_summarize(e.content)}`);
    }
  }

  lines.push('', '---', '', 'Query memory directly: `node ~/projects/second-brain/scripts/recall.js "<query>" --hybrid`');

  return lines.join('\n') + '\n';
}

/**
 * Regenerate memory/dashboard.md from current memory.md + proposal state.
 * Writes through vault-gateway's atomic writer (Pattern 11 — the boundary check
 * lives in the gateway, not here).
 *
 * @param {object} [opts={}] - { entries, pendingProposals, now } for testability
 * @returns {Promise<{ success: boolean, path: string, entries: number, error?: string }>}
 */
async function writeMemoryDashboard(opts = {}) {
  const { vaultWriteAtomic } = require('./vault-gateway');

  let entries = opts.entries;
  if (!entries) {
    const { readMemory } = require('./memory-reader');
    entries = await readMemory();
  }

  let pendingProposals = opts.pendingProposals;
  if (pendingProposals === undefined) {
    const { getProposalsPendingCount } = require('./briefing-helpers');
    pendingProposals = await getProposalsPendingCount();
  }

  const content = renderDashboard(entries, {
    pendingProposals,
    generatedAt: opts.now || new Date(),
  });

  vaultWriteAtomic(DASHBOARD_PATH, content);
  return { success: true, path: DASHBOARD_PATH, entries: entries.length };
}

module.exports = { renderDashboard, writeMemoryDashboard, DASHBOARD_PATH };

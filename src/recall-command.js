'use strict';

/**
 * recall-command.js
 *
 * /recall command: query the compounding memory layer.
 *
 * @module recall-command
 */

const { searchMemoryKeyword } = require('./memory-reader');
const { sourceRefShort } = require('./utils/memory-utils');

/**
 * Parse process.argv-style flags for /recall.
 * @param {string[]} argv - argv slice starting AFTER the command name
 * @returns {{ query: string, flags: { category: string|null, since: string|null, top: number, semantic: boolean, hybrid: boolean } }}
 */
function parseRecallArgs(argv) {
  const flags = { category: null, since: null, top: 5, semantic: false, hybrid: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--category' && i + 1 < argv.length) {
      flags.category = argv[++i];
    } else if (tok === '--since' && i + 1 < argv.length) {
      flags.since = argv[++i];
    } else if (tok === '--top' && i + 1 < argv.length) {
      const parsed = parseInt(argv[++i], 10);
      flags.top = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
    } else if (tok === '--semantic') {
      flags.semantic = true;
    } else if (tok === '--hybrid') {
      flags.hybrid = true;
    } else if (!tok.startsWith('--')) {
      positional.push(tok);
    }
  }
  const raw = positional.join(' ');
  const query = raw.replace(/^["']|["']$/g, '');
  return { query, flags };
}

/**
 * Run a /recall invocation: parses argv, dispatches to keyword / semantic /
 * hybrid search, increments daily-stats counters, and renders display lines
 * (including degraded-mode banners and blocked-policy reasons).
 * @param {string[]} argv - Argv slice starting AFTER the command name.
 * @param {Object} [options] - Internal call options.
 * @param {boolean} [options._internal=false] - When true, suppresses the
 *   `recall_count` daily-stats increment (used by Memory Echo's morning hit).
 * @returns {Promise<{ query: string, mode: string, results: Array<{rank: number, category: string, snippet: string, sourceRef: string, date: string, score: number}>, total: number, lines: string[], empty: boolean, degraded: boolean, degradedBanner: string|null, blocked: boolean, blockedReason: string|null }>} Recall result envelope.
 */
async function runRecall(argv, options = {}) {
  const { query, flags } = parseRecallArgs(argv);
  let hits = [];
  let mode = 'keyword';
  let degraded = false;
  let degradedBanner = null;
  let blocked = false;
  let blockedReason = null;

  // D-04: Increment recall_count for every explicit /recall invocation.
  // Internal callers (e.g. Memory Echo in getMemoryEcho()) pass { _internal: true }
  // to suppress the counter — Memory Echo's automatic morning hit is NOT counted.
  // Memory Echo calls searchMemoryKeyword/semanticSearch directly and does NOT
  // call runRecall at all, so D-04 is naturally satisfied even without the flag.
  // The flag provides an explicit gate for any future internal callers.
  if (!options._internal) {
    try {
      const { recordRecallInvocation } = require('./daily-stats');
      recordRecallInvocation();
    } catch (_) { /* briefing-is-the-product: never break recall on stats failure */ }
  }

  try {
    if (flags.hybrid) {
      const { hybridSearch } = require('./semantic-index');
      const res = await hybridSearch(query, { category: flags.category, since: flags.since, top: flags.top });
      if (res.blocked) {
        blocked = true;
        blockedReason = res.reason;
      } else {
        hits = res.results || [];
        if (res.degraded) {
          degraded = true;
          degradedBanner = '(hybrid unavailable — using keyword only)';
        }
        mode = res.mode || (res.degraded ? 'keyword (hybrid unavailable)' : 'hybrid');
        // D-07: Emit top-1 RRF score (emit-only — not surfaced in stats columns this phase).
        if (hits.length > 0) {
          try {
            const { recordTopRrf } = require('./daily-stats');
            recordTopRrf(hits[0].rrfScore);
          } catch (_) { /* briefing-is-the-product: never break --hybrid on stats failure */ }
        }
      }
    } else if (flags.semantic) {
      const { semanticSearch } = require('./semantic-index');
      const res = await semanticSearch(query, { category: flags.category, since: flags.since, top: flags.top });
      if (res.blocked) {
        blocked = true;
        blockedReason = res.reason;
      } else if (res.degraded) {
        degraded = true;
        degradedBanner = '(semantic unavailable — using keyword only)';
        mode = 'keyword (semantic unavailable)';
        // Fall back to keyword so the user still gets useful output (MEM-DEGRADE-01)
        const kw = await searchMemoryKeyword(query, { category: flags.category, since: flags.since });
        hits = kw.slice(0, flags.top);
      } else {
        hits = res.results || [];
        mode = 'semantic';
      }
    } else {
      hits = await searchMemoryKeyword(query, { category: flags.category, since: flags.since });
      mode = 'keyword';
    }
  } catch (_) {
    // Never surface a crash for /recall — missing vault, parse error, etc.
    hits = [];
  }

  const topN = hits.slice(0, flags.top);
  const empty = topN.length === 0 && !blocked;
  // Keyword-only path (no flags): preserve byte-for-byte existing snippet behavior so legacy tests pass untouched.
  // Semantic / hybrid paths: fall back to content slice because semantic-index results don't carry a pre-computed snippet.
  const usedSemanticPath = flags.semantic || flags.hybrid;
  const results = topN.map((h, idx) => ({
    rank: idx + 1,
    category: h.category,
    snippet: usedSemanticPath ? (h.snippet || (h.content ? String(h.content).slice(0, 100) : '')) : h.snippet,
    sourceRef: h.sourceRef,
    date: h.date,
    score: h.score !== undefined ? h.score : (h.rrfScore !== undefined ? h.rrfScore : 0),
  }));

  const lines = [];
  if (degradedBanner) lines.push(degradedBanner);
  if (blocked) {
    lines.push(`(blocked: ${blockedReason || 'excluded-terms policy'})`);
  } else if (empty) {
    lines.push(`No results matching "${query}".`);
  } else {
    results.forEach(r => {
      lines.push(`${r.rank}. [${r.category}] ${r.snippet} (${sourceRefShort(r.sourceRef)})`);
    });
  }

  return { query, mode, results, total: topN.length, lines, empty, degraded, degradedBanner, blocked, blockedReason };
}

module.exports = { runRecall, parseRecallArgs };

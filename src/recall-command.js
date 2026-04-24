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
 * @returns {{ query: string, flags: { category: string|null, since: string|null, top: number } }}
 */
function parseRecallArgs(argv) {
  const flags = { category: null, since: null, top: 5 };
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
    } else if (!tok.startsWith('--')) {
      positional.push(tok);
    }
  }
  const raw = positional.join(' ');
  const query = raw.replace(/^["']|["']$/g, '');
  return { query, flags };
}

/**
 * Run a /recall invocation.
 * @param {string[]} argv
 * @returns {Promise<{ query: string, results: Array, total: number, lines: string[], empty: boolean }>}
 */
async function runRecall(argv) {
  const { query, flags } = parseRecallArgs(argv);
  let hits;
  try {
    hits = await searchMemoryKeyword(query, {
      category: flags.category,
      since: flags.since,
    });
  } catch (_) {
    // Never surface a crash for /recall — missing vault, parse error, etc.
    hits = [];
  }
  const topN = hits.slice(0, flags.top);
  const empty = topN.length === 0;
  const results = topN.map((h, idx) => ({
    rank: idx + 1,
    category: h.category,
    snippet: h.snippet,
    sourceRef: h.sourceRef,
    date: h.date,
    score: h.score,
  }));
  const lines = empty
    ? [`No results matching "${query}".`]
    : results.map((r) =>
        `${r.rank}. [${r.category}] ${r.snippet} (${sourceRefShort(r.sourceRef)})`
      );
  return { query, results, total: topN.length, lines, empty };
}

module.exports = { runRecall, parseRecallArgs };

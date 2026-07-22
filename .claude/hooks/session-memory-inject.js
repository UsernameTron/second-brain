#!/usr/bin/env node
'use strict';

/**
 * session-memory-inject.js
 *
 * Claude Code SessionStart hook (Phase 35, INJECT-HOOK-01/EGRESS-01/KILL-01).
 * Proactively injects a small, exclusion-gated digest of the most relevant
 * recalled memories into every new session's context. Never blocks a
 * session — always exits 0, even when recall/config/network fails.
 *
 * Registration in settings.json:
 * "hooks": {
 *   "SessionStart": [{ "hooks": [{ "command": "node .claude/hooks/session-memory-inject.js" }] }]
 * }
 */

const path = require('path');

/**
 * Pure, dependency-injected core. Never throws — every failure path returns
 * `{ text: '', skipped: true, reason }` instead.
 *
 * @param {object} deps
 * @param {Function} deps.runRecall - (argv, options) => Promise<recall envelope>
 * @param {Function} deps.checkContent - (content, excludedTerms) => Promise<verdict>
 * @param {Function} deps.loadExcludedTerms - () => string[]
 * @param {Function} deps.isDegraded - () => boolean
 * @param {object} deps.config - sessionInject config block
 * @param {string} deps.query - project-derived query string (never persisted)
 * @param {object} deps.env - process.env-like object
 * @returns {Promise<{ text: string, skipped: boolean, reason?: string, count?: number }>}
 */
async function buildSessionMemoryContext(deps) {
  if (deps.env.SB_SESSION_INJECT === '0') {
    return { text: '', skipped: true, reason: 'env override' };
  }
  if (!deps.config || deps.config.enabled === false) {
    return { text: '', skipped: true, reason: 'config disabled' };
  }

  const budgetMs = deps.isDegraded() ? deps.config.latencyDegradedMs : deps.config.latencyUpMs;

  const recallP = deps.runRecall([deps.query, '--hybrid', '--top', String(deps.config.topN)], { _internal: true });
  let timer;
  const timeoutP = new Promise(resolve => {
    timer = setTimeout(() => resolve({ __timeout: true }), budgetMs);
    if (timer.unref) timer.unref(); // never keep the process alive waiting on the loser of the race
  });

  let res;
  try {
    res = await Promise.race([recallP, timeoutP]);
  } catch (_) {
    clearTimeout(timer);
    return { text: '', skipped: true, reason: 'recall error' };
  }
  clearTimeout(timer);

  if (!res || res.__timeout) {
    return { text: '', skipped: true, reason: 'latency' };
  }
  if (res.blocked || res.empty || !res.results || res.results.length === 0) {
    return { text: '', skipped: true, reason: 'no results' };
  }

  const excludedTerms = deps.loadExcludedTerms();
  const capChars = deps.config.tokenCap * 4; // ponytail: chars/4 heuristic, not a real tokenizer
  const bullets = [];
  let used = 0;

  for (const r of res.results) {
    let verdict;
    try {
      verdict = await deps.checkContent(`${r.category} ${r.snippet}`, excludedTerms);
    } catch (_) {
      continue; // fail-closed on any throw
    }
    if (verdict.decision !== 'PASS') continue;

    const bullet = `- **${r.date} · ${r.category}** — ${r.snippet}`;
    if (used + bullet.length + 1 > capChars) break; // whole entries only, drop remainder
    bullets.push(bullet);
    used += bullet.length + 1;
  }

  if (bullets.length === 0) {
    return { text: '', skipped: true, reason: 'all excluded' };
  }

  const text = `## Recalled memory (proactive)\n\n${bullets.join('\n')}\n`;
  return { text, skipped: false, count: bullets.length };
}

if (require.main === module) {
  (async () => {
    try {
      require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

      const { runRecall } = require('../../src/recall-command');
      const { checkContent } = require('../../src/content-policy');
      const { loadExcludedTerms, loadConfigWithOverlay } = require('../../src/pipeline-infra');
      const { isDegraded } = require('../../src/utils/voyage-health');

      let config;
      try {
        config = loadConfigWithOverlay('pipeline', { validate: true }).sessionInject;
      } catch (_) {
        process.exit(0);
        return;
      }

      const query = path.basename(process.env.CLAUDE_PROJECT_DIR || process.cwd());

      const out = await buildSessionMemoryContext({
        runRecall,
        checkContent,
        loadExcludedTerms,
        isDegraded,
        config,
        query,
        env: process.env,
      });

      if (out.text) process.stdout.write(out.text);
      process.exit(0);
    } catch (_) {
      process.exit(0);
    }
  })();
}

module.exports = { buildSessionMemoryContext };

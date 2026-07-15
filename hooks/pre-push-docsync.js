#!/usr/bin/env node
'use strict';

/**
 * pre-push-docsync.js
 *
 * Pre-push hook: documentation drift gate (blocking).
 *
 * Reuses extractDocStats/compareStats/getLiveStats from post-merge-doc-sync.js
 * (no duplicated regexes). Blocks the push when CLAUDE.md/README.md stats have
 * drifted from live test/coverage output beyond config/docsync.json's
 * block_threshold_pct (test-count mismatch always blocks, any amount). Drift
 * at or below block_threshold_pct but above warn_threshold_pct warns without
 * blocking. A jest failure (getLiveStats returns null) never blocks a push.
 *
 * Escape hatch: SKIP_DOCSYNC=1 git push (enforced by hooks/pre-push, not here).
 *
 * Exports:
 *   evaluate(docStats, liveStats, config) -> { block, blockers, warnings }
 *   main()                                -> void (exit 1 on block, else exit 0)
 *
 * Requirement: REQ-SURF-02
 */

const fs = require('fs');
const path = require('path');
const { extractDocStats, compareStats, getLiveStats } = require('./post-merge-doc-sync');

const PROJECT_ROOT = path.join(__dirname, '..');

// ── evaluate ──────────────────────────────────────────────────────────────────

/**
 * Pure decision function: compare one doc's stats against live stats.
 *
 * @param {object} docStats  - stats parsed from a doc file via extractDocStats
 * @param {object} liveStats - live stats from getLiveStats
 * @param {{ block_threshold_pct?: number, warn_threshold_pct?: number }} config
 * @returns {{ block: boolean, blockers: string[], warnings: string[] }}
 */
function evaluate(docStats, liveStats, config) {
  const blockThreshold = typeof config.block_threshold_pct === 'number' ? config.block_threshold_pct : 3.0;
  const warnThreshold = typeof config.warn_threshold_pct === 'number' ? config.warn_threshold_pct : 1.0;

  const blockers = compareStats(docStats, liveStats, blockThreshold);
  const allDrift = compareStats(docStats, liveStats, warnThreshold);
  const warnings = allDrift.filter((v) => !blockers.includes(v));

  return { block: blockers.length > 0, blockers, warnings };
}

// ── main ──────────────────────────────────────────────────────────────────────

function main() {
  try {
    const configPath = path.join(PROJECT_ROOT, 'config', 'docsync.json');
    let config = { warn_threshold_pct: 1.0, block_threshold_pct: 3.0 };
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (_) {
      // Config missing or invalid — use defaults
    }

    const liveStats = getLiveStats(PROJECT_ROOT);
    if (!liveStats) {
      process.stderr.write('[pre-push] could not obtain live stats — skipping\n');
      process.exit(0);
    }

    const docs = [
      { name: 'CLAUDE.md', path: path.join(PROJECT_ROOT, 'CLAUDE.md') },
      { name: 'README.md', path: path.join(PROJECT_ROOT, 'README.md') },
    ];

    const allBlockers = [];
    const allWarnings = [];

    for (const doc of docs) {
      let text = '';
      try {
        text = fs.readFileSync(doc.path, 'utf8');
      } catch (_) {
        continue;
      }

      const docStats = extractDocStats(text);
      const { blockers, warnings } = evaluate(docStats, liveStats, config);
      for (const b of blockers) allBlockers.push(`${doc.name}: ${b}`);
      for (const w of warnings) allWarnings.push(`${doc.name}: ${w}`);
    }

    if (allBlockers.length > 0) {
      for (const b of allBlockers) {
        process.stderr.write(`[pre-push] BLOCKED: ${b}\n`);
      }
      process.stderr.write('[pre-push] Update CLAUDE.md/README.md stats, or bypass with: SKIP_DOCSYNC=1 git push\n');
      process.exit(1);
    }

    if (allWarnings.length > 0) {
      for (const w of allWarnings) {
        process.stderr.write(`[pre-push] WARNING: ${w}\n`);
      }
      process.exit(0);
    }

    process.stdout.write('[pre-push] documentation stats are current.\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[pre-push] Unexpected error: ${err.message}\n`);
    process.exit(0);
  }
}

module.exports = { evaluate, main };

if (require.main === module) {
  main();
}

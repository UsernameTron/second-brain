#!/usr/bin/env node
'use strict';

/**
 * post-merge-doc-sync.js
 *
 * Post-merge hook: documentation drift detection (non-blocking).
 *
 * Compares stat values declared in CLAUDE.md and README.md against live
 * jest/coverage output. Prints warnings to stderr when drift exceeds the
 * configured threshold. Always exits 0 — a documentation warning must never
 * block a merge.
 *
 * Exports:
 *   extractDocStats(text)             -> { testCount?, coverageStatements?, coverageBranches? }
 *   compareStats(docStats, liveStats, warnThreshold) -> string[]
 *   getLiveStats(projectRoot)         -> { testCount, coverageStatements, coverageBranches } | null
 *   main()                            -> void (reads docs, runs jest, prints drift)
 *
 * Requirement: HOOK-DOCSYNC-01
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');

// ── Regex patterns for stat extraction ───────────────────────────────────────

/** Matches: "1127 total" or "1,127 total across" — captures the raw number string */
const RE_TEST_COUNT = /(\d[\d,]*)\s+total(?:\s+across|\b)/i;

/** Matches: "Statements 94.62%" or "Statement 94.62%" */
const RE_STMT_PCT = /Statements?\s+([\d.]+)%/i;

/** Matches: "Branch 81.28%" or "Branches 82.00%" */
const RE_BRANCH_PCT = /Branch(?:es)?\s+([\d.]+)%/i;

// ── extractDocStats ───────────────────────────────────────────────────────────

/**
 * Parse documentation text and extract stat values.
 *
 * Returns only the stats that are present in the text — absent stats are
 * simply not included in the result object. Returns {} if no stats found.
 *
 * @param {string} text - raw markdown text from CLAUDE.md or README.md
 * @returns {{ testCount?: number, coverageStatements?: number, coverageBranches?: number }}
 */
function extractDocStats(text) {
  if (!text || typeof text !== 'string') return {};

  /** @type {{ testCount?: number, coverageStatements?: number, coverageBranches?: number }} */
  const stats = {};

  const countMatch = RE_TEST_COUNT.exec(text);
  if (countMatch) {
    // Remove commas before parsing (handles "1,127")
    stats.testCount = parseInt(countMatch[1].replace(/,/g, ''), 10);
  }

  const stmtMatch = RE_STMT_PCT.exec(text);
  if (stmtMatch) {
    stats.coverageStatements = parseFloat(stmtMatch[1]);
  }

  const branchMatch = RE_BRANCH_PCT.exec(text);
  if (branchMatch) {
    stats.coverageBranches = parseFloat(branchMatch[1]);
  }

  return stats;
}

// ── compareStats ──────────────────────────────────────────────────────────────

/**
 * Compare documented stats against live stats.
 *
 * testCount uses exact match (any difference is a violation regardless of
 * threshold). Coverage stats use warnThreshold — drift must exceed the
 * threshold to produce a violation.
 *
 * Null or undefined values in either side skip that stat (no crash).
 *
 * @param {object} docStats  - stats parsed from documentation
 * @param {object} liveStats - stats from live jest/coverage run
 * @param {number} warnThreshold - percentage drift that triggers a warning (e.g. 1.0 = 1%)
 * @returns {string[]} array of violation strings (empty = no drift)
 */
function compareStats(docStats, liveStats, warnThreshold) {
  const violations = [];

  // testCount: exact match required
  if (docStats.testCount != null && liveStats.testCount != null) {
    if (docStats.testCount !== liveStats.testCount) {
      const drift = Math.abs(docStats.testCount - liveStats.testCount);
      violations.push(
        `test count: doc states ${docStats.testCount}, actual is ${liveStats.testCount}, drift=${drift.toFixed(2)}`
      );
    }
  }

  // coverageStatements: threshold-based
  if (docStats.coverageStatements != null && liveStats.coverageStatements != null) {
    const drift = Math.abs(docStats.coverageStatements - liveStats.coverageStatements);
    if (drift > warnThreshold) {
      violations.push(
        `statement coverage: doc states ${Number(docStats.coverageStatements).toFixed(2)}, actual is ${Number(liveStats.coverageStatements).toFixed(2)}, drift=${drift.toFixed(2)}`
      );
    }
  }

  // coverageBranches: threshold-based
  if (docStats.coverageBranches != null && liveStats.coverageBranches != null) {
    const drift = Math.abs(docStats.coverageBranches - liveStats.coverageBranches);
    if (drift > warnThreshold) {
      violations.push(
        `branch coverage: doc states ${Number(docStats.coverageBranches).toFixed(2)}, actual is ${Number(liveStats.coverageBranches).toFixed(2)}, drift=${drift.toFixed(2)}`
      );
    }
  }

  return violations;
}

// ── getLiveStats ──────────────────────────────────────────────────────────────

/**
 * Run jest with coverage and extract live stats.
 *
 * Uses execFileSync (not execSync) for security — no shell interpolation.
 * Cleans up temp file in all cases (success + failure).
 * Returns null on any failure — the hook must never block a merge.
 *
 * @param {string} projectRoot - absolute path to project root
 * @returns {{ testCount: number, coverageStatements: number, coverageBranches: number } | null}
 */
function getLiveStats(projectRoot) {
  const tmpOut = path.join(os.tmpdir(), `jest-output-${Date.now()}.json`);

  try {
    execFileSync(
      'npx',
      ['jest', '--coverage', '--json', `--outputFile=${tmpOut}`, '--silent', '--forceExit'],
      {
        cwd: projectRoot,
        timeout: 60000,
        stdio: ['ignore', 'ignore', 'ignore'],
      }
    );
  } catch (_) {
    // Jest may exit non-zero if tests fail — that is fine, we still read the output
  }

  try {
    /** @type {{ testCount?: number, coverageStatements?: number, coverageBranches?: number }} */
    const result = {};

    // Read jest JSON output for test count
    if (fs.existsSync(tmpOut)) {
      const jestData = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
      if (typeof jestData.numTotalTests === 'number') {
        result.testCount = jestData.numTotalTests;
      }
    }

    // Read coverage-summary.json for coverage percentages
    const coverageSummaryPath = path.join(projectRoot, 'coverage', 'coverage-summary.json');
    if (fs.existsSync(coverageSummaryPath)) {
      const coverageData = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
      const total = coverageData && coverageData.total;
      if (total) {
        if (total.statements && typeof total.statements.pct === 'number') {
          result.coverageStatements = total.statements.pct;
        }
        if (total.branches && typeof total.branches.pct === 'number') {
          result.coverageBranches = total.branches.pct;
        }
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (_) {
    return null;
  } finally {
    // Always clean up temp file
    try { fs.unlinkSync(tmpOut); } catch (_) { /* ok if missing */ }
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

/**
 * Main entry point: read docs, get live stats, compare, print results.
 *
 * CRITICAL: wraps everything in try/catch and always calls process.exit(0).
 * A documentation warning must never block or confuse a git merge operation.
 */
function main() {
  try {
    // Load config
    const configPath = path.join(PROJECT_ROOT, 'config', 'docsync.json');
    let config = { warn_threshold_pct: 1.0 };
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (_) {
      // Config missing or invalid — use default threshold
    }
    const threshold = typeof config.warn_threshold_pct === 'number'
      ? config.warn_threshold_pct
      : 1.0;

    // Get live stats (may be null if jest fails)
    const liveStats = getLiveStats(PROJECT_ROOT);
    if (!liveStats) {
      process.stderr.write('[post-merge] Could not obtain live stats — skipping drift check.\n');
      process.exit(0);
    }

    // Read and parse docs
    const docs = [
      { name: 'CLAUDE.md', path: path.join(PROJECT_ROOT, 'CLAUDE.md') },
      { name: 'README.md', path: path.join(PROJECT_ROOT, 'README.md') },
    ];

    const allViolations = [];

    for (const doc of docs) {
      let text = '';
      try {
        text = fs.readFileSync(doc.path, 'utf8');
      } catch (_) {
        // File missing — skip
        continue;
      }

      const docStats = extractDocStats(text);
      const violations = compareStats(docStats, liveStats, threshold);

      if (violations.length > 0) {
        for (const v of violations) {
          process.stderr.write(`[post-merge] WARNING (${doc.name}): ${v}\n`);
          allViolations.push(v);
        }
      }
    }

    if (allViolations.length === 0) {
      process.stdout.write('[post-merge] Documentation stats are current.\n');
    }
  } catch (err) {
    process.stderr.write(`[post-merge] Unexpected error: ${err.message}\n`);
  }

  process.exit(0);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { extractDocStats, compareStats, getLiveStats, main };

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  main();
}

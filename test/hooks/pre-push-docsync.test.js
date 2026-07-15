'use strict';

/**
 * pre-push-docsync.test.js
 *
 * Tests for hooks/pre-push-docsync.js
 *
 * Tests the exported pure `evaluate` function directly (no jest subprocess
 * spawning). main()/process.exit plumbing is excluded — it is covered by
 * the plan's manual verification and hooks/pre-push wiring.
 */

const { evaluate } = require('../../hooks/pre-push-docsync');

const CONFIG = { block_threshold_pct: 3.0, warn_threshold_pct: 1.0 };

describe('evaluate: pre-push docsync block/warn semantics', () => {
  test('exact test-count mismatch -> block true', () => {
    const result = evaluate({ testCount: 100 }, { testCount: 101 }, CONFIG);
    expect(result.block).toBe(true);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  test('coverage drift > block_threshold_pct -> block true', () => {
    // drift = |94.5 - 90.0| = 4.5 > 3.0
    const result = evaluate(
      { coverageStatements: 94.5 },
      { coverageStatements: 90.0 },
      CONFIG
    );
    expect(result.block).toBe(true);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  test('coverage drift <= block_threshold_pct but > warn_threshold_pct -> block false, warnings non-empty', () => {
    // drift = |94.5 - 92.0| = 2.5 -> between warn (1.0) and block (3.0)
    const result = evaluate(
      { coverageStatements: 94.5 },
      { coverageStatements: 92.0 },
      CONFIG
    );
    expect(result.block).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.blockers).toEqual([]);
  });

  test('synced stats -> block false, warnings empty', () => {
    const result = evaluate(
      { testCount: 100, coverageStatements: 94.5, coverageBranches: 81.0 },
      { testCount: 100, coverageStatements: 94.5, coverageBranches: 81.0 },
      CONFIG
    );
    expect(result.block).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.blockers).toEqual([]);
  });

  test('uses default thresholds when config values are missing', () => {
    const result = evaluate(
      { coverageStatements: 94.5 },
      { coverageStatements: 90.0 },
      {}
    );
    expect(result.block).toBe(true);
  });
});

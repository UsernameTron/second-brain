'use strict';

/**
 * post-merge-doc-sync.test.js
 *
 * Tests for hooks/post-merge-doc-sync.js
 *
 * Tests extractDocStats and compareStats directly (no subprocess spawning).
 * getLiveStats and main are excluded from unit tests — they require
 * a running jest process and are covered by acceptance criteria.
 */

const { extractDocStats, compareStats } = require('../../hooks/post-merge-doc-sync');

// ── extractDocStats ──────────────────────────────────────────────────────────

describe('extractDocStats: CLAUDE.md / README.md stat parsing', () => {
  test('parses test count, statement coverage, and branch coverage from valid markdown', () => {
    const text = `
**Test count:** 1127 total across 55 test files (1044 passing, 38 skipped)
- Coverage: Branch 81.28%, Statements 94.62%
`;
    const stats = extractDocStats(text);
    expect(stats.testCount).toBe(1127);
    expect(stats.coverageStatements).toBeCloseTo(94.62);
    expect(stats.coverageBranches).toBeCloseTo(81.28);
  });

  test('returns empty object for text with no stats (no crash)', () => {
    const stats = extractDocStats('no stats here');
    expect(stats).toEqual({});
  });

  test('returns empty object for empty string (no crash)', () => {
    const stats = extractDocStats('');
    expect(stats).toEqual({});
  });

  test('handles comma-separated test count numbers', () => {
    const text = '1,127 total across 55 test files';
    const stats = extractDocStats(text);
    expect(stats.testCount).toBe(1127);
  });

  test('parses test count without "across" keyword', () => {
    const text = '100 total passing';
    const stats = extractDocStats(text);
    expect(stats.testCount).toBe(100);
  });

  test('parses coverage with Statements variant (plural)', () => {
    const text = 'Statements 94.62%';
    const stats = extractDocStats(text);
    expect(stats.coverageStatements).toBeCloseTo(94.62);
  });

  test('parses coverage with Branch variant (singular)', () => {
    const text = 'Branch 81.28%';
    const stats = extractDocStats(text);
    expect(stats.coverageBranches).toBeCloseTo(81.28);
  });

  test('parses coverage with Branches variant (plural)', () => {
    const text = 'Branches 82.00%';
    const stats = extractDocStats(text);
    expect(stats.coverageBranches).toBeCloseTo(82.00);
  });

  test('returns only present stats when only test count is in text', () => {
    const text = '500 total across 20 test files';
    const stats = extractDocStats(text);
    expect(stats.testCount).toBe(500);
    expect(stats.coverageStatements).toBeUndefined();
    expect(stats.coverageBranches).toBeUndefined();
  });
});

// ── compareStats ─────────────────────────────────────────────────────────────

describe('compareStats: drift detection and violation reporting', () => {
  test('returns empty array when doc and live stats match exactly', () => {
    const violations = compareStats({ testCount: 100 }, { testCount: 100 }, 1.0);
    expect(violations).toEqual([]);
  });

  test('returns violation when test counts differ (exact match, no threshold)', () => {
    const violations = compareStats({ testCount: 100 }, { testCount: 120 }, 0);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/test count/i);
  });

  test('returns no violation when coverage drift is within threshold', () => {
    // drift = |94.5 - 94.0| = 0.5, threshold = 1.0 → no violation
    const violations = compareStats(
      { coverageStatements: 94.5 },
      { coverageStatements: 94.0 },
      1.0
    );
    expect(violations).toEqual([]);
  });

  test('returns violation when coverage drift exceeds threshold', () => {
    // drift = |94.5 - 90.0| = 4.5, threshold = 1.0 → violation
    const violations = compareStats(
      { coverageStatements: 94.5 },
      { coverageStatements: 90.0 },
      1.0
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/statement/i);
  });

  test('violation message includes doc value, actual value, and drift', () => {
    const violations = compareStats(
      { coverageStatements: 94.5 },
      { coverageStatements: 90.0 },
      1.0
    );
    const msg = violations[0];
    expect(msg).toMatch(/94\.5/);
    expect(msg).toMatch(/90\.0/);
    expect(msg).toMatch(/drift/i);
  });

  test('skips stat when doc value is null/undefined (no crash)', () => {
    const violations = compareStats(
      { coverageStatements: null },
      { coverageStatements: 94.0 },
      1.0
    );
    expect(violations).toEqual([]);
  });

  test('skips stat when live value is null/undefined (no crash)', () => {
    const violations = compareStats(
      { coverageStatements: 94.0 },
      { coverageStatements: undefined },
      1.0
    );
    expect(violations).toEqual([]);
  });

  test('handles empty doc stats object (no crash)', () => {
    const violations = compareStats({}, { testCount: 100 }, 1.0);
    expect(violations).toEqual([]);
  });

  test('handles empty live stats object (no crash)', () => {
    const violations = compareStats({ testCount: 100 }, {}, 1.0);
    expect(violations).toEqual([]);
  });

  test('returns violations for both test count and coverage when both drift', () => {
    const violations = compareStats(
      { testCount: 100, coverageStatements: 95.0 },
      { testCount: 120, coverageStatements: 80.0 },
      1.0
    );
    expect(violations).toHaveLength(2);
  });

  test('returns no violation when test counts match despite threshold > 0', () => {
    // testCount always uses exact match regardless of threshold
    const violations = compareStats({ testCount: 1127 }, { testCount: 1127 }, 5.0);
    expect(violations).toEqual([]);
  });
});

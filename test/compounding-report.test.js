'use strict';

/**
 * test/compounding-report.test.js
 *
 * Smoke test for scripts/compounding-report.js (v1.7 TREND-02). Spawns the
 * CLI as a real subprocess and asserts it exits 0 and prints a verdict. The
 * real vault has no daily-stats.md yet, so readDailyStats returns
 * { rows: [] } -> insufficient-data -> the report still prints the header
 * and verdict line even without 7 rows (this is the CLI's core behavior,
 * distinct from the /today section which suppresses at <7 rows).
 */

const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'compounding-report.js');

describe('compounding-report.js CLI', () => {
  it('exits 0 and prints the report header + verdict', () => {
    const output = execFileSync('node', [SCRIPT_PATH], { encoding: 'utf8' });

    expect(output).toContain('# Compounding Report');
    expect(output).toContain('Verdict:');
  });
});

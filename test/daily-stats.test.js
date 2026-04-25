'use strict';

/**
 * daily-stats.test.js
 *
 * Unit tests for src/daily-stats.js.
 * Tests dateKey(), recordDailyStats(), and readDailyStats().
 */

const { dateKey, recordDailyStats, readDailyStats } = require('../src/daily-stats');

// ── dateKey() ────────────────────────────────────────────────────────────────
describe('dateKey()', () => {
  it('returns YYYY-MM-DD in America/Chicago', () => {
    // 2026-04-24 18:00 UTC = 2026-04-24 13:00 Central (CDT, UTC-5)
    const d = new Date('2026-04-24T18:00:00.000Z');
    expect(dateKey(d)).toBe('2026-04-24');
  });

  it('returns the same date at 23:59 Central (D-08 boundary)', () => {
    // 2026-04-25 04:59 UTC = 2026-04-24 23:59 Central
    const d = new Date('2026-04-25T04:59:00.000Z');
    expect(dateKey(d)).toBe('2026-04-24');
  });

  it('rolls to next date at 00:01 Central (D-08 boundary)', () => {
    // 2026-04-25 05:01 UTC = 2026-04-25 00:01 Central
    const d = new Date('2026-04-25T05:01:00.000Z');
    expect(dateKey(d)).toBe('2026-04-25');
  });

  it('handles DST spring-forward boundary (2026-03-08 in Chicago)', () => {
    // 2026-03-08 07:00 UTC = 2026-03-08 01:00 CST (pre-jump) → still 2026-03-08
    const before = new Date('2026-03-08T07:00:00.000Z');
    // 2026-03-08 09:00 UTC = 2026-03-08 04:00 CDT (post-jump) → still 2026-03-08
    const after  = new Date('2026-03-08T09:00:00.000Z');
    expect(dateKey(before)).toBe('2026-03-08');
    expect(dateKey(after)).toBe('2026-03-08');
  });

  it('honors a non-default timezone argument', () => {
    const d = new Date('2026-04-25T04:59:00.000Z');  // 23:59 Chicago, 21:59 LA
    expect(dateKey(d, 'America/Los_Angeles')).toBe('2026-04-24');
    expect(dateKey(d, 'America/Chicago')).toBe('2026-04-24');
    expect(dateKey(d, 'UTC')).toBe('2026-04-25');
  });

  it('uses current date when called with no arguments', () => {
    // Exercises the default parameter branch (now = new Date())
    const result = dateKey();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── recordDailyStats() ────────────────────────────────────────────────────────
describe('recordDailyStats()', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const matter = require('gray-matter');

  let tmpDir;

  /** Build a minimal configOverride that routes stats to a tmpDir path */
  function makeConfig(_tmpRoot) {
    return {
      stats: {
        enabled: true,
        path: 'RIGHT/daily-stats.md',
        timezone: 'America/Chicago',
        summaryLineEnabled: true,
        schemaVersion: 1,
      },
      // required pipeline fields (not used by daily-stats but needed if validate:true were called)
    };
  }

  /** Minimal stats object for tests */
  const baseStats = {
    proposals: 3,
    promotions: 1,
    totalEntries: 42,
    memoryKb: 13.456,
    recallCount: 2,
    avgLatencyMs: 280,
    avgConfidence: 0.834,
  };

  beforeEach(() => {
    // Each test gets a fresh tmp vault root with a RIGHT directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-stats-test-'));
    fs.mkdirSync(path.join(tmpDir, 'RIGHT'), { recursive: true });
    // Point vault-gateway's VAULT_ROOT at our tmp dir
    process.env.VAULT_ROOT = tmpDir;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.VAULT_ROOT;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
    jest.restoreAllMocks();
  });

  it('creates the file with frontmatter + table header + one row on first call', () => {
    const config = makeConfig(tmpDir);
    const now = new Date('2026-04-24T18:00:00.000Z'); // 2026-04-24 in Chicago
    recordDailyStats(baseStats, { now, configOverride: config });

    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    expect(fs.existsSync(absPath)).toBe(true);

    const raw = fs.readFileSync(absPath, 'utf8');
    const parsed = matter(raw);

    // Frontmatter has all 4 required keys
    expect(parsed.data).toHaveProperty('schema_version');
    expect(parsed.data).toHaveProperty('columns');
    expect(parsed.data).toHaveProperty('last_updated');
    expect(parsed.data).toHaveProperty('timezone');

    // columns array has exactly 8 entries
    expect(parsed.data.columns).toHaveLength(8);

    // Exactly one data row
    const { rows } = readDailyStats(absPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-04-24');
  });

  it('appends a second row in ascending date order on a different day', () => {
    const config = makeConfig(tmpDir);

    recordDailyStats(baseStats, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });
    recordDailyStats({ ...baseStats, proposals: 5 }, {
      now: new Date('2026-04-25T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);

    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe('2026-04-24');
    expect(rows[1].date).toBe('2026-04-25');
  });

  it('replaces the existing row on same-day re-call (last-run-wins)', () => {
    const config = makeConfig(tmpDir);
    const now = new Date('2026-04-24T18:00:00.000Z');

    recordDailyStats({ ...baseStats, proposals: 1 }, { now, configOverride: config });
    recordDailyStats({ ...baseStats, proposals: 99 }, { now, configOverride: config });

    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);

    expect(rows).toHaveLength(1);
    expect(rows[0].proposals).toBe('99');
  });

  it('writes via vault-gateway vaultWriteAtomic (atomic + boundary-enforced)', () => {
    const config = makeConfig(tmpDir);
    const gateway = require('../src/vault-gateway');
    const spy = jest.spyOn(gateway, 'vaultWriteAtomic');

    // Re-require daily-stats after spying so the lazy require picks up the spy
    jest.resetModules();
    const { recordDailyStats: rds } = require('../src/daily-stats');
    // Re-apply spy on fresh module instance
    const freshGw = require('../src/vault-gateway');
    const freshSpy = jest.spyOn(freshGw, 'vaultWriteAtomic');

    rds(baseStats, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    // Either of the spy references may have been called depending on module cache
    const called = spy.mock.calls.length + freshSpy.mock.calls.length;
    expect(called).toBeGreaterThanOrEqual(1);

    spy.mockRestore();
    freshSpy.mockRestore();
  });

  it('renders memory_kb to 1 decimal', () => {
    const config = makeConfig(tmpDir);
    recordDailyStats({ ...baseStats, memoryKb: 13.456 }, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    const raw = fs.readFileSync(absPath, 'utf8');
    expect(raw).toContain('13.5');
    expect(raw).not.toContain('13.456');
  });

  it('renders null avg_latency_ms as em-dash', () => {
    const config = makeConfig(tmpDir);
    recordDailyStats({ ...baseStats, avgLatencyMs: null }, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    const raw = fs.readFileSync(absPath, 'utf8');
    expect(raw).toContain('\u2014'); // em-dash
  });

  it('renders null avg_confidence as em-dash', () => {
    const config = makeConfig(tmpDir);
    recordDailyStats({ ...baseStats, avgConfidence: null }, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    const raw = fs.readFileSync(absPath, 'utf8');
    expect(raw).toContain('\u2014'); // em-dash in avg_confidence column
  });

  it('respects stats.enabled === false (early return, no file written)', () => {
    const config = { stats: { enabled: false, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago', schemaVersion: 1 } };
    recordDailyStats(baseStats, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    expect(fs.existsSync(absPath)).toBe(false);
  });

  it('column order in rendered table matches frontmatter.columns element-for-element', () => {
    const config = makeConfig(tmpDir);
    recordDailyStats(baseStats, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    const raw = fs.readFileSync(absPath, 'utf8');
    const expectedHeader = '| date | proposals | promotions | total_entries | memory_kb | recall_count | avg_latency_ms | avg_confidence |';
    expect(raw).toContain(expectedHeader);
  });

  it('THROWS when config.stats.path resolves to a LEFT-side location (Pattern 11)', () => {
    const config = {
      stats: {
        enabled: true,
        path: 'ABOUT ME/spoof.md',  // LEFT-side path — must be rejected by vault-gateway
        timezone: 'America/Chicago',
        schemaVersion: 1,
      },
    };

    expect(() => {
      recordDailyStats(baseStats, {
        now: new Date('2026-04-24T18:00:00.000Z'),
        configOverride: config,
      });
    }).toThrow();
  });

  it('inserts a new row in ascending date order between two existing rows', () => {
    // This covers the "middle insert" branch (insertIdx !== -1) in recordDailyStats
    const config = makeConfig(tmpDir);

    // Write row for 2026-04-24
    recordDailyStats({ ...baseStats, proposals: 1 }, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });
    // Write row for 2026-04-26
    recordDailyStats({ ...baseStats, proposals: 3 }, {
      now: new Date('2026-04-26T18:00:00.000Z'),
      configOverride: config,
    });
    // Write row for 2026-04-25 — should insert between the two existing rows
    recordDailyStats({ ...baseStats, proposals: 2 }, {
      now: new Date('2026-04-25T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);

    expect(rows).toHaveLength(3);
    expect(rows[0].date).toBe('2026-04-24');
    expect(rows[1].date).toBe('2026-04-25');
    expect(rows[2].date).toBe('2026-04-26');
  });

  it('readDailyStats rethrows non-ENOENT fs errors', () => {
    // This covers the re-throw branch at line 84
    const realFs = jest.requireActual('fs');
    jest.spyOn(require('fs'), 'readFileSync').mockImplementation(() => {
      const err = new Error('permission denied');
      err.code = 'EACCES';
      throw err;
    });

    // Re-require daily-stats after mocking
    jest.resetModules();
    const { readDailyStats: rds } = require('../src/daily-stats');
    expect(() => rds('/some/path/daily-stats.md')).toThrow('permission denied');
  });

  it('readDailyStats handles a file with no frontmatter (uses COLUMNS fallback)', () => {
    // Exercises the `frontmatter.columns || COLUMNS` and `parsed.data || {}` branches
    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    // Write a plain table with no YAML frontmatter
    const plainTable = '| date | proposals |\n| --- | --- |\n| 2026-04-24 | 5 |\n';
    fs.writeFileSync(absPath, plainTable, 'utf8');

    const { frontmatter, rows } = readDailyStats(absPath);
    // frontmatter should be empty (no YAML block) — parser returns {} or similar
    expect(frontmatter).toBeDefined();
    // Rows with mismatched column count are skipped (only 2 columns vs COLUMNS length 8)
    // but the function should not throw
    expect(Array.isArray(rows)).toBe(true);
  });

  it('readDailyStats returns empty rows for a file with frontmatter but no table', () => {
    // Exercises the `parsed.content || ''` branch for empty content
    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    const frontmatterOnly = '---\nschema_version: 1\ncolumns:\n  - date\n---\n';
    fs.writeFileSync(absPath, frontmatterOnly, 'utf8');

    const { rows } = readDailyStats(absPath);
    expect(rows).toHaveLength(0);
  });

  it('writes zeros for undefined stat fields (default branch coverage)', () => {
    // Calls recordDailyStats with no numeric fields — exercises the else-0 branches
    const config = makeConfig(tmpDir);
    recordDailyStats({}, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].proposals).toBe('0');
    expect(rows[0].promotions).toBe('0');
    expect(rows[0].total_entries).toBe('0');
    expect(rows[0].recall_count).toBe('0');
    expect(rows[0].memory_kb).toBe('0');
  });

  it('applies timezone and schemaVersion defaults when absent from config', () => {
    // Exercises the `|| 'America/Chicago'` and `|| 1` fallback branches
    const minConfig = {
      stats: {
        enabled: true,
        path: 'RIGHT/daily-stats.md',
        // timezone and schemaVersion intentionally absent
      },
    };
    // Should not throw — defaults kick in
    expect(() => {
      recordDailyStats(baseStats, {
        now: new Date('2026-04-24T18:00:00.000Z'),
        configOverride: minConfig,
      });
    }).not.toThrow();

    const absPath = path.join(tmpDir, 'RIGHT', 'daily-stats.md');
    const { frontmatter } = readDailyStats(absPath);
    expect(frontmatter.timezone).toBe('America/Chicago');
    expect(frontmatter.schema_version).toBe(1);
  });
});

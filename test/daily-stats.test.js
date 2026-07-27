'use strict';

/**
 * daily-stats.test.js
 *
 * Unit tests for src/daily-stats.js.
 * Tests dateKey(), recordDailyStats(), and readDailyStats().
 */

const {
  dateKey, recordDailyStats, readDailyStats,
} = require('../src/daily-stats');

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

// ── counter-store test isolation (regression tripwire) ────────────────────────
describe('counter-store test isolation (regression tripwire)', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  it('routes counter writes under os.tmpdir when JEST_WORKER_ID is set and no CACHE_DIR_OVERRIDE', () => {
    const saved = process.env.CACHE_DIR_OVERRIDE;
    delete process.env.CACHE_DIR_OVERRIDE;
    expect(process.env.JEST_WORKER_ID).toBeDefined();

    jest.resetModules();
    const { recordProposalsBatch } = require('../src/daily-stats');
    const now = new Date('2026-05-01T18:00:00.000Z'); // 2026-05-01 Chicago
    recordProposalsBatch(1, { now });

    const workerDir = path.join(os.tmpdir(), 'second-brain-jest', String(process.env.JEST_WORKER_ID));
    const expected = path.join(workerDir, 'daily-counters-2026-05-01.json');
    expect(fs.existsSync(expected)).toBe(true);

    const realCache = path.join(os.homedir(), '.cache', 'second-brain', 'daily-counters-2026-05-01.json');
    expect(fs.existsSync(realCache)).toBe(false);

    try { fs.unlinkSync(expected); } catch (_) { /* best-effort */ }
    if (saved !== undefined) process.env.CACHE_DIR_OVERRIDE = saved;
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
        path: 'briefings/daily-stats.md',
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
    // Each test gets a fresh tmp vault root with a briefings directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-stats-test-'));
    fs.mkdirSync(path.join(tmpDir, 'briefings'), { recursive: true });
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

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
    expect(fs.existsSync(absPath)).toBe(true);

    const raw = fs.readFileSync(absPath, 'utf8');
    const parsed = matter(raw);

    // Frontmatter has all 4 required keys
    expect(parsed.data).toHaveProperty('schema_version');
    expect(parsed.data).toHaveProperty('columns');
    expect(parsed.data).toHaveProperty('last_updated');
    expect(parsed.data).toHaveProperty('timezone');

    // columns array has exactly 12 entries (vault_hygiene added 2026-07-26)
    expect(parsed.data.columns).toHaveLength(12);

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

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
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

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);

    expect(rows).toHaveLength(1);
    expect(rows[0].proposals).toBe(99);
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

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
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

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
    const raw = fs.readFileSync(absPath, 'utf8');
    expect(raw).toContain('\u2014'); // em-dash
  });

  it('renders null avg_confidence as em-dash', () => {
    const config = makeConfig(tmpDir);
    recordDailyStats({ ...baseStats, avgConfidence: null }, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
    const raw = fs.readFileSync(absPath, 'utf8');
    expect(raw).toContain('\u2014'); // em-dash in avg_confidence column
  });

  it('respects stats.enabled === false (early return, no file written)', () => {
    const config = { stats: { enabled: false, path: 'briefings/daily-stats.md', timezone: 'America/Chicago', schemaVersion: 1 } };
    recordDailyStats(baseStats, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
    expect(fs.existsSync(absPath)).toBe(false);
  });

  it('column order in rendered table matches frontmatter.columns element-for-element', () => {
    const config = makeConfig(tmpDir);
    recordDailyStats(baseStats, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
    const raw = fs.readFileSync(absPath, 'utf8');
    const expectedHeader = '| date | proposals | promotions | total_entries | memory_kb | recall_count | avg_latency_ms | avg_confidence | recall_hits | echo_shown | echo_score |';
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

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);

    expect(rows).toHaveLength(3);
    expect(rows[0].date).toBe('2026-04-24');
    expect(rows[1].date).toBe('2026-04-25');
    expect(rows[2].date).toBe('2026-04-26');
  });

  it('readDailyStats rethrows non-ENOENT fs errors', () => {
    // This covers the re-throw branch at line 84
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
    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
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
    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
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

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].proposals).toBe(0);
    expect(rows[0].promotions).toBe(0);
    expect(rows[0].total_entries).toBe(0);
    expect(rows[0].recall_count).toBe(0);
    expect(rows[0].memory_kb).toBe(0);
  });

  it('applies timezone and schemaVersion defaults when absent from config', () => {
    // Exercises the `|| 'America/Chicago'` and `|| 1` fallback branches
    const minConfig = {
      stats: {
        enabled: true,
        path: 'briefings/daily-stats.md',
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

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
    const { frontmatter } = readDailyStats(absPath);
    expect(frontmatter.timezone).toBe('America/Chicago');
    expect(frontmatter.schema_version).toBe(1);
  });

  // ── 11-column schema + numeric coercion (STATS-OUTCOME-01/02) ──────────────

  it('writes recall_hits/echo_shown/echo_score and round-trips numeric coercion', () => {
    const config = makeConfig(tmpDir);
    recordDailyStats({
      ...baseStats,
      avgLatencyMs: null,
      recallHits: 2,
      echoShown: 1,
      echoScore: 0.912,
    }, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);
    const row = rows[0];

    // 12 columns present on the written+read row (vault_hygiene added 2026-07-26)
    expect(Object.keys(row)).toHaveLength(12);

    // Numeric cells coerce to Number; the em dash survives as a string
    expect(typeof row.recall_count).toBe('number');
    expect(row.avg_latency_ms).toBe('—');

    // recall_hits/echo_shown/echo_score render as numbers when supplied
    expect(row.recall_hits).toBe(2);
    expect(row.echo_shown).toBe(1);
    expect(row.echo_score).toBe(0.91);

    // recall_hits <= recall_count invariant
    expect(row.recall_hits).toBeLessThanOrEqual(row.recall_count);
  });

  it('renders echo_shown/echo_score as em dash when not supplied', () => {
    const config = makeConfig(tmpDir);
    recordDailyStats(baseStats, {
      now: new Date('2026-04-24T18:00:00.000Z'),
      configOverride: config,
    });

    const absPath = path.join(tmpDir, 'briefings', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);
    expect(rows[0].echo_shown).toBe('—');
    expect(rows[0].echo_score).toBe('—');
    expect(rows[0].recall_hits).toBe(0);
  });
});

// ── counter helpers ────────────────────────────────────────────────────────────

describe('counter helpers', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  let cacheDir;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-counter-test-'));
    process.env.CACHE_DIR_OVERRIDE = cacheDir;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.CACHE_DIR_OVERRIDE;
    try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
    jest.restoreAllMocks();
  });

  function freshModule() {
    return require('../src/daily-stats');
  }

  it('recordRecallInvocation increments recallCount atomically across calls', () => {
    const { recordRecallInvocation: rri, readDailyCounters: rdc } = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    rri({ now });
    rri({ now });
    rri({ now });
    const counters = rdc({ now });
    expect(counters.recallCount).toBe(3);
  });

  it('recordProposalsBatch accumulates across calls', () => {
    const { recordProposalsBatch: rpb, readDailyCounters: rdc } = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    rpb(2, { now });
    rpb(5, { now });
    const counters = rdc({ now });
    expect(counters.proposals).toBe(7);
  });

  it('recordPromotion accumulates count + confidence sum', () => {
    const { recordPromotion: rp, readDailyCounters: rdc } = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    rp(0.8, { now });
    rp(0.9, { now });
    const counters = rdc({ now });
    expect(counters.promotions).toBe(2);
    expect(counters.avgConfidence).toBeCloseTo(0.85, 5);
  });

  it('avgConfidence is null when no promotions recorded', () => {
    const { readDailyCounters: rdc } = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    const counters = rdc({ now });
    expect(counters.avgConfidence).toBeNull();
  });

  it('recordTopCosine appends to topCosineScores', () => {
    const { recordTopCosine: rtc } = freshModule();
    const fs2 = require('fs');
    const now = new Date('2026-04-24T18:00:00.000Z');
    rtc(0.9, { now });
    rtc(0.7, { now });
    const files = fs2.readdirSync(cacheDir).filter(f => f.startsWith('daily-counters-'));
    expect(files.length).toBe(1);
    const raw = JSON.parse(fs2.readFileSync(path.join(cacheDir, files[0]), 'utf8'));
    expect(Array.isArray(raw.topCosineScores)).toBe(true);
    expect(raw.topCosineScores.length).toBe(2);
  });

  it('recordTopRrf appends to topRrfScores', () => {
    const { recordTopRrf: rtr } = freshModule();
    const fs2 = require('fs');
    const now = new Date('2026-04-24T18:00:00.000Z');
    rtr(0.05, { now });
    rtr(0.03, { now });
    const files = fs2.readdirSync(cacheDir).filter(f => f.startsWith('daily-counters-'));
    expect(files.length).toBe(1);
    const raw = JSON.parse(fs2.readFileSync(path.join(cacheDir, files[0]), 'utf8'));
    expect(Array.isArray(raw.topRrfScores)).toBe(true);
    expect(raw.topRrfScores.length).toBe(2);
  });

  it('emit functions never throw on FS error', () => {
    const ds = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    const fsModule = require('fs');
    jest.spyOn(fsModule, 'writeFileSync').mockImplementation(() => { throw new Error('disk full'); });
    expect(() => ds.recordRecallInvocation({ now })).not.toThrow();
  });

  it('counter file is written atomically via .tmp + rename', () => {
    const ds = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    const fsModule = require('fs');
    const renameSpy = jest.spyOn(fsModule, 'renameSync');
    ds.recordRecallInvocation({ now });
    const tmpCall = renameSpy.mock.calls.find(args => String(args[0]).endsWith('.tmp'));
    expect(tmpCall).toBeDefined();
  });

  it('counter file is created with chmod 0o600', () => {
    const ds = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    const fsModule = require('fs');
    const writeSpy = jest.spyOn(fsModule, 'writeFileSync');
    ds.recordRecallInvocation({ now });
    const call600 = writeSpy.mock.calls.find(args => args[2] && args[2].mode === 0o600);
    expect(call600).toBeDefined();
  });

  it('counters are scoped to today dateKey — different day creates a different file', () => {
    const ds = freshModule();
    const fs2 = require('fs');
    const day1 = new Date('2026-04-24T18:00:00.000Z');
    const day2 = new Date('2026-04-25T18:00:00.000Z');
    ds.recordRecallInvocation({ now: day1 });
    ds.recordRecallInvocation({ now: day2 });
    const counterFiles = fs2.readdirSync(cacheDir).filter(f => f.startsWith('daily-counters-'));
    expect(counterFiles.length).toBe(2);
  });

  // ── recall hit tracking + Memory Echo outcome (STATS-OUTCOME-01/02) ─────────

  it('recordRecallInvocation with no hit: recallCount +1, recallHits unchanged', () => {
    const { recordRecallInvocation: rri, readDailyCounters: rdc } = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    rri({ now });
    const counters = rdc({ now });
    expect(counters.recallCount).toBe(1);
    expect(counters.recallHits).toBe(0);
  });

  it('recordRecallInvocation with hit:true increments both recallCount and recallHits', () => {
    const { recordRecallInvocation: rri, readDailyCounters: rdc } = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    rri({ hit: true, resultCount: 3, now });
    const counters = rdc({ now });
    expect(counters.recallCount).toBe(1);
    expect(counters.recallHits).toBe(1);
  });

  it('recordRecallInvocation with hit:false leaves recallHits unchanged', () => {
    const { recordRecallInvocation: rri, readDailyCounters: rdc } = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    rri({ hit: false, now });
    const counters = rdc({ now });
    expect(counters.recallCount).toBe(1);
    expect(counters.recallHits).toBe(0);
  });

  it('recordEchoShown(true, 0.83) persists echoShown === 1 and echoScore === 0.83', () => {
    const { recordEchoShown: res, readDailyCounters: rdc } = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    res(true, 0.83, { now });
    const counters = rdc({ now });
    expect(counters.echoShown).toBe(1);
    expect(counters.echoScore).toBe(0.83);
  });

  it('recordEchoShown(false, 0) persists echoShown === 0 and echoScore === 0', () => {
    const { recordEchoShown: res, readDailyCounters: rdc } = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    res(false, 0, { now });
    const counters = rdc({ now });
    expect(counters.echoShown).toBe(0);
    expect(counters.echoScore).toBe(0);
  });

  it('readDailyCounters returns recallHits/echoShown/echoScore alongside existing fields', () => {
    const { recordRecallInvocation: rri, recordEchoShown: res, readDailyCounters: rdc } = freshModule();
    const now = new Date('2026-04-24T18:00:00.000Z');
    rri({ hit: true, now });
    res(true, 0.7, { now });
    const counters = rdc({ now });
    expect(counters).toEqual(expect.objectContaining({
      proposals: 0,
      promotions: 0,
      recallCount: 1,
      recallHits: 1,
      echoShown: 1,
      echoScore: 0.7,
      avgConfidence: null,
    }));
  });
});

// ── flushMissedDays() ──────────────────────────────────────────────────────────

describe('flushMissedDays()', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  let cacheDir;
  let vaultDir;

  /** Build a minimal configOverride that routes stats to the tmp vault path */
  function makeFlushConfig() {
    return {
      stats: {
        enabled: true,
        path: 'briefings/daily-stats.md',
        timezone: 'America/Chicago',
        schemaVersion: 1,
      },
    };
  }

  function writeCounterFile(dateStr, state) {
    fs.writeFileSync(
      path.join(cacheDir, `daily-counters-${dateStr}.json`),
      JSON.stringify({ date: dateStr, ...state }),
      'utf8',
    );
  }

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-flush-test-'));
    process.env.CACHE_DIR_OVERRIDE = cacheDir;
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-flush-vault-'));
    fs.mkdirSync(path.join(vaultDir, 'briefings'), { recursive: true });
    process.env.VAULT_ROOT = vaultDir;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.CACHE_DIR_OVERRIDE;
    delete process.env.VAULT_ROOT;
    try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
    try { fs.rmSync(vaultDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
    jest.restoreAllMocks();
  });

  it('flushes an orphan past-day counter into an idempotent daily-stats row', () => {
    const { flushMissedDays, readDailyStats } = require('../src/daily-stats');

    writeCounterFile('2026-06-01', {
      proposals: 2, promotions: 1, recallCount: 3, confidenceSum: 1.6, confidenceCount: 2,
    });

    flushMissedDays({
      now: new Date('2026-06-15T18:00:00.000Z'),
      totalEntries: 50,
      memoryKb: 12.3,
      configOverride: makeFlushConfig(),
    });

    const absPath = path.join(vaultDir, 'briefings', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);
    const row = rows.find(r => r.date === '2026-06-01');
    expect(row).toBeDefined();
    expect(row.recall_count).toBe(3);
    expect(row.avg_latency_ms).toBe('—');
    expect(row.total_entries).toBe(50);
  });

  it('is idempotent — calling twice does not duplicate the flushed row', () => {
    const { flushMissedDays, readDailyStats } = require('../src/daily-stats');

    writeCounterFile('2026-06-01', {
      proposals: 2, promotions: 1, recallCount: 3, confidenceSum: 1.6, confidenceCount: 2,
    });

    const opts = {
      now: new Date('2026-06-15T18:00:00.000Z'),
      totalEntries: 50,
      memoryKb: 12.3,
      configOverride: makeFlushConfig(),
    };
    flushMissedDays(opts);
    flushMissedDays(opts);

    const absPath = path.join(vaultDir, 'briefings', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);
    expect(rows.filter(r => r.date === '2026-06-01')).toHaveLength(1);
  });

  it('skips a counter file dated today or in the future', () => {
    const { flushMissedDays, readDailyStats } = require('../src/daily-stats');

    // Counter file dated the same day as `now` — must never be flushed.
    writeCounterFile('2026-06-15', {
      proposals: 1, promotions: 0, recallCount: 0, confidenceSum: 0, confidenceCount: 0,
    });

    flushMissedDays({
      now: new Date('2026-06-15T18:00:00.000Z'),
      configOverride: makeFlushConfig(),
    });

    const absPath = path.join(vaultDir, 'briefings', 'daily-stats.md');
    const { rows } = readDailyStats(absPath);
    expect(rows.find(r => r.date === '2026-06-15')).toBeUndefined();
  });

  it('prunes counter files older than ~14 days, keeping recent ones', () => {
    const { flushMissedDays } = require('../src/daily-stats');

    // 20 days before 2026-06-15 → past retention, must be deleted.
    writeCounterFile('2026-05-20', {
      proposals: 0, promotions: 0, recallCount: 0, confidenceSum: 0, confidenceCount: 0,
    });
    // 5 days before 2026-06-15 → within retention, must survive.
    writeCounterFile('2026-06-10', {
      proposals: 0, promotions: 0, recallCount: 0, confidenceSum: 0, confidenceCount: 0,
    });

    flushMissedDays({
      now: new Date('2026-06-15T18:00:00.000Z'),
      configOverride: makeFlushConfig(),
    });

    expect(fs.existsSync(path.join(cacheDir, 'daily-counters-2026-05-20.json'))).toBe(false);
    expect(fs.existsSync(path.join(cacheDir, 'daily-counters-2026-06-10.json'))).toBe(true);
  });
});

// ── computeVaultHygiene() ─────────────────────────────────────────────────────
//
// The 2026-07-26 restructure emptied a vault root that had accumulated 83 loose
// files. vault-gateway can only block writes that route through it, so the count
// is the visibility layer for everything that does not.
describe('computeVaultHygiene()', () => {
  const fsx = require('fs');
  const osx = require('os');
  const pathx = require('path');
  let vaultDir;

  const paths = { left: ['ABOUT ME', 'Daily'], right: ['memory', 'briefings', 'proposals/unrouted'] };

  beforeEach(() => {
    vaultDir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'ds-hygiene-'));
  });

  afterEach(() => {
    try { fsx.rmSync(vaultDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  });

  it('counts zero for a vault whose folders are all declared', () => {
    const { computeVaultHygiene } = require('../src/daily-stats');
    for (const d of ['ABOUT ME', 'Daily', 'memory', 'briefings']) {
      fsx.mkdirSync(pathx.join(vaultDir, d), { recursive: true });
    }
    fsx.writeFileSync(pathx.join(vaultDir, 'CLAUDE.md'), '# router', 'utf8');
    fsx.mkdirSync(pathx.join(vaultDir, '.obsidian'), { recursive: true });
    fsx.writeFileSync(pathx.join(vaultDir, '.DS_Store'), 'x', 'utf8');

    expect(computeVaultHygiene({ vaultRoot: vaultDir, vaultPaths: paths })).toBe(0);
  });

  it('counts loose root files and undeclared top-level folders', () => {
    const { computeVaultHygiene } = require('../src/daily-stats');
    fsx.mkdirSync(pathx.join(vaultDir, 'memory'), { recursive: true });
    fsx.mkdirSync(pathx.join(vaultDir, 'Untitled'), { recursive: true });      // +1 undeclared folder
    fsx.mkdirSync(pathx.join(vaultDir, 'Daily Standups'), { recursive: true }); // +1 undeclared folder
    fsx.writeFileSync(pathx.join(vaultDir, 'standup-2026-05-27.md'), 'x', 'utf8'); // +1 loose file
    fsx.writeFileSync(pathx.join(vaultDir, 'CTG-brief.md'), 'x', 'utf8');          // +1 loose file
    fsx.writeFileSync(pathx.join(vaultDir, 'CLAUDE.md'), 'x', 'utf8');             // allowlisted

    expect(computeVaultHygiene({ vaultRoot: vaultDir, vaultPaths: paths })).toBe(4);
  });

  it('credits a nested declaration to its top segment (proposals/unrouted -> proposals)', () => {
    const { computeVaultHygiene } = require('../src/daily-stats');
    fsx.mkdirSync(pathx.join(vaultDir, 'proposals', 'unrouted'), { recursive: true });
    expect(computeVaultHygiene({ vaultRoot: vaultDir, vaultPaths: paths })).toBe(0);
  });
});

'use strict';

/**
 * Unit tests for src/today/sweep-status.js computeSweepLine.
 * Isolated via DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE → temp fixture file.
 * Pure fs, fail-open — no network, not CI-guarded.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { computeSweepLine } = require('../../src/today/sweep-status');

let tmpDir;
let statePath;
let savedOverride;

beforeEach(() => {
  savedOverride = process.env.DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-status-'));
  statePath = path.join(tmpDir, 'daily-sweep-last-run.json');
  process.env.DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE = statePath;
});

afterEach(() => {
  if (savedOverride === undefined) delete process.env.DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE;
  else process.env.DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE = savedOverride;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeState(obj) {
  fs.writeFileSync(statePath, JSON.stringify(obj), 'utf8');
}

describe('computeSweepLine', () => {
  test('recent run (5 min ago) → "sweep ran HH:MM, staged N"', () => {
    const now = new Date('2026-07-21T18:05:00');
    const ts = new Date('2026-07-21T18:00:00').toISOString();
    writeState({ ts, staged: 7, durationMs: 1000, degraded: false });
    const expectedHHMM = new Date(ts).toTimeString().slice(0, 5);
    expect(computeSweepLine(now)).toBe(`sweep ran ${expectedHHMM}, staged 7`);
  });

  test('run 30h ago → "sweep STALE (last ran YYYY-MM-DD)"', () => {
    const now = new Date('2026-07-21T18:00:00Z');
    const ts = new Date('2026-07-20T12:00:00Z').toISOString(); // 30h earlier
    writeState({ ts, staged: 3, durationMs: 1000, degraded: false });
    expect(computeSweepLine(now)).toBe(`sweep STALE (last ran ${ts.slice(0, 10)})`);
  });

  test('missing state file → "sweep NEVER RAN"', () => {
    expect(computeSweepLine()).toBe('sweep NEVER RAN');
  });

  test('corrupt/garbage state file → "sweep NEVER RAN" (fail-open)', () => {
    fs.writeFileSync(statePath, '{ not valid json', 'utf8');
    expect(() => computeSweepLine()).not.toThrow();
    expect(computeSweepLine()).toBe('sweep NEVER RAN');
  });

  test('state without a ts → "sweep NEVER RAN"', () => {
    writeState({ staged: 5 });
    expect(computeSweepLine()).toBe('sweep NEVER RAN');
  });

  test('the 26h boundary: just under stays "ran", just over flips to STALE', () => {
    const now = new Date('2026-07-21T18:00:00Z');
    const justUnder = new Date(now.getTime() - (26 * 60 * 60 * 1000 - 60 * 1000)).toISOString(); // 25h59m
    writeState({ ts: justUnder, staged: 1 });
    expect(computeSweepLine(now)).toMatch(/^sweep ran /);

    const justOver = new Date(now.getTime() - (26 * 60 * 60 * 1000 + 60 * 1000)).toISOString(); // 26h01m
    writeState({ ts: justOver, staged: 1 });
    expect(computeSweepLine(now)).toMatch(/^sweep STALE /);
  });

  test('missing staged falls back to 0, not NaN', () => {
    const now = new Date('2026-07-21T18:05:00Z');
    const ts = new Date('2026-07-21T18:00:00Z').toISOString();
    writeState({ ts });
    expect(computeSweepLine(now)).toContain('staged 0');
  });
});

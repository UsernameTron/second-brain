'use strict';

/**
 * Unit tests for src/utils/classifier-health.js.
 *
 * Pure fs module (hits no live endpoint) — isolated per-test via CACHE_DIR_OVERRIDE
 * pointed at a fresh mkdtemp dir. NO CI/UAT guard needed (no network, deterministic).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const health = require('../../src/utils/classifier-health');

let tmpCacheDir;
let originalCacheDir;

beforeEach(() => {
  originalCacheDir = process.env.CACHE_DIR_OVERRIDE;
  tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classifier-health-'));
  process.env.CACHE_DIR_OVERRIDE = tmpCacheDir;
});

afterEach(() => {
  if (originalCacheDir === undefined) delete process.env.CACHE_DIR_OVERRIDE;
  else process.env.CACHE_DIR_OVERRIDE = originalCacheDir;
  fs.rmSync(tmpCacheDir, { recursive: true, force: true });
});

describe('classifier-health — failure tracking & degraded mode', () => {
  test('readHealth() on a missing file returns defaults and does not throw', () => {
    const state = health.readHealth();
    expect(state.consecutive_failures).toBe(0);
    expect(state.degraded_until).toBeNull();
    expect(state.haiku_calls).toBe(0);
  });

  test('a single failure does not degrade; 3 consecutive failures degrade with reason', () => {
    health.recordFailure('timeout');
    expect(health.isDegraded()).toBe(false);

    health.recordFailure('http');
    health.recordFailure('parse');
    expect(health.isDegraded()).toBe(true);
    // getDegradedReason mentions the LAST failure code
    expect(health.getDegradedReason()).toContain('parse');
  });

  test('recordSuccess() resets the counter and closes the degraded window', () => {
    health.recordFailure('timeout');
    health.recordFailure('timeout');
    health.recordFailure('timeout');
    expect(health.isDegraded()).toBe(true);

    health.recordSuccess();
    expect(health.isDegraded()).toBe(false);
    expect(health.readHealth().consecutive_failures).toBe(0);
    expect(health.getDegradedReason()).toBe('');
  });

  test('a corrupt/garbage health file fails open to defaults (no throw)', () => {
    fs.writeFileSync(health.getHealthPath(), '{ this is not json ', 'utf8');
    expect(() => health.readHealth()).not.toThrow();
    expect(health.readHealth().consecutive_failures).toBe(0);
    expect(health.isDegraded()).toBe(false);
  });
});

describe('classifier-health — per-night Haiku cap', () => {
  test('recordHaikuCall increments; isHaikuCapReached(N) true, (N+1) false', () => {
    const N = 3;
    for (let i = 0; i < N; i++) health.recordHaikuCall();
    expect(health.isHaikuCapReached(N)).toBe(true);
    expect(health.isHaikuCapReached(N + 1)).toBe(false);
  });

  test('the Haiku counter is keyed by date and resets on rollover', () => {
    const day1 = '2026-07-21';
    const day2 = '2026-07-22';
    health.recordHaikuCall(day1);
    health.recordHaikuCall(day1);
    expect(health.isHaikuCapReached(2, day1)).toBe(true);

    // New day: last night's 2 calls must NOT cap tonight
    expect(health.isHaikuCapReached(1, day2)).toBe(false);
    // First call on day2 starts the count from 1, not 3
    health.recordHaikuCall(day2);
    expect(health.isHaikuCapReached(1, day2)).toBe(true);
    expect(health.isHaikuCapReached(2, day2)).toBe(false);
  });

  test('the Haiku counter is independent of the failure/degraded state', () => {
    health.recordHaikuCall();
    health.recordFailure('http');
    // recording a failure must not wipe the Haiku count
    expect(health.readHealth().haiku_calls).toBe(1);
  });
});

describe('classifier-health — atomic persistence', () => {
  test('writes leave no leftover .tmp file', () => {
    health.recordFailure('timeout');
    const leftover = fs.readdirSync(tmpCacheDir).filter((f) => f.endsWith('.tmp'));
    expect(leftover).toEqual([]);
    // and the real file exists
    expect(fs.existsSync(health.getHealthPath())).toBe(true);
  });
});

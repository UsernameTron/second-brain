'use strict';

/**
 * Tests for the Phase 33 proof-of-fire write in scripts/daily-sweep.js main().
 * Heavy sweep deps (memory-extractor, lifecycle) are mocked so main() runs fast +
 * deterministically; transcript/inbox roots point at empty temp dirs. Pure fs +
 * mocks, no network → not CI-guarded.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/memory-extractor', () => ({
  // 3 candidates for the Daily extraction; none for the inbox dir
  extractMemories: jest.fn(async (opts) => (opts && opts.dir === 'inbox' ? [] : [{}, {}, {}])),
  extractFromTranscript: jest.fn(async () => []),
}));
jest.mock('../src/lifecycle', () => ({
  retryDeadLetters: jest.fn(async () => ({ retried: 0 })),
  archiveStaleLeftProposals: jest.fn(async () => ({ archived: 0 })),
}));

const ENV_KEYS = [
  'DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE',
  'TRANSCRIPTS_ROOT_OVERRIDE',
  'VAULT_ROOT',
  'CACHE_DIR_OVERRIDE',
];

describe('daily-sweep last-run evidence (CAP-EVIDENCE-01)', () => {
  let tmpDir;
  let tmpCacheDir;
  let lastRunPath;
  let savedEnv;
  let savedArgv;

  beforeEach(() => {
    jest.resetModules();
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    savedArgv = process.argv;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-lastrun-'));
    tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-cache-'));
    lastRunPath = path.join(tmpDir, 'daily-sweep-last-run.json');

    process.env.DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE = lastRunPath;
    process.env.TRANSCRIPTS_ROOT_OVERRIDE = path.join(tmpDir, 'transcripts'); // empty → 0 swept
    process.env.VAULT_ROOT = path.join(tmpDir, 'vault'); // inbox created empty → 0 files
    process.env.CACHE_DIR_OVERRIDE = tmpCacheDir;
    fs.mkdirSync(process.env.TRANSCRIPTS_ROOT_OVERRIDE, { recursive: true });
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    process.argv = savedArgv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpCacheDir, { recursive: true, force: true });
  });

  test('a real (non-dry-run) sweep writes ts/staged/durationMs/degraded atomically', async () => {
    const { main } = require('../scripts/daily-sweep');
    await main();

    expect(fs.existsSync(lastRunPath)).toBe(true);
    const state = JSON.parse(fs.readFileSync(lastRunPath, 'utf8'));
    expect(typeof state.ts).toBe('string');
    expect(state.staged).toBe(3); // 3 daily + 0 transcript + 0 inbox
    expect(typeof state.durationMs).toBe('number');
    expect(state.degraded).toBe(false);
    // atomic: no leftover .tmp beside the file
    expect(fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  test('the degraded flag reflects classifier-health.isDegraded()', async () => {
    const health = require('../src/utils/classifier-health');
    health.recordFailure('timeout');
    health.recordFailure('timeout');
    health.recordFailure('timeout'); // 3 consecutive → degraded window open
    expect(health.isDegraded()).toBe(true);

    const { main } = require('../scripts/daily-sweep');
    await main();
    const state = JSON.parse(fs.readFileSync(lastRunPath, 'utf8'));
    expect(state.degraded).toBe(true);
  });

  test('--dry-run writes nothing', async () => {
    process.argv = [...savedArgv, '--dry-run'];
    jest.resetModules();
    const { main } = require('../scripts/daily-sweep');
    await main();
    expect(fs.existsSync(lastRunPath)).toBe(false);
  });

  test('a write failure does not throw out of main() (fail-open)', async () => {
    // Parent is a FILE, so mkdir/write/rename fails — must be swallowed
    const badParent = path.join(tmpDir, 'notadir');
    fs.writeFileSync(badParent, 'x');
    process.env.DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE = path.join(badParent, 'nope.json');
    jest.resetModules();
    const { main } = require('../scripts/daily-sweep');
    await expect(main()).resolves.toBeDefined();
  });
});

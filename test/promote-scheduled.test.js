'use strict';

/**
 * promote-scheduled.test.js
 *
 * The nightly auto-promotion entry point. It promotes unreviewed candidates
 * without a human in the loop, so its argument handling and drain-loop
 * accounting are the safety surface.
 */

jest.mock('../src/promote-memories', () => ({ promoteMemories: jest.fn() }));
const { promoteMemories } = require('../src/promote-memories');
const { main } = require('../scripts/promote-scheduled');

const round = (o = {}) => ({ promoted: 0, deferred: 0, duplicates: 0, rejected: 0, skipped: 0, ...o });

describe('promote-scheduled', () => {
  let exit, log, err;
  beforeEach(() => {
    promoteMemories.mockReset();
    exit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    err = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { exit.mockRestore(); log.mockRestore(); err.mockRestore(); });

  test('a mistyped safety flag exits 2 instead of promoting for real', async () => {
    await expect(main(['--dryrun'])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(2);
    expect(promoteMemories).not.toHaveBeenCalled();
  });

  test('a bare run promotes exactly one batch', async () => {
    promoteMemories.mockResolvedValue(round({ promoted: 10, deferred: 5 }));
    await main([]);
    expect(promoteMemories).toHaveBeenCalledTimes(1);
    expect(promoteMemories).toHaveBeenCalledWith({ auto: true, dryRun: false, skipStats: false });
  });

  test('--drain repeats while candidates remain deferred', async () => {
    promoteMemories
      .mockResolvedValueOnce(round({ promoted: 10, deferred: 5 }))
      .mockResolvedValueOnce(round({ promoted: 5, deferred: 0 }));
    await main(['--drain']);
    expect(promoteMemories).toHaveBeenCalledTimes(2);
  });

  test('only the first drain round records the staged-proposals count', async () => {
    // recordProposalsBatch accumulates, so counting every round inflated the
    // daily figure: 201 staged was recorded as 201 + 201 + 101.
    promoteMemories
      .mockResolvedValueOnce(round({ promoted: 10, deferred: 5 }))
      .mockResolvedValueOnce(round({ promoted: 5, deferred: 0 }));
    await main(['--drain']);
    expect(promoteMemories.mock.calls[0][0].skipStats).toBe(false);
    expect(promoteMemories.mock.calls[1][0].skipStats).toBe(true);
  });

  test('--dry-run runs a single round and never loops', async () => {
    promoteMemories.mockResolvedValue(round({ deferred: 99, dryRun: true }));
    await main(['--drain', '--dry-run']);
    expect(promoteMemories).toHaveBeenCalledTimes(1);
    expect(promoteMemories.mock.calls[0][0].dryRun).toBe(true);
  });

  test('a round that moves nothing stops the drain', async () => {
    promoteMemories.mockResolvedValue(round({ deferred: 3 }));
    await main(['--drain']);
    expect(promoteMemories).toHaveBeenCalledTimes(1);
  });

  test('a failed round exits 1 rather than reporting a clean night', async () => {
    promoteMemories.mockResolvedValue({ error: 'lock held' });
    await expect(main(['--drain'])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

/**
 * The mocked suite above cannot catch a broken options contract: it replaces
 * promoteMemories, so a key the real function rejects still "passes". That is
 * exactly how `skipStats` shipped to master and made the nightly job exit 1
 * every night without promoting anything. These tests use the REAL function.
 */
describe('promote-scheduled against the real promoteMemories', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  let dir, prevVault;

  beforeEach(() => {
    jest.resetModules();
    jest.dontMock('../src/promote-memories');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promote-sched-real-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'proposals'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'memory', 'memory.md'), '');
    prevVault = process.env.VAULT_ROOT;
    process.env.VAULT_ROOT = dir;
  });
  afterEach(() => {
    if (prevVault === undefined) delete process.env.VAULT_ROOT; else process.env.VAULT_ROOT = prevVault;
    fs.rmSync(dir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('every option promote-scheduled passes is accepted by promoteMemories', async () => {
    const { promoteMemories } = jest.requireActual('../src/promote-memories');
    // The exact shape scripts/promote-scheduled.js sends on each drain round.
    for (const skipStats of [false, true]) {
      const r = await promoteMemories({ auto: true, dryRun: false, skipStats });
      expect(r.error).toBeUndefined();
    }
  });

  test('an unknown option is still rejected, so the contract stays strict', async () => {
    const { promoteMemories } = jest.requireActual('../src/promote-memories');
    const r = await promoteMemories({ auto: true, nonsense: 1 });
    expect(r.error).toMatch(/Unknown option/);
  });
});

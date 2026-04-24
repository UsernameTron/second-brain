'use strict';

/**
 * test/memory-proposals-coverage.test.js
 *
 * Phase 16 branch coverage lift for src/memory-proposals.js.
 * Baseline branch coverage before this file: 57.14%.
 * Target: >= 80%.
 *
 * Covers the uncovered branches identified by `jest --coverage`:
 *   L86       acquireLock non-EEXIST error propagation
 *   L137/L141 parseFrontmatter no-frontmatter + unterminated-frontmatter paths
 *   L184-187  sourceRefShort daily: prefix + default fallback
 *   L281      flushPendingBuffer malformed-line swallow
 *   L326-327  flushPendingBuffer lock-acquisition-failed branch
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('memory-proposals coverage lift', () => {
  let tempVault;
  let origVault;
  let memProposals;

  beforeEach(() => {
    tempVault = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-memprop-cov-'));
    fs.mkdirSync(path.join(tempVault, 'proposals'), { recursive: true });
    fs.mkdirSync(path.join(tempVault, 'memory'), { recursive: true });
    origVault = process.env.VAULT_ROOT;
    process.env.VAULT_ROOT = tempVault;
    jest.resetModules();
    memProposals = require('../src/memory-proposals');
  });

  afterEach(() => {
    if (origVault === undefined) delete process.env.VAULT_ROOT;
    else process.env.VAULT_ROOT = origVault;
    try { fs.rmSync(tempVault, { recursive: true, force: true }); } catch (_) { /* cleanup */ }
    jest.resetModules();
  });

  // ── sourceRefShort: L184-187 ──────────────────────────────────────────────

  describe('sourceRefShort via writeCandidate', () => {
    test('daily: prefix is returned verbatim (L184)', async () => {
      const result = await memProposals.writeCandidate({
        content: 'A test memory about the daily source.',
        category: 'test',
        sourceRef: 'daily:2026-04-24',
        confidence: 0.9,
      });

      expect(result.written).toBe(true);

      const proposalsContent = fs.readFileSync(
        path.join(tempVault, 'proposals', 'memory-proposals.md'),
        'utf8'
      );
      expect(proposalsContent).toMatch(/daily:2026-04-24/);
    });

    test('unknown prefix falls back to 20-char slice (L187)', async () => {
      const result = await memProposals.writeCandidate({
        content: 'A test memory with an unknown source prefix.',
        category: 'test',
        sourceRef: 'custom:abcdefghijklmnopqrstuvwxyz1234567890',
        confidence: 0.9,
      });

      expect(result.written).toBe(true);

      const proposalsContent = fs.readFileSync(
        path.join(tempVault, 'proposals', 'memory-proposals.md'),
        'utf8'
      );
      // sourceRefShort takes first 20 chars of the full sourceRef
      expect(proposalsContent).toMatch(/custom:abcdefghijklm/);
    });

    test('file: prefix extracts basename without extension', async () => {
      const result = await memProposals.writeCandidate({
        content: 'A memory referencing a file path.',
        category: 'test',
        sourceRef: 'file:/path/to/source.md',
        confidence: 0.9,
      });

      expect(result.written).toBe(true);
      const proposalsContent = fs.readFileSync(
        path.join(tempVault, 'proposals', 'memory-proposals.md'),
        'utf8'
      );
      expect(proposalsContent).toMatch(/file:source/);
    });

    test('session: prefix truncates session id to 8 chars', async () => {
      const result = await memProposals.writeCandidate({
        content: 'A memory from a session.',
        category: 'test',
        sourceRef: 'session:abcdef0123456789',
        confidence: 0.9,
      });

      expect(result.written).toBe(true);
      const proposalsContent = fs.readFileSync(
        path.join(tempVault, 'proposals', 'memory-proposals.md'),
        'utf8'
      );
      expect(proposalsContent).toMatch(/session:abcdef01/);
    });

    test('null sourceRef maps to "unknown"', async () => {
      const result = await memProposals.writeCandidate({
        content: 'A memory with no source reference.',
        category: 'test',
        sourceRef: null,
        confidence: 0.9,
      });

      expect(result.written).toBe(true);
      const proposalsContent = fs.readFileSync(
        path.join(tempVault, 'proposals', 'memory-proposals.md'),
        'utf8'
      );
      expect(proposalsContent).toMatch(/\u00b7 unknown/);
    });
  });

  // ── flushPendingBuffer: L281, L326-327 ────────────────────────────────────

  describe('flushPendingBuffer edge cases', () => {
    test('malformed pending line is swallowed with warning, valid lines still flush (L281)', async () => {
      const pendingPath = path.join(tempVault, 'proposals', 'memory-proposals-pending.jsonl');
      const valid = JSON.stringify({
        content: 'Valid buffered memory',
        category: 'test',
        sourceRef: 'daily:2026-04-24',
        confidence: 0.9,
      });
      fs.writeFileSync(pendingPath, `${valid}\n{ malformed json\n`, 'utf8');

      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await memProposals.flushPendingBuffer();
      errSpy.mockRestore();

      // Valid candidate should have been written
      const proposalsContent = fs.readFileSync(
        path.join(tempVault, 'proposals', 'memory-proposals.md'),
        'utf8'
      );
      expect(proposalsContent).toMatch(/Valid buffered memory/);

      // Pending file is truncated after flush
      expect(fs.readFileSync(pendingPath, 'utf8')).toBe('');
    });

    test('flushPendingBuffer returns silently when lock cannot be acquired (L326-327)', async () => {
      // Hold the lock manually to simulate contention
      const lockPath = path.join(tempVault, 'proposals', 'memory-proposals.md.lock');
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ pid: 99999, acquired: new Date().toISOString(), holder: 'other' })
      );

      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const start = Date.now();

      // flushPendingBuffer times out after ~5 seconds and returns without throwing
      await memProposals.flushPendingBuffer();

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(4500);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Could not acquire lock/)
      );
      errSpy.mockRestore();

      try { fs.unlinkSync(lockPath); } catch (_) { /* cleanup */ }
    }, 10000);

    test('flushPendingBuffer returns early when no pending file exists', async () => {
      // No pending file created
      await expect(memProposals.flushPendingBuffer()).resolves.toBeUndefined();
    });

    test('flushPendingBuffer returns early when pending file is empty', async () => {
      const pendingPath = path.join(tempVault, 'proposals', 'memory-proposals-pending.jsonl');
      fs.writeFileSync(pendingPath, '', 'utf8');

      await expect(memProposals.flushPendingBuffer()).resolves.toBeUndefined();
    });
  });

  // ── acquireLock: L86 non-EEXIST error path ────────────────────────────────

  describe('acquireLock non-EEXIST error path', () => {
    test('acquireLock re-throws when writeFileSync fails with a non-EEXIST error', async () => {
      // Simulate a non-EEXIST write failure by making the proposals dir non-writable.
      // On macOS, chmod 0o555 on the proposals dir blocks file creation with EACCES,
      // which is not EEXIST, so the error path at L86 should execute.
      const proposalsDir = path.join(tempVault, 'proposals');
      fs.chmodSync(proposalsDir, 0o555);

      try {
        await expect(memProposals._testOnly.acquireLock()).rejects.toThrow();
      } finally {
        // Restore permissions so cleanup can remove the dir
        fs.chmodSync(proposalsDir, 0o755);
      }
    });
  });

  // ── isDuplicate archive dir missing (happy path) ──────────────────────────

  describe('isDuplicate with archive dir missing', () => {
    test('writeCandidate succeeds even when memory-archive dir does not exist', async () => {
      // Ensure archive dir is absent (it is by default since we only create proposals/ and memory/)
      const archiveDir = path.join(tempVault, 'memory-archive');
      expect(fs.existsSync(archiveDir)).toBe(false);

      const result = await memProposals.writeCandidate({
        content: 'A memory written with no archive directory present.',
        category: 'test',
        sourceRef: 'daily:2026-04-24',
        confidence: 0.9,
      });

      expect(result.written).toBe(true);
    });
  });
});

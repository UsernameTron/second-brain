'use strict';

/**
 * lifecycle.test.js
 *
 * Tests for src/lifecycle.js — dead-letter auto-retry and left-proposal auto-archive.
 * Covers: retryDeadLetters, archiveStaleLeftProposals.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Test environment setup ───────────────────────────────────────────────────

let tmpDir;
let vaultRoot;
let unroutedDir;
let leftProposalsDir;
let lifecycle;

// Config override dir (real config)
const REAL_CONFIG_DIR = path.join(__dirname, '..', 'config');

function setupDirs() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-test-'));
  vaultRoot = tmpDir;
  unroutedDir = path.join(vaultRoot, 'proposals', 'unrouted');
  leftProposalsDir = path.join(vaultRoot, 'proposals', 'left-proposals');
  fs.mkdirSync(unroutedDir, { recursive: true });
  fs.mkdirSync(leftProposalsDir, { recursive: true });
  fs.mkdirSync(path.join(unroutedDir, 'promoted'), { recursive: true });
  fs.mkdirSync(path.join(unroutedDir, 'rerouted'), { recursive: true });
  fs.mkdirSync(path.join(leftProposalsDir, 'archive'), { recursive: true });
}

function makeDeadLetter(opts = {}) {
  const {
    failureMode = 'api-error',
    retryCount = 0,
    status = 'unrouted',
    createdMinutesAgo = 30,
    body = 'This is the original input content.',
  } = opts;

  const created = new Date(Date.now() - createdMinutesAgo * 60 * 1000).toISOString();
  const frontmatter = [
    '---',
    `created: ${created}`,
    `failure-mode: ${failureMode}`,
    `correlation-id: test-corr-id-12345678`,
    `status: ${status}`,
    `retry-count: ${retryCount}`,
    'original-source: unknown',
    '---',
  ].join('\n');

  return `${frontmatter}\n${body}`;
}

function makeLeftProposal(opts = {}) {
  const {
    status = 'pending',
    createdDaysAgo = 20,
  } = opts;

  const created = new Date(Date.now() - createdDaysAgo * 24 * 60 * 60 * 1000).toISOString();
  const frontmatter = [
    '---',
    `created: ${created}`,
    'suggested-left-path: Daily/',
    `status: ${status}`,
    'correlation-id: test-proposal-id-1234',
    '---',
  ].join('\n');

  return `${frontmatter}\nSome left-side proposal content.`;
}

function writeDeadLetterFile(filename, content) {
  fs.writeFileSync(path.join(unroutedDir, filename), content, 'utf8');
}

function writeLeftProposalFile(filename, content) {
  fs.writeFileSync(path.join(leftProposalsDir, filename), content, 'utf8');
}

beforeEach(() => {
  setupDirs();

  process.env.VAULT_ROOT = vaultRoot;
  process.env.CONFIG_DIR_OVERRIDE = REAL_CONFIG_DIR;

  jest.resetModules();

  // Mock classifier so we can control retry success/failure
  jest.mock('../src/classifier', () => ({
    classifyInput: jest.fn(),
    runStage0: jest.fn(),
  }));

  // Mock note-formatter
  jest.mock('../src/note-formatter', () => ({
    formatNote: jest.fn().mockReturnValue('# Formatted Note\n\nContent here.'),
    generateFilename: jest.fn().mockReturnValue('formatted-note'),
  }));

  // Mock vault-gateway write for destination
  jest.mock('../src/vault-gateway', () => ({
    vaultWrite: jest.fn().mockResolvedValue({ decision: 'WRITTEN', path: 'memory/formatted-note.md' }),
    vaultRead: jest.fn(),
    logDecision: jest.fn(),
  }));

  lifecycle = require('../src/lifecycle');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
  delete process.env.CONFIG_DIR_OVERRIDE;
  jest.restoreAllMocks();
});

// ── retryDeadLetters ────────────────────────────────────────────────────────

describe('retryDeadLetters', () => {
  test('returns summary object with retried, succeeded, failed, frozen, skipped fields', async () => {
    const result = await lifecycle.retryDeadLetters();
    expect(result).toMatchObject({
      retried: expect.any(Number),
      succeeded: expect.any(Number),
      failed: expect.any(Number),
      frozen: expect.any(Number),
      skipped: expect.any(Number),
    });
  });

  test('returns all zeros when unrouted directory is empty', async () => {
    const result = await lifecycle.retryDeadLetters();
    expect(result).toEqual({ retried: 0, succeeded: 0, failed: 0, frozen: 0, skipped: 0 });
  });

  test('skips files with non-retryable failure-mode: parse-error', async () => {
    writeDeadLetterFile('dl-parse.md', makeDeadLetter({ failureMode: 'parse-error' }));
    const result = await lifecycle.retryDeadLetters();
    expect(result.skipped).toBe(1);
    expect(result.retried).toBe(0);
  });

  test('skips files with non-retryable failure-mode: confidence-floor', async () => {
    writeDeadLetterFile('dl-conf.md', makeDeadLetter({ failureMode: 'confidence-floor' }));
    const result = await lifecycle.retryDeadLetters();
    expect(result.skipped).toBe(1);
    expect(result.retried).toBe(0);
  });

  test('skips files with non-retryable failure-mode: gate-rejection', async () => {
    writeDeadLetterFile('dl-gate.md', makeDeadLetter({ failureMode: 'gate-rejection' }));
    const result = await lifecycle.retryDeadLetters();
    expect(result.skipped).toBe(1);
    expect(result.retried).toBe(0);
  });

  test('skips files with non-retryable failure-mode: non-interactive-ambiguous', async () => {
    writeDeadLetterFile('dl-ambig.md', makeDeadLetter({ failureMode: 'non-interactive-ambiguous' }));
    const result = await lifecycle.retryDeadLetters();
    expect(result.skipped).toBe(1);
    expect(result.retried).toBe(0);
  });

  test('skips files with status: frozen', async () => {
    writeDeadLetterFile('dl-frozen.md', makeDeadLetter({ failureMode: 'api-error', status: 'frozen' }));
    const result = await lifecycle.retryDeadLetters();
    expect(result.skipped).toBe(1);
    expect(result.retried).toBe(0);
  });

  test('skips files where retry-count >= maxAttempts (3)', async () => {
    writeDeadLetterFile('dl-maxed.md', makeDeadLetter({ failureMode: 'api-error', retryCount: 3 }));
    const result = await lifecycle.retryDeadLetters();
    expect(result.skipped).toBe(1);
    expect(result.retried).toBe(0);
  });

  test('skips files modified less than delayMinutes (15) ago', async () => {
    writeDeadLetterFile('dl-recent.md', makeDeadLetter({ failureMode: 'api-error', createdMinutesAgo: 5 }));
    const result = await lifecycle.retryDeadLetters();
    expect(result.skipped).toBe(1);
    expect(result.retried).toBe(0);
  });

  test('retries files with retryable failure-mode: api-error older than delayMinutes', async () => {
    const { classifyInput } = require('../src/classifier');
    classifyInput.mockResolvedValue({
      success: true,
      side: 'RIGHT',
      directory: 'memory',
      confidence: 0.9,
    });

    writeDeadLetterFile('dl-api.md', makeDeadLetter({ failureMode: 'api-error', createdMinutesAgo: 30 }));
    const result = await lifecycle.retryDeadLetters();
    expect(result.retried).toBe(1);
  });

  test('retries files with retryable failure-mode: timeout', async () => {
    const { classifyInput } = require('../src/classifier');
    classifyInput.mockResolvedValue({
      success: true,
      side: 'RIGHT',
      directory: 'memory',
      confidence: 0.9,
    });

    writeDeadLetterFile('dl-timeout.md', makeDeadLetter({ failureMode: 'timeout', createdMinutesAgo: 30 }));
    const result = await lifecycle.retryDeadLetters();
    expect(result.retried).toBe(1);
  });

  test('retries files with retryable failure-mode: exclusion-unavailable', async () => {
    const { classifyInput } = require('../src/classifier');
    classifyInput.mockResolvedValue({
      success: true,
      side: 'RIGHT',
      directory: 'memory',
      confidence: 0.9,
    });

    writeDeadLetterFile('dl-excl.md', makeDeadLetter({ failureMode: 'exclusion-unavailable', createdMinutesAgo: 30 }));
    const result = await lifecycle.retryDeadLetters();
    expect(result.retried).toBe(1);
  });

  test('on successful retry: succeeded increments', async () => {
    const { classifyInput } = require('../src/classifier');
    classifyInput.mockResolvedValue({
      success: true,
      side: 'RIGHT',
      directory: 'memory',
      confidence: 0.9,
    });

    writeDeadLetterFile('dl-ok.md', makeDeadLetter({ failureMode: 'api-error', createdMinutesAgo: 30 }));
    const result = await lifecycle.retryDeadLetters();
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
  });

  test('on successful retry: original dead-letter moved to promoted/ directory', async () => {
    const { classifyInput } = require('../src/classifier');
    classifyInput.mockResolvedValue({
      success: true,
      side: 'RIGHT',
      directory: 'memory',
      confidence: 0.9,
    });

    writeDeadLetterFile('dl-move.md', makeDeadLetter({ failureMode: 'api-error', createdMinutesAgo: 30 }));
    await lifecycle.retryDeadLetters();

    const promotedDir = path.join(unroutedDir, 'promoted');
    const promotedFiles = fs.readdirSync(promotedDir);
    expect(promotedFiles).toContain('dl-move.md');

    // Original should be gone
    expect(fs.existsSync(path.join(unroutedDir, 'dl-move.md'))).toBe(false);
  });

  test('on failed retry: increments retry-count in frontmatter', async () => {
    const { classifyInput } = require('../src/classifier');
    classifyInput.mockResolvedValue({
      success: false,
      failureMode: 'api-error',
    });

    writeDeadLetterFile('dl-fail.md', makeDeadLetter({ failureMode: 'api-error', retryCount: 0, createdMinutesAgo: 30 }));
    await lifecycle.retryDeadLetters();

    const updatedContent = fs.readFileSync(path.join(unroutedDir, 'dl-fail.md'), 'utf8');
    expect(updatedContent).toMatch(/retry-count: 1/);
  });

  test('on failed retry: adds last-retry timestamp to frontmatter', async () => {
    const { classifyInput } = require('../src/classifier');
    classifyInput.mockResolvedValue({
      success: false,
      failureMode: 'api-error',
    });

    writeDeadLetterFile('dl-ts.md', makeDeadLetter({ failureMode: 'api-error', retryCount: 1, createdMinutesAgo: 30 }));
    await lifecycle.retryDeadLetters();

    const updatedContent = fs.readFileSync(path.join(unroutedDir, 'dl-ts.md'), 'utf8');
    expect(updatedContent).toMatch(/last-retry:/);
  });

  test('on failed retry: sets status: frozen when retry-count reaches maxAttempts (3)', async () => {
    const { classifyInput } = require('../src/classifier');
    classifyInput.mockResolvedValue({
      success: false,
      failureMode: 'api-error',
    });

    // retryCount is 2, so after this attempt it becomes 3 and should freeze
    writeDeadLetterFile('dl-freeze.md', makeDeadLetter({ failureMode: 'api-error', retryCount: 2, createdMinutesAgo: 30 }));
    const result = await lifecycle.retryDeadLetters();

    expect(result.frozen).toBe(1);
    const updatedContent = fs.readFileSync(path.join(unroutedDir, 'dl-freeze.md'), 'utf8');
    expect(updatedContent).toMatch(/status: frozen/);
  });

  test('ignores files in promoted/ and rerouted/ subdirectories', async () => {
    // Write a file to the promoted/ subdir — should not be retried
    const promotedFile = path.join(unroutedDir, 'promoted', 'old-promoted.md');
    fs.writeFileSync(promotedFile, makeDeadLetter({ failureMode: 'api-error', createdMinutesAgo: 60 }), 'utf8');

    const result = await lifecycle.retryDeadLetters();
    expect(result.retried).toBe(0);
    expect(result.skipped).toBe(0);
  });

  test('delayMinutes reads from pipeline config (retry.delayMinutes)', async () => {
    // The test above (skips files < 15 min old) implicitly verifies delayMinutes config usage.
    // This test verifies the config path is referenced correctly by checking behavior.
    writeDeadLetterFile('dl-delay.md', makeDeadLetter({ failureMode: 'api-error', createdMinutesAgo: 10 }));
    const result = await lifecycle.retryDeadLetters();
    // 10 minutes < 15 minutes (delayMinutes), so should be skipped
    expect(result.skipped).toBe(1);
  });

  // T12.4 — write/move isolation tests
  test('vaultWrite rejection keeps dead-letter in unrouted, succeeded=0', async () => {
    const { classifyInput } = require('../src/classifier');
    classifyInput.mockResolvedValue({ success: true, directory: 'memory', side: 'RIGHT', confidence: 0.9 });
    const { vaultWrite, logDecision } = require('../src/vault-gateway');
    vaultWrite.mockRejectedValue(new Error('vault write failed'));

    writeDeadLetterFile('dl-write-fail.md', makeDeadLetter({ createdMinutesAgo: 30 }));
    const result = await lifecycle.retryDeadLetters();

    expect(result.succeeded).toBe(0);
    expect(logDecision).toHaveBeenCalledWith('RETRY', expect.any(String), 'WRITE_FAILED', 'vault write failed');
    // Original file should still exist in unrouted/
    expect(fs.existsSync(path.join(unroutedDir, 'dl-write-fail.md'))).toBe(true);
  });

  test('vaultWrite QUARANTINED result still removes from unrouted, logs QUARANTINED', async () => {
    const { classifyInput } = require('../src/classifier');
    classifyInput.mockResolvedValue({ success: true, directory: 'memory', side: 'RIGHT', confidence: 0.9 });
    const { vaultWrite, logDecision } = require('../src/vault-gateway');
    vaultWrite.mockResolvedValue({ decision: 'QUARANTINED', quarantinePath: 'quarantine/test.md' });

    writeDeadLetterFile('dl-quarantined.md', makeDeadLetter({ createdMinutesAgo: 30 }));
    const result = await lifecycle.retryDeadLetters();

    expect(result.succeeded).toBe(1);
    expect(logDecision).toHaveBeenCalledWith('RETRY', expect.any(String), 'QUARANTINED', expect.any(String));
    // Original should be removed from unrouted/
    expect(fs.existsSync(path.join(unroutedDir, 'dl-quarantined.md'))).toBe(false);
  });

  test('write success + move/unlink failure still counts as succeeded, logs MOVE_FAILED', async () => {
    const { classifyInput } = require('../src/classifier');
    classifyInput.mockResolvedValue({ success: true, directory: 'memory', side: 'RIGHT', confidence: 0.9 });
    const { vaultWrite, logDecision } = require('../src/vault-gateway');
    vaultWrite.mockResolvedValue({ decision: 'WRITTEN', path: 'memory/note.md' });

    writeDeadLetterFile('dl-move-fail.md', makeDeadLetter({ createdMinutesAgo: 30 }));

    // Make promoted dir read-only to force move failure
    const promotedDir = path.join(unroutedDir, 'promoted');
    fs.chmodSync(promotedDir, 0o444);

    const result = await lifecycle.retryDeadLetters();

    // Restore permissions for cleanup
    fs.chmodSync(promotedDir, 0o755);

    expect(result.succeeded).toBe(1);
    expect(logDecision).toHaveBeenCalledWith('RETRY', expect.any(String), 'MOVE_FAILED', expect.stringContaining('write succeeded but move failed'));
  });
});

// ── archiveStaleLeftProposals ────────────────────────────────────────────────

describe('archiveStaleLeftProposals', () => {
  test('returns summary object with archived and skipped fields', async () => {
    const result = await lifecycle.archiveStaleLeftProposals();
    expect(result).toMatchObject({
      archived: expect.any(Number),
      skipped: expect.any(Number),
    });
  });

  test('returns { archived: 0, skipped: 0 } when left-proposals directory is empty', async () => {
    const result = await lifecycle.archiveStaleLeftProposals();
    expect(result).toEqual({ archived: 0, skipped: 0 });
  });

  test('archives pending proposals older than autoArchiveDays (14)', async () => {
    writeLeftProposalFile('old-proposal.md', makeLeftProposal({ status: 'pending', createdDaysAgo: 20 }));
    const result = await lifecycle.archiveStaleLeftProposals();
    expect(result.archived).toBe(1);
    expect(result.skipped).toBe(0);
  });

  test('moves archived file to proposals/left-proposals/archive/', async () => {
    writeLeftProposalFile('stale-proposal.md', makeLeftProposal({ status: 'pending', createdDaysAgo: 20 }));
    await lifecycle.archiveStaleLeftProposals();

    const archiveDir = path.join(leftProposalsDir, 'archive');
    const archivedFiles = fs.readdirSync(archiveDir);
    expect(archivedFiles).toContain('stale-proposal.md');

    // Original should be gone
    expect(fs.existsSync(path.join(leftProposalsDir, 'stale-proposal.md'))).toBe(false);
  });

  test('updates frontmatter: status: archived in archived file', async () => {
    writeLeftProposalFile('stale2.md', makeLeftProposal({ status: 'pending', createdDaysAgo: 20 }));
    await lifecycle.archiveStaleLeftProposals();

    const archivePath = path.join(leftProposalsDir, 'archive', 'stale2.md');
    const content = fs.readFileSync(archivePath, 'utf8');
    expect(content).toMatch(/status: archived/);
  });

  test('adds archived-at ISO-8601 timestamp to archived file frontmatter', async () => {
    writeLeftProposalFile('stale3.md', makeLeftProposal({ status: 'pending', createdDaysAgo: 20 }));
    await lifecycle.archiveStaleLeftProposals();

    const archivePath = path.join(leftProposalsDir, 'archive', 'stale3.md');
    const content = fs.readFileSync(archivePath, 'utf8');
    expect(content).toMatch(/archived-at:/);
  });

  test('preserves files with status: pending that are within autoArchiveDays', async () => {
    writeLeftProposalFile('fresh-proposal.md', makeLeftProposal({ status: 'pending', createdDaysAgo: 5 }));
    const result = await lifecycle.archiveStaleLeftProposals();
    expect(result.skipped).toBe(1);
    expect(result.archived).toBe(0);

    // File should still be in left-proposals (not archived)
    expect(fs.existsSync(path.join(leftProposalsDir, 'fresh-proposal.md'))).toBe(true);
  });

  test('preserves files with non-pending status (already processed)', async () => {
    writeLeftProposalFile('processed.md', makeLeftProposal({ status: 'approved', createdDaysAgo: 30 }));
    const result = await lifecycle.archiveStaleLeftProposals();
    expect(result.skipped).toBe(1);
    expect(result.archived).toBe(0);
  });

  test('ignores files in archive/ subdirectory', async () => {
    // Write a file directly in the archive/ subdir — should not be re-processed
    const archiveFile = path.join(leftProposalsDir, 'archive', 'already-archived.md');
    fs.writeFileSync(archiveFile, makeLeftProposal({ status: 'archived', createdDaysAgo: 30 }), 'utf8');

    const result = await lifecycle.archiveStaleLeftProposals();
    expect(result.archived).toBe(0);
    expect(result.skipped).toBe(0);
  });

  test('autoArchiveDays reads from pipeline config (leftProposal.autoArchiveDays)', async () => {
    // 14 days is the threshold. A 13-day-old pending proposal should NOT be archived.
    writeLeftProposalFile('almost-stale.md', makeLeftProposal({ status: 'pending', createdDaysAgo: 13 }));
    const result = await lifecycle.archiveStaleLeftProposals();
    expect(result.skipped).toBe(1);
    expect(result.archived).toBe(0);
  });

  test('handles mixed stale/fresh proposals correctly', async () => {
    writeLeftProposalFile('stale-a.md', makeLeftProposal({ status: 'pending', createdDaysAgo: 20 }));
    writeLeftProposalFile('stale-b.md', makeLeftProposal({ status: 'pending', createdDaysAgo: 25 }));
    writeLeftProposalFile('fresh-c.md', makeLeftProposal({ status: 'pending', createdDaysAgo: 3 }));

    const result = await lifecycle.archiveStaleLeftProposals();
    expect(result.archived).toBe(2);
    expect(result.skipped).toBe(1);
  });
});

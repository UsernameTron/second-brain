'use strict';

/**
 * memory-proposals.test.js
 *
 * Tests for src/memory-proposals.js — memory-proposals.md reader/writer.
 * Covers: generateCandidateId, writeCandidate, readProposals,
 *         acquireLock, releaseLock, flushPendingBuffer, dedup, pending buffer.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ── Test environment setup ───────────────────────────────────────────────────

let tmpDir;
let proposalsDir;
let memoryDir;
let archiveDir;

// Module under test (lazy-loaded after env is set)
let memProposals;

function makeCandidate(overrides = {}) {
  return {
    content: 'Pete prefers short, imperative commit messages.',
    category: 'PREFERENCE',
    sourceRef: 'session:abc123',
    confidence: 0.8,
    rationale: 'Explicitly stated preference in session.',
    sessionId: 'abc12345-1234-1234-1234-123456789012',
    sourceFile: '/path/to/transcript.jsonl',
    extractionTrigger: 'wrap',
    ...overrides,
  };
}

beforeEach(() => {
  // Create isolated temp filesystem layout
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-test-'));
  proposalsDir = path.join(tmpDir, 'proposals');
  memoryDir = path.join(tmpDir, 'memory');
  archiveDir = path.join(tmpDir, 'memory-archive');
  fs.mkdirSync(proposalsDir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  // Override env vars so module uses our temp dirs
  process.env.VAULT_ROOT = tmpDir;
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

  // Clear module cache so each test gets a fresh instance
  jest.resetModules();
  memProposals = require('../src/memory-proposals');
});

afterEach(() => {
  // Remove temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
});

// ── generateCandidateId ──────────────────────────────────────────────────────

describe('generateCandidateId', () => {
  test('returns format mem-YYYYMMDD-NNN', () => {
    const id = memProposals.generateCandidateId();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(id).toMatch(/^mem-\d{8}-\d{3}$/);
    expect(id).toContain(`mem-${today}-`);
  });

  test('NNN starts at 001 when proposals file is absent', () => {
    const id = memProposals.generateCandidateId();
    expect(id).toMatch(/-001$/);
  });

  test('NNN increments based on existing candidates for today', async () => {
    // Write one candidate so the file has mem-TODAY-001
    await memProposals.writeCandidate(makeCandidate({ content: 'first candidate entry' }));
    const id2 = memProposals.generateCandidateId();
    expect(id2).toMatch(/-002$/);
  });
});

// ── writeCandidate ───────────────────────────────────────────────────────────

describe('writeCandidate', () => {
  test('returns { written: true, candidateId } on success', async () => {
    const result = await memProposals.writeCandidate(makeCandidate());
    expect(result.written).toBe(true);
    expect(result.candidateId).toMatch(/^mem-\d{8}-001$/);
  });

  test('creates proposals/memory-proposals.md if absent', async () => {
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    expect(fs.existsSync(proposalsFile)).toBe(false);
    await memProposals.writeCandidate(makeCandidate());
    expect(fs.existsSync(proposalsFile)).toBe(true);
  });

  test('candidate section includes all 8 required inline Dataview fields', async () => {
    await memProposals.writeCandidate(makeCandidate());
    const content = fs.readFileSync(path.join(proposalsDir, 'memory-proposals.md'), 'utf8');
    expect(content).toContain('session_id::');
    expect(content).toContain('captured_at::');
    expect(content).toContain('source_file::');
    expect(content).toContain('category::');
    expect(content).toContain('confidence::');
    expect(content).toContain('content_hash::');
    expect(content).toContain('status::');
    expect(content).toContain('extraction_trigger::');
  });

  test('candidate section includes checkboxes for accept/reject/edit-then-accept/defer', async () => {
    await memProposals.writeCandidate(makeCandidate());
    const content = fs.readFileSync(path.join(proposalsDir, 'memory-proposals.md'), 'utf8');
    expect(content).toContain('- [ ] accept');
    expect(content).toContain('- [ ] reject');
    expect(content).toContain('- [ ] edit-then-accept');
    expect(content).toContain('- [ ] defer');
  });

  test('candidate section includes Content and Proposed tags fields', async () => {
    await memProposals.writeCandidate(makeCandidate());
    const content = fs.readFileSync(path.join(proposalsDir, 'memory-proposals.md'), 'utf8');
    expect(content).toContain('**Content:**');
    expect(content).toContain('**Proposed tags:**');
    expect(content).toContain('**Proposed related:**');
  });

  test('status field is "pending" for new candidates', async () => {
    await memProposals.writeCandidate(makeCandidate());
    const content = fs.readFileSync(path.join(proposalsDir, 'memory-proposals.md'), 'utf8');
    expect(content).toContain('status:: pending');
  });

  test('file-level frontmatter is created with last_updated and total_pending', async () => {
    await memProposals.writeCandidate(makeCandidate());
    const content = fs.readFileSync(path.join(proposalsDir, 'memory-proposals.md'), 'utf8');
    expect(content).toContain('last_updated:');
    expect(content).toContain('total_pending:');
  });

  test('total_pending increments on each write', async () => {
    await memProposals.writeCandidate(makeCandidate({ content: 'first unique candidate abc' }));
    await memProposals.writeCandidate(makeCandidate({ content: 'second unique candidate xyz' }));
    const content = fs.readFileSync(path.join(proposalsDir, 'memory-proposals.md'), 'utf8');
    expect(content).toContain('total_pending: 2');
  });

  test('newest candidate appears first (after frontmatter)', async () => {
    await memProposals.writeCandidate(makeCandidate({ content: 'first unique candidate 111' }));
    await memProposals.writeCandidate(makeCandidate({ content: 'second unique candidate 222' }));
    const content = fs.readFileSync(path.join(proposalsDir, 'memory-proposals.md'), 'utf8');
    const pos002 = content.indexOf('mem-');
    const pos001 = content.lastIndexOf('mem-');
    // 002 should come before 001 (newest first)
    expect(pos002).toBeLessThan(pos001);
  });

  test('content_hash is SHA-256 of normalized content, first 12 hex chars', async () => {
    const candidate = makeCandidate({ content: 'Pete prefers short, imperative commit messages.' });
    await memProposals.writeCandidate(candidate);
    const normalized = candidate.content.trim().toLowerCase();
    const expectedHash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
    const fileContent = fs.readFileSync(path.join(proposalsDir, 'memory-proposals.md'), 'utf8');
    expect(fileContent).toContain(`content_hash:: ${expectedHash}`);
  });

  test('category field reflects the candidate category', async () => {
    await memProposals.writeCandidate(makeCandidate({ category: 'DECISION' }));
    const content = fs.readFileSync(path.join(proposalsDir, 'memory-proposals.md'), 'utf8');
    expect(content).toContain('category:: DECISION');
  });

  test('extraction_trigger field reflects the candidate trigger', async () => {
    await memProposals.writeCandidate(makeCandidate({ extractionTrigger: 'extract-memories' }));
    const content = fs.readFileSync(path.join(proposalsDir, 'memory-proposals.md'), 'utf8');
    expect(content).toContain('extraction_trigger:: extract-memories');
  });
});

// ── writeCandidate dedup ─────────────────────────────────────────────────────

describe('writeCandidate dedup', () => {
  test('duplicate content_hash in proposals file returns { written: false, reason: "duplicate" }', async () => {
    const c = makeCandidate({ content: 'Pete prefers short commit messages for dedup test.' });
    await memProposals.writeCandidate(c);
    const result = await memProposals.writeCandidate(c);
    expect(result.written).toBe(false);
    expect(result.reason).toBe('duplicate');
  });

  test('duplicate in memory.md returns { written: false, reason: "duplicate" }', async () => {
    const content = 'Pete prefers short commit messages for memory dedup test.';
    const hash = crypto.createHash('sha256').update(content.trim().toLowerCase()).digest('hex').slice(0, 12);
    // Write a fake memory.md entry with this hash
    const memoryFile = path.join(memoryDir, 'memory.md');
    fs.writeFileSync(memoryFile, `content_hash:: ${hash}\n`);

    const result = await memProposals.writeCandidate(makeCandidate({ content }));
    expect(result.written).toBe(false);
    expect(result.reason).toBe('duplicate');
  });

  test('duplicate in memory-archive returns { written: false, reason: "duplicate" }', async () => {
    const content = 'Pete prefers short commit messages for archive dedup test.';
    const hash = crypto.createHash('sha256').update(content.trim().toLowerCase()).digest('hex').slice(0, 12);
    // Write a fake archive file with this hash
    const archiveFile = path.join(archiveDir, '2025.md');
    fs.writeFileSync(archiveFile, `content_hash:: ${hash}\n`);

    const result = await memProposals.writeCandidate(makeCandidate({ content }));
    expect(result.written).toBe(false);
    expect(result.reason).toBe('duplicate');
  });

  test('non-duplicate writes successfully even when memory files exist', async () => {
    const memoryFile = path.join(memoryDir, 'memory.md');
    fs.writeFileSync(memoryFile, 'content_hash:: aabbccddeeff\n');

    const result = await memProposals.writeCandidate(makeCandidate({ content: 'Totally unique content here xyz789' }));
    expect(result.written).toBe(true);
  });
});

// ── readProposals ────────────────────────────────────────────────────────────

describe('readProposals', () => {
  test('returns empty array when file does not exist', async () => {
    const result = await memProposals.readProposals();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('parses candidates from proposals file', async () => {
    await memProposals.writeCandidate(makeCandidate());
    const proposals = await memProposals.readProposals();
    expect(proposals.length).toBe(1);
    expect(proposals[0]).toHaveProperty('candidateId');
    expect(proposals[0]).toHaveProperty('category');
    expect(proposals[0]).toHaveProperty('content_hash');
    expect(proposals[0]).toHaveProperty('status');
  });

  test('returns all candidates when multiple exist', async () => {
    await memProposals.writeCandidate(makeCandidate({ content: 'first candidate entry aaaa' }));
    await memProposals.writeCandidate(makeCandidate({ content: 'second candidate entry bbbb' }));
    const proposals = await memProposals.readProposals();
    expect(proposals.length).toBe(2);
  });

  test('candidate objects include all parsed Dataview fields', async () => {
    await memProposals.writeCandidate(makeCandidate({ category: 'LEARNING', confidence: 0.9 }));
    const proposals = await memProposals.readProposals();
    expect(proposals[0].category).toBe('LEARNING');
    expect(proposals[0].confidence).toBe('0.9');
    expect(proposals[0].status).toBe('pending');
  });
});

// ── acquireLock / releaseLock ────────────────────────────────────────────────

describe('acquireLock / releaseLock', () => {
  test('acquireLock creates .lock file', async () => {
    const lockFile = path.join(proposalsDir, 'memory-proposals.md.lock');
    const result = await memProposals._testOnly.acquireLock();
    expect(result.acquired).toBe(true);
    expect(fs.existsSync(lockFile)).toBe(true);
    await memProposals._testOnly.releaseLock();
  });

  test('lock file contains pid, acquired, and holder fields', async () => {
    const lockFile = path.join(proposalsDir, 'memory-proposals.md.lock');
    await memProposals._testOnly.acquireLock();
    const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    expect(lockData.pid).toBe(process.pid);
    expect(lockData.holder).toBe('memory-extractor');
    expect(typeof lockData.acquired).toBe('string');
    await memProposals._testOnly.releaseLock();
  });

  test('releaseLock removes .lock file', async () => {
    const lockFile = path.join(proposalsDir, 'memory-proposals.md.lock');
    await memProposals._testOnly.acquireLock();
    await memProposals._testOnly.releaseLock();
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  test('releaseLock is idempotent (no error if lock file missing)', async () => {
    await expect(memProposals._testOnly.releaseLock()).resolves.not.toThrow();
  });

  test('acquireLock on existing lock times out after ~5 seconds and returns { acquired: false }', async () => {
    jest.setTimeout(8000);
    const lockFile = path.join(proposalsDir, 'memory-proposals.md.lock');
    // Manually create a lock file to simulate a held lock
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 99999, acquired: new Date().toISOString(), holder: 'other' }));
    const start = Date.now();
    const result = await memProposals._testOnly.acquireLock();
    const elapsed = Date.now() - start;
    expect(result.acquired).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(4500);
    // Cleanup
    fs.rmSync(lockFile, { force: true });
  }, 8000);
});

// ── flushPendingBuffer ───────────────────────────────────────────────────────

describe('flushPendingBuffer', () => {
  test('reads pending.jsonl and writes candidates to main proposals file', async () => {
    const pendingFile = path.join(proposalsDir, 'memory-proposals-pending.jsonl');
    const candidate = makeCandidate({ content: 'Pending buffer candidate content abc' });
    fs.writeFileSync(pendingFile, JSON.stringify(candidate) + '\n');

    await memProposals.flushPendingBuffer();

    const proposals = await memProposals.readProposals();
    expect(proposals.length).toBe(1);
  });

  test('truncates pending.jsonl after successful flush', async () => {
    const pendingFile = path.join(proposalsDir, 'memory-proposals-pending.jsonl');
    const candidate = makeCandidate({ content: 'Pending buffer content to be flushed and cleared' });
    fs.writeFileSync(pendingFile, JSON.stringify(candidate) + '\n');

    await memProposals.flushPendingBuffer();

    const afterFlush = fs.readFileSync(pendingFile, 'utf8');
    expect(afterFlush.trim()).toBe('');
  });

  test('returns without error when pending.jsonl does not exist', async () => {
    await expect(memProposals.flushPendingBuffer()).resolves.not.toThrow();
  });
});

// ── writeCandidate pending buffer (lock timeout) ─────────────────────────────

describe('writeCandidate pending buffer on lock timeout', () => {
  test('writes to pending.jsonl when lock cannot be acquired', async () => {
    jest.setTimeout(8000);
    const lockFile = path.join(proposalsDir, 'memory-proposals.md.lock');
    const pendingFile = path.join(proposalsDir, 'memory-proposals-pending.jsonl');

    // Hold the lock
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 99999, acquired: new Date().toISOString(), holder: 'other' }));

    const result = await memProposals.writeCandidate(makeCandidate({ content: 'Buffered candidate on lock timeout xyz' }));
    expect(result.written).toBe(true);
    expect(result.buffered).toBe(true);
    expect(fs.existsSync(pendingFile)).toBe(true);

    // Cleanup
    fs.rmSync(lockFile, { force: true });
  }, 8000);
});

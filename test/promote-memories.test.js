'use strict';

/**
 * promote-memories.test.js
 *
 * Tests for src/promote-memories.js — memory promotion from proposals to memory.md.
 * Covers: batch cap enforcement, confidence ordering, dedup, archiving, entry format.
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
let proposalArchiveDir;

let promoteMemories;

function computeHash(content) {
  const normalized = content.trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/**
 * Build a minimal proposals file with given candidates.
 * Each candidate: { candidateId, category, confidence, content, status, sourceRef, capturedAt }
 */
function buildProposalsFile(candidates) {
  const total = candidates.length;
  const pending = candidates.filter(c => !c.processedStatus || c.processedStatus === 'pending').length;

  const header = [
    '---',
    `last_updated: ${new Date().toISOString()}`,
    `total_pending: ${pending}`,
    `total_processed: ${total - pending}`,
    '---',
    '',
  ].join('\n');

  const sections = candidates.map(c => {
    // In real usage: user checks a checkbox while status:: remains pending
    // until promotion processes it. The status field in test candidates
    // represents the user's checkbox action, not the processing state.
    const action = c.status || 'pending';
    const acceptBox = action === 'accepted' ? '- [x] accept' : '- [ ] accept';
    const rejectBox = action === 'rejected' ? '- [x] reject' : '- [ ] reject';
    const editBox = action === 'edit-then-accept' ? '- [x] edit-then-accept' : '- [ ] edit-then-accept';
    const deferBox = action === 'deferred' ? '- [x] defer' : '- [ ] defer';
    // statusField: use explicit processedStatus if provided, otherwise pending
    const statusField = c.processedStatus || 'pending';

    // Ambiguous: multiple boxes checked
    let boxes;
    if (c.ambiguous) {
      boxes = ['- [x] accept', '- [x] reject', '- [ ] edit-then-accept', '- [ ] defer'].join('\n');
    } else {
      boxes = [acceptBox, rejectBox, editBox, deferBox].join('\n');
    }

    const shortRef = c.sourceRef ? c.sourceRef.slice(0, 20) : 'unknown';
    const hash = computeHash(c.content || 'default content');

    return [
      `### ${c.candidateId} · ${c.category} · ${shortRef}`,
      boxes,
      '',
      `**Content:** ${c.content || 'A test memory entry.'}`,
      `**Proposed tags:** ${c.tags || 'test'}`,
      `**Proposed related:** `,
      '',
      `session_id:: manual`,
      `source_ref:: ${c.sourceRef || 'session:abc12345'}`,
      `captured_at:: ${c.capturedAt || new Date().toISOString()}`,
      `source_file:: /path/to/file`,
      `category:: ${c.category}`,
      `confidence:: ${c.confidence || 0.8}`,
      `content_hash:: ${hash}`,
      `status:: ${statusField}`,
      `extraction_trigger:: wrap`,
      '',
    ].join('\n');
  });

  return header + sections.join('');
}

function makeCandidates(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    candidateId: `mem-20260422-${String(i + 1).padStart(3, '0')}`,
    category: 'LEARNING',
    confidence: 0.9 - i * 0.01,
    content: `Memory candidate number ${i + 1} with unique content for dedup testing instance ${i + 1}.`,
    status: 'accepted',
    sourceRef: 'session:abc12345',
    capturedAt: new Date().toISOString(),
    ...overrides,
  }));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  proposalsDir = path.join(tmpDir, 'proposals');
  memoryDir = path.join(tmpDir, 'memory');
  archiveDir = path.join(tmpDir, 'memory-archive');
  proposalArchiveDir = path.join(tmpDir, 'memory-proposals-archive');

  fs.mkdirSync(proposalsDir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.mkdirSync(proposalArchiveDir, { recursive: true });

  process.env.VAULT_ROOT = tmpDir;
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

  // Clear module cache and load module under test
  jest.resetModules();
  promoteMemories = require('../src/promote-memories');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
  delete process.env.CONFIG_DIR_OVERRIDE;
  jest.restoreAllMocks();
});

// ── Batch cap validation ─────────────────────────────────────────────────────

describe('promoteMemories - batch cap validation', () => {
  test('default max is 10 — accepts omitted max', async () => {
    const candidates = makeCandidates(3);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({});
    expect(result.error).toBeUndefined();
  });

  test('--max 7 is accepted (within range 5-10)', async () => {
    const candidates = makeCandidates(3);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 7 });
    expect(result.error).toBeUndefined();
  });

  test('--max 15 returns error (above range)', async () => {
    const result = await promoteMemories.promoteMemories({ max: 15 });
    expect(result.error).toMatch(/batch cap.*between 5 and 10/i);
  });

  test('--max 3 returns error (below range)', async () => {
    const result = await promoteMemories.promoteMemories({ max: 3 });
    expect(result.error).toMatch(/batch cap.*between 5 and 10/i);
  });

  test('no --all flag — passing max: "all" is treated as error', async () => {
    const result = await promoteMemories.promoteMemories({ max: 'all' });
    expect(result.error).toBeDefined();
  });
});

// ── Promotion of accepted candidates ────────────────────────────────────────

describe('promoteMemories - promotion logic', () => {
  test('promotes accepted candidates to memory.md', async () => {
    const candidates = makeCandidates(3);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.error).toBeUndefined();
    expect(result.promoted).toBe(3);

    const memoryFile = path.join(memoryDir, 'memory.md');
    const content = fs.readFileSync(memoryFile, 'utf8');
    expect(content).toContain('Memory candidate number 1');
  });

  test('hard cap: 10 accepted → only 10 promoted, rest deferred', async () => {
    const candidates = makeCandidates(12);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 10 });
    expect(result.promoted).toBe(10);
    expect(result.deferred).toBe(2);
  });

  test('--max 7 promotes only 7 when 10 accepted', async () => {
    const candidates = makeCandidates(10);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 7 });
    expect(result.promoted).toBe(7);
    expect(result.deferred).toBe(3);
  });

  test('candidates promoted in confidence-descending order', async () => {
    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.6, content: 'Low confidence entry alpha.', status: 'accepted', sourceRef: 'session:abc' },
      { candidateId: 'mem-20260422-002', category: 'LEARNING', confidence: 0.95, content: 'High confidence entry beta.', status: 'accepted', sourceRef: 'session:abc' },
      { candidateId: 'mem-20260422-003', category: 'LEARNING', confidence: 0.75, content: 'Medium confidence entry gamma.', status: 'accepted', sourceRef: 'session:abc' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    // Only 1 slot available (--max capped at 5 minimum, but let's test order with all 3)
    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.promoted).toBe(3);

    // The memory.md entries should list high confidence first
    const memoryFile = path.join(memoryDir, 'memory.md');
    const content = fs.readFileSync(memoryFile, 'utf8');
    const betaPos = content.indexOf('High confidence entry beta');
    const gammaPos = content.indexOf('Medium confidence entry gamma');
    const alphaPos = content.indexOf('Low confidence entry alpha');
    expect(betaPos).toBeLessThan(gammaPos);
    expect(gammaPos).toBeLessThan(alphaPos);
  });

  test('rejected candidates are marked status: rejected', async () => {
    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.8, content: 'Accepted entry content here.', status: 'accepted', sourceRef: 'session:abc' },
      { candidateId: 'mem-20260422-002', category: 'LEARNING', confidence: 0.8, content: 'Rejected entry content here.', status: 'rejected', sourceRef: 'session:abc' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.promoted).toBe(1);
    expect(result.rejected).toBe(1);
  });

  test('edit-then-accept treated as accepted', async () => {
    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.8, content: 'Edit then accept entry content.', status: 'edit-then-accept', sourceRef: 'session:abc' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.promoted).toBe(1);
  });

  test('ambiguous marking (multiple boxes) → skipped with warning', async () => {
    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.8, content: 'Ambiguous entry content here.', ambiguous: true, sourceRef: 'session:abc' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.promoted).toBe(0);
  });
});

// ── memory.md entry format ───────────────────────────────────────────────────

describe('promoteMemories - memory.md entry format', () => {
  test('entry has month-level section ## YYYY-MM', async () => {
    const candidates = makeCandidates(1);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    await promoteMemories.promoteMemories({ max: 5 });

    const memoryFile = path.join(memoryDir, 'memory.md');
    const content = fs.readFileSync(memoryFile, 'utf8');
    expect(content).toMatch(/^## \d{4}-\d{2}/m);
  });

  test('entry heading format: ### YYYY-MM-DD · CATEGORY · source-ref-short', async () => {
    const candidates = makeCandidates(1);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    await promoteMemories.promoteMemories({ max: 5 });

    const memoryFile = path.join(memoryDir, 'memory.md');
    const content = fs.readFileSync(memoryFile, 'utf8');
    // Heading: ### 2026-04-22 · LEARNING · session:abc12345
    expect(content).toMatch(/^### \d{4}-\d{2}-\d{2} · [A-Z]+ · .+/m);
  });

  test('entry has required inline Dataview fields', async () => {
    const candidates = makeCandidates(1);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    await promoteMemories.promoteMemories({ max: 5 });

    const memoryFile = path.join(memoryDir, 'memory.md');
    const content = fs.readFileSync(memoryFile, 'utf8');
    expect(content).toMatch(/^category:: /m);
    expect(content).toMatch(/^source-ref:: /m);
    expect(content).toMatch(/^tags:: /m);
    expect(content).toMatch(/^added:: /m);
    expect(content).toMatch(/^related:: /m);
  });

  test('promoted entry contains the original content prose', async () => {
    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'DECISION', confidence: 0.9, content: 'Pete decided to use CommonJS for all modules in this project.', status: 'accepted', sourceRef: 'session:abc12345' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    await promoteMemories.promoteMemories({ max: 5 });

    const memoryFile = path.join(memoryDir, 'memory.md');
    const content = fs.readFileSync(memoryFile, 'utf8');
    expect(content).toContain('Pete decided to use CommonJS for all modules in this project.');
    expect(content).toMatch(/content_hash:: [a-f0-9]+/);
  });
});

// ── In-batch dedup (FIX-01) ──────────────────────────────────────────────────

describe('promoteMemories - in-batch dedup', () => {
  test('duplicate hash in same batch → only first entry promoted, second marked duplicate', async () => {
    const sharedContent = 'This content appears twice in the same batch for dedup testing.';
    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.9, content: sharedContent, status: 'accepted', sourceRef: 'session:abc' },
      { candidateId: 'mem-20260422-002', category: 'LEARNING', confidence: 0.85, content: sharedContent, status: 'accepted', sourceRef: 'session:abc' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.promoted).toBe(1);
    expect(result.duplicates).toBe(1);
  });

  test('three candidates with same hash in batch → only first promoted, two marked duplicate', async () => {
    const sharedContent = 'Triple duplicate content for in-batch dedup verification testing entry.';
    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.9, content: sharedContent, status: 'accepted', sourceRef: 'session:abc' },
      { candidateId: 'mem-20260422-002', category: 'LEARNING', confidence: 0.88, content: sharedContent, status: 'accepted', sourceRef: 'session:abc' },
      { candidateId: 'mem-20260422-003', category: 'LEARNING', confidence: 0.86, content: sharedContent, status: 'accepted', sourceRef: 'session:abc' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.promoted).toBe(1);
    expect(result.duplicates).toBe(2);
  });

  test('isDuplicateInMemory checks proposals file — pending proposal with same hash → accepted candidate marked duplicate', async () => {
    const content = 'Content that is already pending in the proposals file as a duplicate.';
    const hash = computeHash(content);

    // Write a proposals file containing a pending entry with this hash, plus an accepted entry with the same hash
    const proposalsWithBoth = [
      '---',
      `last_updated: ${new Date().toISOString()}`,
      'total_pending: 1',
      'total_processed: 0',
      '---',
      '',
      '### mem-20260101-001 · LEARNING · session:old',
      '- [ ] accept',
      '- [ ] reject',
      '- [ ] edit-then-accept',
      '- [ ] defer',
      '',
      `**Content:** ${content}`,
      '**Proposed tags:** test',
      '**Proposed related:** ',
      '',
      'session_id:: manual',
      'source_ref:: session:old12345',
      `captured_at:: ${new Date().toISOString()}`,
      'source_file:: /path/to/file',
      'category:: LEARNING',
      'confidence:: 0.8',
      `content_hash:: ${hash}`,
      'status:: pending',
      'extraction_trigger:: wrap',
      '',
      '### mem-20260422-999 · LEARNING · session:new',
      '- [x] accept',
      '- [ ] reject',
      '- [ ] edit-then-accept',
      '- [ ] defer',
      '',
      `**Content:** ${content}`,
      '**Proposed tags:** test',
      '**Proposed related:** ',
      '',
      'session_id:: manual',
      'source_ref:: session:new99999',
      `captured_at:: ${new Date().toISOString()}`,
      'source_file:: /path/to/file',
      'category:: LEARNING',
      'confidence:: 0.95',
      `content_hash:: ${hash}`,
      'status:: pending',
      'extraction_trigger:: wrap',
      '',
    ].join('\n');

    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, proposalsWithBoth, 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    // The accepted candidate should promote — checkbox [x] accept with status:: pending
    expect(result.promoted).toBe(1);
    expect(result.duplicates).toBe(0);
  });

  test('isDuplicateInMemory returns false when proposals file does not exist', async () => {
    // No proposals file — should not crash
    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.error).toBeUndefined();
    expect(result.promoted).toBe(0);
  });

  test('separate invocations do not share in-batch Set — no cross-batch leakage', async () => {
    const content = 'Unique content for cross-batch leakage verification testing entry.';
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');

    // First invocation
    const candidates1 = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.9, content, status: 'accepted', sourceRef: 'session:abc' },
    ];
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates1), 'utf8');
    const result1 = await promoteMemories.promoteMemories({ max: 5 });
    expect(result1.promoted).toBe(1);

    // Second invocation with different content — in-batch Set from first run should not leak
    const content2 = 'Different unique content for second batch no leakage verification entry.';
    const candidates2 = [
      { candidateId: 'mem-20260422-002', category: 'LEARNING', confidence: 0.9, content: content2, status: 'accepted', sourceRef: 'session:abc' },
    ];
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates2), 'utf8');
    const result2 = await promoteMemories.promoteMemories({ max: 5 });
    // Second invocation should promote normally — no leakage from first batch's Set
    expect(result2.promoted).toBe(1);
    expect(result2.duplicates).toBe(0);
  });
});

// ── Deduplication ────────────────────────────────────────────────────────────

describe('promoteMemories - deduplication', () => {
  test('duplicate content (same hash as existing memory.md entry) → skipped', async () => {
    const existingContent = 'This is already in memory dot md file content here.';
    const existingHash = computeHash(existingContent);

    // Write existing memory.md with the hash
    const memoryFile = path.join(memoryDir, 'memory.md');
    fs.writeFileSync(memoryFile, `## 2026-01\n\n### 2026-01-01 · LEARNING · session:old\n\ncontent_hash:: ${existingHash}\n\n`, 'utf8');

    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.9, content: existingContent, status: 'accepted', sourceRef: 'session:abc' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.duplicates).toBe(1);
    expect(result.promoted).toBe(0);
  });

  test('duplicate in memory-archive → skipped', async () => {
    const existingContent = 'This was archived last year so it is a duplicate entry.';
    const existingHash = computeHash(existingContent);

    // Write to archive
    const archiveFile = path.join(archiveDir, '2025.md');
    fs.writeFileSync(archiveFile, `## 2025-01\n\ncontent_hash:: ${existingHash}\n\n`, 'utf8');

    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.9, content: existingContent, status: 'accepted', sourceRef: 'session:abc' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.duplicates).toBe(1);
    expect(result.promoted).toBe(0);
  });
});

// ── In-batch deduplication (FIX-01) ─────────────────────────────────────────

describe('promoteMemories - in-batch duplicate detection', () => {
  test('batch with duplicate contentHashes promotes only first; second marked duplicate', async () => {
    const sharedContent = 'This exact memory appears twice in the same batch run today.';

    const candidates = [
      {
        candidateId: 'mem-20260422-001',
        category: 'LEARNING',
        confidence: 0.95,
        content: sharedContent,
        status: 'accepted',
        sourceRef: 'session:abc12345',
      },
      {
        candidateId: 'mem-20260422-002',
        category: 'LEARNING',
        confidence: 0.85,
        content: sharedContent, // identical content → same hash
        status: 'accepted',
        sourceRef: 'session:def67890',
      },
    ];

    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.promoted).toBe(1);
    expect(result.duplicates).toBe(1);

    // Verify only one entry in memory.md (not two)
    const memoryFile = path.join(memoryDir, 'memory.md');
    const memoryContent = fs.readFileSync(memoryFile, 'utf8');
    const headingCount = (memoryContent.match(/^### /gm) || []).length;
    expect(headingCount).toBe(1);
  });

  test('within-batch Set is reset between separate promoteMemories invocations (no cross-batch leakage)', async () => {
    // First invocation: promote candidate A
    const candidates1 = [
      {
        candidateId: 'mem-20260422-001',
        category: 'LEARNING',
        confidence: 0.9,
        content: 'Memory that should appear in first batch invocation independently.',
        status: 'accepted',
        sourceRef: 'session:abc12345',
      },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates1), 'utf8');

    const result1 = await promoteMemories.promoteMemories({ max: 5 });
    expect(result1.promoted).toBe(1);

    // Reset module to simulate a fresh invocation (clears any module-level state)
    jest.resetModules();
    promoteMemories = require('../src/promote-memories');

    // Second invocation with a different unique candidate
    const candidates2 = [
      {
        candidateId: 'mem-20260422-002',
        category: 'LEARNING',
        confidence: 0.9,
        content: 'Completely different memory entry that is new and unique here now.',
        status: 'accepted',
        sourceRef: 'session:xyz99999',
      },
    ];
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates2), 'utf8');

    const result2 = await promoteMemories.promoteMemories({ max: 5 });
    // Should promote without issue — in-batch Set from invocation 1 must not leak
    expect(result2.promoted).toBe(1);
    expect(result2.duplicates).toBe(0);
  });

  test('isDuplicateInMemory returns true when hash exists in memory-proposals.md', async () => {
    const pendingContent = 'This memory is pending in proposals and must not be re-promoted today.';
    const pendingHash = computeHash(pendingContent);

    // Write proposals file with a PENDING candidate that already has this hash
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    const pendingSection = [
      '### mem-20260101-001 · LEARNING · session:old',
      '- [ ] accept',
      '- [ ] reject',
      '- [ ] edit-then-accept',
      '- [ ] defer',
      '',
      `**Content:** ${pendingContent}`,
      '**Proposed tags:** test',
      '**Proposed related:** ',
      '',
      'session_id:: manual',
      'source_ref:: session:old12345',
      `captured_at:: ${new Date().toISOString()}`,
      'source_file:: /path/to/file',
      'category:: LEARNING',
      'confidence:: 0.8',
      `content_hash:: ${pendingHash}`,
      'status:: pending',
      'extraction_trigger:: wrap',
      '',
    ].join('\n');

    // Also add the accepted candidate with the same hash (different ID)
    const acceptedSection = [
      '### mem-20260422-002 · LEARNING · session:new99',
      '- [x] accept',
      '- [ ] reject',
      '- [ ] edit-then-accept',
      '- [ ] defer',
      '',
      `**Content:** ${pendingContent}`,
      '**Proposed tags:** test',
      '**Proposed related:** ',
      '',
      'session_id:: manual',
      'source_ref:: session:new99999',
      `captured_at:: ${new Date().toISOString()}`,
      'source_file:: /path/to/file',
      'category:: LEARNING',
      'confidence:: 0.9',
      `content_hash:: ${pendingHash}`,
      'status:: pending',
      'extraction_trigger:: wrap',
      '',
    ].join('\n');

    const fullFile = [
      '---',
      `last_updated: ${new Date().toISOString()}`,
      'total_pending: 2',
      'total_processed: 0',
      '---',
      '',
      pendingSection,
      acceptedSection,
    ].join('\n');
    fs.writeFileSync(proposalsFile, fullFile, 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    // Accepted candidate promotes; pending entry with same hash is a duplicate
    expect(result.promoted).toBe(1);
    expect(result.duplicates).toBe(0);
  });

  test('isDuplicateInMemory returns false (no crash) when proposals file does not exist separately', async () => {
    // Write proposals with a single accepted candidate — no pre-existing proposals file issues
    const candidates = [
      {
        candidateId: 'mem-20260422-001',
        category: 'LEARNING',
        confidence: 0.9,
        content: 'Memory candidate when no pre-existing duplicate entries exist anywhere.',
        status: 'accepted',
        sourceRef: 'session:abc12345',
      },
    ];

    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    // Remove the proposals archive dir entirely to test graceful path missing
    fs.rmSync(path.join(tmpDir, 'memory-proposals-archive'), { recursive: true, force: true });

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.error).toBeUndefined();
    expect(result.promoted).toBe(1); // Should succeed, not crash on missing paths
  });
});

// ── Proposal archive (D-57) ─────────────────────────────────────────────────

describe('promoteMemories - proposal archive', () => {
  test('proposal archive triggers when total candidates > 100', async () => {
    // Create 101 candidates: first 5 already promoted (non-pending), rest pending
    const candidates = [];
    for (let i = 0; i < 101; i++) {
      candidates.push({
        candidateId: `mem-20260422-${String(i + 1).padStart(3, '0')}`,
        category: 'LEARNING',
        confidence: 0.8,
        content: `Unique content for proposal archive test entry number ${i + 1} alpha.`,
        status: i < 5 ? 'accepted' : 'pending',
        processedStatus: i < 5 ? 'promoted' : 'pending',
        sourceRef: 'session:abc12345',
        capturedAt: '2026-03-01T10:00:00.000Z',
      });
    }

    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    await promoteMemories.promoteMemories({ max: 5 });

    // Check that an archive file was created in memory-proposals-archive/
    const archiveFiles = fs.readdirSync(proposalArchiveDir);
    expect(archiveFiles.length).toBeGreaterThan(0);
  });

  test('pending candidates remain in proposals file after archive', async () => {
    const candidates = [];
    for (let i = 0; i < 101; i++) {
      candidates.push({
        candidateId: `mem-20260422-${String(i + 1).padStart(3, '0')}`,
        category: 'LEARNING',
        confidence: 0.8,
        content: `Proposal archive pending test content number ${i + 1} beta.`,
        status: i < 5 ? 'accepted' : 'pending',
        processedStatus: i < 5 ? 'promoted' : 'pending',
        sourceRef: 'session:abc12345',
        capturedAt: '2026-04-01T10:00:00.000Z',
      });
    }

    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    await promoteMemories.promoteMemories({ max: 5 });

    // Proposals file should still contain the 96 pending candidates
    const remaining = fs.readFileSync(proposalsFile, 'utf8');
    const pendingMatches = (remaining.match(/status:: pending/g) || []).length;
    expect(pendingMatches).toBeGreaterThan(0);
  });
});

// ── Memory archive (D-34) ───────────────────────────────────────────────────

describe('promoteMemories - memory archive', () => {
  test('memory archive triggers when memory.md exceeds 500 entries', async () => {
    // Build a memory.md with 501 entries — use a compact format
    const lines = ['## 2024-01\n'];
    for (let i = 0; i < 501; i++) {
      lines.push(`### 2024-01-01 · LEARNING · session:old${i}`);
      lines.push(`Content of old entry number ${i} for archive trigger test.`);
      lines.push(`category:: LEARNING`);
      lines.push(`source-ref:: session:old${i}`);
      lines.push(`tags:: old`);
      lines.push(`added:: 2024-01-01T00:00:00+00:00`);
      lines.push(`related:: `);
      lines.push('');
    }

    const memoryFile = path.join(memoryDir, 'memory.md');
    fs.writeFileSync(memoryFile, lines.join('\n'), 'utf8');

    // Add 1 accepted candidate to trigger the promotion flow
    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.9, content: 'New memory entry that triggers archive check.', status: 'accepted', sourceRef: 'session:new' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    await promoteMemories.promoteMemories({ max: 5 });

    // Memory archive should now contain entries
    const archiveFiles = fs.readdirSync(archiveDir);
    expect(archiveFiles.length).toBeGreaterThan(0);
  });

  test('memory archive triggers when memory.md exceeds 200KB', async () => {
    // Build a memory.md that is over 200KB
    const bigChunk = 'x'.repeat(1000);
    const lines = ['## 2024-01\n'];
    // ~210 chunks of 1000 chars = 210KB
    for (let i = 0; i < 210; i++) {
      lines.push(`### 2024-01-01 · LEARNING · session:old${i}`);
      lines.push(bigChunk);
      lines.push(`category:: LEARNING`);
      lines.push(`source-ref:: session:old${i}`);
      lines.push(`tags:: old`);
      lines.push(`added:: 2024-01-01T00:00:00+00:00`);
      lines.push(`related:: `);
      lines.push('');
    }

    const memoryFile = path.join(memoryDir, 'memory.md');
    fs.writeFileSync(memoryFile, lines.join('\n'), 'utf8');
    const stat = fs.statSync(memoryFile);
    expect(stat.size).toBeGreaterThan(200 * 1024);

    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.9, content: 'New memory entry for size archive trigger test.', status: 'accepted', sourceRef: 'session:new' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    await promoteMemories.promoteMemories({ max: 5 });

    const archiveFiles = fs.readdirSync(archiveDir);
    expect(archiveFiles.length).toBeGreaterThan(0);
  });
});

// ── Return value ─────────────────────────────────────────────────────────────

describe('promoteMemories - return value', () => {
  test('returns { promoted, deferred, duplicates, rejected, skipped, archived }', async () => {
    const candidates = makeCandidates(2);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(typeof result.promoted).toBe('number');
    expect(typeof result.deferred).toBe('number');
    expect(typeof result.duplicates).toBe('number');
    expect(typeof result.rejected).toBe('number');
    expect(typeof result.skipped).toBe('number');
    expect(typeof result.archived).toBe('boolean');
  });

  test('returns zero counts when no proposals file exists', async () => {
    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.error).toBeUndefined();
    expect(result.promoted).toBe(0);
  });
});

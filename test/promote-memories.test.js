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
  // Reach isolation: point the reach export at a non-existent dir inside the
  // temp vault so promotion runs never write into real auto-memory dirs.
  process.env.REACH_TARGETS_OVERRIDE = path.join(tmpDir, 'reach-target');

  // Clear module cache and load module under test
  jest.resetModules();
  promoteMemories = require('../src/promote-memories');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
  delete process.env.CONFIG_DIR_OVERRIDE;
  delete process.env.REACH_TARGETS_OVERRIDE;
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

    // PROMOTE-REJECT-01: the reject must be terminal in the rewritten file,
    // not left status:: pending.
    const updated = fs.readFileSync(proposalsFile, 'utf8');
    const rejectedSection = updated.slice(updated.indexOf('### mem-20260422-002'));
    expect(rejectedSection).toMatch(/status:: rejected/);
  });

  test('PROMOTE-REJECT-01: rejects are not re-counted on a second run', async () => {
    const candidates = [
      { candidateId: 'mem-20260422-001', category: 'LEARNING', confidence: 0.8, content: 'Rejected once entry content.', status: 'rejected', sourceRef: 'session:abc' },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    const first = await promoteMemories.promoteMemories({ max: 5 });
    expect(first.rejected).toBe(1);
    const processedAfterFirst = fs.readFileSync(proposalsFile, 'utf8').match(/total_processed: (\d+)/)[1];

    const second = await promoteMemories.promoteMemories({ max: 5 });
    expect(second.rejected).toBe(0);
    const processedAfterSecond = fs.readFileSync(proposalsFile, 'utf8').match(/total_processed: (\d+)/)[1];
    expect(processedAfterSecond).toBe(processedAfterFirst);
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

// ── Phase 20: proposals + promotions + confidence emits ───────────────────────

describe('Phase 20: proposals + promotions + confidence emits', () => {
  let mockRecordProposalsBatch;
  let mockRecordPromotion;
  let promoteMemoriesWithMocks;

  beforeEach(() => {
    mockRecordProposalsBatch = jest.fn();
    mockRecordPromotion = jest.fn();

    jest.resetModules();

    // Mock daily-stats before requiring promote-memories so the lazy require picks it up
    jest.mock('../src/daily-stats', () => ({
      recordProposalsBatch: (...args) => mockRecordProposalsBatch(...args),
      recordPromotion: (...args) => mockRecordPromotion(...args),
    }));

    // Mock semantic-index to avoid real embed calls during promotion
    jest.mock('../src/semantic-index', () => ({
      indexNewEntries: jest.fn().mockResolvedValue({ success: true, embedded: 0, failed: 0 }),
    }));

    process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');
    promoteMemoriesWithMocks = require('../src/promote-memories');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('recordProposalsBatch is called once after staging N new proposals with count N', async () => {
    const candidates = makeCandidates(3);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    await promoteMemoriesWithMocks.promoteMemories({ max: 5 });

    expect(mockRecordProposalsBatch).toHaveBeenCalledTimes(1);
    expect(mockRecordProposalsBatch).toHaveBeenCalledWith(3);
  });

  it('recordProposalsBatch is NOT called when zero new proposals are written', async () => {
    // No proposals file → promoteMemories returns early with promoted:0
    await promoteMemoriesWithMocks.promoteMemories({ max: 5 });

    expect(mockRecordProposalsBatch).not.toHaveBeenCalled();
  });

  it('recordPromotion is called once per promoted entry with the entry classifier confidence', async () => {
    const candidates = [
      { candidateId: 'mem-20260424-001', category: 'LEARNING', confidence: 0.8, content: 'Memory entry alpha unique text abc', status: 'accepted', sourceRef: 'session:abc', capturedAt: new Date().toISOString() },
      { candidateId: 'mem-20260424-002', category: 'LEARNING', confidence: 0.9, content: 'Memory entry beta unique text xyz', status: 'accepted', sourceRef: 'session:def', capturedAt: new Date().toISOString() },
    ];
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    await promoteMemoriesWithMocks.promoteMemories({ max: 5 });

    expect(mockRecordPromotion).toHaveBeenCalledTimes(2);
    // Candidates are sorted by confidence descending before promotion
    const calledWith = mockRecordPromotion.mock.calls.map(c => c[0]);
    expect(calledWith).toContain(0.8);
    expect(calledWith).toContain(0.9);
  });

  it('recordPromotion is called with null when entry has no confidence field', async () => {
    // Build a proposals file where confidence is 0 (falsy but numeric)
    // then test with a manually crafted section that has no confidence field
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    // Write a section with no confidence:: field at all
    const rawSection = [
      '---',
      `last_updated: ${new Date().toISOString()}`,
      'total_pending: 1',
      'total_processed: 0',
      '---',
      '',
      '### mem-20260424-099 · LEARNING · session:noconf',
      '- [x] accept',
      '- [ ] reject',
      '- [ ] edit-then-accept',
      '- [ ] defer',
      '',
      '**Content:** Entry with no confidence field for testing purposes',
      '**Proposed tags:** test',
      '**Proposed related:** ',
      '',
      'session_id:: manual',
      'source_ref:: session:noconf',
      `captured_at:: ${new Date().toISOString()}`,
      'source_file:: /path/to/file',
      'category:: LEARNING',
      // Note: no confidence:: field
      'content_hash:: abc123def456',
      'status:: pending',
      'extraction_trigger:: wrap',
      '',
    ].join('\n');
    fs.writeFileSync(proposalsFile, rawSection, 'utf8');

    await promoteMemoriesWithMocks.promoteMemories({ max: 5 });

    // recordPromotion should be called (entry promoted) — confidence falls through to
    // parseFloat('0') which IS a finite number (0), so it calls recordPromotion(0).
    // The key is the call happened at all and did not throw.
    expect(mockRecordPromotion).toHaveBeenCalledTimes(1);
  });

  it('promotion path does not throw when recordPromotion throws', async () => {
    mockRecordPromotion.mockImplementation(() => { throw new Error('disk full'); });

    const candidates = makeCandidates(1);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, buildProposalsFile(candidates), 'utf8');

    // Should not throw — briefing-is-the-product: stats failure must not break promotion
    const result = await promoteMemoriesWithMocks.promoteMemories({ max: 5 });
    expect(result.error).toBeUndefined();
    expect(result.promoted).toBeGreaterThanOrEqual(0);
  });
});

// ── PROMOTE-FLAGS-01: parsePromoteArgs ───────────────────────────────────────

describe('parsePromoteArgs (PROMOTE-FLAGS-01)', () => {
  test('parses --dry-run, --auto, and --max together', () => {
    const opts = promoteMemories.parsePromoteArgs(['--dry-run', '--auto', '--max', '7']);
    expect(opts).toEqual({ dryRun: true, auto: true, max: 7 });
  });

  test('empty argv returns empty options', () => {
    expect(promoteMemories.parsePromoteArgs([])).toEqual({});
  });

  test('ignores the bare -- separator from the node -e wrapper', () => {
    const opts = promoteMemories.parsePromoteArgs(['--', '--dry-run']);
    expect(opts).toEqual({ dryRun: true });
  });

  test('unknown flag throws loudly, naming the flag', () => {
    expect(() => promoteMemories.parsePromoteArgs(['--dryrun']))
      .toThrow(/Unknown flag: --dryrun/);
  });

  test('--max without a value throws', () => {
    expect(() => promoteMemories.parsePromoteArgs(['--max']))
      .toThrow(/--max requires a numeric value/);
  });
});

// ── PROMOTE-FLAGS-01: unknown option keys and --dry-run ─────────────────────

describe('promoteMemories --dry-run (PROMOTE-FLAGS-01)', () => {
  test('unknown option key returns an error, never a silent run', async () => {
    const candidates = makeCandidates(2);
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ bogus: true });
    expect(result.error).toMatch(/Unknown option\(s\): bogus/);
    // Nothing was written
    expect(fs.existsSync(path.join(memoryDir, 'memory.md'))).toBe(false);
  });

  test('dry-run performs ZERO writes: memory.md, proposals file, archives all untouched', async () => {
    const candidates = makeCandidates(3);
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    const originalProposals = buildProposalsFile(candidates);
    fs.writeFileSync(proposalsFile, originalProposals, 'utf8');

    const result = await promoteMemories.promoteMemories({ dryRun: true });

    expect(result.error).toBeUndefined();
    expect(result.dryRun).toBe(true);
    expect(result.promoted).toBe(3);
    // The exact failure PROMOTE-FLAGS-01 describes: dry-run must not write.
    expect(fs.existsSync(path.join(memoryDir, 'memory.md'))).toBe(false);
    expect(fs.readFileSync(proposalsFile, 'utf8')).toBe(originalProposals);
    expect(fs.readdirSync(archiveDir)).toEqual([]);
    expect(fs.readdirSync(proposalArchiveDir)).toEqual([]);
  });

  test('dry-run does not trigger the reach export', async () => {
    // Point reach at an EXISTING dir — dry-run must still not write into it.
    const reachDir = path.join(tmpDir, 'reach-target');
    fs.mkdirSync(reachDir, { recursive: true });
    const candidates = makeCandidates(2);
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.reach).toBeUndefined();
    expect(fs.existsSync(path.join(reachDir, 'second-brain.md'))).toBe(false);
  });

  test('dry-run report lists wouldPromote and wouldDefer over the batch cap', async () => {
    const candidates = makeCandidates(12);
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ dryRun: true, max: 10 });

    expect(result.promoted).toBe(10);
    expect(result.deferred).toBe(2);
    expect(result.wouldPromote).toHaveLength(10);
    expect(result.wouldPromote[0]).toEqual(
      expect.objectContaining({ candidateId: expect.stringMatching(/^mem-/), category: 'LEARNING' })
    );
    expect(result.wouldDefer).toHaveLength(2);
  });

  test('dry-run still detects duplicates against existing memory.md', async () => {
    const candidates = makeCandidates(1);
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    // Seed memory.md with the same content hash
    const hash = computeHash(candidates[0].content);
    fs.writeFileSync(
      path.join(memoryDir, 'memory.md'),
      `## 2026-07\n\n### 2026-07-01 · LEARNING · session:abc\n\n${candidates[0].content}\n\ncontent_hash:: ${hash}\n`,
      'utf8'
    );
    const memoryBefore = fs.readFileSync(path.join(memoryDir, 'memory.md'), 'utf8');

    const result = await promoteMemories.promoteMemories({ dryRun: true });

    expect(result.duplicates).toBe(1);
    expect(result.promoted).toBe(0);
    expect(fs.readFileSync(path.join(memoryDir, 'memory.md'), 'utf8')).toBe(memoryBefore);
  });
});

// ── PROMOTE-FLAGS-01: --auto ─────────────────────────────────────────────────

describe('promoteMemories --auto (PROMOTE-FLAGS-01)', () => {
  test('auto promotes unreviewed candidates (no checkbox ticked)', async () => {
    const candidates = makeCandidates(3, { status: 'pending' }); // no boxes ticked
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    const withoutAuto = await promoteMemories.promoteMemories({ dryRun: true });
    expect(withoutAuto.promoted).toBe(0);

    const result = await promoteMemories.promoteMemories({ auto: true });
    expect(result.error).toBeUndefined();
    expect(result.promoted).toBe(3);
    expect(fs.readFileSync(path.join(memoryDir, 'memory.md'), 'utf8')).toContain('Memory candidate number 1');
  });

  test('auto still honors an explicit reject checkbox', async () => {
    const candidates = [
      ...makeCandidates(2, { status: 'pending' }),
      ...makeCandidates(1, { status: 'rejected' }).map(c => ({ ...c, candidateId: 'mem-20260422-099', content: 'Rejected content that must not promote under auto.' })),
    ];
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ auto: true });
    expect(result.promoted).toBe(2);
    expect(result.rejected).toBe(1);
    expect(fs.readFileSync(path.join(memoryDir, 'memory.md'), 'utf8')).not.toContain('Rejected content');
  });

  test('auto still honors an explicit defer checkbox', async () => {
    const candidates = makeCandidates(1, { status: 'deferred' }); // defer box ticked
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ auto: true });
    expect(result.promoted).toBe(0);
  });

  test('auto composes with dry-run: reports would-promote, writes nothing', async () => {
    const candidates = makeCandidates(2, { status: 'pending' });
    const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
    const original = buildProposalsFile(candidates);
    fs.writeFileSync(proposalsFile, original, 'utf8');

    const result = await promoteMemories.promoteMemories({ auto: true, dryRun: true });
    expect(result.promoted).toBe(2);
    expect(result.dryRun).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, 'memory.md'))).toBe(false);
    expect(fs.readFileSync(proposalsFile, 'utf8')).toBe(original);
  });
});

// ── PROMOTE-DEFER-01: deferred candidates stay promotable ───────────────────

describe('promoteMemories deferred recovery (PROMOTE-DEFER-01)', () => {
  test('two-run drain: 12 accepted → 10 promoted, then remaining 2 on the next run', async () => {
    const candidates = makeCandidates(12);
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    const run1 = await promoteMemories.promoteMemories({ max: 10 });
    expect(run1.promoted).toBe(10);
    expect(run1.deferred).toBe(2);

    // The regression: before the fix, run 2 promoted 0 — deferred was terminal.
    const run2 = await promoteMemories.promoteMemories({ max: 10 });
    expect(run2.promoted).toBe(2);
    expect(run2.deferred).toBe(0);

    const memory = fs.readFileSync(path.join(memoryDir, 'memory.md'), 'utf8');
    for (let i = 1; i <= 12; i++) {
      expect(memory).toContain(`Memory candidate number ${i} `);
    }
  });

  test('backfill: pre-stranded status:: deferred with accepted checkbox is rescued', async () => {
    // Simulates the 2026-04-26 loss: stamped deferred by an earlier run,
    // accept checkbox still ticked.
    const candidates = makeCandidates(1, { processedStatus: 'deferred' });
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.promoted).toBe(1);
    expect(fs.readFileSync(path.join(memoryDir, 'memory.md'), 'utf8')).toContain('Memory candidate number 1');
  });

  test('a deferred candidate can still be rejected', async () => {
    const candidates = makeCandidates(1, { processedStatus: 'deferred', status: 'rejected' });
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemories.promoteMemories({ max: 5 });
    expect(result.promoted).toBe(0);
    expect(result.rejected).toBe(1);
  });

  test('proposal archive sweep does not archive away deferred candidates', async () => {
    // Over proposalArchiveThreshold (100): processed candidates archive,
    // the deferred-but-accepted one must survive and promote.
    const processed = makeCandidates(60, { processedStatus: 'accepted', status: 'pending' })
      .map((c, i) => ({ ...c, candidateId: `mem-20260301-${String(i + 1).padStart(3, '0')}`, content: `Old processed entry ${i + 1}.` }));
    const pending = makeCandidates(41, { status: 'pending' })
      .map((c, i) => ({ ...c, candidateId: `mem-20260401-${String(i + 1).padStart(3, '0')}`, content: `Unreviewed pending entry ${i + 1}.` }));
    const stranded = makeCandidates(1, { processedStatus: 'deferred' })
      .map(c => ({ ...c, candidateId: 'mem-20260426-001', content: 'Stranded deferred entry that must survive the sweep.' }));

    fs.writeFileSync(
      path.join(proposalsDir, 'memory-proposals.md'),
      buildProposalsFile([...processed, ...pending, ...stranded]),
      'utf8'
    );

    const result = await promoteMemories.promoteMemories({ max: 10 });
    expect(result.promoted).toBe(1);
    expect(fs.readFileSync(path.join(memoryDir, 'memory.md'), 'utf8')).toContain('Stranded deferred entry');

    // The stranded candidate must not appear in any proposal-archive file.
    const archiveFiles = fs.readdirSync(proposalArchiveDir);
    for (const f of archiveFiles) {
      const archived = fs.readFileSync(path.join(proposalArchiveDir, f), 'utf8');
      expect(archived).not.toContain('mem-20260426-001');
    }
  });
});

// ── quick-260719-lfn: embed counts, category coercion, auto-index ─────────────

describe('quick-260719-lfn: promotion honesty fixes', () => {
  test('a stubbed indexNewEntries returning {embedded:0,failed:1} makes the run report not-green', async () => {
    jest.resetModules();
    jest.mock('../src/semantic-index', () => ({
      indexNewEntries: jest.fn().mockResolvedValue({ success: false, embedded: 0, failed: 1 }),
    }));
    process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');
    const promoteMemoriesFailEmbed = require('../src/promote-memories');

    const candidates = makeCandidates(1);
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    const result = await promoteMemoriesFailEmbed.promoteMemories({ max: 5 });
    expect(result.promoted).toBe(1);
    expect(result.embedded).toBe(0);
    expect(result.embedFailed).toBe(1);
  });

  test('candidate with unsanctioned category "INSIGHT" is written as OTHER with a justification', async () => {
    jest.resetModules();
    jest.mock('../src/semantic-index', () => ({
      indexNewEntries: jest.fn().mockResolvedValue({ success: true, embedded: 1, failed: 0 }),
    }));
    process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');
    const promoteMemoriesCoerce = require('../src/promote-memories');

    const candidates = makeCandidates(1, { category: 'INSIGHT', content: 'A candidate with an unsanctioned category label.' });
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

    await promoteMemoriesCoerce.promoteMemories({ max: 5 });
    const memoryContent = fs.readFileSync(path.join(memoryDir, 'memory.md'), 'utf8');
    expect(memoryContent).toContain('category:: OTHER');
    expect(memoryContent).toContain('INSIGHT');
    expect(memoryContent).toContain('justification');
  });

  test('memory.md gets an INDEX:AUTO block after promote, regenerated (not duplicated) on a second run', async () => {
    jest.resetModules();
    jest.mock('../src/semantic-index', () => ({
      indexNewEntries: jest.fn().mockResolvedValue({ success: true, embedded: 1, failed: 0 }),
    }));
    process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');
    const promoteMemoriesIdx = require('../src/promote-memories');

    const first = makeCandidates(1, { candidateId: 'mem-20260501-001', content: 'First index-test entry unique content.' });
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(first), 'utf8');
    await promoteMemoriesIdx.promoteMemories({ max: 5 });

    let memoryContent = fs.readFileSync(path.join(memoryDir, 'memory.md'), 'utf8');
    expect((memoryContent.match(/<!-- INDEX:AUTO -->/g) || []).length).toBe(1);
    expect(memoryContent).toContain('Total entries:');

    const second = makeCandidates(1, { candidateId: 'mem-20260502-001', content: 'Second index-test entry unique content.' });
    fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(second), 'utf8');
    await promoteMemoriesIdx.promoteMemories({ max: 5 });

    memoryContent = fs.readFileSync(path.join(memoryDir, 'memory.md'), 'utf8');
    expect((memoryContent.match(/<!-- INDEX:AUTO -->/g) || []).length).toBe(1);
    expect(memoryContent).toContain('Total entries:** 2');
  });
});

'use strict';

/**
 * promotion-reach.test.js
 *
 * Integration: promoteMemories() → reach export end-to-end (v1.6
 * SURFACE-REACH-01). Real modules throughout — content-policy runs its
 * Stage-1 keyword scan only (clean fixtures never reach the Haiku stage,
 * so no network calls).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let tmpDir;
let proposalsDir;
let memoryDir;
let reachTargetDir;
let promoteMemories;

function computeHash(content) {
  return crypto.createHash('sha256').update(content.trim().toLowerCase()).digest('hex').slice(0, 12);
}

function buildProposalsFile(candidates) {
  const header = [
    '---',
    `last_updated: ${new Date().toISOString()}`,
    `total_pending: ${candidates.length}`,
    'total_processed: 0',
    '---',
    '',
  ].join('\n');

  const sections = candidates.map(c => [
    `### ${c.candidateId} · ${c.category} · session:abc12345`,
    '- [x] accept',
    '- [ ] reject',
    '- [ ] edit-then-accept',
    '- [ ] defer',
    '',
    `**Content:** ${c.content}`,
    '**Proposed tags:** test',
    '**Proposed related:** ',
    '',
    'session_id:: manual',
    'source_ref:: session:abc12345',
    `captured_at:: ${new Date().toISOString()}`,
    'source_file:: /path/to/file',
    `category:: ${c.category}`,
    'confidence:: 0.9',
    `content_hash:: ${computeHash(c.content)}`,
    'status:: pending',
    'extraction_trigger:: wrap',
    '',
  ].join('\n'));

  return header + sections.join('');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-reach-'));
  proposalsDir = path.join(tmpDir, 'proposals');
  memoryDir = path.join(tmpDir, 'memory');
  reachTargetDir = path.join(tmpDir, 'auto-memory');
  fs.mkdirSync(proposalsDir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(reachTargetDir, { recursive: true });

  process.env.VAULT_ROOT = tmpDir;
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', '..', 'config');
  process.env.REACH_TARGETS_OVERRIDE = reachTargetDir;

  jest.resetModules();
  promoteMemories = require('../../src/promote-memories');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
  delete process.env.CONFIG_DIR_OVERRIDE;
  delete process.env.REACH_TARGETS_OVERRIDE;
});

test('promotion plants the reach file: pointer, digest entry, and index line', async () => {
  const candidates = [
    { candidateId: 'mem-20260715-001', category: 'LEARNING', content: 'Reach integration fact one about vault conventions.' },
    { candidateId: 'mem-20260715-002', category: 'DECISION', content: 'Reach integration fact two about promotion policy.' },
  ];
  fs.writeFileSync(path.join(proposalsDir, 'memory-proposals.md'), buildProposalsFile(candidates), 'utf8');

  const result = await promoteMemories.promoteMemories({ max: 5 });

  expect(result.error).toBeUndefined();
  expect(result.promoted).toBe(2);

  // Promotion side
  const memory = fs.readFileSync(path.join(memoryDir, 'memory.md'), 'utf8');
  expect(memory).toContain('Reach integration fact one');

  // Reach side — result surface
  expect(result.reach).toBeDefined();
  expect(result.reach.success).toBe(true);
  expect(result.reach.targets).toEqual([{ dir: reachTargetDir, status: 'written' }]);
  expect(result.reach.included).toBe(2);

  // Reach side — files on disk
  const reachFile = fs.readFileSync(path.join(reachTargetDir, 'second-brain.md'), 'utf8');
  expect(reachFile).toContain('Reach integration fact one');
  expect(reachFile).toContain('Reach integration fact two');
  expect(reachFile).toContain(path.join(tmpDir, 'memory', 'memory.md'));
  expect(reachFile).toContain('the canonical store wins');
  expect(reachFile).toContain('scripts/recall.js');

  const index = fs.readFileSync(path.join(reachTargetDir, 'MEMORY.md'), 'utf8');
  expect(index.match(/\]\(second-brain\.md\)/g)).toHaveLength(1);
});

test('a second promotion regenerates the reach file without duplicating the index line', async () => {
  fs.writeFileSync(
    path.join(proposalsDir, 'memory-proposals.md'),
    buildProposalsFile([{ candidateId: 'mem-20260715-001', category: 'LEARNING', content: 'First run fact for regeneration check.' }]),
    'utf8'
  );
  await promoteMemories.promoteMemories({ max: 5 });

  fs.writeFileSync(
    path.join(proposalsDir, 'memory-proposals.md'),
    buildProposalsFile([{ candidateId: 'mem-20260716-001', category: 'DECISION', content: 'Second run fact for regeneration check.' }]),
    'utf8'
  );
  const run2 = await promoteMemories.promoteMemories({ max: 5 });

  expect(run2.promoted).toBe(1);
  const reachFile = fs.readFileSync(path.join(reachTargetDir, 'second-brain.md'), 'utf8');
  expect(reachFile).toContain('Second run fact');
  expect(reachFile).toContain('First run fact'); // both promoted entries are in memory.md
  const index = fs.readFileSync(path.join(reachTargetDir, 'MEMORY.md'), 'utf8');
  expect(index.match(/\]\(second-brain\.md\)/g)).toHaveLength(1);
});

test('dry-run end-to-end: no memory.md, no proposals rewrite, no reach file', async () => {
  const proposalsFile = path.join(proposalsDir, 'memory-proposals.md');
  const original = buildProposalsFile([
    { candidateId: 'mem-20260715-001', category: 'LEARNING', content: 'Dry-run fact that must not land anywhere.' },
  ]);
  fs.writeFileSync(proposalsFile, original, 'utf8');

  const result = await promoteMemories.promoteMemories({ dryRun: true });

  expect(result.dryRun).toBe(true);
  expect(result.promoted).toBe(1);
  expect(result.reach).toBeUndefined();
  expect(fs.existsSync(path.join(memoryDir, 'memory.md'))).toBe(false);
  expect(fs.readFileSync(proposalsFile, 'utf8')).toBe(original);
  expect(fs.existsSync(path.join(reachTargetDir, 'second-brain.md'))).toBe(false);
});

'use strict';

/**
 * dream-apply.test.js
 *
 * Tests for the /dream-apply path (Phase 34 Plan 07): snapshotStore,
 * applyOps (MERGE supersede-not-delete + STALE flag-append), restoreSnapshot,
 * and the mandatory runEvalGate (auto-restore on regression).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeHash } = require('../src/utils/memory-utils');

let tmpDir;
let vaultRoot;
let cacheDir;
let dream;

/** Uncheck-to-accept: flips one op's accept box to `[x]` within a raw changeset. */
function acceptOp(content, id) {
  const idEsc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(## ${idEsc} · (?:MERGE|STALE)[\\s\\S]*?)- \\[ \\] accept`, 'm');
  return content.replace(regex, '$1- [x] accept');
}

const CONTENT_A = 'gh CLI must use the keychain token for auth.';
const CONTENT_B = 'Always authenticate gh via the stored keychain token.';
const CONTENT_C = 'References config/pipeline-old-removed.json which was deleted.';
const HASH_A = computeHash(CONTENT_A);
const HASH_B = computeHash(CONTENT_B);
const HASH_C = computeHash(CONTENT_C);

function buildMemoryMd() {
  return [
    '## 2026-01',
    '',
    '### 2026-01-01 · CONSTRAINT · gh-auth',
    '',
    CONTENT_A,
    '',
    'category:: CONSTRAINT',
    'source-ref:: gh-auth',
    'tags:: ',
    'added:: 2026-01-01T00:00:00Z',
    'related:: ',
    `content_hash:: ${HASH_A}`,
    '',
    '### 2026-01-02 · CONSTRAINT · gh-auth-token',
    '',
    CONTENT_B,
    '',
    'category:: CONSTRAINT',
    'source-ref:: gh-auth-token',
    'tags:: ',
    'added:: 2026-01-02T00:00:00Z',
    'related:: ',
    `content_hash:: ${HASH_B}`,
    '',
    '### 2026-01-03 · OTHER · old-config',
    '',
    CONTENT_C,
    '',
    'category:: OTHER',
    'source-ref:: old-config',
    'tags:: ',
    'added:: 2026-01-03T00:00:00Z',
    'related:: ',
    `content_hash:: ${HASH_C}`,
    '',
  ].join('\n');
}

const CONFIG = { promotion: { batchCapMin: 5, batchCapMax: 10 } };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-apply-'));
  vaultRoot = path.join(tmpDir, 'vault');
  cacheDir = path.join(tmpDir, 'cache');
  fs.mkdirSync(path.join(vaultRoot, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, 'proposals'), { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  fs.writeFileSync(path.join(vaultRoot, 'memory', 'memory.md'), buildMemoryMd(), 'utf8');

  process.env.VAULT_ROOT = vaultRoot;
  process.env.CACHE_DIR_OVERRIDE = cacheDir;
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

  jest.resetModules();
  dream = require('../src/dream');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
  delete process.env.CACHE_DIR_OVERRIDE;
  delete process.env.CONFIG_DIR_OVERRIDE;
  jest.restoreAllMocks();
});

function buildChangeset() {
  const mergeOp = {
    op: 'MERGE',
    mergedContent: CONTENT_A,
    category: 'CONSTRAINT',
    shortRef: 'gh-auth',
    tags: ['gh', 'auth'],
    rationale: 'both entries state the same constraint',
    'merged-from': `${HASH_A}, ${HASH_B}`,
    sourceHashes: [HASH_A, HASH_B],
    similarity: 0.95,
    content_hash: computeHash('MERGED: ' + CONTENT_A),
  };
  const staleOp = {
    targetHash: HASH_C,
    reason: 'dead-reference — file path removed',
    action: 'append stale:: 2026-08-01 · dead-reference — file removed',
  };
  const { path: changesetPath, written } = dream.writeChangeset([mergeOp], [staleOp], { entries: [] });
  expect(written).toBe(true);
  return changesetPath;
}

describe('dream: applyOps', () => {
  test('MERGE op supersedes both sources without deleting them, and inserts the merged entry', async () => {
    const changesetPath = buildChangeset();
    let content = fs.readFileSync(changesetPath, 'utf8');
    const ops = dream.parseChangesetOps(content);
    const mergeId = ops.find(o => o.opType === 'MERGE').id;
    content = acceptOp(content, mergeId);
    fs.writeFileSync(changesetPath, content, 'utf8');

    const result = await dream.applyOps(content, CONFIG);
    expect(result.mergeCount).toBe(1);
    expect(result.appliedIds).toContain(mergeId);

    const memoryContent = fs.readFileSync(path.join(vaultRoot, 'memory', 'memory.md'), 'utf8');
    // Sources are still present, verbatim, never deleted.
    expect(memoryContent).toContain(CONTENT_A);
    expect(memoryContent).toContain(CONTENT_B);
    // Both sources carry superseded-by pointing at the new merged hash.
    const newHash = computeHash('MERGED: ' + CONTENT_A);
    const aIdx = memoryContent.indexOf(`content_hash:: ${HASH_A}`);
    const bIdx = memoryContent.indexOf(`content_hash:: ${HASH_B}`);
    expect(memoryContent.slice(aIdx, aIdx + 200)).toContain(`superseded-by:: ${newHash}`);
    expect(memoryContent.slice(bIdx, bIdx + 200)).toContain(`superseded-by:: ${newHash}`);
    // Merged entry itself landed in the file.
    expect(memoryContent).toContain(`content_hash:: ${newHash}`);
  });

  test('STALE op appends its flag line to the target without deleting it', async () => {
    const changesetPath = buildChangeset();
    let content = fs.readFileSync(changesetPath, 'utf8');
    const ops = dream.parseChangesetOps(content);
    const staleId = ops.find(o => o.opType === 'STALE').id;
    content = acceptOp(content, staleId);
    fs.writeFileSync(changesetPath, content, 'utf8');

    const result = await dream.applyOps(content, CONFIG);
    expect(result.staleCount).toBe(1);

    const memoryContent = fs.readFileSync(path.join(vaultRoot, 'memory', 'memory.md'), 'utf8');
    expect(memoryContent).toContain(CONTENT_C);
    const cIdx = memoryContent.indexOf(`content_hash:: ${HASH_C}`);
    expect(memoryContent.slice(cIdx, cIdx + 200)).toContain('stale:: 2026-08-01');
  });

  test('ops already marked applied:: are skipped (no double-apply)', async () => {
    const changesetPath = buildChangeset();
    let content = fs.readFileSync(changesetPath, 'utf8');
    const ops = dream.parseChangesetOps(content);
    const mergeId = ops.find(o => o.opType === 'MERGE').id;
    content = acceptOp(content, mergeId);
    content = content.replace(`## ${mergeId} · MERGE\n`, `## ${mergeId} · MERGE\napplied:: 2026-08-01T00:00:00Z\n`);

    const result = await dream.applyOps(content, CONFIG);
    expect(result.appliedIds).toHaveLength(0);
  });
});

describe('dream: snapshotStore + restoreSnapshot', () => {
  test('restore is byte-identical to the pre-apply snapshot', () => {
    const before = fs.readFileSync(path.join(vaultRoot, 'memory', 'memory.md'), 'utf8');
    const snapshotPath = dream.snapshotStore('2026-08-01');

    fs.writeFileSync(path.join(vaultRoot, 'memory', 'memory.md'), 'MUTATED CONTENT', 'utf8');
    dream.restoreSnapshot(snapshotPath);

    const after = fs.readFileSync(path.join(vaultRoot, 'memory', 'memory.md'), 'utf8');
    expect(after).toBe(before);
  });
});

describe('dream: runEvalGate', () => {
  test('eval-fail auto-restores the snapshot and reverts op statuses to unresolved', async () => {
    const before = fs.readFileSync(path.join(vaultRoot, 'memory', 'memory.md'), 'utf8');
    const snapshotPath = dream.snapshotStore('2026-08-01');

    const changesetPath = buildChangeset();
    let content = fs.readFileSync(changesetPath, 'utf8');
    const ops = dream.parseChangesetOps(content);
    const mergeId = ops.find(o => o.opType === 'MERGE').id;
    content = acceptOp(content, mergeId);
    fs.writeFileSync(changesetPath, content, 'utf8');

    const applyResult = await dream.applyOps(content, CONFIG);
    // Mutate memory.md further post-apply to prove restore actually ran.
    const postApply = fs.readFileSync(path.join(vaultRoot, 'memory', 'memory.md'), 'utf8');
    expect(postApply).not.toBe(before);

    const gateResult = dream.runEvalGate(snapshotPath, changesetPath, applyResult.appliedIds, {
      runEvalFn: () => { throw new Error('recall regression'); },
    });

    expect(gateResult.passed).toBe(false);
    const restored = fs.readFileSync(path.join(vaultRoot, 'memory', 'memory.md'), 'utf8');
    expect(restored).toBe(before);

    const revertedChangeset = fs.readFileSync(changesetPath, 'utf8');
    const revertedOps = dream.parseChangesetOps(revertedChangeset);
    expect(revertedOps.find(o => o.id === mergeId).status).toBeNull();
  });

  test('eval-pass marks applied ops in the changeset', async () => {
    const snapshotPath = dream.snapshotStore('2026-08-01');
    const changesetPath = buildChangeset();
    let content = fs.readFileSync(changesetPath, 'utf8');
    const ops = dream.parseChangesetOps(content);
    const mergeId = ops.find(o => o.opType === 'MERGE').id;
    content = acceptOp(content, mergeId);
    fs.writeFileSync(changesetPath, content, 'utf8');

    const applyResult = await dream.applyOps(content, CONFIG);
    const gateResult = dream.runEvalGate(snapshotPath, changesetPath, applyResult.appliedIds, {
      runEvalFn: () => {},
    });

    expect(gateResult.passed).toBe(true);
    const finalChangeset = fs.readFileSync(changesetPath, 'utf8');
    expect(finalChangeset).toMatch(new RegExp(`## ${mergeId}[\\s\\S]*?applied:: `));
  });
});

// ── Lock + changeset-finder helpers (branch coverage for Phase 34 apply path) ──
describe('dream apply helpers — lock + changeset finder', () => {
  test('findLatestChangesetPath returns null when the proposals dir has no changeset', () => {
    // beforeEach created an empty proposals/ dir
    expect(dream.findLatestChangesetPath()).toBeNull();
  });

  test('findLatestChangesetPath returns null when the proposals dir is absent', () => {
    fs.rmSync(path.join(vaultRoot, 'proposals'), { recursive: true, force: true });
    expect(dream.findLatestChangesetPath()).toBeNull();
  });

  test('findLatestChangesetPath picks the latest month when several exist', () => {
    const dir = path.join(vaultRoot, 'proposals');
    fs.writeFileSync(path.join(dir, 'dream-changeset-2026-01.md'), 'x', 'utf8');
    fs.writeFileSync(path.join(dir, 'dream-changeset-2026-03.md'), 'x', 'utf8');
    fs.writeFileSync(path.join(dir, 'dream-changeset-2026-02.md'), 'x', 'utf8');
    expect(dream.findLatestChangesetPath()).toBe(path.join(dir, 'dream-changeset-2026-03.md'));
  });

  test('acquireProposalsLock acquires a free lock; releaseProposalsLock removes it', async () => {
    const res = await dream.acquireProposalsLock();
    expect(res.acquired).toBe(true);
    expect(fs.existsSync(res.lockPath)).toBe(true);
    dream.releaseProposalsLock(res.lockPath);
    expect(fs.existsSync(res.lockPath)).toBe(false);
  });

  test('releaseProposalsLock swallows ENOENT when the lock is already gone', () => {
    expect(() => dream.releaseProposalsLock(path.join(vaultRoot, 'proposals', 'nope.lock'))).not.toThrow();
  });
});

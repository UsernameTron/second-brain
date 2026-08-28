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

  test('MERGE output lands with ^anchor, added:: and source-ref:: so its supersede pointers resolve', async () => {
    // Regression: the merged entry used to land with content_hash:: and no
    // ^anchor, so every `superseded-by:: <hash>` on a source dead-ended — a
    // reader told to prefer the replacement could not find it and fell back
    // on the stale source. Observed live as 8 unresolved pointers and 1
    // dangling [[memory#^hash]]. It also had no added::, so memory-reader
    // left addedAt '' and _daysSince defaulted to 365 (max recency penalty).
    const changesetPath = buildChangeset();
    let content = fs.readFileSync(changesetPath, 'utf8');
    const ops = dream.parseChangesetOps(content);
    const mergeId = ops.find(o => o.opType === 'MERGE').id;
    content = acceptOp(content, mergeId);
    fs.writeFileSync(changesetPath, content, 'utf8');

    await dream.applyOps(content, CONFIG);

    const memoryContent = fs.readFileSync(path.join(vaultRoot, 'memory', 'memory.md'), 'utf8');
    const newHash = computeHash('MERGED: ' + CONTENT_A);

    // The anchor exists, so the pointer resolves.
    expect(memoryContent).toMatch(new RegExp(`^\\^${newHash}$`, 'm'));

    // Every superseded-by:: target in the file has a matching ^anchor.
    const anchors = new Set((memoryContent.match(/^\^[0-9a-f]{12}$/gm) || []).map(a => a.slice(1)));
    const pointers = (memoryContent.match(/^superseded-by:: [0-9a-f]{12}$/gm) || []).map(p => p.slice(-12));
    expect(pointers.length).toBeGreaterThan(0);
    expect(pointers.filter(h => !anchors.has(h))).toEqual([]);

    // Provenance + recency fields are present on the merged entry.
    const mergedIdx = memoryContent.indexOf(`content_hash:: ${newHash}`);
    const mergedBlock = memoryContent.slice(Math.max(0, mergedIdx - 600), mergedIdx + 100);
    expect(mergedBlock).toMatch(/^added:: \d{4}-\d{2}-\d{2}T/m);
    expect(mergedBlock).toMatch(/^source-ref:: \S/m);

    // memory-reader must actually parse that addedAt, or recency decay still
    // treats the entry as a year old.
    const entries = await require('../src/memory-reader').readMemory();
    const merged = entries.find(e => e.contentHash === newHash);
    expect(merged).toBeDefined();
    expect(merged.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(merged.sourceRef).toBeTruthy();
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

    const gateResult = await dream.runEvalGate(snapshotPath, changesetPath, applyResult.appliedIds, {
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
    const gateResult = await dream.runEvalGate(snapshotPath, changesetPath, applyResult.appliedIds, {
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

// ── Codex hardening: P1/P2 apply-path correctness ────────────────────────────
describe('dream apply — Codex P1/P2 hardening', () => {
  const CONFIG2 = { promotion: { batchCapMax: 10 } };
  const mem = () => fs.readFileSync(path.join(vaultRoot, 'memory', 'memory.md'), 'utf8');
  const acceptFirst = (cs, opType) => {
    let content = fs.readFileSync(cs, 'utf8');
    const id = dream.parseChangesetOps(content).find(o => o.opType === opType).id;
    content = acceptOp(content, id);
    fs.writeFileSync(cs, content, 'utf8');
    return content;
  };

  test('P2: STALE op with an absent target is not recorded applied', async () => {
    const before = mem();
    const { path: cs } = dream.writeChangeset([], [
      { targetHash: 'ffffffffffff', reason: 'x', action: 'append stale:: 2026-08-01 · x' },
    ], { entries: [] });
    const content = acceptFirst(cs, 'STALE');
    const res = await dream.applyOps(content, CONFIG2);
    expect(res.staleCount).toBe(0);
    expect(res.appliedIds).toHaveLength(0);
    expect(mem()).toBe(before); // nothing written
  });

  test('P2: MERGE with a missing source is skipped, not half-applied', async () => {
    const before = mem();
    const mergeOp = {
      op: 'MERGE', mergedContent: 'merged text', category: 'OTHER', shortRef: 'x', tags: [],
      rationale: 'r', 'merged-from': `${HASH_A}, ffffffffffff`, sourceHashes: [HASH_A, 'ffffffffffff'],
      similarity: 0.9, content_hash: computeHash('merged text'),
    };
    const { path: cs } = dream.writeChangeset([mergeOp], [], { entries: [] });
    const content = acceptFirst(cs, 'MERGE');
    const res = await dream.applyOps(content, CONFIG2);
    expect(res.mergeCount).toBe(0);
    expect(res.appliedIds).toHaveLength(0);
    expect(mem()).toBe(before); // no orphan merged entry inserted
  });

  test('P2: restoreSnapshot removes a sidecar created after the snapshot', () => {
    const snap = dream.snapshotStore('2026-08-01');
    expect(fs.existsSync(path.join(snap, 'embeddings.jsonl'))).toBe(false);
    const embPath = path.join(cacheDir, 'embeddings.jsonl');
    fs.writeFileSync(embPath, '{"hash":"x"}\n', 'utf8'); // simulate apply creating it
    dream.restoreSnapshot(snap);
    expect(fs.existsSync(embPath)).toBe(false); // removed to match snapshot
    expect(fs.existsSync(path.join(vaultRoot, 'memory', 'memory.md'))).toBe(true);
  });

  test('P1: default gate passes when the merged entry stays retrievable', async () => {
    const snap = dream.snapshotStore('2026-08-01');
    const cs = buildChangeset();
    const content = acceptFirst(cs, 'MERGE');
    const applyResult = await dream.applyOps(content, CONFIG);
    const mergedHash = computeHash('MERGED: ' + CONTENT_A);
    const gate = await dream.runEvalGate(snap, cs, applyResult.appliedIds, {
      hybridSearchFn: async () => ({ results: [{ id: mergedHash }] }),
    });
    expect(gate.passed).toBe(true);
  });

  test('P1: default gate fails + restores when the merged entry is unretrievable', async () => {
    const before = mem();
    const snap = dream.snapshotStore('2026-08-01');
    const cs = buildChangeset();
    const content = acceptFirst(cs, 'MERGE');
    const applyResult = await dream.applyOps(content, CONFIG);
    expect(mem()).not.toBe(before);
    const gate = await dream.runEvalGate(snap, cs, applyResult.appliedIds, {
      hybridSearchFn: async () => ({ results: [] }), // merged entry not found
    });
    expect(gate.passed).toBe(false);
    expect(gate.error).toMatch(/not retrievable/);
    expect(mem()).toBe(before); // snapshot restored
  });

  test('P1: default gate fails closed when retrieval is degraded', async () => {
    const snap = dream.snapshotStore('2026-08-01');
    const cs = buildChangeset();
    const content = acceptFirst(cs, 'MERGE');
    const applyResult = await dream.applyOps(content, CONFIG);
    const gate = await dream.runEvalGate(snap, cs, applyResult.appliedIds, {
      hybridSearchFn: async () => ({ results: [], degraded: true, reason: 'voyage down' }),
    });
    expect(gate.passed).toBe(false);
    expect(gate.error).toMatch(/failing closed/);
  });
});

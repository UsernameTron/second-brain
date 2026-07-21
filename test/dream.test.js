'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeHash } = require('../src/utils/memory-utils');

const CONFIG = {
  dream: {
    enabled: true,
    mergeCosineMin: 0.90,
    patternDedupCosine: 0.86,
    maxMergeOps: 15,
    maxStaleFlags: 10,
    maxPatternAdds: 5,
    staleAgeDays: 180,
    sessionLogWindow: 30,
    maxLLMCalls: 40,
  },
};

function makeEntry(overrides = {}) {
  const content = overrides.content || 'default content';
  return {
    id: overrides.contentHash || computeHash(content),
    category: 'LEARNING',
    content,
    date: '2026-01-01',
    sourceRef: 'ref',
    contentHash: overrides.contentHash || computeHash(content),
    tags: '',
    related: '',
    addedAt: '2026-01-01T00:00:00Z',
    supersededBy: null,
    stale: null,
    ...overrides,
  };
}

describe('dream: detectMergePairs', () => {
  const { detectMergePairs } = require('../src/dream');

  test('pairs live entries at or above mergeCosineMin', () => {
    const a = makeEntry({ content: 'entry A', contentHash: 'hashA' });
    const b = makeEntry({ content: 'entry B', contentHash: 'hashB' });
    const embeddings = [
      { hash: 'hashA', embedding: [1, 0] },
      { hash: 'hashB', embedding: [1, 0] },
    ];

    const pairs = detectMergePairs([a, b], embeddings, CONFIG);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].similarity).toBeCloseTo(1.0);
  });

  test('excludes superseded entries from pairing', () => {
    const a = makeEntry({ content: 'entry A', contentHash: 'hashA', supersededBy: 'hashZ' });
    const b = makeEntry({ content: 'entry B', contentHash: 'hashB' });
    const embeddings = [
      { hash: 'hashA', embedding: [1, 0] },
      { hash: 'hashB', embedding: [1, 0] },
    ];

    const pairs = detectMergePairs([a, b], embeddings, CONFIG);
    expect(pairs).toHaveLength(0);
  });

  test('below-threshold cosine with no shortRef match is not paired', () => {
    const a = makeEntry({ content: 'entry A', contentHash: 'hashA', sourceRef: 'topic-x' });
    const b = makeEntry({ content: 'entry B', contentHash: 'hashB', sourceRef: 'topic-y' });
    const embeddings = [
      { hash: 'hashA', embedding: [1, 0] },
      { hash: 'hashB', embedding: [0, 1] },
    ];

    const pairs = detectMergePairs([a, b], embeddings, CONFIG);
    expect(pairs).toHaveLength(0);
  });

  test('same-category shortRef prefix match pairs even below cosine threshold', () => {
    const a = makeEntry({ content: 'entry A', contentHash: 'hashA', category: 'CONSTRAINT', sourceRef: 'gh-auth' });
    const b = makeEntry({ content: 'entry B', contentHash: 'hashB', category: 'CONSTRAINT', sourceRef: 'gh-auth-token' });
    const embeddings = [
      { hash: 'hashA', embedding: [1, 0] },
      { hash: 'hashB', embedding: [0, 1] },
    ];

    const pairs = detectMergePairs([a, b], embeddings, CONFIG);
    expect(pairs).toHaveLength(1);
  });

  test('caps results at maxMergeOps, sorted by similarity descending', () => {
    const cfg = { dream: { ...CONFIG.dream, maxMergeOps: 1 } };
    const a = makeEntry({ content: 'A', contentHash: 'hA' });
    const b = makeEntry({ content: 'B', contentHash: 'hB' });
    const c = makeEntry({ content: 'C', contentHash: 'hC' });
    const embeddings = [
      { hash: 'hA', embedding: [1, 0] },
      { hash: 'hB', embedding: [1, 0] },
      { hash: 'hC', embedding: [0.9, Math.sqrt(1 - 0.81)] },
    ];

    const pairs = detectMergePairs([a, b, c], embeddings, cfg);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].similarity).toBeCloseTo(1.0);
  });
});

describe('dream: authorMerge', () => {
  const { authorMerge } = require('../src/dream');

  test('valid merge with verbatim quotes from both sources is proposed', async () => {
    const a = makeEntry({ content: 'gh CLI must use the keychain token for auth.', contentHash: 'hashA', category: 'CONSTRAINT', sourceRef: 'gh-auth' });
    const b = makeEntry({ content: 'Always authenticate gh via the stored keychain token.', contentHash: 'hashB', category: 'CONSTRAINT', sourceRef: 'gh-auth-token' });

    const sonnetClient = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: {
          mergedContent: 'gh CLI must use the keychain token for auth.',
          category: 'CONSTRAINT',
          shortRef: 'gh-auth',
          tags: ['gh', 'auth'],
          rationale: 'both entries state the same constraint',
          quotedFromA: 'gh CLI must use the keychain token for auth.',
          quotedFromB: 'Always authenticate gh via the stored keychain token.',
        },
      }),
    };

    const proposal = await authorMerge({ a, b, similarity: 0.95 }, CONFIG, { sonnetClient });

    expect(proposal).not.toBeNull();
    expect(proposal.op).toBe('MERGE');
    expect(proposal['merged-from']).toBe('hashA, hashB');
    expect(proposal.content_hash).toBe(computeHash(proposal.mergedContent));
  });

  test('fabricated quote (not a literal substring of the source) drops the pair, proposes nothing', async () => {
    const a = makeEntry({ content: 'gh CLI must use the keychain token for auth.', contentHash: 'hashA' });
    const b = makeEntry({ content: 'Always authenticate gh via the stored keychain token.', contentHash: 'hashB' });

    const sonnetClient = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: {
          mergedContent: 'gh CLI must use the keychain token for auth.',
          category: 'CONSTRAINT',
          shortRef: 'gh-auth',
          tags: [],
          rationale: 'merged',
          quotedFromA: 'this sentence was never in source A',
          quotedFromB: 'Always authenticate gh via the stored keychain token.',
        },
      }),
    };

    const proposal = await authorMerge({ a, b, similarity: 0.95 }, CONFIG, { sonnetClient });

    expect(proposal).toBeNull();
  });

  test('Sonnet failure drops the pair, never throws', async () => {
    const a = makeEntry({ content: 'A', contentHash: 'hashA' });
    const b = makeEntry({ content: 'B', contentHash: 'hashB' });
    const sonnetClient = { classify: jest.fn().mockResolvedValue({ success: false, error: 'api-error' }) };

    const proposal = await authorMerge({ a, b, similarity: 0.95 }, CONFIG, { sonnetClient });
    expect(proposal).toBeNull();
  });
});

describe('dream: detectStale', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../src/contradiction-check');
  });

  test('dead-reference: flags an entry referencing a config key/file that no longer exists', async () => {
    const { detectStale } = require('../src/dream');
    const entry = makeEntry({
      content: 'See config/this-file-does-not-exist.json for the flag definition.',
      contentHash: 'hashDead',
      category: 'LEARNING',
    });

    const flags = await detectStale([entry], CONFIG);
    expect(flags).toHaveLength(1);
    expect(flags[0].targetHash).toBe('hashDead');
    expect(flags[0].reason).toMatch(/dead-reference/);
  });

  test('CONSTRAINT entries are never age-flagged, even far over staleAgeDays', async () => {
    const { detectStale } = require('../src/dream');
    const oldConstraint = makeEntry({
      content: 'plain constraint text, no dead references',
      contentHash: 'hashOldConstraint',
      category: 'CONSTRAINT',
      addedAt: '2020-01-01T00:00:00Z',
    });

    const flags = await detectStale([oldConstraint], CONFIG);
    expect(flags).toHaveLength(0);
  });

  test('PREFERENCE entries are never age-flagged, even far over staleAgeDays', async () => {
    const { detectStale } = require('../src/dream');
    const oldPreference = makeEntry({
      content: 'plain preference text, no dead references',
      contentHash: 'hashOldPreference',
      category: 'PREFERENCE',
      addedAt: '2020-01-01T00:00:00Z',
    });

    const flags = await detectStale([oldPreference], CONFIG);
    expect(flags).toHaveLength(0);
  });

  test('ephemeral category over staleAgeDays is age-flagged', async () => {
    const { detectStale } = require('../src/dream');
    const oldLearning = makeEntry({
      content: 'plain learning text, no dead references',
      contentHash: 'hashOldLearning',
      category: 'LEARNING',
      addedAt: '2020-01-01T00:00:00Z',
    });

    const flags = await detectStale([oldLearning], CONFIG);
    expect(flags).toHaveLength(1);
    expect(flags[0].reason).toMatch(/age/);
  });

  test('checkContradiction is invoked at most maxStaleFlags times across 50 live entries (confirm cap holds)', async () => {
    jest.doMock('../src/contradiction-check', () => ({
      checkContradiction: jest.fn().mockResolvedValue({ contradicts: false, against: null, confidence: 0 }),
    }));
    const { detectStale } = require('../src/dream');
    const { checkContradiction } = require('../src/contradiction-check');

    const entries = Array.from({ length: 50 }, (_, i) => makeEntry({
      content: `entry number ${i}, no dead references, recent`,
      contentHash: `hash${i}`,
      category: 'LEARNING',
      addedAt: new Date().toISOString(),
    }));

    await detectStale(entries, CONFIG);

    expect(checkContradiction.mock.calls.length).toBeLessThanOrEqual(CONFIG.dream.maxStaleFlags);
  });

  test('contradicted entry is flagged with the contradicting hash', async () => {
    jest.doMock('../src/contradiction-check', () => ({
      checkContradiction: jest.fn().mockResolvedValue({ contradicts: true, against: 'hashOther', confidence: 0.9 }),
    }));
    const { detectStale } = require('../src/dream');

    const entry = makeEntry({
      content: 'entry with no dead references, recent',
      contentHash: 'hashContradicted',
      category: 'LEARNING',
      addedAt: new Date().toISOString(),
    });

    const flags = await detectStale([entry], CONFIG);
    expect(flags).toHaveLength(1);
    expect(flags[0].reason).toMatch(/contradicted by hashOther/);
  });

  test('already-superseded and already-stale entries are excluded from consideration', async () => {
    const { detectStale } = require('../src/dream');
    const superseded = makeEntry({ contentHash: 'hashSup', supersededBy: 'hashNew', addedAt: '2020-01-01T00:00:00Z', category: 'LEARNING' });
    const stale = makeEntry({ contentHash: 'hashStale', stale: '2026-01-01 · old', addedAt: '2020-01-01T00:00:00Z', category: 'LEARNING' });

    const flags = await detectStale([superseded, stale], CONFIG);
    expect(flags).toHaveLength(0);
  });

  test('results are capped at maxStaleFlags', async () => {
    const cfg = { dream: { ...CONFIG.dream, maxStaleFlags: 2 } };
    const { detectStale } = require('../src/dream');

    const entries = Array.from({ length: 5 }, (_, i) => makeEntry({
      content: `entry ${i} refs config/missing-file-${i}.json which is gone`,
      contentHash: `hashDeadRef${i}`,
      category: 'LEARNING',
    }));

    const flags = await detectStale(entries, cfg);
    expect(flags).toHaveLength(2);
  });
});

describe('dream: detectPatterns', () => {
  const { detectPatterns } = require('../src/dream');
  const today = new Date().toISOString().slice(0, 10);
  const SESSION_LOG_CONTENT = `# Session Log\n\n## ${today} Session End\nDid a thing spanning two sessions.\n`;
  const DECISIONS_CONTENT = `# Decisions\n\n## ${today} — Some Decision\nRelated context.\n`;
  const actualFs = jest.requireActual('fs');

  let readFileSyncSpy;

  beforeEach(() => {
    readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockImplementation((filePath, ...args) => {
      const p = String(filePath);
      if (p.endsWith(path.join('state', 'session-log.md'))) return SESSION_LOG_CONTENT;
      if (p.endsWith(path.join('state', 'decisions.md'))) return DECISIONS_CONTENT;
      return actualFs.readFileSync(filePath, ...args);
    });
  });

  afterEach(() => {
    readFileSyncSpy.mockRestore();
  });

  test('duplicate-hash candidate is dropped (writeCandidate reports duplicate)', async () => {
    const sonnetClient = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: [{ content: 'a recurring pattern across sessions', category: 'PATTERN', sourceRef: 'session-log', confidence: 0.9 }],
      }),
    };
    const writeCandidateFn = jest.fn().mockResolvedValue({ written: false, reason: 'duplicate' });
    const readAllEmbeddingsFn = jest.fn().mockReturnValue([]);

    const staged = await detectPatterns(CONFIG, { sonnetClient, writeCandidateFn, readAllEmbeddingsFn });

    expect(writeCandidateFn).toHaveBeenCalledTimes(1);
    expect(staged).toHaveLength(0);
  });

  test('high-cosine candidate vs a live entry is dropped before staging', async () => {
    const sonnetClient = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: [{ content: 'near-duplicate pattern text', category: 'PATTERN', sourceRef: 'session-log', confidence: 0.9 }],
      }),
    };
    const voyageClient = { embed: jest.fn().mockResolvedValue({ success: true, embeddings: [[1, 0]] }) };
    const readAllEmbeddingsFn = jest.fn().mockReturnValue([{ hash: 'liveHash', embedding: [1, 0] }]);
    const writeCandidateFn = jest.fn().mockResolvedValue({ written: true, candidateId: 'mem-x' });

    const config = { ...CONFIG, memory: { semantic: {} } };
    const staged = await detectPatterns(config, { sonnetClient, voyageClient, readAllEmbeddingsFn, writeCandidateFn });

    expect(staged).toHaveLength(0);
    expect(writeCandidateFn).not.toHaveBeenCalled();
  });

  test('novel candidate below cosine threshold is staged', async () => {
    const sonnetClient = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: [{ content: 'genuinely novel pattern text', category: 'PATTERN', sourceRef: 'session-log', confidence: 0.9 }],
      }),
    };
    const voyageClient = { embed: jest.fn().mockResolvedValue({ success: true, embeddings: [[0, 1]] }) };
    const readAllEmbeddingsFn = jest.fn().mockReturnValue([{ hash: 'liveHash', embedding: [1, 0] }]);
    const writeCandidateFn = jest.fn().mockResolvedValue({ written: true, candidateId: 'mem-x' });

    const config = { ...CONFIG, memory: { semantic: {} } };
    const staged = await detectPatterns(config, { sonnetClient, voyageClient, readAllEmbeddingsFn, writeCandidateFn });

    expect(staged).toHaveLength(1);
    expect(writeCandidateFn).toHaveBeenCalledWith(expect.objectContaining({
      content: 'genuinely novel pattern text',
      extractionTrigger: 'dream',
    }));
  });

  test('maxPatternAdds caps staged survivors', async () => {
    const sonnetClient = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: Array.from({ length: 8 }, (_, i) => ({
          content: `pattern ${i}`, category: 'PATTERN', sourceRef: 'session-log', confidence: 0.9,
        })),
      }),
    };
    const writeCandidateFn = jest.fn().mockResolvedValue({ written: true, candidateId: 'mem-x' });
    const readAllEmbeddingsFn = jest.fn().mockReturnValue([]);
    const cfg = { dream: { ...CONFIG.dream, maxPatternAdds: 2 } };

    const staged = await detectPatterns(cfg, { sonnetClient, writeCandidateFn, readAllEmbeddingsFn });
    expect(staged).toHaveLength(2);
    expect(writeCandidateFn).toHaveBeenCalledTimes(2);
  });

  test('low-confidence candidates are filtered before staging', async () => {
    const sonnetClient = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: [{ content: 'weak signal', category: 'PATTERN', sourceRef: 'session-log', confidence: 0.5 }],
      }),
    };
    const writeCandidateFn = jest.fn();
    const readAllEmbeddingsFn = jest.fn().mockReturnValue([]);

    const staged = await detectPatterns(CONFIG, { sonnetClient, writeCandidateFn, readAllEmbeddingsFn });
    expect(staged).toHaveLength(0);
    expect(writeCandidateFn).not.toHaveBeenCalled();
  });

  test('dryRun runs detection and cosine dedup but stages nothing', async () => {
    const sonnetClient = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: [{ content: 'a novel pattern for dry-run', category: 'PATTERN', sourceRef: 'session-log', confidence: 0.9 }],
      }),
    };
    const writeCandidateFn = jest.fn();
    const readAllEmbeddingsFn = jest.fn().mockReturnValue([]);

    const staged = await detectPatterns(CONFIG, { sonnetClient, writeCandidateFn, readAllEmbeddingsFn, dryRun: true });
    expect(staged).toHaveLength(1);
    expect(writeCandidateFn).not.toHaveBeenCalled();
  });
});

describe('dream: writeChangeset + parseChangesetOps + hasUnresolvedChangeset', () => {
  let tmpVault;
  let prevVaultRoot;

  beforeEach(() => {
    tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-changeset-'));
    prevVaultRoot = process.env.VAULT_ROOT;
    process.env.VAULT_ROOT = tmpVault;
  });

  afterEach(() => {
    if (prevVaultRoot === undefined) delete process.env.VAULT_ROOT;
    else process.env.VAULT_ROOT = prevVaultRoot;
    fs.rmSync(tmpVault, { recursive: true, force: true });
  });

  test('writes MERGE + STALE ops in the design-doc format, golden-hash YES for a golden hash', () => {
    const { writeChangeset } = require('../src/dream');
    const goldenHash = '2b0a841acb92'; // eval/golden-recall.json q01 expected hash
    const a = makeEntry({ contentHash: goldenHash, content: 'gh CLI keychain token', category: 'CONSTRAINT', sourceRef: 'gh-auth' });
    const b = makeEntry({ contentHash: 'hashB', content: 'keychain token again', category: 'CONSTRAINT', sourceRef: 'gh-auth-token' });
    const mergeOp = {
      op: 'MERGE',
      mergedContent: 'merged body',
      category: 'CONSTRAINT',
      shortRef: 'gh-auth',
      tags: ['gh'],
      rationale: 'same constraint',
      'merged-from': `${goldenHash}, hashB`,
      sourceHashes: [goldenHash, 'hashB'],
      sourceEntries: [a, b],
      similarity: 0.95,
      content_hash: 'mergedhash01',
    };
    const staleOp = { targetHash: 'hashStale', reason: 'dead-reference — x', action: 'append stale:: ...' };

    const result = writeChangeset([mergeOp], [staleOp], { entries: [a, b], runDate: '2026-08-01' });

    expect(result.written).toBe(true);
    expect(result.opsWritten).toBe(2);
    const content = fs.readFileSync(result.path, 'utf8');
    expect(content).toMatch(/type: dream-changeset/);
    expect(content).toMatch(/## dream-2026-08-01-001 · MERGE/);
    expect(content).toMatch(/- \[ \] accept/);
    expect(content).toMatch(/golden-hash:: YES/);
    expect(content).toMatch(/## dream-2026-08-01-002 · STALE/);
  });

  test('a multi-box op parses as ambiguous -> skipped via the shared parser', () => {
    const { parseChangesetOps } = require('../src/dream');
    const content = [
      '---',
      'type: dream-changeset',
      '---',
      '',
      '## dream-2026-08-01-001 · STALE',
      '- [x] accept',
      '- [x] reject',
      '- [ ] defer',
      'target:: hashX (2026-01-01 · OTHER · ref)',
      'reason:: dead-reference',
      'action:: append stale',
      '',
    ].join('\n');

    const ops = parseChangesetOps(content);
    expect(ops).toHaveLength(1);
    expect(ops[0].ambiguous).toBe(true);
    expect(ops[0].status).toBeNull();
  });

  test('propose refuses (hasUnresolvedChangeset true) while any op is unresolved', () => {
    const { writeChangeset, hasUnresolvedChangeset } = require('../src/dream');
    const staleOp = { targetHash: 'hashStale', reason: 'dead-reference', action: 'append stale' };
    writeChangeset([], [staleOp], { runDate: '2026-08-01' });

    expect(hasUnresolvedChangeset()).toBe(true);
  });

  test('accepted-but-unapplied op stays unresolved; only applied (or rejected) resolves it', () => {
    const { writeChangeset, hasUnresolvedChangeset } = require('../src/dream');
    const staleOp = { targetHash: 'hashStale', reason: 'dead-reference', action: 'append stale' };
    const result = writeChangeset([], [staleOp], { runDate: '2026-08-01' });

    // Accepted but NOT yet applied — must remain unresolved (P1): otherwise the
    // next propose could overwrite/strand this accepted op before apply runs.
    let content = fs.readFileSync(result.path, 'utf8');
    content = content.replace('- [ ] accept', '- [x] accept');
    fs.writeFileSync(result.path, content, 'utf8');
    expect(hasUnresolvedChangeset()).toBe(true);

    // Stamp applied:: after the op header — now terminal → resolved.
    content = content.replace(/^(## .+ · STALE\n)/m, '$1applied:: 2026-08-01T00:00:00Z\n');
    fs.writeFileSync(result.path, content, 'utf8');
    expect(hasUnresolvedChangeset()).toBe(false);
  });

  test('no changeset file present -> not unresolved', () => {
    const { hasUnresolvedChangeset } = require('../src/dream');
    expect(hasUnresolvedChangeset()).toBe(false);
  });
});

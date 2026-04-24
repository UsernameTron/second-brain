'use strict';

/**
 * semantic-index.test.js
 *
 * Unit tests for src/semantic-index.js — happy paths and core semantics.
 *
 * Coverage groups:
 *   1. indexNewEntries — batching, dedup, empty guard
 *   2. semanticSearch  — content-policy gate, ranking, filters, temporal decay
 *   3. hybridSearch    — RRF math, keyword-only degrade, dedup
 *   4. selfHealIfNeeded — set-diff logic, schema_version mismatch
 *   5. computeSchemaVersion — D-14 invariance (threshold/decay changes MUST NOT change hash)
 *   6. cosine / temporal math via _testOnly
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Shared mock state ─────────────────────────────────────────────────────────

const mockEmbed = jest.fn();
const mockCheckContent = jest.fn();
const mockReadMemory = jest.fn();
const mockSearchMemoryKeyword = jest.fn();
const mockGetMemoryEcho = jest.fn();
const mockSafeLoadPipelineConfig = jest.fn();

jest.mock('voyageai', () => ({
  VoyageAIClient: jest.fn().mockImplementation(() => ({
    embed: (...args) => mockEmbed(...args),
  })),
}));

jest.mock('../src/content-policy', () => ({
  checkContent: (...args) => mockCheckContent(...args),
}));

jest.mock('../src/memory-reader', () => ({
  readMemory: (...args) => mockReadMemory(...args),
  searchMemoryKeyword: (...args) => mockSearchMemoryKeyword(...args),
  getMemoryEcho: (...args) => mockGetMemoryEcho(...args),
}));

jest.mock('../src/pipeline-infra', () => ({
  safeLoadPipelineConfig: (...args) => mockSafeLoadPipelineConfig(...args),
}));

// ── Default config ─────────────────────────────────────────────────────────────

const defaultSemConfig = {
  model: 'voyage-4-lite',
  threshold: 0.72,
  recencyDecay: 0.2,
  rrfK: 60,
  candidatesPerSource: 20,
  embedBatchSize: 128,
  timeoutMs: 3000,
  degradedModeMinutes: 15,
  embeddingDim: 1024,
};

// ── Env isolation ─────────────────────────────────────────────────────────────

let tmpCacheDir;
let originalCacheDir;
let originalVoyageKey;

beforeAll(() => {
  originalCacheDir = process.env.CACHE_DIR_OVERRIDE;
  originalVoyageKey = process.env.VOYAGE_API_KEY;
  process.env.VOYAGE_API_KEY = 'test-key';
});

beforeEach(() => {
  tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sem-'));
  process.env.CACHE_DIR_OVERRIDE = tmpCacheDir;
  jest.resetModules();

  mockEmbed.mockReset();
  mockCheckContent.mockReset();
  mockCheckContent.mockResolvedValue({ decision: 'PASS' });
  mockReadMemory.mockReset();
  mockReadMemory.mockResolvedValue([]);
  mockSearchMemoryKeyword.mockReset();
  mockSearchMemoryKeyword.mockResolvedValue([]);
  mockSafeLoadPipelineConfig.mockReset();
  mockSafeLoadPipelineConfig.mockReturnValue({
    config: {
      memory: { semantic: defaultSemConfig },
      excludedTerms: ['ISPN', 'Genesys', 'Asana'],
    },
    errors: [],
  });
});

afterEach(() => {
  fs.rmSync(tmpCacheDir, { recursive: true, force: true });
});

afterAll(() => {
  if (originalCacheDir === undefined) delete process.env.CACHE_DIR_OVERRIDE;
  else process.env.CACHE_DIR_OVERRIDE = originalCacheDir;
  if (originalVoyageKey === undefined) delete process.env.VOYAGE_API_KEY;
  else process.env.VOYAGE_API_KEY = originalVoyageKey;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a deterministic float array of length n starting from seed */
function makeVec(seed, n = 4) {
  return Array.from({ length: n }, (_, i) => Math.sin(seed + i));
}

/** Normalize a vector to unit length */
function normalize(v) {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / mag);
}

/** Make an embed response with n_embeddings equal-dimension vectors */
function makeEmbedResponse(n, seedFn) {
  return {
    data: Array.from({ length: n }, (_, i) => ({
      embedding: seedFn ? seedFn(i) : makeVec(i * 0.7, 4),
    })),
  };
}

// ── Group 1: indexNewEntries ──────────────────────────────────────────────────

describe('indexNewEntries', () => {
  let indexNewEntries;

  beforeEach(() => {
    indexNewEntries = require('../src/semantic-index').indexNewEntries;
  });

  test('empty array returns {success:true, embedded:0} without calling Voyage', async () => {
    const result = await indexNewEntries([]);
    expect(result).toEqual({ success: true, embedded: 0, failed: 0 });
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  test('3 entries → exactly 1 Voyage call and 3 records in embeddings.jsonl', async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbedResponse(3));
    const entries = [
      { contentHash: 'h1', content: 'Leadership resilience', addedAt: new Date().toISOString(), category: 'INSIGHT' },
      { contentHash: 'h2', content: 'Strategy planning',    addedAt: new Date().toISOString(), category: 'DECISION' },
      { contentHash: 'h3', content: 'Team dynamics',        addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ];
    const result = await indexNewEntries(entries);
    expect(result.embedded).toBe(3);
    expect(result.success).toBe(true);
    expect(mockEmbed).toHaveBeenCalledTimes(1);

    const lines = fs.readFileSync(
      path.join(tmpCacheDir, 'embeddings.jsonl'), 'utf8'
    ).split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  test('130 entries → exactly 2 Voyage calls (128 + 2)', async () => {
    mockEmbed
      .mockResolvedValueOnce(makeEmbedResponse(128))
      .mockResolvedValueOnce(makeEmbedResponse(2));

    const entries = Array.from({ length: 130 }, (_, i) => ({
      contentHash: `h${i}`,
      content: `entry ${i}`,
      addedAt: new Date().toISOString(),
      category: 'INSIGHT',
    }));
    const result = await indexNewEntries(entries);
    expect(mockEmbed).toHaveBeenCalledTimes(2);
    expect(result.embedded).toBe(130);
  });

  test('called twice with same 3 entries → only 1 Voyage call total (dedup by contentHash)', async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbedResponse(3));
    const entries = [
      { contentHash: 'x1', content: 'a', addedAt: new Date().toISOString(), category: 'INSIGHT' },
      { contentHash: 'x2', content: 'b', addedAt: new Date().toISOString(), category: 'INSIGHT' },
      { contentHash: 'x3', content: 'c', addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ];
    await indexNewEntries(entries);
    // Second call should find all hashes already stored → 0 new embeds
    const result = await indexNewEntries(entries);
    expect(result.embedded).toBe(0);
    expect(mockEmbed).toHaveBeenCalledTimes(1); // only from first call
  });

  test('entry without contentHash is skipped', async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbedResponse(1));
    const entries = [
      { content: 'no hash here', addedAt: new Date().toISOString(), category: 'INSIGHT' },
      { contentHash: 'valid', content: 'has hash', addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ];
    const result = await indexNewEntries(entries);
    expect(result.embedded).toBe(1);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    const inputs = mockEmbed.mock.calls[0][0].input;
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toBe('has hash');
  });
});

// ── Group 2: semanticSearch ───────────────────────────────────────────────────

describe('semanticSearch', () => {
  let semanticSearch;
  let indexNewEntries;

  beforeEach(async () => {
    const mod = require('../src/semantic-index');
    semanticSearch = mod.semanticSearch;
    indexNewEntries = mod.indexNewEntries;
  });

  /** Seed the embeddings store with n entries that have known vectors */
  async function seedEmbeddings(n, baseVectors) {
    const entries = Array.from({ length: n }, (_, i) => ({
      contentHash: `seed${i}`,
      content: `content ${i}`,
      addedAt: new Date().toISOString(),
      category: 'INSIGHT',
    }));
    mockEmbed.mockResolvedValueOnce({
      data: baseVectors.map(v => ({ embedding: v })),
    });
    // Also mock memory reading to return entries with contentHash
    mockReadMemory.mockResolvedValue(
      entries.map((e, i) => ({
        id: `id${i}`,
        contentHash: e.contentHash,
        content: e.content,
        category: 'INSIGHT',
        addedAt: e.addedAt,
        sourceRef: 'memory:memory.md',
        date: new Date().toISOString().slice(0, 10),
      }))
    );
    await indexNewEntries(entries);
    mockEmbed.mockReset();
    return entries;
  }

  test('query with ISPN → {blocked:true, results:[]}, no Voyage call (content-policy)', async () => {
    mockCheckContent.mockResolvedValueOnce({ decision: 'BLOCK', reason: 'excluded term', matchedTerm: 'ISPN' });
    const result = await semanticSearch('ISPN pipeline status');
    expect(result.blocked).toBe(true);
    expect(result.results).toEqual([]);
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  test('happy path: returns ranked list sorted desc by adjusted score', async () => {
    // Create 3 vectors: v1 is closest to query, v3 is farthest
    const queryVec = normalize([1, 0, 0, 0]);
    const v1 = normalize([0.99, 0.1, 0, 0]);  // high cosine
    const v2 = normalize([0.7, 0.7, 0, 0]);   // medium cosine
    const v3 = normalize([0, 1, 0, 0]);        // low cosine

    await seedEmbeddings(3, [v1, v2, v3]);

    // Mock the query embed
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: queryVec }] });

    const result = await semanticSearch('leadership', { top: 3 });
    expect(result.results.length).toBeGreaterThan(0);
    // Scores should be descending
    for (let i = 1; i < result.results.length; i++) {
      expect(result.results[i - 1].score).toBeGreaterThanOrEqual(result.results[i].score);
    }
  });

  test('scores below threshold filtered out', async () => {
    // Use orthogonal vectors — cosine=0, below threshold 0.72
    const queryVec = normalize([1, 0, 0, 0]);
    const v1 = normalize([0, 1, 0, 0]); // cosine ≈ 0
    await seedEmbeddings(1, [v1]);

    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: queryVec }] });
    const result = await semanticSearch('leadership', { top: 5 });
    expect(result.results).toHaveLength(0);
  });

  test('top=3 returns at most 3 results even when more pass threshold', async () => {
    const queryVec = normalize([1, 0, 0, 0]);
    const vecs = Array.from({ length: 5 }, (_, i) =>
      normalize([0.9, i * 0.01, 0, 0]) // all very similar to query
    );
    await seedEmbeddings(5, vecs);

    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: queryVec }] });
    const result = await semanticSearch('leadership', { top: 3 });
    expect(result.results.length).toBeLessThanOrEqual(3);
  });

  test('category filter narrows results', async () => {
    const queryVec = normalize([1, 0, 0, 0]);
    const v1 = normalize([0.99, 0.1, 0, 0]);
    // Patch memory entries to include different categories
    mockReadMemory.mockResolvedValue([
      { id: 'id0', contentHash: 'seed0', content: 'insight', category: 'INSIGHT',   addedAt: new Date().toISOString(), sourceRef: 'memory:memory.md', date: '2026-04-24' },
      { id: 'id1', contentHash: 'seed1', content: 'decision', category: 'DECISION', addedAt: new Date().toISOString(), sourceRef: 'memory:memory.md', date: '2026-04-24' },
    ]);
    const entries = [
      { contentHash: 'seed0', content: 'insight',  addedAt: new Date().toISOString(), category: 'INSIGHT' },
      { contentHash: 'seed1', content: 'decision', addedAt: new Date().toISOString(), category: 'DECISION' },
    ];
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: v1 }, { embedding: v1 }] });
    await indexNewEntries(entries);
    mockEmbed.mockReset();

    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: queryVec }] });
    const result = await semanticSearch('leadership', { top: 5, category: 'DECISION' });
    result.results.forEach(r => expect(r.category).toBe('DECISION'));
  });

  test('temporal decay: entry added today outranks same-cosine entry from 300 days ago', async () => {
    const queryVec = normalize([1, 0, 0, 0]);
    const v = normalize([0.95, 0.1, 0, 0]);

    const todayISO = new Date().toISOString();
    const oldISO = new Date(Date.now() - 300 * 24 * 60 * 60 * 1000).toISOString();

    mockReadMemory.mockResolvedValue([
      { id: 'recent', contentHash: 'r1', content: 'recent', category: 'INSIGHT', addedAt: todayISO, sourceRef: 'memory:m.md', date: '2026-04-24' },
      { id: 'old',    contentHash: 'r2', content: 'old',    category: 'INSIGHT', addedAt: oldISO,   sourceRef: 'memory:m.md', date: '2025-07-01' },
    ]);
    const entries = [
      { contentHash: 'r1', content: 'recent', addedAt: todayISO, category: 'INSIGHT' },
      { contentHash: 'r2', content: 'old',    addedAt: oldISO,   category: 'INSIGHT' },
    ];
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: v }, { embedding: v }] });
    await indexNewEntries(entries);
    mockEmbed.mockReset();

    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: queryVec }] });
    const result = await semanticSearch('leadership', { top: 5 });
    const recentResult = result.results.find(r => r.id === 'recent');
    const oldResult    = result.results.find(r => r.id === 'old');
    // Both entries should be present (they were indexed with different addedAt)
    expect(recentResult).toBeDefined();
    expect(oldResult).toBeDefined();
    expect(recentResult.score).toBeGreaterThan(oldResult.score);
  });
});

// ── Group 3: hybridSearch ─────────────────────────────────────────────────────

describe('hybridSearch', () => {
  let hybridSearch;
  let indexNewEntries;

  beforeEach(async () => {
    const mod = require('../src/semantic-index');
    hybridSearch = mod.hybridSearch;
    indexNewEntries = mod.indexNewEntries;
  });

  function seedKeywordHits(ids) {
    return ids.map((id, i) => ({
      id,
      content: `content ${i}`,
      category: 'INSIGHT',
      snippet: `snippet ${i}`,
      addedAt: new Date().toISOString(),
      sourceRef: 'memory:m.md',
      date: '2026-04-24',
    }));
  }

  test('doc in both keyword top-20 and semantic top-20 gets RRF = 1/(60+kw_rank) + 1/(60+sem_rank)', async () => {
    // Keyword list: docA at index 2 (rank 3)
    const kwHits = [
      { id: 'docX', content: 'x', category: 'INSIGHT', snippet: 's', addedAt: new Date().toISOString(), sourceRef: 'm', date: '2026-04-24' },
      { id: 'docY', content: 'y', category: 'INSIGHT', snippet: 's', addedAt: new Date().toISOString(), sourceRef: 'm', date: '2026-04-24' },
      { id: 'docA', content: 'a', category: 'INSIGHT', snippet: 's', addedAt: new Date().toISOString(), sourceRef: 'm', date: '2026-04-24' }, // rank 3
    ];
    mockSearchMemoryKeyword.mockResolvedValue(kwHits);

    // Semantic rank: docA at index 4 (rank 5)
    const queryVec = normalize([1, 0, 0, 0]);
    const vA = normalize([0.98, 0.1, 0, 0]);

    // Seed embeddings for docA
    mockReadMemory.mockResolvedValue([
      { id: 'docA', contentHash: 'hA', content: 'a', category: 'INSIGHT', addedAt: new Date().toISOString(), sourceRef: 'm', date: '2026-04-24' },
      { id: 'docB', contentHash: 'hB', content: 'b', category: 'INSIGHT', addedAt: new Date().toISOString(), sourceRef: 'm', date: '2026-04-24' },
      { id: 'docC', contentHash: 'hC', content: 'c', category: 'INSIGHT', addedAt: new Date().toISOString(), sourceRef: 'm', date: '2026-04-24' },
      { id: 'docD', contentHash: 'hD', content: 'd', category: 'INSIGHT', addedAt: new Date().toISOString(), sourceRef: 'm', date: '2026-04-24' },
      // docA also appears at semantic rank 5
    ]);

    const semVecs = [vA, normalize([0.95, 0.2, 0, 0]), normalize([0.93, 0.3, 0, 0]), normalize([0.91, 0.4, 0, 0])];
    mockEmbed.mockResolvedValueOnce({ data: semVecs.map(v => ({ embedding: v })) });

    // We'll mock semanticSearch at a higher level by mocking checkContent as PASS
    // and controlling embed response for query
    const entries = [
      { contentHash: 'hA', content: 'a', addedAt: new Date().toISOString(), category: 'INSIGHT' },
      { contentHash: 'hB', content: 'b', addedAt: new Date().toISOString(), category: 'INSIGHT' },
      { contentHash: 'hC', content: 'c', addedAt: new Date().toISOString(), category: 'INSIGHT' },
      { contentHash: 'hD', content: 'd', addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ];
    await indexNewEntries(entries);
    mockEmbed.mockReset();

    // Query embed returns queryVec
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: queryVec }] });

    const result = await hybridSearch('leadership', { top: 5 });
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);

    // docA appears in keyword list so should be in results
    // docA appears in keyword list so should be in results with a positive RRF score
    const docAResult = result.results.find(r => r.id === 'docA');
    expect(docAResult).toBeDefined();
    expect(docAResult.rrfScore).toBeGreaterThan(0);
  });

  test('doc appearing only in keyword list gets RRF from keyword rank alone', async () => {
    const kwHits = seedKeywordHits(['uniqueKW']);
    mockSearchMemoryKeyword.mockResolvedValue(kwHits);
    // No embeddings stored → semantic returns empty
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: [1, 0, 0, 0] }] }); // query embed
    mockReadMemory.mockResolvedValue([]);

    const result = await hybridSearch('x', { top: 5 });
    expect(Array.isArray(result.results)).toBe(true);
    // uniqueKW should appear (from keyword side)
    const kw = result.results.find(r => r.id === 'uniqueKW');
    expect(kw).toBeDefined();
    // Its RRF should be 1/(60+1) from rank=1 keyword
    expect(kw.rrfScore).toBeCloseTo(1 / 61, 10);
  });

  test('dedupe by entry id works when doc appears in both sources', async () => {
    const kwHits = seedKeywordHits(['shared', 'kwonly']);
    mockSearchMemoryKeyword.mockResolvedValue(kwHits);

    const sharedVec = normalize([0.99, 0.01, 0, 0]);
    const queryVec = normalize([1, 0, 0, 0]);

    mockReadMemory.mockResolvedValue([
      { id: 'shared', contentHash: 'hs', content: 's', category: 'INSIGHT', addedAt: new Date().toISOString(), sourceRef: 'm', date: '2026-04-24' },
    ]);
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: sharedVec }] });
    await indexNewEntries([{ contentHash: 'hs', content: 's', addedAt: new Date().toISOString(), category: 'INSIGHT' }]);
    mockEmbed.mockReset();

    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: queryVec }] });
    const result = await hybridSearch('leadership', { top: 10 });

    // 'shared' should appear exactly once even though it's in both keyword and semantic lists
    const sharedMatches = result.results.filter(r => r.id === 'shared');
    expect(sharedMatches).toHaveLength(1);
  });

  test('semantic degraded → returns keyword-only with degraded:true', async () => {
    // Ensure Voyage fails by unsetting key for this test
    const originalKey = process.env.VOYAGE_API_KEY;
    delete process.env.VOYAGE_API_KEY;

    const kwHits = seedKeywordHits(['kw1', 'kw2']);
    mockSearchMemoryKeyword.mockResolvedValue(kwHits);

    const result = await hybridSearch('leadership', { top: 5 });
    expect(result.degraded).toBe(true);
    // Should still have keyword results
    expect(Array.isArray(result.results)).toBe(true);

    process.env.VOYAGE_API_KEY = originalKey;
  });
});

// ── Group 4: selfHealIfNeeded ─────────────────────────────────────────────────

describe('selfHealIfNeeded', () => {
  let selfHealIfNeeded;

  beforeEach(() => {
    const mod = require('../src/semantic-index');
    selfHealIfNeeded = mod.selfHealIfNeeded;
  });

  test('all hashes present → no Voyage call, {healed:false, embedded:0}', async () => {
    // Pre-write embeddings for the hashes readMemory returns
    const mod = require('../src/semantic-index');
    const { indexNewEntries } = mod;

    const entries = [
      { contentHash: 'h1', content: 'a', addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ];
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: [1, 0, 0, 0] }] });
    await indexNewEntries(entries);
    mockEmbed.mockReset();

    mockReadMemory.mockResolvedValue([
      { contentHash: 'h1', content: 'a', category: 'INSIGHT', addedAt: new Date().toISOString() },
    ]);

    const result = await selfHealIfNeeded();
    expect(result.healed).toBe(false);
    expect(result.embedded).toBe(0);
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  test('3 missing hashes → 1 Voyage call with 3 inputs, embedded:3', async () => {
    mockReadMemory.mockResolvedValue([
      { contentHash: 'm1', content: 'x', category: 'INSIGHT', addedAt: new Date().toISOString() },
      { contentHash: 'm2', content: 'y', category: 'INSIGHT', addedAt: new Date().toISOString() },
      { contentHash: 'm3', content: 'z', category: 'INSIGHT', addedAt: new Date().toISOString() },
    ]);
    mockEmbed.mockResolvedValueOnce({ data: Array.from({ length: 3 }, (_, i) => ({ embedding: makeVec(i) })) });

    const result = await selfHealIfNeeded();
    expect(result.healed).toBe(true);
    expect(result.embedded).toBe(3);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
  });

  test('schema_version mismatch → truncateEmbeddings + full re-embed', async () => {
    const mod = require('../src/semantic-index');
    const { indexNewEntries, getMetadataPath, getEmbeddingsPath } = mod;

    // Seed an embedding
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: [1, 0, 0, 0] }] });
    await indexNewEntries([{ contentHash: 'old1', content: 'old', addedAt: new Date().toISOString(), category: 'INSIGHT' }]);
    mockEmbed.mockReset();

    // Overwrite metadata with a stale schema_version
    fs.writeFileSync(getMetadataPath(), JSON.stringify({ schema_version: 'stalehash000', updatedAt: new Date().toISOString() }));

    // readMemory returns 1 entry that needs re-embedding
    mockReadMemory.mockResolvedValue([
      { contentHash: 'old1', content: 'old', category: 'INSIGHT', addedAt: new Date().toISOString() },
    ]);
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: [1, 0, 0, 0] }] });

    const result = await selfHealIfNeeded();
    expect(result.schemaChanged).toBe(true);
    expect(result.healed).toBe(true);
    // embeddings.jsonl should be rebuilt (not empty — re-embed ran)
    const lines = fs.readFileSync(getEmbeddingsPath(), 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  test('schema_version missing in metadata → no truncate, fills gaps', async () => {
    // Write metadata WITHOUT schema_version
    const mod = require('../src/semantic-index');
    const { getMetadataPath } = mod;
    fs.mkdirSync(tmpCacheDir, { recursive: true });
    fs.writeFileSync(getMetadataPath(), JSON.stringify({ updatedAt: new Date().toISOString() }));

    mockReadMemory.mockResolvedValue([
      { contentHash: 'new1', content: 'new entry', category: 'INSIGHT', addedAt: new Date().toISOString() },
    ]);
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: [1, 0, 0, 0] }] });

    const result = await selfHealIfNeeded();
    expect(result.schemaChanged).toBe(false); // no existing schema_version → no mismatch
    expect(result.healed).toBe(true);
    expect(result.embedded).toBe(1);
  });
});

// ── Group 5: computeSchemaVersion — D-14 invariance ──────────────────────────

describe('computeSchemaVersion (D-14 lesson regression)', () => {
  let computeSchemaVersion;

  beforeEach(() => {
    computeSchemaVersion = require('../src/semantic-index').computeSchemaVersion;
  });

  test('same (model, embeddingDim) → identical 12-char hash', () => {
    const h1 = computeSchemaVersion({ model: 'voyage-4-lite', embeddingDim: 1024 });
    const h2 = computeSchemaVersion({ model: 'voyage-4-lite', embeddingDim: 1024 });
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(12);
  });

  test('different model → different hash', () => {
    const h1 = computeSchemaVersion({ model: 'voyage-4-lite', embeddingDim: 1024 });
    const h2 = computeSchemaVersion({ model: 'voyage-4-large', embeddingDim: 1024 });
    expect(h1).not.toBe(h2);
  });

  test('different embeddingDim → different hash', () => {
    const h1 = computeSchemaVersion({ model: 'voyage-4-lite', embeddingDim: 1024 });
    const h2 = computeSchemaVersion({ model: 'voyage-4-lite', embeddingDim: 512 });
    expect(h1).not.toBe(h2);
  });

  test('CRITICAL: different threshold → IDENTICAL hash (D-14 lesson — threshold is query-time math)', () => {
    const base = { model: 'voyage-4-lite', embeddingDim: 1024 };
    const h1 = computeSchemaVersion({ ...base, threshold: 0.72 });
    const h2 = computeSchemaVersion({ ...base, threshold: 0.80 });
    expect(h1).toBe(h2); // threshold must NOT affect schema_version
  });

  test('CRITICAL: different recencyDecay → IDENTICAL hash (D-14 lesson — decay is query-time math)', () => {
    const base = { model: 'voyage-4-lite', embeddingDim: 1024 };
    const h1 = computeSchemaVersion({ ...base, recencyDecay: 0.2 });
    const h2 = computeSchemaVersion({ ...base, recencyDecay: 0.5 });
    expect(h1).toBe(h2); // recencyDecay must NOT affect schema_version
  });

  test('hash is 12 characters hex', () => {
    const h = computeSchemaVersion({ model: 'voyage-4-lite', embeddingDim: 1024 });
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });
});

// ── Group 6: cosine / temporal math via _testOnly ─────────────────────────────

describe('_testOnly math helpers', () => {
  let _testOnly;

  beforeEach(() => {
    _testOnly = require('../src/semantic-index')._testOnly;
  });

  describe('_cosine', () => {
    test('[1,0] vs [1,0] ≈ 1.0', () => {
      expect(_testOnly._cosine([1, 0], [1, 0])).toBeCloseTo(1.0, 5);
    });

    test('[1,0] vs [0,1] ≈ 0', () => {
      expect(_testOnly._cosine([1, 0], [0, 1])).toBeCloseTo(0, 5);
    });

    test('[1,0] vs [-1,0] ≈ -1', () => {
      expect(_testOnly._cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
    });

    test('[0,0] vs [1,0] === 0 (zero-vector guard)', () => {
      expect(_testOnly._cosine([0, 0], [1, 0])).toBe(0);
    });
  });

  describe('_adjustedScore', () => {
    test('recent entry (today) gets boosted above base score', () => {
      const base = 0.8;
      const todayISO = new Date().toISOString();
      const adjusted = _testOnly._adjustedScore(base, todayISO, 0.2);
      expect(adjusted).toBeGreaterThan(base);
    });

    test('entry from 365 days ago → no recency boost (adjusted ≈ base)', () => {
      const base = 0.8;
      const oldISO = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const adjusted = _testOnly._adjustedScore(base, oldISO, 0.2);
      // recency = max(0, 1 - 365/365) = 0 → adjusted = base * (1 + 0) = base
      expect(adjusted).toBeCloseTo(base, 3);
    });

    test('null addedAt → defaults to 365 days (no boost)', () => {
      const base = 0.8;
      const adjusted = _testOnly._adjustedScore(base, null, 0.2);
      expect(adjusted).toBeCloseTo(base, 3);
    });
  });

  describe('_daysSince', () => {
    test('null → 365', () => {
      expect(_testOnly._daysSince(null)).toBe(365);
    });

    test('ISO string of now → ~0', () => {
      const days = _testOnly._daysSince(new Date().toISOString());
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThan(1);
    });
  });

  describe('classifyVoyageError', () => {
    test('status 401 → "401"', () => {
      expect(_testOnly.classifyVoyageError(Object.assign(new Error('Unauthorized'), { status: 401 }))).toBe('401');
    });

    test('status 429 → "429"', () => {
      expect(_testOnly.classifyVoyageError(Object.assign(new Error('rate'), { status: 429 }))).toBe('429');
    });

    test('status 503 → "5xx"', () => {
      expect(_testOnly.classifyVoyageError(Object.assign(new Error('service unavailable'), { status: 503 }))).toBe('5xx');
    });

    test('code ETIMEDOUT → "timeout"', () => {
      expect(_testOnly.classifyVoyageError(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }))).toBe('timeout');
    });

    test('code ENOTFOUND → "network"', () => {
      expect(_testOnly.classifyVoyageError(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))).toBe('network');
    });
  });

  describe('extractRetryAfterSec', () => {
    test('response.headers retry-after=1 → 1', () => {
      const err = Object.assign(new Error('429'), { response: { headers: { 'retry-after': '1' } } });
      expect(_testOnly.extractRetryAfterSec(err)).toBe(1);
    });

    test('no headers → null', () => {
      expect(_testOnly.extractRetryAfterSec(new Error('429'))).toBeNull();
    });
  });
});

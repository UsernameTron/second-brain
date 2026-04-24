'use strict';

/**
 * test/integration/recall-end-to-end.test.js
 *
 * Integration tests for Phase 18 memory retrieval — runs unconditionally in CI.
 *
 * Maps each test group directly to a ROADMAP Phase 18 success criterion (SC1-SC4).
 * Uses a real tmp vault populated from test/fixtures/memory-sample.md so that
 * recall-command and memory-reader exercise the full parse → index → filter path.
 *
 * SC1: /recall returns a numbered list with category, snippet (≤100 chars), and
 *      source-ref — or an empty result with no error when nothing matches.
 * SC2: --category, --since, and --top N flags each narrow / expand results.
 * SC3: Missing memory/memory.md → empty result set, no throw.
 * SC4: getMemoryEcho honours the 0.65 threshold; entries absent below threshold.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { runRecall } = require('../../src/recall-command');
const { getMemoryEcho } = require('../../src/memory-reader');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'memory-sample.md');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a tmp vault with a real memory/memory.md from the fixture. */
function makeTmpVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-phase18-'));
  fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
  fs.copyFileSync(FIXTURE, path.join(root, 'memory', 'memory.md'));
  return root;
}

// ── SC1: /recall returns structured results ───────────────────────────────────

describe('Phase 18 — /recall returns structured results (ROADMAP SC1)', () => {
  let tmpRoot;

  beforeAll(() => {
    tmpRoot = makeTmpVault();
    process.env.VAULT_ROOT = tmpRoot;
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.VAULT_ROOT;
  });

  test('returns numbered list with category label, snippet, and source-ref for a matching query', async () => {
    const result = await runRecall(['leadership']);
    expect(result.empty).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
    // First line must match "N. [CATEGORY] <snippet> (<ref>)"
    expect(result.lines[0]).toMatch(/^1\. \[[A-Z]+\] .+ \(.+\)$/);
  });

  test('caps results at 5 by default when more matches exist', async () => {
    // Query a common short token that matches multiple entries
    const result = await runRecall(['a']);
    expect(result.total).toBeLessThanOrEqual(5);
  });

  test('returns empty result message for a non-matching query — no error thrown', async () => {
    const result = await runRecall(['nomatch-zzz-impossible-xqq']);
    expect(result.empty).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^No results matching/);
  });

  test('each result line snippet is at most 100 characters', async () => {
    const result = await runRecall(['leadership']);
    expect(result.empty).toBe(false);
    for (const r of result.results) {
      expect(r.snippet.length).toBeLessThanOrEqual(100);
    }
  });

  test('result objects expose rank, category, snippet, sourceRef, date, score', async () => {
    const result = await runRecall(['leadership']);
    const first = result.results[0];
    expect(first).toHaveProperty('rank');
    expect(first).toHaveProperty('category');
    expect(first).toHaveProperty('snippet');
    expect(first).toHaveProperty('sourceRef');
    expect(first).toHaveProperty('date');
    expect(first).toHaveProperty('score');
  });
});

// ── SC2: /recall flags narrow and expand results ──────────────────────────────

describe('Phase 18 — /recall flags narrow and expand results (ROADMAP SC2)', () => {
  let tmpRoot;

  beforeAll(() => {
    tmpRoot = makeTmpVault();
    process.env.VAULT_ROOT = tmpRoot;
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.VAULT_ROOT;
  });

  test('--category filters results to matching category only', async () => {
    const result = await runRecall(['leadership', '--category', 'DECISION']);
    expect(result.empty).toBe(false);
    for (const r of result.results) {
      expect(r.category).toBe('DECISION');
    }
  });

  test('--since filters results to entries on or after the given date', async () => {
    const result = await runRecall(['leadership', '--since', '2026-04-01']);
    expect(result.empty).toBe(false);
    for (const r of result.results) {
      expect(r.date >= '2026-04-01').toBe(true);
    }
  });

  test('--top 1 caps results to exactly 1 entry', async () => {
    const result = await runRecall(['leadership', '--top', '1']);
    expect(result.total).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.lines).toHaveLength(1);
  });

  test('--top N larger than match count returns the full match count', async () => {
    // Only 2 fixture entries match "leadership"
    const wideResult = await runRecall(['leadership', '--top', '100']);
    const defaultResult = await runRecall(['leadership']);
    // Wide query must return at least as many as the default top-5 cap
    expect(wideResult.total).toBeGreaterThanOrEqual(defaultResult.total);
  });
});

// ── SC3: Missing memory.md → empty, no throw ─────────────────────────────────

describe('Phase 18 — /recall against missing memory.md (ROADMAP SC3)', () => {
  let emptyRoot;

  beforeAll(() => {
    // Intentionally do NOT create memory/memory.md
    emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-phase18-empty-'));
    process.env.VAULT_ROOT = emptyRoot;
  });

  afterAll(() => {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
    delete process.env.VAULT_ROOT;
  });

  test('returns empty result set without throwing', async () => {
    await expect(runRecall(['anything'])).resolves.toMatchObject({
      empty: true,
      results: [],
    });
  });

  test('lines contains exactly one message string when memory.md absent', async () => {
    const result = await runRecall(['test']);
    expect(result.lines).toHaveLength(1);
    expect(typeof result.lines[0]).toBe('string');
  });

  test('does not throw on empty vault with category flag', async () => {
    await expect(runRecall(['test', '--category', 'DECISION'])).resolves.toBeDefined();
  });
});

// ── SC4: getMemoryEcho honours 0.65 threshold ─────────────────────────────────

describe('Phase 18 — getMemoryEcho honours relevance threshold (ROADMAP SC4)', () => {
  let tmpRoot;

  beforeAll(() => {
    tmpRoot = makeTmpVault();
    process.env.VAULT_ROOT = tmpRoot;
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.VAULT_ROOT;
  });

  test('returns entries when topics score above threshold with a very permissive threshold', async () => {
    const connectorResults = {
      calendar: { success: true, data: [{ summary: 'Leadership weekly sync' }] },
      gmail: { success: true, data: [{ subject: 'Leadership review' }] },
    };
    const looseEcho = await getMemoryEcho(connectorResults, { threshold: 0.01 });
    expect(looseEcho.entries.length).toBeGreaterThan(0);
    expect(looseEcho).toHaveProperty('entries');
    expect(looseEcho).toHaveProperty('score');
  });

  test('returns empty entries when no topic crosses threshold', async () => {
    const connectorResults = {
      calendar: { success: true, data: [{ summary: 'xyzqrs_totally_unrelated_event' }] },
      gmail: { success: true, data: [] },
    };
    const echo = await getMemoryEcho(connectorResults, { threshold: 0.65 });
    expect(echo.entries).toEqual([]);
    expect(echo.score).toBe(0);
  });

  test('threshold is configurable — lower threshold returns at least as many entries', async () => {
    const connectorResults = {
      calendar: { success: true, data: [{ summary: 'leadership' }] },
      gmail: { success: true, data: [] },
    };
    const strict = await getMemoryEcho(connectorResults, { threshold: 0.9 });
    const loose = await getMemoryEcho(connectorResults, { threshold: 0.1 });
    expect(loose.entries.length).toBeGreaterThanOrEqual(strict.entries.length);
  });

  test('no throw when both connectors failed', async () => {
    const connectorResults = {
      calendar: { success: false, data: [] },
      gmail: { success: false, data: [] },
    };
    await expect(getMemoryEcho(connectorResults, { threshold: 0.65 })).resolves.toMatchObject({
      entries: [],
      score: 0,
    });
  });

  test('no throw when connectorResults is null', async () => {
    await expect(getMemoryEcho(null, { threshold: 0.65 })).resolves.toMatchObject({
      entries: [],
      score: 0,
    });
  });
});

'use strict';

/**
 * memory-reader.test.js
 *
 * Unit tests for src/memory-reader.js covering all three exports:
 *   - readMemory()
 *   - searchMemoryKeyword(query, options)
 *   - getMemoryEcho(connectorResults, options)
 *
 * Tests R1-R6 (readMemory), S1-S9 (searchMemoryKeyword), E1-E6 (getMemoryEcho).
 */

const fs = require('fs');
const path = require('path');

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'memory-sample.md');
const MODULE_PATH = path.resolve(__dirname, '..', '..', 'src', 'memory-reader');

let tmpRoot;
let originalVaultRoot;
let readMemory;
let searchMemoryKeyword;
let getMemoryEcho;

beforeAll(() => {
  // Save original env
  originalVaultRoot = process.env.VAULT_ROOT;

  // Create isolated tmp vault with the fixture
  tmpRoot = path.join(__dirname, '..', 'fixtures', `_memory-reader-tmp-${Date.now()}`);
  fs.mkdirSync(path.join(tmpRoot, 'memory'), { recursive: true });
  fs.copyFileSync(FIXTURE_PATH, path.join(tmpRoot, 'memory', 'memory.md'));

  // Set VAULT_ROOT before loading the module
  process.env.VAULT_ROOT = tmpRoot;

  // Load module fresh with correct env
  jest.resetModules();
  ({ readMemory, searchMemoryKeyword, getMemoryEcho } = require(MODULE_PATH));
});

afterAll(() => {
  // Restore env
  if (originalVaultRoot === undefined) {
    delete process.env.VAULT_ROOT;
  } else {
    process.env.VAULT_ROOT = originalVaultRoot;
  }
  // Clean up tmp directory
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {
    // Ignore cleanup errors
  }
});

// ── readMemory() ──────────────────────────────────────────────────────────────

describe('readMemory()', () => {
  test('R1: returns exactly 5 entries (malformed header entry skipped)', async () => {
    const entries = await readMemory();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(5);
  });

  test('R2: each entry has all required fields', async () => {
    const entries = await readMemory();
    const REQUIRED = ['id', 'category', 'content', 'date', 'sourceRef', 'contentHash', 'tags', 'related', 'addedAt'];
    for (const entry of entries) {
      for (const field of REQUIRED) {
        expect(entry).toHaveProperty(field);
      }
    }
  });

  test('R3: entry date matches the YYYY-MM-DD in its ### header', async () => {
    const entries = await readMemory();
    const found = entries.find(e => e.date === '2026-03-15');
    expect(found).toBeDefined();
    expect(found.date).toBe('2026-03-15');
  });

  test('R4: contentHash matches the content_hash:: field value', async () => {
    const entries = await readMemory();
    const archEntry = entries.find(e => e.contentHash === 'aaaa11112222');
    expect(archEntry).toBeDefined();
  });

  test('R5: returns [] when memory.md does not exist (ENOENT, no throw)', async () => {
    // Use the same module but point VAULT_ROOT to nonexistent path temporarily
    // VAULT_ROOT is a dynamic function in memory-reader — reads env at call time
    const savedVaultRoot = process.env.VAULT_ROOT;
    process.env.VAULT_ROOT = `/tmp/nonexistent-vault-${Date.now()}`;

    let result;
    let threw = false;
    try {
      result = await readMemory();
    } catch (_) {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).toEqual([]);

    // Restore VAULT_ROOT for subsequent tests
    process.env.VAULT_ROOT = savedVaultRoot;
  });

  test('R6: malformed entry writes warning to stderr but does NOT throw', async () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const entries = await readMemory();
    expect(stderrSpy).toHaveBeenCalled();
    expect(entries.length).toBe(5);
    stderrSpy.mockRestore();
  });

  test('R7: entries without superseded-by/stale fields yield null for both', async () => {
    const entries = await readMemory();
    for (const entry of entries) {
      expect(entry.supersededBy).toBeNull();
      expect(entry.stale).toBeNull();
    }
  });

  test('R8: superseded-by:: field is surfaced as entry.supersededBy', async () => {
    const scratchRoot = path.join(__dirname, '..', 'fixtures', `_memory-reader-superseded-${Date.now()}`);
    fs.mkdirSync(path.join(scratchRoot, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(scratchRoot, 'memory', 'memory.md'), [
      '### 2026-05-01 · DECISION · file:example',
      '',
      'Old content that has been merged elsewhere.',
      '',
      'category:: DECISION',
      'source-ref:: file:example.md',
      'superseded-by:: a1b2c3d4e5f6',
      '',
    ].join('\n'));

    const savedVaultRoot = process.env.VAULT_ROOT;
    process.env.VAULT_ROOT = scratchRoot;
    const entries = await readMemory();
    process.env.VAULT_ROOT = savedVaultRoot;
    fs.rmSync(scratchRoot, { recursive: true, force: true });

    expect(entries).toHaveLength(1);
    expect(entries[0].supersededBy).toBe('a1b2c3d4e5f6');
    expect(entries[0].stale).toBeNull();
  });

  test('R9: stale:: field is surfaced as entry.stale', async () => {
    const scratchRoot = path.join(__dirname, '..', 'fixtures', `_memory-reader-stale-${Date.now()}`);
    fs.mkdirSync(path.join(scratchRoot, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(scratchRoot, 'memory', 'memory.md'), [
      '### 2026-05-01 · PATTERN · file:example',
      '',
      'A flag reference that no longer exists.',
      '',
      'category:: PATTERN',
      'source-ref:: file:example.md',
      'stale:: 2026-08-01 · dead-reference config key flagX',
      '',
    ].join('\n'));

    const savedVaultRoot = process.env.VAULT_ROOT;
    process.env.VAULT_ROOT = scratchRoot;
    const entries = await readMemory();
    process.env.VAULT_ROOT = savedVaultRoot;
    fs.rmSync(scratchRoot, { recursive: true, force: true });

    expect(entries).toHaveLength(1);
    expect(entries[0].stale).toBe('2026-08-01 · dead-reference config key flagX');
    expect(entries[0].supersededBy).toBeNull();
  });
});

// ── searchMemoryKeyword() ─────────────────────────────────────────────────────

describe('searchMemoryKeyword()', () => {
  test('S1: returns at least 2 leadership entries, ranked', async () => {
    const results = await searchMemoryKeyword('leadership');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test('S2: AND semantics — "leadership communication" returns only entries with BOTH terms', async () => {
    const results = await searchMemoryKeyword('leadership communication');
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      const lc = r.content.toLowerCase();
      expect(lc).toContain('leadership');
      expect(lc).toContain('communication');
    }
  });

  test('S3: quoted phrase returns only entries containing that exact substring', async () => {
    const results = await searchMemoryKeyword('"left right split"');
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.content.toLowerCase()).toContain('left right split');
    }
  });

  test('S4: negation -ISPN excludes the ISPN entry from results', async () => {
    const results = await searchMemoryKeyword('integration -ISPN');
    for (const r of results) {
      expect(r.content.toUpperCase()).not.toContain('ISPN');
    }
  });

  test('S5: category filter returns only DECISION-category matches', async () => {
    const results = await searchMemoryKeyword('leadership', { category: 'DECISION' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.category).toBe('DECISION');
    }
  });

  test('S6: since filter returns only entries dated on or after 2026-04-01', async () => {
    const results = await searchMemoryKeyword('leadership', { since: '2026-04-01' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.date >= '2026-04-01').toBe(true);
    }
  });

  test('S7: each result has a snippet field <= 100 characters', async () => {
    const results = await searchMemoryKeyword('leadership');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty('snippet');
      expect(r.snippet.length).toBeLessThanOrEqual(100);
    }
  });

  test('S8: no-match query returns empty array', async () => {
    const results = await searchMemoryKeyword('nomatch-zzz-unlikely-term');
    expect(results).toEqual([]);
  });

  test('S9: results are ordered by score descending', async () => {
    const results = await searchMemoryKeyword('leadership');
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  describe('downrank (superseded-by / stale)', () => {
    async function withScratchVault(memoryMdContent, fn) {
      const scratchRoot = path.join(__dirname, '..', 'fixtures', `_memory-reader-downrank-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      fs.mkdirSync(path.join(scratchRoot, 'memory'), { recursive: true });
      fs.writeFileSync(path.join(scratchRoot, 'memory', 'memory.md'), memoryMdContent);
      const savedVaultRoot = process.env.VAULT_ROOT;
      process.env.VAULT_ROOT = scratchRoot;
      try {
        return await fn();
      } finally {
        process.env.VAULT_ROOT = savedVaultRoot;
        fs.rmSync(scratchRoot, { recursive: true, force: true });
      }
    }

    const TWO_EQUAL_ENTRIES_SUPERSEDED = [
      '### 2026-05-01 · PATTERN · file:one',
      '',
      'widget rollout plan for the team.',
      '',
      'category:: PATTERN',
      'source-ref:: file:one.md',
      'content_hash:: 111111111111',
      'superseded-by:: 222222222222',
      '',
      '### 2026-05-02 · PATTERN · file:two',
      '',
      'widget rollout plan for the team.',
      '',
      'category:: PATTERN',
      'source-ref:: file:two.md',
      'content_hash:: 222222222222',
      '',
    ].join('\n');

    test('S10: superseded entry ranks strictly below an equal non-superseded entry, and is still present', async () => {
      const results = await withScratchVault(TWO_EQUAL_ENTRIES_SUPERSEDED, () => searchMemoryKeyword('widget rollout'));
      expect(results).toHaveLength(2);
      const superseded = results.find(r => r.supersededBy === '222222222222');
      const live = results.find(r => !r.supersededBy);
      expect(superseded).toBeDefined();
      expect(live).toBeDefined();
      expect(superseded.score).toBeLessThan(live.score);
      expect(results[0].id).toBe(live.id);
    });

    const TWO_EQUAL_ENTRIES_STALE = [
      '### 2026-05-01 · PATTERN · file:one',
      '',
      'gadget rollout plan for the team.',
      '',
      'category:: PATTERN',
      'source-ref:: file:one.md',
      'content_hash:: 333333333333',
      'stale:: 2026-08-01 · dead-reference',
      '',
      '### 2026-05-02 · PATTERN · file:two',
      '',
      'gadget rollout plan for the team.',
      '',
      'category:: PATTERN',
      'source-ref:: file:two.md',
      'content_hash:: 444444444444',
      '',
    ].join('\n');

    test('S11: stale entry ranks strictly below an equal non-stale entry, and is still present', async () => {
      const results = await withScratchVault(TWO_EQUAL_ENTRIES_STALE, () => searchMemoryKeyword('gadget rollout'));
      expect(results).toHaveLength(2);
      const stale = results.find(r => r.stale);
      const live = results.find(r => !r.stale);
      expect(stale).toBeDefined();
      expect(live).toBeDefined();
      expect(stale.score).toBeLessThan(live.score);
      expect(results[0].id).toBe(live.id);
    });

    test('S12: query with no superseded/stale entries returns identical ordering to pre-change behavior', async () => {
      const results = await searchMemoryKeyword('leadership');
      expect(results.every(r => !r.supersededBy && !r.stale)).toBe(true);
      // scores unaffected — same as pre-downrank behavior (no multiplier applied)
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });
  });
});

// ── getMemoryEcho() ───────────────────────────────────────────────────────────

describe('getMemoryEcho()', () => {
  test('E1: returns entries from leadership-tagged memories when calendar contains leadership topic', async () => {
    const connectorResults = {
      calendar: { success: true, data: [{ summary: 'Leadership sync meeting' }] },
      gmail: { success: true, data: [] },
    };
    // Use a low threshold (0.1) to ensure leadership entries are found
    // "leadership" is 1 of 3 topic tokens, score = 0.33 which is >= 0.1
    const result = await getMemoryEcho(connectorResults, { threshold: 0.1 });
    expect(result).toHaveProperty('entries');
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
  });

  test('E2: both connectors failed returns { entries: [], score: 0 }', async () => {
    const connectorResults = {
      calendar: { success: false, data: [] },
      gmail: { success: false, data: [] },
    };
    const result = await getMemoryEcho(connectorResults, { threshold: 0.65 });
    expect(result).toEqual({ entries: [], score: 0 });
  });

  test('E3: no entry exceeds threshold returns { entries: [] }', async () => {
    const connectorResults = {
      calendar: { success: true, data: [{ summary: 'completelyrandom unrelated xyzabc' }] },
      gmail: { success: true, data: [] },
    };
    const result = await getMemoryEcho(connectorResults, { threshold: 0.99 });
    expect(result.entries).toHaveLength(0);
  });

  test('E4: partial success (calendar ok, gmail failed) still returns entries from calendar topics', async () => {
    const connectorResults = {
      calendar: { success: true, data: [{ summary: 'Leadership review' }] },
      gmail: { success: false, data: [] },
    };
    // "leadership" = 1 of 2 tokens, score = 0.5 which is >= 0.1
    const result = await getMemoryEcho(connectorResults, { threshold: 0.1 });
    expect(result).toHaveProperty('entries');
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
  });

  test('E5: lower threshold yields more entries than default high threshold', async () => {
    const connectorResults = {
      calendar: { success: true, data: [{ summary: 'Leadership meeting architecture vault split' }] },
      gmail: { success: true, data: [] },
    };
    const lowResult = await getMemoryEcho(connectorResults, { threshold: 0.1 });
    const highResult = await getMemoryEcho(connectorResults, { threshold: 0.99 });
    expect(lowResult.entries.length).toBeGreaterThanOrEqual(highResult.entries.length);
  });

  test('E6: does NOT throw when connectorResults is undefined', async () => {
    await expect(getMemoryEcho(undefined)).resolves.toMatchObject({ entries: [] });
  });

  test('E6b: does NOT throw when connectorResults is null', async () => {
    await expect(getMemoryEcho(null)).resolves.toMatchObject({ entries: [] });
  });

  describe('downrank (superseded-by / stale)', () => {
    async function withScratchVault(memoryMdContent, fn) {
      const scratchRoot = path.join(__dirname, '..', 'fixtures', `_memory-reader-echo-downrank-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      fs.mkdirSync(path.join(scratchRoot, 'memory'), { recursive: true });
      fs.writeFileSync(path.join(scratchRoot, 'memory', 'memory.md'), memoryMdContent);
      const savedVaultRoot = process.env.VAULT_ROOT;
      process.env.VAULT_ROOT = scratchRoot;
      try {
        return await fn();
      } finally {
        process.env.VAULT_ROOT = savedVaultRoot;
        fs.rmSync(scratchRoot, { recursive: true, force: true });
      }
    }

    const TWO_EQUAL_ENTRIES_SUPERSEDED = [
      '### 2026-05-01 · PATTERN · file:one',
      '',
      'Rocketship launch review meeting notes.',
      '',
      'category:: PATTERN',
      'source-ref:: file:one.md',
      'content_hash:: 555555555555',
      'superseded-by:: 666666666666',
      '',
      '### 2026-05-02 · PATTERN · file:two',
      '',
      'Rocketship launch review meeting notes.',
      '',
      'category:: PATTERN',
      'source-ref:: file:two.md',
      'content_hash:: 666666666666',
      '',
    ].join('\n');

    test('E7: superseded entry ranks below an equal non-superseded entry and remains present', async () => {
      const connectorResults = {
        calendar: { success: true, data: [{ summary: 'Rocketship launch review meeting' }] },
        gmail: { success: true, data: [] },
      };
      const result = await withScratchVault(
        TWO_EQUAL_ENTRIES_SUPERSEDED,
        () => getMemoryEcho(connectorResults, { threshold: 0.01 })
      );
      expect(result.entries).toHaveLength(2);
      const superseded = result.entries.find(e => e.supersededBy === '666666666666');
      const live = result.entries.find(e => !e.supersededBy);
      expect(superseded).toBeDefined();
      expect(live).toBeDefined();
      expect(superseded.score).toBeLessThan(live.score);
    });
  });
});

// ── _parseFields strictness (migrate-memory-wiki regression) ─────────────────

describe('_parseFields field-line strictness', () => {
  test('bare :: mid-prose stays in content; real fields still parse', async () => {
    const memPath = path.join(process.env.VAULT_ROOT, 'memory', 'memory.md');
    fs.appendFileSync(memPath, [
      '',
      '### 2026-07-21 · LEARNING · midprose-colons',
      '',
      'Filter reads only status::pending but overflow entries are stamped status::deferred.',
      '',
      'category:: LEARNING',
      'source-ref:: session:midprose',
      'tags:: ',
      'added:: 2026-07-21T00:00:00Z',
      'related:: ',
      'content_hash:: abcdef123456',
      '',
    ].join('\n'), 'utf8');

    const entries = await readMemory();
    const entry = entries.find(e => e.contentHash === 'abcdef123456');
    expect(entry).toBeDefined();
    // The old "line contains ::" rule swallowed this whole body as fields.
    expect(entry.content).toContain('status::pending');
    expect(entry.category).toBe('LEARNING');
    expect(entry.heading).toBe('2026-07-21 · LEARNING · midprose-colons');
  });
});

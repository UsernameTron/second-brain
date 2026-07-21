'use strict';

/**
 * migrate-memory-wiki.test.js
 *
 * Unit tests for scripts/migrate-memory-wiki.js — Phase A recategorization,
 * Phase B related:: backfill (both entry variants), sidecar rewrite, INDEX
 * regeneration, and the dry-run gate. All LLM/embedding surfaces mocked.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { computeHash } = require('../src/utils/memory-utils');

let tmpVault;
let tmpCache;

// Body deliberately contains a bare "status::pending" mid-prose — the live
// PROMOTE-D entry regression: a `::` inside content must not start the fields.
const H1 = computeHash('Original body of the coerced entry mentioning status::pending mid-prose.');
const H2 = computeHash('A standard entry that stays put.');
const H3 = computeHash('Merged variant body on the header-adjacent line.');
const H4 = computeHash('April entry.');

const mockSelfHeal = jest.fn();
const mockNearest = jest.fn();

jest.mock('../src/wikilink-engine', () => ({
  suggestWikilinks: jest.fn().mockResolvedValue({
    section: '',
    links: [
      { path: 'a.md', title: 'Vault Note A', relevance: 0.9, reason: 'r' },
      { path: 'b.md', title: 'ISPN Runbook', relevance: 0.8, reason: 'r' },
    ],
  }),
}));

jest.mock('../src/semantic-index', () => {
  const p = require('path');
  return {
    getEmbeddingsPath: () => p.join(process.env.CACHE_DIR_OVERRIDE, 'embeddings.jsonl'),
    nearestByHash: (...args) => mockNearest(...args),
    selfHealIfNeeded: (...args) => mockSelfHeal(...args),
  };
});

jest.mock('../scripts/build-index', () => ({
  buildIndex: jest.fn().mockResolvedValue({ entries: 4, embeddings: 4, drift: false }),
}));

function fixtureMemory() {
  return [
    '<!-- INDEX:AUTO -->',
    '**Total entries:** 4',
    '**By category:** OTHER:1, LEARNING:1, PATTERN:1, DECISION:1',
    '**Sections:** 2026-07, 2026-04',
    '**Last promoted:** 2026-07-20',
    '**Archive:** /tmp/none',
    '<!-- /INDEX:AUTO -->',
    '',
    '## 2026-07',
    '',
    '### 2026-07-10 · OTHER · fix-a',
    '',
    'Original body of the coerced entry mentioning status::pending mid-prose.',
    '',
    '(justification: original category "lesson" is not sanctioned; coerced to OTHER)',
    '',
    'category:: OTHER',
    'source-ref:: session:fix-a',
    'tags:: alpha, beta',
    'added:: 2026-07-10T00:00:00Z',
    'related:: ',
    `content_hash:: ${H1}`,
    '',
    '### 2026-07-09 · LEARNING · keep-b',
    '',
    'A standard entry that stays put.',
    '',
    'category:: LEARNING',
    'source-ref:: session:keep-b',
    'tags:: ',
    'added:: 2026-07-09T00:00:00Z',
    'related:: old/path.md',
    `content_hash:: ${H2}`,
    '',
    '### 2026-07-08 · PATTERN · keep-c',
    'Merged variant body on the header-adjacent line.',
    'category:: PATTERN',
    'merged-from:: aaa, bbb',
    'tags:: merged',
    `content_hash:: ${H3}`,
    '',
    '## 2026-04',
    '',
    '### 2026-04-01 · DECISION · keep-d',
    '',
    'April entry.',
    '',
    'category:: DECISION',
    'source-ref:: session:keep-d',
    'tags:: ',
    'added:: 2026-04-01T00:00:00Z',
    'related:: ',
    `content_hash:: ${H4}`,
    '',
  ].join('\n');
}

function writeSidecar(hashes) {
  const lines = hashes.map(h =>
    JSON.stringify({ hash: h, embedding: [0.1, 0.2], addedAt: '2026-07-01T00:00:00Z', category: 'LEARNING' }));
  fs.writeFileSync(path.join(tmpCache, 'embeddings.jsonl'), lines.map(l => l + '\n').join(''), 'utf8');
}

describe('migrate-memory-wiki', () => {
  let migrate;
  const origEnv = {};

  beforeEach(() => {
    jest.clearAllMocks();
    tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-vault-'));
    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-cache-'));
    for (const k of ['VAULT_ROOT', 'CACHE_DIR_OVERRIDE', 'CONFIG_DIR_OVERRIDE']) origEnv[k] = process.env[k];
    process.env.VAULT_ROOT = tmpVault;
    process.env.CACHE_DIR_OVERRIDE = tmpCache;
    process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

    fs.mkdirSync(path.join(tmpVault, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(tmpVault, 'memory', 'memory.md'), fixtureMemory(), 'utf8');
    writeSidecar([H1, H2, H3, H4]);

    // Every entry's nearest neighbor: the (recategorized) fix-a entry.
    mockNearest.mockImplementation(async (hash) =>
      hash === H1
        ? [{ entry: { contentHash: H2 }, score: 0.8 }]
        : [{ entry: { contentHash: H1 }, score: 0.8 }]);
    // Self-heal restores the record dropped for the stripped entry.
    mockSelfHeal.mockImplementation(async () => {
      const p = path.join(tmpCache, 'embeddings.jsonl');
      const present = new Set(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).hash));
      let embedded = 0;
      for (const h of [H1, H2, H3, H4]) {
        if (!present.has(h)) {
          fs.appendFileSync(p, JSON.stringify({ hash: h, embedding: [0.1, 0.2], addedAt: 'x', category: 'LEARNING' }) + '\n');
          embedded++;
        }
      }
      return { healed: embedded > 0, schemaChanged: false, embedded };
    });

    ({ migrate } = require('../scripts/migrate-memory-wiki'));
  });

  afterEach(() => {
    for (const k of ['VAULT_ROOT', 'CACHE_DIR_OVERRIDE', 'CONFIG_DIR_OVERRIDE']) {
      if (origEnv[k] === undefined) delete process.env[k];
      else process.env[k] = origEnv[k];
    }
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.rmSync(tmpCache, { recursive: true, force: true });
  });

  test('dry-run reports without writing', async () => {
    const before = fs.readFileSync(path.join(tmpVault, 'memory', 'memory.md'), 'utf8');
    const result = await migrate({ apply: false, log: () => {} });
    expect(result.applied).toBe(false);
    expect(result.entries).toBe(4);
    expect(result.recategorized).toBe(1);
    expect(fs.readFileSync(path.join(tmpVault, 'memory', 'memory.md'), 'utf8')).toBe(before);
    expect(mockSelfHeal).not.toHaveBeenCalled();
  });

  test('apply: recategorizes, strips note, backfills both variants, rewrites sidecar, regenerates INDEX', async () => {
    const result = await migrate({ apply: true, log: () => {} });
    const after = fs.readFileSync(path.join(tmpVault, 'memory', 'memory.md'), 'utf8');

    // Phase A
    expect(after).not.toContain('(justification:');
    expect(after).toContain('### 2026-07-10 · LEARNING · fix-a');
    expect(after).not.toContain('category:: OTHER');
    expect(after).toContain(`content_hash:: ${H1}`); // hash stable — note was post-hash

    // Phase B: standard entry old value replaced; merged variant gained the field
    expect(after).not.toContain('related:: old/path.md');
    expect(after).toContain('related:: [[memory#2026-07-10 · LEARNING · fix-a]], [[Vault Note A]]');
    const mergedChunk = after.slice(after.indexOf('### 2026-07-08'), after.indexOf('## 2026-04'));
    expect(mergedChunk).toContain('related:: ');
    // Exclusion gate: ISPN title never linked
    expect(after).not.toContain('ISPN');

    // Sidecar parity: stale record dropped, self-heal restored it
    const sidecar = fs.readFileSync(path.join(tmpCache, 'embeddings.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(sidecar).toHaveLength(4);
    expect(result.parity).toBe(true);
    expect(result.coercionNotes).toBe(0);
    expect(result.coveragePct).toBe(100);

    // INDEX:AUTO regenerated with post-migration counts
    expect(after).toContain('**Total entries:** 4');
    expect(after).toContain('LEARNING:2');
    expect(after).not.toContain('OTHER:1');

    // Backup written
    const snaps = fs.readdirSync(path.join(tmpVault, 'memory', '.snapshots'));
    expect(snaps.some(d => d.startsWith('wiki-'))).toBe(true);
  });
});

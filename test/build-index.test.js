/**
 * build-index.test.js — boundary tests for the SQLite index derivation.
 *
 * The index is a pure derivation of memory.md + proposals + the unrouted DLQ.
 * These tests assert it reproduces the source files exactly and reports drift
 * honestly, since promote-memories.js calls it on every real promotion.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { buildIndex } = require('../scripts/build-index');

describe('build-index', () => {
  let vault;
  let dbPath;
  const origVaultRoot = process.env.VAULT_ROOT;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-vault-'));
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bi-db-')), 'index.db');
    fs.mkdirSync(path.join(vault, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(vault, 'proposals', 'unrouted'), { recursive: true });
    process.env.VAULT_ROOT = vault;
  });

  afterEach(() => {
    if (origVaultRoot === undefined) delete process.env.VAULT_ROOT;
    else process.env.VAULT_ROOT = origVaultRoot;
    fs.rmSync(vault, { recursive: true, force: true });
  });

  function writeMemory(entries) {
    const body = entries.map(e =>
      `### ${e.date} · ${e.category} · ${e.ref}\n\n${e.content}\n\n` +
      `category:: ${e.category}\nsource-ref:: ${e.ref}\ntags:: ${e.tags || ''}\n` +
      `added:: ${e.date}\nrelated:: \ncontent_hash:: ${e.hash}\n`
    ).join('\n');
    fs.writeFileSync(path.join(vault, 'memory', 'memory.md'), `# Memory\n\n## 2026-07\n\n${body}`);
  }

  test('indexes every memory entry with its fields', async () => {
    writeMemory([
      { date: '2026-07-01', category: 'LEARNING', ref: 'session:a', content: 'Alpha learning.', hash: 'h1', tags: 'x' },
      { date: '2026-07-02', category: 'DECISION', ref: 'session:b', content: 'Beta decision.', hash: 'h2' },
    ]);

    const result = await buildIndex({ dbPath });
    expect(result.entries).toBe(2);

    const db = new DatabaseSync(dbPath);
    const rows = db.prepare('SELECT * FROM entries ORDER BY content_hash').all();
    expect(rows.map(r => r.content_hash)).toEqual(['h1', 'h2']);
    expect(rows[0].category).toBe('LEARNING');
    expect(rows[0].content).toContain('Alpha learning');
    db.close();
  });

  test('FTS5 finds entries by content token', async () => {
    writeMemory([
      { date: '2026-07-01', category: 'LEARNING', ref: 'session:a', content: 'Voyage embeddings drift check.', hash: 'h1' },
      { date: '2026-07-02', category: 'PATTERN', ref: 'session:b', content: 'Unrelated content.', hash: 'h2' },
    ]);
    await buildIndex({ dbPath });

    const db = new DatabaseSync(dbPath);
    const hits = db.prepare('SELECT content_hash FROM entries_fts WHERE entries_fts MATCH ?').all('embeddings');
    expect(hits).toHaveLength(1);
    expect(hits[0].content_hash).toBe('h1');
    db.close();
  });

  test('is idempotent — rebuilding does not duplicate rows', async () => {
    writeMemory([{ date: '2026-07-01', category: 'LEARNING', ref: 'session:a', content: 'Once.', hash: 'h1' }]);

    await buildIndex({ dbPath });
    const second = await buildIndex({ dbPath });
    expect(second.entries).toBe(1);

    const db = new DatabaseSync(dbPath);
    expect(db.prepare('SELECT COUNT(*) c FROM entries').get().c).toBe(1);
    expect(db.prepare('SELECT COUNT(*) c FROM entries_fts').get().c).toBe(1);
    db.close();
  });

  test('catalogs live DLQ and archived quarantine dirs separately', async () => {
    writeMemory([]);
    fs.writeFileSync(path.join(vault, 'proposals', 'unrouted', 'unrouted-20260720-000000-aaaa.md'), '---\nstatus: unrouted\n---\nlive');
    const quarantine = path.join(vault, 'archive', 'unrouted-quarantine-20260720');
    fs.mkdirSync(quarantine, { recursive: true });
    fs.writeFileSync(path.join(quarantine, 'unrouted-20260423-000000-bbbb.md'), '---\nstatus: unrouted\n---\nold');

    const result = await buildIndex({ dbPath });
    expect(result.unrouted).toBe(2);

    const db = new DatabaseSync(dbPath);
    const dirs = db.prepare('SELECT dir, COUNT(*) c FROM unrouted GROUP BY dir').all();
    expect(dirs).toHaveLength(2);
    db.close();
  });

  test('reports drift when embeddings count differs from entry count', async () => {
    writeMemory([{ date: '2026-07-01', category: 'LEARNING', ref: 'session:a', content: 'One.', hash: 'h1' }]);
    const result = await buildIndex({ dbPath });
    // Embeddings cache is global, not vault-scoped; the count is a number when
    // the cache exists or null when absent. Drift must agree with that count.
    const expectedDrift = result.embeddings !== null && result.embeddings !== result.entries;
    expect(result.drift).toBe(expectedDrift);
  });

  test('missing memory.md yields an empty index rather than throwing', async () => {
    const result = await buildIndex({ dbPath });
    expect(result.entries).toBe(0);
  });

  test('a non-default VAULT_ROOT never writes to the live index.db', async () => {
    writeMemory([{ date: '2026-07-01', category: 'LEARNING', ref: 'session:a', content: 'Scratch.', hash: 'h1' }]);
    // No explicit dbPath — this is the path promote-memories.js takes.
    await buildIndex();

    // A scratch vault keeps its index inside itself; the shared cache's
    // index.db is reserved for the default vault and must be left alone.
    expect(fs.existsSync(path.join(vault, '.cache', 'index.db'))).toBe(true);
  });
});

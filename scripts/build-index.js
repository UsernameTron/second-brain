#!/usr/bin/env node
/**
 * build-index.js — SQLite index over memory.md + staging + unrouted DLQ.
 *
 * The index is a pure derivation: memory.md and the proposals files remain the
 * source of truth. This DB is rebuilt from scratch on every run (146-entry
 * scale makes incremental updates pointless complexity). Never written back
 * to the vault.
 *
 * Tables:
 *   entries      — one row per memory.md entry (content_hash PK)
 *   entries_fts  — FTS5 full-text index over content/tags/category
 *   proposals    — one row per staged candidate in memory-proposals.md
 *   unrouted     — catalog of dead-letter files (filename + mtime)
 *
 * Drift check: memory.md header count vs entries rows vs embeddings.jsonl
 * lines. Reported always; --strict exits 1 on memory↔embeddings drift.
 *
 * CLI: node scripts/build-index.js [--strict] [--db <path>]
 * API: const { buildIndex } = require('./build-index'); await buildIndex();
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const { readMemory } = require('../src/memory-reader');
const { getSemanticCacheDir } = require('../src/utils/voyage-health');

const DEFAULT_VAULT = () => path.join(process.env.HOME, 'Claude Cowork');
const VAULT_ROOT = () => process.env.VAULT_ROOT || DEFAULT_VAULT();

/**
 * DB path for the current vault.
 *
 * The shared cache dir is global, not vault-scoped, so a run against a
 * non-default VAULT_ROOT (tests, scratch harnesses) must not clobber the live
 * index. The default vault uses the shared cache; any other vault root keeps
 * its index inside itself, so a temp vault's index dies with its tmpdir
 * instead of accumulating in the shared cache.
 */
function defaultDbPath() {
  const root = path.resolve(VAULT_ROOT());
  if (root === path.resolve(DEFAULT_VAULT())) {
    return path.join(getSemanticCacheDir(), 'index.db');
  }
  return path.join(root, '.cache', 'index.db');
}

/** Parse staging file into {id, category, status} rows. Same header shape promote-memories.js matches. */
function readProposals() {
  const file = path.join(VAULT_ROOT(), 'proposals', 'memory-proposals.md');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
  const rows = [];
  const re = /^### (mem-\d{8}-\d{3})\s*·\s*(\w+)\s*·\s*(.+?)$/gm;
  let m;
  while ((m = re.exec(raw)) !== null) {
    // status:: line appears within the candidate section; scan forward to next header
    const sectionEnd = raw.indexOf('\n### ', m.index + 1);
    const section = raw.slice(m.index, sectionEnd === -1 ? undefined : sectionEnd);
    const statusMatch = section.match(/^status::\s*(\S+)/m);
    rows.push({ id: m[1], category: m[2], status: statusMatch ? statusMatch[1] : 'pending' });
  }
  return rows;
}

/** Catalog dead-letter files (filename + mtime), wherever the unrouted dir lives. */
function readUnrouted() {
  // Live DLQ plus any archive/unrouted-* quarantine dirs, so quarantined
  // dead letters stay catalogued (and greppable) after being moved out.
  const candidates = [path.join(VAULT_ROOT(), 'proposals', 'unrouted')];
  const archiveRoot = path.join(VAULT_ROOT(), 'archive');
  try {
    for (const name of fs.readdirSync(archiveRoot)) {
      if (name.startsWith('unrouted-')) candidates.push(path.join(archiveRoot, name));
    }
  } catch (_) { /* no archive dir — fine */ }
  const rows = [];
  for (const dir of candidates) {
    let names;
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      let mtime = null;
      try { mtime = fs.statSync(path.join(dir, name)).mtime.toISOString(); } catch (_) { /* skip stat failure */ }
      rows.push({ filename: name, dir, mtime });
    }
  }
  return rows;
}

function countEmbeddings() {
  const file = path.join(getSemanticCacheDir(), 'embeddings.jsonl');
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
  } catch (_) {
    return null; // cache absent — not drift, just unmeasurable
  }
}

/**
 * Rebuild the SQLite index from the source files.
 * @param {{dbPath?: string}} [opts]
 * @returns {Promise<{entries:number, proposals:number, unrouted:number, embeddings:number|null, drift:boolean}>}
 */
async function buildIndex(opts = {}) {
  const dbPath = opts.dbPath || defaultDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });

  const entries = await readMemory();
  const proposals = readProposals();
  const unrouted = readUnrouted();

  const db = new DatabaseSync(dbPath);
  try {
    db.exec('BEGIN');
    db.exec('DROP TABLE IF EXISTS entries; DROP TABLE IF EXISTS entries_fts; DROP TABLE IF EXISTS proposals; DROP TABLE IF EXISTS unrouted;');
    db.exec(`
      CREATE TABLE entries (
        content_hash TEXT PRIMARY KEY,
        date TEXT, category TEXT, source_ref TEXT,
        tags TEXT, related TEXT, added_at TEXT, content TEXT
      );
      CREATE VIRTUAL TABLE entries_fts USING fts5(content, tags, category, content_hash UNINDEXED);
      CREATE TABLE proposals (id TEXT PRIMARY KEY, category TEXT, status TEXT);
      CREATE TABLE unrouted (filename TEXT, dir TEXT, mtime TEXT);
    `);
    const insE = db.prepare('INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?,?,?)');
    const insF = db.prepare('INSERT INTO entries_fts (content,tags,category,content_hash) VALUES (?,?,?,?)');
    for (const e of entries) {
      insE.run(e.contentHash, e.date, e.category, e.sourceRef, e.tags, e.related, e.addedAt, e.content);
      insF.run(e.content, e.tags, e.category, e.contentHash);
    }
    const insP = db.prepare('INSERT OR REPLACE INTO proposals VALUES (?,?,?)');
    for (const p of proposals) insP.run(p.id, p.category, p.status);
    const insU = db.prepare('INSERT INTO unrouted VALUES (?,?,?)');
    for (const u of unrouted) insU.run(u.filename, u.dir, u.mtime);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw err;
  } finally {
    db.close();
  }

  const embeddings = countEmbeddings();
  const drift = embeddings !== null && embeddings !== entries.length;
  return { entries: entries.length, proposals: proposals.length, unrouted: unrouted.length, embeddings, drift };
}

module.exports = { buildIndex };

if (require.main === module) {
  const strict = process.argv.includes('--strict');
  const dbFlag = process.argv.indexOf('--db');
  const dbPath = dbFlag !== -1 ? process.argv[dbFlag + 1] : undefined;
  buildIndex({ dbPath }).then((r) => {
    process.stdout.write(
      `index.db rebuilt at ${dbPath || defaultDbPath()}\n` +
      `entries: ${r.entries}  proposals: ${r.proposals}  unrouted: ${r.unrouted}\n` +
      `embeddings.jsonl: ${r.embeddings === null ? 'absent (unmeasurable)' : r.embeddings}` +
      (r.drift ? `  ⚠ DRIFT vs entries (${r.entries})\n` : '  ✓ matches entries\n')
    );
    if (strict && r.drift) process.exit(1);
  }).catch((err) => {
    process.stderr.write(`[build-index] failed: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  });
}

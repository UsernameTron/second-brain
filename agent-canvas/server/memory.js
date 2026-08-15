'use strict';
// The shared project memory contract.
//
// - Append-only: writeEntry() only ever INSERTs. corrections INSERT a new
//   entry and stamp `superseded_by` on the old one inside a transaction.
// - Every entry carries provenance (author, source, run) and an explicit
//   epistemic state: 'verified' | 'inference' | 'assumption'.
// - Concurrent supersession of the same entry is a conflict, surfaced to the
//   caller (who escalates it) — never last-write-wins.
// - Lineage: citations (entry X was built from entries Y, Z) plus run_reads
//   (run R had entries in context) answer "which inputs produced this output".

const crypto = require('node:crypto');
const { db, tx, nowIso } = require('./db');
const { audit } = require('./audit');

const EPISTEMIC = ['verified', 'inference', 'assumption'];

// Wave 4: FTS5 + bm25 retrieval, probe-gated. External-content index over
// memory_entries.content — the store is append-only (corrections INSERT and
// stamp superseded_by; content never mutates), so an INSERT trigger is the
// entire sync story. Falls back to the scored-OR LIKE scorer when the SQLite
// build lacks FTS5 or MEMORY_FTS=0 is set. Count-mismatch check backfills
// databases created before the index existed (and self-heals).
const FTS_DISABLED = process.env.MEMORY_FTS === '0';
let FTS_OK = false;
if (!FTS_DISABLED) {
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, content='memory_entries', content_rowid='rowid')");
    db.exec(`CREATE TRIGGER IF NOT EXISTS memory_fts_ai AFTER INSERT ON memory_entries BEGIN
      INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
    END`);
    const indexed = db.prepare('SELECT COUNT(*) n FROM memory_fts').get().n;
    const stored = db.prepare('SELECT COUNT(*) n FROM memory_entries').get().n;
    if (indexed !== stored) db.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
    FTS_OK = true;
  } catch { FTS_OK = false; }
}
function retrievalEngine() { return FTS_OK ? 'fts5-bm25' : 'scored-or'; }
// Wave 3 typed memory. All optional — entries written before (or without)
// types are plain untyped facts and stay fully readable/retrievable.
const KINDS = ['fact', 'decision', 'preference', 'constraint', 'outcome', 'feedback'];
const APPLIES_TO = ['global', 'canvas', 'agent', 'user'];

function validateTyped({ kind, appliesToType, appliesToId }) {
  if (kind != null && !KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
  if (appliesToType != null && !APPLIES_TO.includes(appliesToType)) throw new Error(`applies_to_type must be one of ${APPLIES_TO.join(', ')}`);
  if (appliesToId != null && appliesToType == null) throw new Error('applies_to_id requires applies_to_type');
}

function writeEntry({ canvasId, content, epistemic, authorType, authorId, authorName = '', source = '', runId = null, cites = [],
  kind = null, subject = null, appliesToType = null, appliesToId = null, effectiveAt = null, reviewAt = null }) {
  if (!content || typeof content !== 'string') throw new Error('memory content required');
  if (!EPISTEMIC.includes(epistemic)) throw new Error(`epistemic must be one of ${EPISTEMIC.join(', ')}`);
  validateTyped({ kind, appliesToType, appliesToId });
  const id = crypto.randomUUID();
  const ts = nowIso();
  const uniqueCites = [...new Set(cites)].filter(Boolean);
  tx(() => {
    const citedRows = [];
    for (const citeId of uniqueCites) {
      const cited = db.prepare('SELECT id, author_type, author_id, epistemic FROM memory_entries WHERE id = ?').get(citeId);
      if (!cited) throw new Error(`cited memory entry not found: ${citeId}`);
      citedRows.push(cited);
    }
    // Verification laundering guard: an agent cannot mint a "verified" entry
    // whose entire support is its own unverified entries — that is the same
    // self-upgrade the supersession rule blocks, via a side door.
    if (
      authorType === 'agent' && epistemic === 'verified' && citedRows.length > 0 &&
      citedRows.every((c) => c.author_type === 'agent' && c.author_id === authorId && c.epistemic !== 'verified')
    ) {
      throw new Error(
        'verification authority: a "verified" entry cannot rest solely on your own unverified entries. Label it inference/assumption, or cite independent evidence (another author, a verified entry, or a primary source).'
      );
    }
    db.prepare(
      `INSERT INTO memory_entries (id, canvas_id, content, epistemic, author_type, author_id, author_name, source, run_id, created_at,
                                   kind, subject, applies_to_type, applies_to_id, effective_at, review_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, canvasId, content, epistemic, authorType, authorId, authorName, source, runId, ts,
      kind, subject, appliesToType, appliesToId, effectiveAt, reviewAt);
    for (const citeId of uniqueCites) {
      db.prepare('INSERT OR IGNORE INTO citations (entry_id, cites_entry_id) VALUES (?, ?)').run(id, citeId);
    }
    audit(authorType, authorId, 'memory.write', { entryId: id, canvasId, epistemic, runId, cites: uniqueCites });
  });
  return getEntry(id);
}

// Supersede `entryId` with a corrected entry. Returns:
//   { conflict: true, current } when the entry was already superseded (a true
//   concurrent-correction conflict — the caller must escalate, not overwrite);
//   { entry, affected } otherwise, where `affected` is every entry downstream
//   of the corrected one via citations (transitively) — the set to flag/ripple.
function correctEntry({ entryId, content, epistemic, reason = '', authorType, authorId, authorName = '', source = '', runId = null, cites = [],
  kind, subject, appliesToType, appliesToId, effectiveAt, reviewAt }) {
  if (!EPISTEMIC.includes(epistemic)) throw new Error(`epistemic must be one of ${EPISTEMIC.join(', ')}`);
  if (kind !== undefined || appliesToType !== undefined) validateTyped({ kind: kind ?? null, appliesToType: appliesToType ?? null, appliesToId: appliesToId ?? null });
  const newId = crypto.randomUUID();
  const ts = nowIso();
  let conflictResult = null;
  tx(() => {
    const old = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(entryId);
    if (!old) throw new Error(`memory entry not found: ${entryId}`);
    // Verification authority: an agent may not upgrade ITS OWN inference or
    // assumption to "verified". Independent verification is required — another
    // agent with direct evidence, deterministic validation, or a human.
    if (
      authorType === 'agent' && epistemic === 'verified' &&
      old.author_type === 'agent' && old.author_id === authorId && old.epistemic !== 'verified'
    ) {
      throw new Error(
        'verification authority: you cannot upgrade your own inference/assumption to "verified". Keep the corrected label honest (inference/assumption), or let independent verification (another agent with direct evidence, a deterministic check, or a human) do the upgrade.'
      );
    }
    if (old.superseded_by) {
      conflictResult = { conflict: true, current: getEntryTx(old.superseded_by), original: rowToEntry(old) };
      return;
    }
    db.prepare(
      `INSERT INTO memory_entries (id, canvas_id, content, epistemic, author_type, author_id, author_name, source, run_id, created_at, supersedes, supersede_reason,
                                   kind, subject, applies_to_type, applies_to_id, effective_at, review_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newId, old.canvas_id, content, epistemic, authorType, authorId, authorName, source, runId, ts, entryId, reason,
      // A correction inherits the corrected entry's type fields unless the caller overrides them.
      kind !== undefined ? kind : old.kind, subject !== undefined ? subject : old.subject,
      appliesToType !== undefined ? appliesToType : old.applies_to_type, appliesToId !== undefined ? appliesToId : old.applies_to_id,
      effectiveAt !== undefined ? effectiveAt : old.effective_at, reviewAt !== undefined ? reviewAt : old.review_at);
    db.prepare('UPDATE memory_entries SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL').run(newId, entryId);
    // The correction inherits the corrected entry as a citation, plus any explicit cites.
    const allCites = [...new Set([entryId, ...cites])].filter(Boolean);
    for (const citeId of allCites) {
      const exists = db.prepare('SELECT id FROM memory_entries WHERE id = ?').get(citeId);
      if (exists) db.prepare('INSERT OR IGNORE INTO citations (entry_id, cites_entry_id) VALUES (?, ?)').run(newId, citeId);
    }
    audit(authorType, authorId, 'memory.correct', { entryId: newId, supersedes: entryId, canvasId: old.canvas_id, reason, runId });
  });
  if (conflictResult) return conflictResult;
  const affected = downstreamOf(entryId);
  return { entry: getEntry(newId), affected };
}

// All entries that cited `entryId`, transitively (the contamination set).
// A correction cites the entry it supersedes (for lineage), but that edge must
// not count as contamination — hence the `entry_id != superseded_by` guards.
function downstreamOf(entryId) {
  const rows = db.prepare(`
    WITH RECURSIVE down(id) AS (
      SELECT c.entry_id FROM citations c
        JOIN memory_entries t ON t.id = c.cites_entry_id
       WHERE c.cites_entry_id = ? AND c.entry_id != IFNULL(t.superseded_by, '')
      UNION
      SELECT c.entry_id FROM citations c
        JOIN memory_entries t ON t.id = c.cites_entry_id
        JOIN down d ON c.cites_entry_id = d.id
       WHERE c.entry_id != IFNULL(t.superseded_by, '')
    )
    SELECT DISTINCT id FROM down
  `).all(entryId);
  return rows.map((r) => r.id);
}

// All entries whose citation ancestry (transitively) includes a superseded
// entry — i.e. entries built on information that has since been corrected.
function taintedSet(canvasId) {
  // No superseded entries → nothing can be tainted. Skips the recursive
  // citation-graph walk in the common no-corrections case (IMPROVE finding:
  // the walk ran on every listEntries call regardless).
  const anySuperseded = db.prepare('SELECT 1 FROM memory_entries WHERE superseded_by IS NOT NULL LIMIT 1').get();
  if (!anySuperseded) return new Set();
  const rows = db.prepare(`
    WITH RECURSIVE down(id) AS (
      SELECT c.entry_id FROM citations c
        JOIN memory_entries m ON m.id = c.cites_entry_id
       WHERE m.superseded_by IS NOT NULL AND c.entry_id != m.superseded_by
      UNION
      SELECT c.entry_id FROM citations c
        JOIN memory_entries t ON t.id = c.cites_entry_id
        JOIN down d ON c.cites_entry_id = d.id
       WHERE c.entry_id != IFNULL(t.superseded_by, '')
    )
    SELECT DISTINCT down.id FROM down
      JOIN memory_entries e ON e.id = down.id
     WHERE e.superseded_by IS NULL ${canvasId ? 'AND (e.canvas_id = ? OR e.canvas_id IS NULL)' : ''}
  `).all(...(canvasId ? [canvasId] : []));
  return new Set(rows.map((r) => r.id));
}

// Batch-fetch citation edges for a set of entry ids in two queries, instead
// of two queries per row (IMPROVE finding: rowToEntry made listEntries O(2n)).
function citeMapsFor(ids) {
  const cites = new Map();
  const citedBy = new Map();
  if (!ids.length) return { cites, citedBy };
  const marks = ids.map(() => '?').join(', ');
  for (const r of db.prepare(`SELECT entry_id, cites_entry_id FROM citations WHERE entry_id IN (${marks})`).all(...ids)) {
    if (!cites.has(r.entry_id)) cites.set(r.entry_id, []);
    cites.get(r.entry_id).push(r.cites_entry_id);
  }
  for (const r of db.prepare(`SELECT entry_id, cites_entry_id FROM citations WHERE cites_entry_id IN (${marks})`).all(...ids)) {
    if (!citedBy.has(r.cites_entry_id)) citedBy.set(r.cites_entry_id, []);
    citedBy.get(r.cites_entry_id).push(r.entry_id);
  }
  return { cites, citedBy };
}

function rowToEntry(row, maps = null) {
  if (!row) return null;
  const cites = maps
    ? (maps.cites.get(row.id) || [])
    : db.prepare('SELECT cites_entry_id FROM citations WHERE entry_id = ?').all(row.id).map((r) => r.cites_entry_id);
  const citedBy = maps
    ? (maps.citedBy.get(row.id) || [])
    : db.prepare('SELECT entry_id FROM citations WHERE cites_entry_id = ?').all(row.id).map((r) => r.entry_id);
  return {
    id: row.id,
    canvasId: row.canvas_id,
    content: row.content,
    epistemic: row.epistemic,
    author: { type: row.author_type, id: row.author_id, name: row.author_name },
    source: row.source,
    runId: row.run_id,
    createdAt: row.created_at,
    supersedes: row.supersedes,
    supersededBy: row.superseded_by,
    supersedeReason: row.supersede_reason,
    kind: row.kind ?? null,
    subject: row.subject ?? null,
    appliesToType: row.applies_to_type ?? null,
    appliesToId: row.applies_to_id ?? null,
    effectiveAt: row.effective_at ?? null,
    reviewAt: row.review_at ?? null,
    cites,
    citedBy,
  };
}

function getEntryTx(id) {
  return rowToEntry(db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id));
}
function getEntry(id) { return getEntryTx(id); }

function listEntries({ canvasId, includeSuperseded = false, epistemic, since, query, limit = 200, kind, subject, appliesToType, appliesToId }) {
  const clauses = [];
  const params = [];
  if (canvasId) { clauses.push('(canvas_id = ? OR canvas_id IS NULL)'); params.push(canvasId); }
  if (!includeSuperseded) clauses.push('superseded_by IS NULL');
  if (epistemic) { clauses.push('epistemic = ?'); params.push(epistemic); }
  if (since) { clauses.push('created_at >= ?'); params.push(since); }
  if (kind) { clauses.push('kind = ?'); params.push(kind); }
  if (subject) { clauses.push('LOWER(subject) = ?'); params.push(String(subject).toLowerCase()); }
  // Applicability filter: untyped/global entries always qualify; scoped
  // entries qualify when the scope matches. Applicability, not access control.
  if (appliesToType) {
    clauses.push("(applies_to_type IS NULL OR applies_to_type = 'global' OR (applies_to_type = ? AND (applies_to_id IS NULL OR applies_to_id = ?)))");
    params.push(appliesToType, appliesToId || '');
  }
  // Multi-word queries score by matched tokens (at least half must hit) and
  // rank best-first, instead of requiring every token. Field evidence: an
  // agent searched "7-person team capacity constraint" against an entry
  // containing "team size: 7 … feasible at 7-person scale" and strict-AND
  // returned nothing — the memory was there, the search refused to see it.
  // FTS tokenization splits on non-alphanumerics ("7-person" → 7, person),
  // so mirror that split here; the LIKE fallback keeps whitespace splitting.
  const rawTokens = query ? String(query).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 8) : [];
  const likeTokens = query ? String(query).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8) : [];
  const lim = Math.min(Number(limit) || 200, 1000);
  let rows;
  if (rawTokens.length >= 1 && FTS_OK) {
    // Prefix-match each token, any may hit; bm25 ranks (lower = better).
    const match = rawTokens.map((t) => `"${t}"*`).join(' OR ');
    const where = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
    rows = db.prepare(
      `SELECT m.*, -bm25(memory_fts) AS mscore FROM memory_fts JOIN memory_entries m ON m.rowid = memory_fts.rowid
       WHERE memory_fts MATCH ? ${where} ORDER BY bm25(memory_fts), m.created_at DESC LIMIT ?`
    ).all(match, ...params, lim);
  } else if (likeTokens.length >= 2) {
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const scoreExpr = likeTokens.map(() => '(CASE WHEN LOWER(content) LIKE ? THEN 1 ELSE 0 END)').join(' + ');
    const scoreParams = likeTokens.map((t) => `%${t}%`);
    const threshold = Math.max(1, Math.ceil(likeTokens.length / 2));
    rows = db.prepare(
      `SELECT * FROM (SELECT *, ${scoreExpr} AS mscore FROM memory_entries ${where}) WHERE mscore >= ? ORDER BY mscore DESC, created_at DESC LIMIT ?`
    ).all(...scoreParams, ...params, threshold, lim);
  } else {
    if (likeTokens.length === 1) {
      clauses.push('LOWER(content) LIKE ?');
      params.push(`%${likeTokens[0]}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    rows = db.prepare(
      `SELECT * FROM memory_entries ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params, lim);
  }
  const tainted = taintedSet(canvasId);
  const maps = citeMapsFor(rows.map((r) => r.id));
  return rows.map((row) => ({ ...rowToEntry(row, maps), tainted: tainted.has(row.id), score: row.mscore ?? null }));
}

// Retrieval-quality log: which query returned which entries at what rank and
// score. run_reads stays the delivery record; this is the observability record.
function recordRetrievals(runId, query, entries) {
  const ts = nowIso();
  const stmt = db.prepare('INSERT INTO memory_retrievals (run_id, entry_id, query, rank, score, ts) VALUES (?, ?, ?, ?, ?, ?)');
  entries.forEach((e, i) => stmt.run(runId, e.id, String(query || ''), i + 1, e.score ?? null, ts));
}

function recordRunReads(runId, entryIds) {
  for (const entryId of entryIds) {
    db.prepare('INSERT OR IGNORE INTO run_reads (run_id, entry_id) VALUES (?, ?)').run(runId, entryId);
  }
}

// Lineage trace: for one entry, everything upstream (what fed it) and
// downstream (what it fed), plus the producing run and that run's reads.
function lineage(entryId) {
  const entry = getEntry(entryId);
  if (!entry) return null;
  const up = db.prepare(`
    WITH RECURSIVE up(id, depth) AS (
      SELECT cites_entry_id, 1 FROM citations WHERE entry_id = ?
      UNION
      SELECT c.cites_entry_id, up.depth + 1 FROM citations c JOIN up ON c.entry_id = up.id
      WHERE up.depth < 12
    )
    SELECT id, MIN(depth) AS depth FROM up GROUP BY id
  `).all(entryId);
  const down = db.prepare(`
    WITH RECURSIVE down(id, depth) AS (
      SELECT entry_id, 1 FROM citations WHERE cites_entry_id = ?
      UNION
      SELECT c.entry_id, down.depth + 1 FROM citations c JOIN down ON c.cites_entry_id = down.id
      WHERE down.depth < 12
    )
    SELECT id, MIN(depth) AS depth FROM down GROUP BY id
  `).all(entryId);
  let run = null;
  let runReads = [];
  if (entry.runId) {
    run = db.prepare('SELECT id, agent_id, instruction, status, model, started_at, ended_at FROM runs WHERE id = ?').get(entry.runId) || null;
    runReads = db.prepare('SELECT entry_id FROM run_reads WHERE run_id = ?').all(entry.runId).map((r) => r.entry_id);
  }
  const tainted = taintedSet(entry.canvasId);
  const hydrate = (list) => list.map(({ id, depth }) => ({ ...getEntry(id), depth, tainted: tainted.has(id) }));
  return {
    entry: { ...entry, tainted: tainted.has(entry.id) },
    upstream: hydrate(up),
    downstream: hydrate(down),
    producingRun: run,
    runReads: runReads.map((id) => getEntry(id)).filter(Boolean),
  };
}

// Same-subject verified-vs-verified disagreement, computed on read (nothing
// stored). Shared by GET /memory/conflicts and the P2 attention projection.
function findConflicts(canvasId) {
  const pairs = db.prepare(`
    SELECT a.id AS a_id, b.id AS b_id, a.subject
    FROM memory_entries a JOIN memory_entries b
      ON LOWER(a.subject) = LOWER(b.subject) AND a.id < b.id
    WHERE a.canvas_id = ? AND b.canvas_id = ?
      AND a.subject IS NOT NULL AND a.subject != ''
      AND a.superseded_by IS NULL AND b.superseded_by IS NULL
      AND a.epistemic = 'verified' AND b.epistemic = 'verified'
      AND a.content != b.content
  `).all(canvasId, canvasId);
  return pairs.map((p) => ({ subject: p.subject, entries: [getEntry(p.a_id), getEntry(p.b_id)] }));
}

module.exports = { writeEntry, correctEntry, getEntry, listEntries, lineage, downstreamOf, taintedSet, recordRunReads, recordRetrievals, retrievalEngine, citeMapsFor, findConflicts, EPISTEMIC, KINDS, APPLIES_TO };

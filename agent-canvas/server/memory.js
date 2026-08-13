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

function writeEntry({ canvasId, content, epistemic, authorType, authorId, authorName = '', source = '', runId = null, cites = [] }) {
  if (!content || typeof content !== 'string') throw new Error('memory content required');
  if (!EPISTEMIC.includes(epistemic)) throw new Error(`epistemic must be one of ${EPISTEMIC.join(', ')}`);
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
      `INSERT INTO memory_entries (id, canvas_id, content, epistemic, author_type, author_id, author_name, source, run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, canvasId, content, epistemic, authorType, authorId, authorName, source, runId, ts);
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
function correctEntry({ entryId, content, epistemic, reason = '', authorType, authorId, authorName = '', source = '', runId = null, cites = [] }) {
  if (!EPISTEMIC.includes(epistemic)) throw new Error(`epistemic must be one of ${EPISTEMIC.join(', ')}`);
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
      `INSERT INTO memory_entries (id, canvas_id, content, epistemic, author_type, author_id, author_name, source, run_id, created_at, supersedes, supersede_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newId, old.canvas_id, content, epistemic, authorType, authorId, authorName, source, runId, ts, entryId, reason);
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

function rowToEntry(row) {
  if (!row) return null;
  const cites = db.prepare('SELECT cites_entry_id FROM citations WHERE entry_id = ?').all(row.id).map((r) => r.cites_entry_id);
  const citedBy = db.prepare('SELECT entry_id FROM citations WHERE cites_entry_id = ?').all(row.id).map((r) => r.entry_id);
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
    cites,
    citedBy,
  };
}

function getEntryTx(id) {
  return rowToEntry(db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(id));
}
function getEntry(id) { return getEntryTx(id); }

function listEntries({ canvasId, includeSuperseded = false, epistemic, since, query, limit = 200 }) {
  const clauses = [];
  const params = [];
  if (canvasId) { clauses.push('(canvas_id = ? OR canvas_id IS NULL)'); params.push(canvasId); }
  if (!includeSuperseded) clauses.push('superseded_by IS NULL');
  if (epistemic) { clauses.push('epistemic = ?'); params.push(epistemic); }
  if (since) { clauses.push('created_at >= ?'); params.push(since); }
  // Multi-word queries score by matched tokens (at least half must hit) and
  // rank best-first, instead of requiring every token. Field evidence: an
  // agent searched "7-person team capacity constraint" against an entry
  // containing "team size: 7 … feasible at 7-person scale" and strict-AND
  // returned nothing — the memory was there, the search refused to see it.
  const tokens = query ? String(query).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8) : [];
  if (tokens.length === 1) {
    clauses.push('LOWER(content) LIKE ?');
    params.push(`%${tokens[0]}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const lim = Math.min(Number(limit) || 200, 1000);
  let rows;
  if (tokens.length >= 2) {
    const scoreExpr = tokens.map(() => '(CASE WHEN LOWER(content) LIKE ? THEN 1 ELSE 0 END)').join(' + ');
    const scoreParams = tokens.map((t) => `%${t}%`);
    const threshold = Math.max(1, Math.ceil(tokens.length / 2));
    rows = db.prepare(
      `SELECT * FROM (SELECT *, ${scoreExpr} AS mscore FROM memory_entries ${where}) WHERE mscore >= ? ORDER BY mscore DESC, created_at DESC LIMIT ?`
    ).all(...scoreParams, ...params, threshold, lim);
  } else {
    rows = db.prepare(
      `SELECT * FROM memory_entries ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params, lim);
  }
  const tainted = taintedSet(canvasId);
  return rows.map((row) => ({ ...rowToEntry(row), tainted: tainted.has(row.id) }));
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

module.exports = { writeEntry, correctEntry, getEntry, listEntries, lineage, downstreamOf, taintedSet, recordRunReads, EPISTEMIC };

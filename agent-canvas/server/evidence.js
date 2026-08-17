'use strict';
// P1 evidence spine. An evidence ref is one external artifact a run touched —
// web page, Drive file, canvas attachment, Gmail message, CRM record, MCP
// result, enrichment record. Refs are recorded at the tool funnels
// (tools.js / runner.js), the
// ref id is surfaced to the model OUTSIDE the external_content wrapper (so a
// payload cannot forge one), and memory_write's `evidence` param links entries
// to the refs that support them. citations stays entry→entry; this is
// entry→artifact. Append-only, like everything else in the memory layer.

const crypto = require('node:crypto');
const { db, nowIso } = require('./db');

const SOURCE_KINDS = ['web', 'drive', 'sheet', 'gmail', 'calendar', 'hubspot', 'mcp', 'enrichment', 'canvas_file'];
// Kinds whose URI can leak a private surface (a mailbox, a Drive file) —
// redacted for anyone other than the directing user at read time.
const PRIVATE_URI_KINDS = ['gmail', 'drive', 'sheet'];

function recordRef({ runId, sourceKind, sourceId = '', title = '', uri = '', directedBy = '', visibility = 'canvas', meta = {} }) {
  if (!runId) throw new Error('evidence ref requires runId');
  if (!SOURCE_KINDS.includes(sourceKind)) throw new Error(`source_kind must be one of ${SOURCE_KINDS.join(', ')}`);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO evidence_refs (id, run_id, source_kind, source_id, display_title, uri, directed_by, retrieved_at, visibility, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, runId, sourceKind, String(sourceId).slice(0, 500), String(title).slice(0, 300),
    String(uri).slice(0, 2000), directedBy || '', nowIso(), visibility, JSON.stringify(meta || {}));
  return id;
}

// Validate that every ref exists and belongs to this run, then link. Called
// inside memory_write's flow — throwing here rejects the whole write (tx()
// is re-entrant, so wrap the write+cite in one tx at the call site).
function citeEvidence(entryId, refIds, runId) {
  const unique = [...new Set(refIds)].filter(Boolean);
  for (const refId of unique) {
    const ref = db.prepare('SELECT id, run_id FROM evidence_refs WHERE id = ?').get(refId);
    if (!ref) throw new Error(`evidence ref not found: ${refId}`);
    if (ref.run_id !== runId) throw new Error(`evidence ref ${refId} belongs to a different run — cite only refs from this run's own tool results`);
  }
  for (const refId of unique) {
    db.prepare('INSERT OR IGNORE INTO evidence_citations (entry_id, evidence_ref_id) VALUES (?, ?)').run(entryId, refId);
  }
  return unique;
}

function rowToRef(row) {
  return {
    id: row.id, runId: row.run_id, sourceKind: row.source_kind, sourceId: row.source_id,
    title: row.display_title, uri: row.uri, directedBy: row.directed_by,
    retrievedAt: row.retrieved_at, visibility: row.visibility, meta: JSON.parse(row.meta_json || '{}'),
  };
}

function refsForRun(runId) {
  return db.prepare('SELECT * FROM evidence_refs WHERE run_id = ? ORDER BY retrieved_at, id').all(runId).map(rowToRef);
}

// Batch: entry ids → Map(entry_id -> [refs]). Two queries, citeMapsFor-style.
function evidenceMapsFor(entryIds) {
  const map = new Map();
  if (!entryIds.length) return map;
  const marks = entryIds.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT ec.entry_id, er.* FROM evidence_citations ec JOIN evidence_refs er ON er.id = ec.evidence_ref_id
     WHERE ec.entry_id IN (${marks})`
  ).all(...entryIds);
  for (const row of rows) {
    if (!map.has(row.entry_id)) map.set(row.entry_id, []);
    map.get(row.entry_id).push(rowToRef(row));
  }
  return map;
}

// Read-time redaction: private-surface URIs are the directing user's own view.
// Title + kind stay visible so the receipt stays honest without leaking.
function redactRef(ref, viewerEmail) {
  if (!PRIVATE_URI_KINDS.includes(ref.sourceKind)) return ref;
  if (viewerEmail && ref.directedBy === viewerEmail) return ref;
  return { ...ref, uri: '', sourceId: '', redacted: true };
}

// The marker appended to tool results, outside the external_content wrapper.
function refMarker(id) {
  return `\n[evidence_ref: ${id} — pass this id in memory_write's evidence array for any entry that rests on this result]`;
}

module.exports = { recordRef, citeEvidence, refsForRun, evidenceMapsFor, redactRef, refMarker, SOURCE_KINDS };

'use strict';
// Hash-chained, append-only audit log. Every row carries the SHA-256 of the
// previous row's hash concatenated with its own content, so any tampering with
// history breaks the chain. There is no update or delete path anywhere in the
// codebase; verifyChain() re-walks the chain and reports the first break.

const crypto = require('node:crypto');
const { db, nowIso } = require('./db');

const insertStmt = db.prepare(
  'INSERT INTO audit_log (ts, actor_type, actor_id, action, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const lastStmt = db.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1');

function rowHash(prevHash, ts, actorType, actorId, action, detail) {
  return crypto.createHash('sha256')
    .update(`${prevHash}|${ts}|${actorType}|${actorId}|${action}|${detail}`)
    .digest('hex');
}

function audit(actorType, actorId, action, detail = {}) {
  const ts = nowIso();
  const detailJson = JSON.stringify(detail);
  const prev = lastStmt.get();
  const prevHash = prev ? prev.hash : 'genesis';
  const hash = rowHash(prevHash, ts, actorType, actorId, action, detailJson);
  const { lastInsertRowid } = insertStmt.run(ts, actorType, actorId, action, detailJson, prevHash, hash);
  // Authoritative copy: mirror every entry to stdout as structured JSON. On
  // Cloud Run this lands in Cloud Logging, which the application runtime
  // cannot update or delete — and can be routed to a locked log bucket for
  // regulator-grade immutability (docs/DEPLOY.md). The SQLite table is the
  // queryable index; this stream is the tamper-independent record.
  process.stdout.write(`${JSON.stringify({ audit: true, seq: Number(lastInsertRowid), ts, actor_type: actorType, actor_id: actorId, action, detail, hash })}\n`);
  return { ts, action, hash };
}

function queryAudit({ action, actorId, since, until, limit = 200, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (action) { clauses.push('action LIKE ?'); params.push(`${action}%`); }
  if (actorId) { clauses.push('actor_id = ?'); params.push(actorId); }
  if (since) { clauses.push('ts >= ?'); params.push(since); }
  if (until) { clauses.push('ts <= ?'); params.push(until); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT seq, ts, actor_type, actor_id, action, detail, hash FROM audit_log ${where} ORDER BY seq DESC LIMIT ? OFFSET ?`
  ).all(...params, Math.min(Number(limit) || 200, 1000), Number(offset) || 0);
  return rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) }));
}

// Tail verification for polling callers (finding 10): re-hash only the last
// K rows, anchored on the stored hash of the row just before the tail. O(K)
// instead of O(all rows ever), so the 60s health poll stops growing forever.
// The anchor hash itself is trusted here — the full walk stays available on
// the owner-only audit view, where paying for it is a choice.
function verifyChainTail(k = 200) {
  const tail = db.prepare('SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?').all(k).reverse();
  if (!tail.length) return { ok: true, entries: 0, tail: 0 };
  const anchor = db.prepare('SELECT hash FROM audit_log WHERE seq < ? ORDER BY seq DESC LIMIT 1').get(tail[0].seq);
  let prevHash = anchor ? anchor.hash : 'genesis';
  for (const row of tail) {
    if (row.prev_hash !== prevHash) return { ok: false, brokenAt: row.seq, reason: 'prev_hash mismatch' };
    const expect = rowHash(prevHash, row.ts, row.actor_type, row.actor_id, row.action, row.detail);
    if (row.hash !== expect) return { ok: false, brokenAt: row.seq, reason: 'hash mismatch' };
    prevHash = row.hash;
  }
  return { ok: true, tail: tail.length };
}

function verifyChain() {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all();
  let prevHash = 'genesis';
  for (const row of rows) {
    if (row.prev_hash !== prevHash) return { ok: false, brokenAt: row.seq, reason: 'prev_hash mismatch' };
    const expect = rowHash(prevHash, row.ts, row.actor_type, row.actor_id, row.action, row.detail);
    if (row.hash !== expect) return { ok: false, brokenAt: row.seq, reason: 'hash mismatch' };
    prevHash = row.hash;
  }
  return { ok: true, entries: rows.length };
}

module.exports = { audit, queryAudit, verifyChain, verifyChainTail };

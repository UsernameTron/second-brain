'use strict';
// P3 Evidence Rooms. A Room is metadata over an existing canvas; everything a
// Room shows is a READ-TIME projection over records that already exist (the
// attention.js pattern) — no section has its own business table. Every item
// carries its source and a timestamp so freshness is never implied.

const { db } = require('./db');
const memory = require('./memory');
const attention = require('./attention');
const evidence = require('./evidence');

const ROOM_TYPES = ['deal', 'client', 'initiative', 'decision'];
const LENSES = ['now', 'history', 'risk'];

function rowToRoom(row) {
  return {
    id: row.id, canvasId: row.canvas_id, roomType: row.room_type,
    externalRef: row.external_ref, lifecycle: row.lifecycle,
    createdBy: row.created_by, createdAt: row.created_at,
    refreshedAt: row.refreshed_at, refreshedBy: row.refreshed_by,
    name: row.name, description: row.description,
  };
}

function getRoom(roomId) {
  const row = db.prepare(
    'SELECT r.*, c.name, c.description FROM rooms r JOIN canvases c ON c.id = r.canvas_id WHERE r.id = ?'
  ).get(roomId);
  return row ? rowToRoom(row) : null;
}

function listRooms() {
  return db.prepare(
    'SELECT r.*, c.name, c.description FROM rooms r JOIN canvases c ON c.id = r.canvas_id ORDER BY r.created_at DESC'
  ).all().map(rowToRoom);
}

// The six sections + lens filter. viewer is {email} — evidence URIs on
// private surfaces are redacted for anyone but the directing user.
function buildRoom(roomId, { lens = 'now', viewer = {} } = {}) {
  const room = getRoom(roomId);
  if (!room) return null;
  if (!LENSES.includes(lens)) lens = 'now';
  const canvasId = room.canvasId;
  const history = lens === 'history';

  const people = {
    onCanvas: db.prepare('SELECT id, email, display, color FROM canvas_people WHERE canvas_id = ?').all(canvasId),
    members: db.prepare('SELECT user_email AS email, access FROM canvas_members WHERE canvas_id = ?').all(canvasId),
  };

  const evidenceRefs = db.prepare(
    `SELECT er.* FROM evidence_refs er JOIN runs r ON r.id = er.run_id
     WHERE r.canvas_id = ? ORDER BY er.retrieved_at DESC LIMIT 100`
  ).all(canvasId).map((row) => evidence.redactRef({
    id: row.id, runId: row.run_id, sourceKind: row.source_kind, sourceId: row.source_id,
    title: row.display_title, uri: row.uri, directedBy: row.directed_by,
    retrievedAt: row.retrieved_at, visibility: row.visibility,
  }, viewer.email));

  const tasks = db.prepare(
    `SELECT id, title, description, status, assignee_email, created_at FROM tasks WHERE canvas_id = ?
     ${history ? '' : "AND status != 'done'"} ORDER BY created_at DESC LIMIT 50`
  ).all(canvasId);
  const runs = db.prepare(
    `SELECT id, agent_id, status, mode, instruction, summary, initiated_by, created_at, ended_at
     FROM runs WHERE canvas_id = ? ORDER BY created_at DESC LIMIT ${history ? 100 : 20}`
  ).all(canvasId);

  const decisions = memory.listEntries({ canvasId, kind: 'decision', includeSuperseded: history, limit: 100 });

  const risks = attention.listAttention({ email: viewer.email || '', scope: 'all', canvasIds: [canvasId] });
  const taintedIds = [...memory.taintedSet(canvasId)];

  const openQuestions = {
    escalations: db.prepare(
      `SELECT id, kind, question, status, owner_email, owner_agent_id, due_at, created_at, resolved_at
       FROM escalations WHERE canvas_id = ? ${history ? '' : "AND status = 'open'"}
       ORDER BY created_at DESC LIMIT 50`
    ).all(canvasId),
    inquiries: db.prepare(
      `SELECT id, question, status, requested_by, created_at FROM inquiries
       WHERE canvas_id = ? ${history ? '' : "AND status NOT IN ('answered')"}
       ORDER BY created_at DESC LIMIT 50`
    ).all(canvasId),
  };

  const refreshes = db.prepare(
    'SELECT id, run_id, actor, note, created_at FROM room_refreshes WHERE room_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(roomId);

  let sections = {
    people,
    evidence: evidenceRefs,
    work: { tasks, runs },
    decisions,
    risks,
    openQuestions,
  };

  if (lens === 'risk') {
    // Risk lens: only what can bite — attention rows, tainted decisions,
    // evidence cited by tainted entries stays visible via the decisions list.
    sections = {
      people,
      evidence: evidenceRefs.filter((r) => r.redacted),
      work: { tasks: tasks.filter((t) => t.status === 'escalated'), runs: runs.filter((r) => ['failed', 'refused', 'halted_budget', 'halted_timeout', 'halted_steps'].includes(r.status)) },
      decisions: decisions.filter((d) => d.tainted || taintedIds.includes(d.id)),
      risks,
      openQuestions,
    };
  }

  return { room, lens, sections, refreshes, taintedCount: taintedIds.length, generatedAt: new Date().toISOString() };
}

module.exports = { getRoom, listRooms, buildRoom, ROOM_TYPES, LENSES };

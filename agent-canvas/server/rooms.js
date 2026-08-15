'use strict';
// P3 Evidence Rooms. A Room is metadata over an existing canvas; everything a
// Room shows is a READ-TIME projection over records that already exist (the
// attention.js pattern) — no section has its own business table. Every item
// carries its source and a timestamp so freshness is never implied.

const crypto = require('node:crypto');
const { db } = require('./db');
const memory = require('./memory');
const attention = require('./attention');
const evidence = require('./evidence');

const ROOM_TYPES = ['deal', 'client', 'initiative', 'decision'];
const LENSES = ['now', 'history', 'risk'];

function rowToRoom(row) {
  return {
    id: row.id, canvasId: row.canvas_id, roomType: row.room_type,
    externalRef: row.external_ref,
    // Derived, never stored twice: archiving the canvas (either route)
    // archives the room with it.
    lifecycle: row.archived ? 'archived' : 'active',
    createdBy: row.created_by, createdAt: row.created_at,
    refreshedAt: row.refreshed_at, refreshedBy: row.refreshed_by,
    name: row.name, description: row.description,
  };
}

function getRoom(roomId) {
  const row = db.prepare(
    'SELECT r.*, c.name, c.description, c.archived FROM rooms r JOIN canvases c ON c.id = r.canvas_id WHERE r.id = ?'
  ).get(roomId);
  return row ? rowToRoom(row) : null;
}

function listRooms() {
  return db.prepare(
    'SELECT r.*, c.name, c.description, c.archived FROM rooms r JOIN canvases c ON c.id = r.canvas_id ORDER BY r.created_at DESC'
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
    // and the evidence actually CITED by tainted entries (redaction state
    // is a visibility concern, not a risk signal).
    const taintedEvidence = taintedIds.length
      ? [...new Map([...evidence.evidenceMapsFor(taintedIds).values()].flat().map((r) => [r.id, r])).values()]
        .map((r) => evidence.redactRef(r, viewer.email))
      : [];
    sections = {
      people,
      evidence: taintedEvidence,
      work: { tasks: tasks.filter((t) => t.status === 'escalated'), runs: runs.filter((r) => ['failed', 'refused', 'halted_budget', 'halted_timeout', 'halted_steps'].includes(r.status)) },
      decisions: decisions.filter((d) => d.tainted || taintedIds.includes(d.id)),
      risks,
      openQuestions,
    };
  }

  return { room, lens, sections, refreshes, taintedCount: taintedIds.length, generatedAt: new Date().toISOString() };
}

// ---------- client-safe export ----------
// The disclosure contract: the export carries ONLY reviewed conclusions —
// non-tainted decisions, verified facts, work status, and evidence titles
// from non-private surfaces. Assumptions/inferences, tainted entries,
// private-surface evidence (gmail/drive/sheet), open escalations, and the
// raw audit chain are excluded BY NAME in the preview so the disclosure
// review is explicit, never implied.
const PRIVATE_KINDS = new Set(['gmail', 'drive', 'sheet']);

function exportManifest(roomId) {
  const room = getRoom(roomId);
  if (!room) return null;
  const canvasId = room.canvasId;
  const taintedIds = memory.taintedSet(canvasId);

  // Only VERIFIED decisions may leave — a decision recorded as an assumption
  // or inference stays internal with the rest of the soft memory.
  const allDecisions = memory.listEntries({ canvasId, kind: 'decision', limit: 200 })
    .filter((e) => e.epistemic === 'verified');
  const verifiedFacts = memory.listEntries({ canvasId, epistemic: 'verified', limit: 200 })
    .filter((e) => e.kind !== 'decision');
  const splitTainted = (list) => ({
    clean: list.filter((e) => !e.tainted && !taintedIds.has(e.id)),
    tainted: list.filter((e) => e.tainted || taintedIds.has(e.id)),
  });
  const decisions = splitTainted(allDecisions);
  const facts = splitTainted(verifiedFacts);
  const softMemory = memory.listEntries({ canvasId, limit: 200 })
    .filter((e) => e.epistemic !== 'verified');

  const refs = db.prepare(
    `SELECT er.* FROM evidence_refs er JOIN runs r ON r.id = er.run_id
     WHERE r.canvas_id = ? ORDER BY er.retrieved_at DESC LIMIT 200`
  ).all(canvasId);
  const publicRefs = refs.filter((r) => !PRIVATE_KINDS.has(r.source_kind));
  const privateRefs = refs.filter((r) => PRIVATE_KINDS.has(r.source_kind));

  const tasks = db.prepare("SELECT id, title, status, created_at FROM tasks WHERE canvas_id = ? ORDER BY created_at").all(canvasId);
  const openEscalations = db.prepare("SELECT id, question, created_at FROM escalations WHERE canvas_id = ? AND status = 'open'").all(canvasId);

  const manifest = {
    room,
    included: {
      decisions: decisions.clean,
      facts: facts.clean,
      evidence: publicRefs.map((r) => ({ id: r.id, sourceKind: r.source_kind, title: r.display_title, uri: r.uri, retrievedAt: r.retrieved_at })),
      tasks,
    },
    excluded: {
      assumptionsAndInferences: softMemory.map((e) => ({ id: e.id, epistemic: e.epistemic, content: e.content })),
      taintedEntries: [...decisions.tainted, ...facts.tainted].map((e) => ({ id: e.id, content: e.content })),
      privateEvidence: privateRefs.map((r) => ({ id: r.id, sourceKind: r.source_kind, title: r.display_title })),
      openEscalations,
      auditChain: 'always excluded',
    },
    generatedAt: new Date().toISOString(),
  };
  // The disclosure contract is content-addressed: the export endpoint only
  // ships the exact manifest the owner previewed. Any write landing between
  // preview and export changes the hash and forces a re-review.
  manifest.manifestHash = manifestHash(manifest);
  return manifest;
}

function manifestHash(manifest) {
  const stable = {
    decisions: manifest.included.decisions.map((d) => d.id),
    facts: manifest.included.facts.map((f) => f.id),
    evidence: manifest.included.evidence.map((e) => e.id),
    tasks: manifest.included.tasks.map((t) => `${t.id}:${t.status}`),
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Reviewed HTML output (PDF deferred until this contract is proven).
function renderExportHtml(manifest, exportedBy) {
  const { room, included } = manifest;
  const section = (title, items, render) => (items.length
    ? `<h2>${esc(title)}</h2><ul>${items.map(render).join('')}</ul>`
    : `<h2>${esc(title)}</h2><p class="dim">None.</p>`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(room.name)} — recommendation</title>
<style>
body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.5}
h1{font-size:26px;margin-bottom:4px} h2{font-size:16px;margin-top:28px;text-transform:uppercase;letter-spacing:.05em}
.meta{color:#666;font-size:13px} .dim{color:#888} li{margin:6px 0} .src{color:#666;font-size:12px}
</style></head><body>
<h1>${esc(room.name)}</h1>
<p class="meta">${esc(room.roomType)}${room.externalRef ? ` · ${esc(room.externalRef)}` : ''} · prepared ${esc(manifest.generatedAt)} by ${esc(exportedBy)}</p>
<p class="meta">Contains reviewed conclusions only. Sources and retrieval dates are stated per item.</p>
${section('Decisions', included.decisions, (d) => `<li>${esc(d.content)} <span class="src">— ${esc(d.author && d.author.name)}, ${esc(d.createdAt)}</span></li>`)}
${section('Verified findings', included.facts, (f) => `<li>${esc(f.content)} <span class="src">— ${esc(f.createdAt)}</span></li>`)}
${section('Evidence', included.evidence, (e) => `<li>${esc(e.title || e.uri || e.sourceKind)} <span class="src">— ${esc(e.sourceKind)}, retrieved ${esc(e.retrievedAt)}</span></li>`)}
${section('Work status', included.tasks, (t) => `<li>${esc(t.title)} <span class="src">— ${esc(t.status.replace('_', ' '))}</span></li>`)}
</body></html>`;
}

module.exports = { getRoom, listRooms, buildRoom, exportManifest, renderExportHtml, ROOM_TYPES, LENSES };

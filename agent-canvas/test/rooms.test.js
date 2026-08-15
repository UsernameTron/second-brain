'use strict';
// P3 Evidence Rooms: a Room is metadata over a restricted canvas; sections are
// read-time projections; refresh is one ask-mode run with recorded time+actor;
// archive flips room + canvas together and loses nothing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-rooms-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test'; // placeholder, never called

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');
const evidence = require('../server/evidence');
const runner = require('../server/orchestrator/runner');

// Refresh queues a real background run — stub the run loop's model.
runner._internal.setCallModel(async () => ({
  content: [{ type: 'text', text: 'stubbed refresh' }], stop_reason: 'end_turn', usage: {},
}));

const OWNER = 'pete@cloudtechgurus.com';
const VIEWER = 'jessica@cloudtechgurus.com';
const EDITOR = 'darren@cloudtechgurus.com';

let base;
let ownerCookie;
let viewerCookie;
let editorCookie;
let outsiderCookie;
let roomId;
let canvasId;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200, `dev sign-in failed for ${email}`);
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(cookie, method, apiPath, body) {
  const res = await fetch(`${base}${apiPath}`, {
    method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ownerCookie = await signIn(OWNER);
  for (const email of [VIEWER, EDITOR, 'fred@cloudtechgurus.com']) {
    assert.equal((await call(ownerCookie, 'POST', '/api/allowlist', { email, role: 'member' })).status, 200);
  }
  viewerCookie = await signIn(VIEWER);
  editorCookie = await signIn(EDITOR);
  outsiderCookie = await signIn('fred@cloudtechgurus.com');
});

test.after(() => server.close());

test('config exposes the rooms flag', async () => {
  const res = await fetch(`${base}/api/config`);
  assert.equal((await res.json()).rooms, true);
});

test('owner creates a room: restricted canvas + room row atomically; members only', async () => {
  const bad = await call(ownerCookie, 'POST', '/api/rooms', { name: 'X', room_type: 'party' });
  assert.equal(bad.status, 400);

  const created = await call(ownerCookie, 'POST', '/api/rooms', { name: 'Acme renewal', room_type: 'deal', external_ref: 'CRM-42' });
  assert.equal(created.status, 200);
  roomId = created.data.room.id;
  canvasId = created.data.room.canvasId;
  assert.equal(created.data.room.roomType, 'deal');
  assert.equal(db.prepare('SELECT access_mode FROM canvases WHERE id = ?').get(canvasId).access_mode, 'restricted');

  const memberDenied = await call(editorCookie, 'POST', '/api/rooms', { name: 'Nope', room_type: 'deal' });
  assert.equal(memberDenied.status, 403);
});

test('room visibility follows the canvas access model', async () => {
  assert.equal((await call(outsiderCookie, 'GET', `/api/rooms/${roomId}`)).status, 403);
  assert.equal((await call(outsiderCookie, 'GET', '/api/rooms')).data.rooms.length, 0);

  assert.equal((await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/members`, { email: VIEWER, access: 'view' })).status, 200);
  assert.equal((await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/members`, { email: EDITOR, access: 'edit' })).status, 200);

  const asViewer = await call(viewerCookie, 'GET', `/api/rooms/${roomId}`);
  assert.equal(asViewer.status, 200);
  assert.equal(asViewer.data.access, 'view');
  assert.equal((await call(viewerCookie, 'GET', '/api/rooms')).data.rooms.length, 1);
});

test('projection carries the six sections with source + freshness', async () => {
  // Seed one of everything the sections project.
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES ('agent-room-1', ?, 'Scout', 'research', ?)").run(canvasId, nowIso());
  db.prepare(`INSERT INTO runs (id, canvas_id, agent_id, status, trigger_kind, instruction, step_budget, wall_ms_budget, created_at, mode)
    VALUES ('run-room-1', ?, 'agent-room-1', 'completed', 'user', 'scout it', 10, 60000, ?, 'ask')`).run(canvasId, nowIso());
  const refId = evidence.recordRef({ runId: 'run-room-1', sourceKind: 'gmail', sourceId: 'msg-1', title: 'Renewal thread', uri: 'https://mail.example/msg-1', directedBy: OWNER });
  memory.writeEntry({ canvasId, content: 'We will renew at flat pricing', epistemic: 'verified', kind: 'decision', authorType: 'user', authorId: OWNER, authorName: 'Pete', source: 'test' });
  db.prepare(`INSERT INTO tasks (id, canvas_id, title, status, created_at, updated_at) VALUES ('task-room-1', ?, 'Draft renewal memo', 'todo', ?, ?)`).run(canvasId, nowIso(), nowIso());
  db.prepare(`INSERT INTO escalations (id, canvas_id, kind, question, context, status, created_at) VALUES ('esc-room-1', ?, 'question', 'Discount floor?', '{}', 'open', ?)`).run(canvasId, nowIso());

  const built = (await call(ownerCookie, 'GET', `/api/rooms/${roomId}`)).data;
  assert.equal(built.lens, 'now');
  assert.equal(built.sections.decisions.length, 1);
  assert.equal(built.sections.work.tasks.length, 1);
  assert.equal(built.sections.openQuestions.escalations.length, 1);
  assert.equal(built.sections.evidence.length, 1);
  assert.ok(built.sections.evidence[0].retrievedAt, 'evidence carries freshness');
  assert.equal(built.sections.evidence[0].uri, 'https://mail.example/msg-1'); // directing user sees the URI
  assert.ok(built.generatedAt);

  // Private-surface URI is redacted for a non-directing viewer.
  const asViewer = (await call(viewerCookie, 'GET', `/api/rooms/${roomId}`)).data;
  assert.equal(asViewer.sections.evidence[0].redacted, true);
  assert.equal(asViewer.sections.evidence[0].uri, '');
  assert.equal(asViewer.sections.evidence[0].title, 'Renewal thread'); // honest, not hidden
  void refId;
});

test('lenses filter the same projection', async () => {
  // history includes done tasks + non-open escalations; now excludes them.
  db.prepare("UPDATE tasks SET status = 'done' WHERE id = 'task-room-1'").run();
  const now = (await call(ownerCookie, 'GET', `/api/rooms/${roomId}?lens=now`)).data;
  assert.equal(now.sections.work.tasks.length, 0);
  const history = (await call(ownerCookie, 'GET', `/api/rooms/${roomId}?lens=history`)).data;
  assert.equal(history.sections.work.tasks.length, 1);

  const risk = (await call(ownerCookie, 'GET', `/api/rooms/${roomId}?lens=risk`)).data;
  assert.equal(risk.lens, 'risk');
  assert.ok(Array.isArray(risk.sections.risks));
  assert.ok(risk.sections.risks.some((r) => r.sourceRef && r.sourceRef.kind === 'escalation'), 'open escalation shows as a risk');
});

test('refresh dispatches one ask-mode run and records time + actor; view member 403', async () => {
  assert.equal((await call(viewerCookie, 'POST', `/api/rooms/${roomId}/refresh`, {})).status, 403);

  const refreshed = await call(editorCookie, 'POST', `/api/rooms/${roomId}/refresh`, {});
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.run.mode, 'ask');
  assert.equal(refreshed.data.room.refreshedBy, EDITOR);
  assert.ok(refreshed.data.room.refreshedAt);
  const rows = db.prepare('SELECT * FROM room_refreshes WHERE room_id = ?').all(roomId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, EDITOR);
  assert.equal(rows[0].run_id, refreshed.data.run.id);
});

test('export preview names what leaves and what stays; export is owner-only, audited, client-safe', async () => {
  // An assumption and a private-surface ref must land in `excluded`.
  memory.writeEntry({ canvasId, content: 'They probably churn without a discount', epistemic: 'assumption', authorType: 'user', authorId: OWNER, authorName: 'Pete', source: 'test' });
  evidence.recordRef({ runId: 'run-room-1', sourceKind: 'web', sourceId: 'https://acme.example', title: 'Acme pricing page', uri: 'https://acme.example/pricing', directedBy: OWNER });

  assert.equal((await call(viewerCookie, 'GET', `/api/rooms/${roomId}/export/preview`)).status, 403); // edit access required
  const preview = (await call(editorCookie, 'GET', `/api/rooms/${roomId}/export/preview`)).data;
  assert.equal(preview.included.decisions.length, 1);
  assert.equal(preview.included.evidence.length, 1); // web ref only
  assert.equal(preview.included.evidence[0].sourceKind, 'web');
  assert.ok(preview.excluded.privateEvidence.some((r) => r.sourceKind === 'gmail'), 'gmail ref stays internal');
  assert.ok(preview.excluded.assumptionsAndInferences.some((e) => e.epistemic === 'assumption'));
  assert.ok(preview.excluded.openEscalations.length >= 1);
  assert.equal(preview.excluded.auditChain, 'always excluded');

  assert.equal((await call(editorCookie, 'POST', `/api/rooms/${roomId}/export`, { manifest_hash: preview.manifestHash })).status, 403); // owner only

  // The export is bound to the reviewed manifest: no hash → 400, stale hash → 409.
  assert.equal((await call(ownerCookie, 'POST', `/api/rooms/${roomId}/export`)).status, 400);
  assert.equal((await call(ownerCookie, 'POST', `/api/rooms/${roomId}/export`, { manifest_hash: 'stale' })).status, 409);

  const res = await fetch(`${base}/api/rooms/${roomId}/export`, {
    method: 'POST', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest_hash: preview.manifestHash }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  const html = await res.text();
  assert.match(html, /We will renew at flat pricing/);
  assert.match(html, /Acme pricing page/);
  assert.ok(!html.includes('probably churn'), 'assumptions never leave');
  assert.ok(!html.includes('mail.example'), 'private URIs never leave');
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'room.export'").get().n >= 1);
});

test('archive is lossless and flips room + canvas together', async () => {
  assert.equal((await call(editorCookie, 'PATCH', `/api/rooms/${roomId}`, { lifecycle: 'archived' })).status, 403); // owner only
  const archived = await call(ownerCookie, 'PATCH', `/api/rooms/${roomId}`, { lifecycle: 'archived' });
  assert.equal(archived.status, 200);
  assert.equal(archived.data.room.lifecycle, 'archived');
  assert.equal(db.prepare('SELECT archived FROM canvases WHERE id = ?').get(canvasId).archived, 1);

  const list = (await call(ownerCookie, 'GET', '/api/rooms')).data;
  assert.equal(list.rooms.length, 0);
  assert.equal(list.archived.length, 1);

  // Lifecycle is DERIVED from canvases.archived — archiving via the canvas
  // route archives the room too, with no second flag to desync.
  db.prepare('UPDATE canvases SET archived = 0 WHERE id = ?').run(canvasId);
  assert.equal((await call(ownerCookie, 'GET', '/api/rooms')).data.rooms.length, 1);

  // Everything underneath survives; unarchive restores the projection whole.
  await call(ownerCookie, 'PATCH', `/api/rooms/${roomId}`, { lifecycle: 'active' });
  const back = (await call(ownerCookie, 'GET', `/api/rooms/${roomId}?lens=history`)).data;
  assert.equal(back.sections.decisions.length, 1);
  assert.equal(back.sections.work.tasks.length, 1);
  assert.equal(back.refreshes.length, 1);
});

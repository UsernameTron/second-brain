'use strict';
// User-managed notes are real working context: editors can create and update
// them, viewers cannot mutate them, and removal must immediately take the note
// out of both the UI read model and every agent's read_notes context. The row
// remains as a recoverable, audited tombstone in the operational ledger.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-notes-'));
process.env.DEV_AUTH = '1';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');
const { db } = require('../server/db');
const { executeTool } = require('../server/orchestrator/tools');

const OWNER = 'pete@cloudtechgurus.com';
const VIEWER = 'jessica@cloudtechgurus.com';

let base;
let ownerCookie;
let viewerCookie;
let canvasId;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200, `dev sign-in failed for ${email}`);
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(cookie, method, apiPath, body) {
  const res = await fetch(`${base}${apiPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function readNotesForAgent() {
  return executeTool('read_notes', {}, {
    run: { id: 'note-lifecycle-read', mode: 'ask' },
    agent: { name: 'Test reader', role: 'research', tools_json: '[]' },
    canvas: { id: canvasId },
  }).then((result) => {
    assert.equal(result.isError, undefined, result.content);
    return JSON.parse(result.content);
  });
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ownerCookie = await signIn(OWNER);

  const allow = await call(ownerCookie, 'POST', '/api/allowlist', { email: VIEWER, role: 'member' });
  assert.equal(allow.status, 200);
  viewerCookie = await signIn(VIEWER);

  const created = await call(ownerCookie, 'POST', '/api/canvases', { name: 'Note lifecycle' });
  assert.equal(created.status, 200);
  canvasId = created.data.canvas.id;
  assert.equal((await call(ownerCookie, 'PATCH', `/api/canvases/${canvasId}`, { access_mode: 'restricted' })).status, 200);
  assert.equal((await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/members`, {
    email: VIEWER,
    access: 'view',
  })).status, 200);
});

test.after(() => server.close());

test('view-only members can read notes but cannot create, update, or remove them', async () => {
  const created = await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/notes`, {
    title: 'Protected context',
    content: 'Owner-managed working context',
    pinned: false,
    x: 24,
    y: 48,
  });
  assert.equal(created.status, 200);
  const note = created.data.note;

  const read = await call(viewerCookie, 'GET', `/api/canvases/${canvasId}`);
  assert.equal(read.status, 200);
  assert.equal(read.data.notes.find((entry) => entry.id === note.id).content, 'Owner-managed working context');

  for (const attempt of [
    call(viewerCookie, 'POST', `/api/canvases/${canvasId}/notes`, { title: 'No', content: 'not allowed' }),
    call(viewerCookie, 'PUT', `/api/canvases/${canvasId}/notes/${note.id}`, { title: 'Changed', content: 'not allowed' }),
    call(viewerCookie, 'DELETE', `/api/canvases/${canvasId}/notes/${note.id}`),
  ]) {
    const denied = await attempt;
    assert.equal(denied.status, 403);
    assert.match(denied.data.error, /view-only/);
  }

  const unchanged = db.prepare('SELECT title, content, deleted_at FROM notes WHERE id = ?').get(note.id);
  assert.deepEqual(unchanged, {
    title: 'Protected context',
    content: 'Owner-managed working context',
    deleted_at: null,
  });
});

test('pinned-note removal is recoverable, audited, idempotent, and invisible to users and agents', async () => {
  const secretContent = 'Sensitive working context that must not enter the audit detail after removal.';
  const created = await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/notes`, {
    title: 'Temporary source',
    content: secretContent,
    pinned: true,
    x: 80,
    y: 120,
  });
  assert.equal(created.status, 200);
  const note = created.data.note;
  assert.equal(note.pinned, 1);
  assert.equal(note.version, 1);
  assert.equal(note.deleted_at, null);

  const before = await call(ownerCookie, 'GET', `/api/canvases/${canvasId}`);
  assert.equal(before.status, 200);
  assert.equal(before.data.notes.find((entry) => entry.id === note.id).content, secretContent);
  assert.ok((await readNotesForAgent()).some((entry) => entry.id === note.id), 'control: active note reaches read_notes');

  const removed = await call(ownerCookie, 'DELETE', `/api/canvases/${canvasId}/notes/${note.id}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.data.ok, true);
  assert.equal(removed.data.alreadyRemoved, undefined);
  assert.equal(removed.data.note.id, note.id);
  assert.ok(removed.data.note.deleted_at);

  const tombstone = db.prepare(
    'SELECT pinned, version, deleted_at, deleted_by, updated_by, content FROM notes WHERE id = ?'
  ).get(note.id);
  assert.equal(tombstone.pinned, 0, 'a removed note cannot remain injected as pinned context');
  assert.equal(tombstone.version, 2);
  assert.equal(tombstone.deleted_at, removed.data.note.deleted_at);
  assert.equal(tombstone.deleted_by, OWNER);
  assert.equal(tombstone.updated_by, OWNER);
  assert.equal(tombstone.content, secretContent, 'removal retains recoverable ledger content');

  const after = await call(ownerCookie, 'GET', `/api/canvases/${canvasId}`);
  assert.equal(after.status, 200);
  assert.ok(!after.data.notes.some((entry) => entry.id === note.id), 'canvas read model hides tombstones');
  assert.ok(!(await readNotesForAgent()).some((entry) => entry.id === note.id), 'read_notes excludes tombstones');

  const staleUpdate = await call(ownerCookie, 'PUT', `/api/canvases/${canvasId}/notes/${note.id}`, {
    content: 'must not resurrect',
    base_version: tombstone.version,
    base_content: secretContent,
  });
  assert.equal(staleUpdate.status, 404);

  const auditRows = db.prepare("SELECT actor_type, actor_id, detail FROM audit_log WHERE action = 'note.remove'").all()
    .map((row) => ({ ...row, detail: JSON.parse(row.detail) }))
    .filter((row) => row.detail.noteId === note.id);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].actor_type, 'user');
  assert.equal(auditRows[0].actor_id, OWNER);
  assert.deepEqual(auditRows[0].detail, {
    noteId: note.id,
    canvasId,
    title: 'Temporary source',
    wasPinned: true,
  });
  assert.ok(!JSON.stringify(auditRows[0].detail).includes(secretContent), 'audit metadata must not copy note content');

  const repeated = await call(ownerCookie, 'DELETE', `/api/canvases/${canvasId}/notes/${note.id}`);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.data.ok, true);
  assert.equal(repeated.data.alreadyRemoved, true);
  assert.equal(repeated.data.note.deleted_at, tombstone.deleted_at);

  const afterRepeat = db.prepare('SELECT pinned, version, deleted_at FROM notes WHERE id = ?').get(note.id);
  assert.deepEqual(afterRepeat, { pinned: 0, version: 2, deleted_at: tombstone.deleted_at });
  const removeAuditCount = db.prepare("SELECT detail FROM audit_log WHERE action = 'note.remove'").all()
    .map((row) => JSON.parse(row.detail))
    .filter((detail) => detail.noteId === note.id).length;
  assert.equal(removeAuditCount, 1, 'an idempotent repeat does not forge a second removal event');
});

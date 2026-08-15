'use strict';
// P2.1: view vs edit membership is enforced server-side. A 'view' member can
// read a restricted canvas but every mutation — requireCanvas routes and the
// direct-check routes (escalation assign/resolve, inquiry save, demo run) —
// answers 403. An 'edit' member can mutate.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-vea-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const { canAccessCanvas, canEditCanvas } = require('../server/auth');

const VIEWER = 'jessica@cloudtechgurus.com';
const EDITOR = 'darren@cloudtechgurus.com';

let base;
let ownerCookie;
let viewerCookie;
let editorCookie;
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

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ownerCookie = await signIn('pete@cloudtechgurus.com');

  for (const email of [VIEWER, EDITOR]) {
    const added = await call(ownerCookie, 'POST', '/api/allowlist', { email, role: 'member' });
    assert.equal(added.status, 200);
  }
  viewerCookie = await signIn(VIEWER);
  editorCookie = await signIn(EDITOR);

  const created = await call(ownerCookie, 'POST', '/api/canvases', { name: 'View/Edit' });
  canvasId = created.data.canvas.id;
  assert.equal((await call(ownerCookie, 'PATCH', `/api/canvases/${canvasId}`, { access_mode: 'restricted' })).status, 200);
  assert.equal((await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/members`, { email: VIEWER, access: 'view' })).status, 200);
  assert.equal((await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/members`, { email: EDITOR, access: 'edit' })).status, 200);
});

test.after(() => server.close());

test('canAccessCanvas reports the access level; canEditCanvas rejects view members', () => {
  assert.equal(canAccessCanvas({ email: 'pete@cloudtechgurus.com', role: 'owner' }, canvasId).access, 'edit');
  assert.equal(canAccessCanvas({ email: VIEWER, role: 'member' }, canvasId).access, 'view');
  assert.equal(canAccessCanvas({ email: EDITOR, role: 'member' }, canvasId).access, 'edit');
  const denied = canEditCanvas({ email: VIEWER, role: 'member' }, canvasId);
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.equal(canEditCanvas({ email: EDITOR, role: 'member' }, canvasId).ok, true);
});

test('member route rejects unknown access levels', async () => {
  const res = await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/members`, { email: VIEWER, access: 'admin' });
  assert.equal(res.status, 400);
});

test('view member can read the canvas but not mutate it', async () => {
  assert.equal((await call(viewerCookie, 'GET', `/api/canvases/${canvasId}`)).status, 200);
  const note = await call(viewerCookie, 'POST', `/api/canvases/${canvasId}/notes`, { text: 'nope', x: 0, y: 0 });
  assert.equal(note.status, 403);
  assert.match(note.data.error, /view-only/);
});

test('edit member can mutate', async () => {
  const note = await call(editorCookie, 'POST', `/api/canvases/${canvasId}/notes`, { text: 'yes', x: 0, y: 0 });
  assert.equal(note.status, 200);
});

test('escalation assign/resolve and inquiry save require edit access', async () => {
  db.prepare(`INSERT INTO escalations (id, canvas_id, kind, question, context, status, created_at)
    VALUES ('esc-vea-1', ?, 'question', 'q', '{}', 'open', ?)`).run(canvasId, nowIso());
  db.prepare(`INSERT INTO inquiries (id, canvas_id, question, requested_by, saved, created_at, updated_at)
    VALUES ('inq-vea-1', ?, 'q', 'pete@cloudtechgurus.com', 0, ?, ?)`).run(canvasId, nowIso(), nowIso());

  assert.equal((await call(viewerCookie, 'POST', '/api/escalations/esc-vea-1/assign', { owner_email: EDITOR })).status, 403);
  assert.equal((await call(viewerCookie, 'POST', '/api/escalations/esc-vea-1/resolve', { action: 'dismiss' })).status, 403);
  assert.equal((await call(viewerCookie, 'PATCH', '/api/inquiries/inq-vea-1', { saved: true })).status, 403);

  assert.equal((await call(editorCookie, 'PATCH', '/api/inquiries/inq-vea-1', { saved: true })).status, 200);
});

'use strict';
// Canvas archive: tidiness without destruction. Archived canvases leave
// everyone's switcher; the owner gets them back in a separate list and can
// restore them. Nothing is ever deleted — rows, memory, and audit lineage
// survive an archive/restore round trip. Only the owner can flip the flag.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-archive-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index'); // boots app + seeds allowlist/canvases
const { db } = require('../server/db');

let base;
let ownerCookie;
let memberCookie;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200, `dev sign-in failed for ${email}`);
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(method, apiPath, cookie, body) {
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
  memberCookie = await signIn('fred@cloudtechgurus.com');
});

test.after(() => new Promise((resolve) => server.close(resolve)));

let canvasId;

test('any member can create a canvas; it appears in everyone\'s switcher', async () => {
  const created = await call('POST', '/api/canvases', memberCookie, { name: 'Q3 Pipeline' });
  assert.equal(created.status, 200);
  canvasId = created.data.canvas.id;
  assert.equal(created.data.canvas.archived, 0);

  const list = await call('GET', '/api/canvases', ownerCookie);
  assert.ok(list.data.canvases.some((c) => c.id === canvasId));
});

test('a member cannot archive — owner only', async () => {
  const denied = await call('PATCH', `/api/canvases/${canvasId}`, memberCookie, { archived: true });
  assert.equal(denied.status, 403);
});

test('owner archives: gone from the member switcher, listed for the owner, nothing deleted', async () => {
  const ok = await call('PATCH', `/api/canvases/${canvasId}`, ownerCookie, { archived: true });
  assert.equal(ok.status, 200);

  const memberList = await call('GET', '/api/canvases', memberCookie);
  assert.ok(!memberList.data.canvases.some((c) => c.id === canvasId), 'archived canvas leaked into member switcher');
  assert.deepEqual(memberList.data.archived, [], 'members must not receive the archived list');

  const ownerList = await call('GET', '/api/canvases', ownerCookie);
  assert.ok(!ownerList.data.canvases.some((c) => c.id === canvasId));
  assert.ok(ownerList.data.archived.some((c) => c.id === canvasId), 'owner should see it under archived');

  // Destroy never: the row is still there, flagged, with an audit trail.
  const row = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
  assert.equal(row.archived, 1);
  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'canvas.archive' ORDER BY seq DESC LIMIT 1").get();
  assert.ok(auditRow, 'archive must be audited');
});

test('owner restores: back in the switcher for everyone', async () => {
  const ok = await call('PATCH', `/api/canvases/${canvasId}`, ownerCookie, { archived: false });
  assert.equal(ok.status, 200);
  const memberList = await call('GET', '/api/canvases', memberCookie);
  assert.ok(memberList.data.canvases.some((c) => c.id === canvasId));
});

test('patch validation: all-or-nothing, no half-applied updates', async () => {
  const empty = await call('PATCH', `/api/canvases/${canvasId}`, ownerCookie, {});
  assert.equal(empty.status, 400);

  const badType = await call('PATCH', `/api/canvases/${canvasId}`, ownerCookie, { archived: 'yes' });
  assert.equal(badType.status, 400);

  // Valid archived + invalid access_mode must apply NEITHER.
  const mixed = await call('PATCH', `/api/canvases/${canvasId}`, ownerCookie, { archived: true, access_mode: 'sideways' });
  assert.equal(mixed.status, 400);
  const row = db.prepare('SELECT archived FROM canvases WHERE id = ?').get(canvasId);
  assert.equal(row.archived, 0, 'invalid mixed patch must not half-apply');

  const badMode = await call('PATCH', '/api/canvases/does-not-exist', ownerCookie, { archived: true });
  assert.equal(badMode.status, 404);
});

test('access_mode still works through the extended patch', async () => {
  const ok = await call('PATCH', `/api/canvases/${canvasId}`, ownerCookie, { access_mode: 'restricted' });
  assert.equal(ok.status, 200);
  // fred is not a member of the restricted canvas — it leaves his switcher too
  const memberList = await call('GET', '/api/canvases', memberCookie);
  assert.ok(!memberList.data.canvases.some((c) => c.id === canvasId));
  const back = await call('PATCH', `/api/canvases/${canvasId}`, ownerCookie, { access_mode: 'workspace' });
  assert.equal(back.status, 200);
});

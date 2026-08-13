'use strict';
// Server-side authorization: per-canvas access and role checks are decided by
// the server from the database, never by the client.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-access-'));

const { db, nowIso } = require('../server/db');
const { canAccessCanvas } = require('../server/auth');

db.prepare("INSERT INTO canvases (id, name, access_mode, created_at) VALUES ('c-open', 'Open', 'workspace', ?)").run(nowIso());
db.prepare("INSERT INTO canvases (id, name, access_mode, created_at) VALUES ('c-restricted', 'Secret', 'restricted', ?)").run(nowIso());
db.prepare("INSERT INTO canvas_members (canvas_id, user_email, access) VALUES ('c-restricted', 'jessica@cloudtechgurus.com', 'edit')").run();

const owner = { email: 'pete@cloudtechgurus.com', role: 'owner' };
const memberIn = { email: 'jessica@cloudtechgurus.com', role: 'member' };
const memberOut = { email: 'darren@cloudtechgurus.com', role: 'member' };

test('workspace canvases are visible to all members', () => {
  assert.equal(canAccessCanvas(memberOut, 'c-open').ok, true);
});

test('restricted canvases: members only when listed; owner always; others 403', () => {
  assert.equal(canAccessCanvas(memberIn, 'c-restricted').ok, true);
  assert.equal(canAccessCanvas(owner, 'c-restricted').ok, true);
  const denied = canAccessCanvas(memberOut, 'c-restricted');
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
});

test('unknown canvas is 404, not an information leak about access', () => {
  const missing = canAccessCanvas(owner, 'nope');
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);
});

'use strict';
// P2 T1: people cards + human assignment. canvas_people is presentation-only
// (identity stays in the allowlist — unlisted emails are refused), tasks and
// escalations become assignable to a person OR an agent (never both), and
// assignment routes attention without resolving anything.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-people-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const { createEscalation } = require('../server/orchestrator/tools');

let base;
let cookie;
let canvasId;
let agentId;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200, `dev sign-in failed for ${email}`);
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(method, apiPath, body) {
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
  cookie = await signIn('pete@cloudtechgurus.com');
  const created = await call('POST', '/api/canvases', { name: 'People T1' });
  canvasId = created.data.canvas.id;
  agentId = 'agent-people-1';
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)")
    .run(agentId, canvasId, nowIso());
  const added = await call('POST', '/api/allowlist', { email: 'darren@cloudtechgurus.com', display_name: 'Darren' });
  assert.equal(added.status, 200);
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('person card: allowlisted email creates, unlisted refuses, duplicate 409s', async () => {
  const ok = await call('POST', `/api/canvases/${canvasId}/people`, { email: 'darren@cloudtechgurus.com', display: 'Darren' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.person.email, 'darren@cloudtechgurus.com');

  const unlisted = await call('POST', `/api/canvases/${canvasId}/people`, { email: 'stranger@cloudtechgurus.com' });
  assert.equal(unlisted.status, 400);
  assert.match(unlisted.data.error, /allowlist/);

  const dup = await call('POST', `/api/canvases/${canvasId}/people`, { email: 'DARREN@cloudtechgurus.com' });
  assert.equal(dup.status, 409);

  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'person.create' ORDER BY rowid DESC LIMIT 1").get();
  assert.ok(auditRow, 'person.create is audited');
});

test('people ride the canvas state payload and the positions endpoint accepts kind=person', async () => {
  const state = await call('GET', `/api/canvases/${canvasId}`);
  assert.equal(state.status, 200);
  assert.equal(state.data.people.length, 1);
  const personId = state.data.people[0].id;

  const moved = await call('POST', `/api/canvases/${canvasId}/positions`, { kind: 'person', id: personId, x: 42, y: 24 });
  assert.equal(moved.status, 200);
  const row = db.prepare('SELECT x, y FROM canvas_people WHERE id = ?').get(personId);
  assert.equal(row.x, 42);
  assert.equal(row.y, 24);
});

test('task assignment: person or agent round-trips, unlisted email refused, off-canvas agent refused', async () => {
  const created = await call('POST', `/api/canvases/${canvasId}/tasks`, { title: 'Own this' });
  const taskId = created.data.task.id;

  const toPerson = await call('PATCH', `/api/canvases/${canvasId}/tasks/${taskId}`, { assignee_email: 'darren@cloudtechgurus.com', assignee_agent_id: null });
  assert.equal(toPerson.status, 200);
  assert.equal(toPerson.data.task.assignee_email, 'darren@cloudtechgurus.com');
  assert.equal(toPerson.data.task.assignee_agent_id, null);

  // The pre-P2 PATCH could not change assignee_agent_id at all — prove it can now.
  const toAgent = await call('PATCH', `/api/canvases/${canvasId}/tasks/${taskId}`, { assignee_agent_id: agentId, assignee_email: null });
  assert.equal(toAgent.status, 200);
  assert.equal(toAgent.data.task.assignee_agent_id, agentId);
  assert.equal(toAgent.data.task.assignee_email, null);

  const badEmail = await call('PATCH', `/api/canvases/${canvasId}/tasks/${taskId}`, { assignee_email: 'ghost@cloudtechgurus.com' });
  assert.equal(badEmail.status, 400);

  const badAgent = await call('PATCH', `/api/canvases/${canvasId}/tasks/${taskId}`, { assignee_agent_id: 'not-on-this-canvas' });
  assert.equal(badAgent.status, 400);

  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'task.update' ORDER BY rowid DESC LIMIT 1").get();
  assert.ok(auditRow, 'task.update is audited');
});

test('escalation assign: person or agent (not both), due date validated, open-only, audited', async () => {
  const esc = createEscalation({
    canvasId, runId: null, agentId, kind: 'question',
    question: 'Who owns this?', context: { entry_ids: [] },
  });

  const both = await call('POST', `/api/escalations/${esc.id}/assign`, { owner_email: 'darren@cloudtechgurus.com', owner_agent_id: agentId });
  assert.equal(both.status, 400);

  const badDue = await call('POST', `/api/escalations/${esc.id}/assign`, { owner_email: 'darren@cloudtechgurus.com', due_at: 'not-a-date' });
  assert.equal(badDue.status, 400);

  const ok = await call('POST', `/api/escalations/${esc.id}/assign`, { owner_email: 'darren@cloudtechgurus.com', due_at: '2026-08-20T00:00:00.000Z' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.escalation.owner_email, 'darren@cloudtechgurus.com');
  assert.equal(ok.data.escalation.due_at, '2026-08-20T00:00:00.000Z');

  // Reassigning to an agent clears the person owner.
  const toAgent = await call('POST', `/api/escalations/${esc.id}/assign`, { owner_agent_id: agentId });
  assert.equal(toAgent.status, 200);
  assert.equal(toAgent.data.escalation.owner_agent_id, agentId);
  assert.equal(toAgent.data.escalation.owner_email, null);

  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'escalation.assign' ORDER BY rowid DESC LIMIT 1").get();
  assert.ok(auditRow, 'escalation.assign is audited');

  // Assignment never resolves: the escalation is still open and resolvable.
  const resolved = await call('POST', `/api/escalations/${esc.id}/resolve`, { action: 'dismiss' });
  assert.equal(resolved.status, 200);

  const afterResolve = await call('POST', `/api/escalations/${esc.id}/assign`, { owner_email: 'darren@cloudtechgurus.com' });
  assert.equal(afterResolve.status, 409, 'only open escalations can be assigned');
});

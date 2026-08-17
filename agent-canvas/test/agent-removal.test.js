'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-remove-agent-'));
process.env.DEV_AUTH = '1';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const control = require('../server/orchestrator/control');
const { dispatchRun } = require('../server/orchestrator/queue');

const OWNER = 'pete@cloudtechgurus.com';
const VIEWER = 'jessica@cloudtechgurus.com';
let base;
let ownerCookie;
let viewerCookie;
let canvasId;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
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
  assert.equal((await call(ownerCookie, 'POST', '/api/allowlist', { email: VIEWER, role: 'member' })).status, 200);
  viewerCookie = await signIn(VIEWER);
  const created = await call(ownerCookie, 'POST', '/api/canvases', { name: 'Agent removal' });
  canvasId = created.data.canvas.id;
  assert.equal((await call(ownerCookie, 'PATCH', `/api/canvases/${canvasId}`, { access_mode: 'restricted' })).status, 200);
  assert.equal((await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/members`, { email: VIEWER, access: 'view' })).status, 200);
});

test.after(() => {
  if (control.isPaused()) control.setPaused(false, OWNER);
  server.close();
});

test('agent removal is edit-only, stops work, preserves history, and is idempotent', async () => {
  const created = await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/agents`, {
    name: 'Temporary agent', role: 'research', system_prompt: 'Temporary prompt',
  });
  assert.equal(created.status, 200);
  const agent = created.data.agent;

  const denied = await call(viewerCookie, 'DELETE', `/api/canvases/${canvasId}/agents/${agent.id}`);
  assert.equal(denied.status, 403);
  assert.match(denied.data.error, /view-only/);

  const ruleId = crypto.randomUUID();
  const ts = nowIso();
  db.prepare(`INSERT INTO standing_rules
    (id, canvas_id, agent_id, owner_email, instruction, interpretation_json, category, source_scope_json,
     output_type, cadence, cadence_hour, state, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '{}', 'watch', '{}', 'alert', 'daily', 8, 'draft', ?, ?, ?)`)
    .run(ruleId, canvasId, agent.id, OWNER, 'Watch this', OWNER, ts, ts);
  const blocked = await call(ownerCookie, 'DELETE', `/api/canvases/${canvasId}/agents/${agent.id}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /standing rule/);
  assert.equal(db.prepare('SELECT lifecycle FROM agents WHERE id = ?').get(agent.id).lifecycle, 'active');
  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(ruleId);

  control.setPaused(true, OWNER);
  const queued = dispatchRun({ agentId: agent.id, canvasId, instruction: 'Queued work', actor: OWNER, initiatedBy: OWNER });
  const running = dispatchRun({ agentId: agent.id, canvasId, instruction: 'Running work', actor: OWNER, initiatedBy: OWNER });
  db.prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?").run(nowIso(), running.id);

  const removed = await call(ownerCookie, 'DELETE', `/api/canvases/${canvasId}/agents/${agent.id}`);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.data.stopped, { queued: 1, running: 1 });
  assert.equal(removed.data.agent.lifecycle, 'retired');
  assert.equal(removed.data.agent.retired_by, OWNER);
  assert.ok(removed.data.agent.retired_at);

  for (const runId of [queued.id, running.id]) {
    const run = db.prepare('SELECT status, error, ended_at FROM runs WHERE id = ?').get(runId);
    assert.equal(run.status, 'failed');
    assert.equal(run.error, 'agent removed from canvas');
    assert.ok(run.ended_at);
  }
  control.setPaused(false, OWNER);

  const canvas = await call(ownerCookie, 'GET', `/api/canvases/${canvasId}`);
  assert.ok(!canvas.data.agents.some((row) => row.id === agent.id));
  assert.equal((await call(ownerCookie, 'PATCH', `/api/canvases/${canvasId}/agents/${agent.id}`, { name: 'Resurrected' })).status, 404);
  assert.equal((await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/agents/${agent.id}/resync`)).status, 404);
  assert.throws(
    () => dispatchRun({ agentId: agent.id, canvasId, instruction: 'Must not run', actor: OWNER, initiatedBy: OWNER }),
    /removed from the canvas/,
  );

  const history = db.prepare('SELECT name, system_prompt, lifecycle, retired_by FROM agents WHERE id = ?').get(agent.id);
  assert.deepEqual(history, { name: 'Temporary agent', system_prompt: 'Temporary prompt', lifecycle: 'retired', retired_by: OWNER });
  const auditRows = db.prepare("SELECT detail FROM audit_log WHERE action = 'agent.remove'").all()
    .map((row) => JSON.parse(row.detail)).filter((detail) => detail.agentId === agent.id);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].queuedRunsStopped, 1);
  assert.equal(auditRows[0].runningRunsStopped, 1);
  assert.ok(!JSON.stringify(auditRows[0]).includes('Temporary prompt'));

  const repeated = await call(ownerCookie, 'DELETE', `/api/canvases/${canvasId}/agents/${agent.id}`);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.data.alreadyRemoved, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.remove'").get().n, 1);
});

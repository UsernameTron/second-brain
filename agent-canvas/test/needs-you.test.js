'use strict';
// P2 T3 server half: the needs_you flag (default on, reversible via
// setSetting), run retry (new run, mode/lineage inherited, terminal-only,
// audited), and memory re-affirmation (append-only, fresh review date).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-ny-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');
const { db, nowIso, setSetting } = require('../server/db');
const memory = require('../server/memory');

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

function insertRun(id, status, { mode = 'act', initiatedBy = null } = {}) {
  db.prepare(`INSERT INTO runs (id, canvas_id, agent_id, status, trigger_kind, instruction, step_budget, wall_ms_budget, created_at, initiated_by, mode)
    VALUES (?, ?, ?, ?, 'user', 'find the tier for Acme', 10, 60000, ?, ?, ?)`)
    .run(id, canvasId, agentId, status, nowIso(), initiatedBy, mode);
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn('pete@cloudtechgurus.com');
  const created = await call('POST', '/api/canvases', { name: 'NeedsYou T3' });
  canvasId = created.data.canvas.id;
  agentId = 'agent-ny-1';
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)")
    .run(agentId, canvasId, nowIso());
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('needs_you flag defaults on and reverts with setSetting, no deploy', async () => {
  const on = await call('GET', '/api/config');
  assert.equal(on.data.needsYou, true);
  setSetting('needs_you', '0');
  const off = await call('GET', '/api/config');
  assert.equal(off.data.needsYou, false);
  setSetting('needs_you', '1');
});

test('retry dispatches a NEW run inheriting mode via parentRunId, audited', async () => {
  insertRun('run-ny-failed', 'failed', { mode: 'ask', initiatedBy: 'someone-else@cloudtechgurus.com' });
  const res = await call('POST', `/api/canvases/${canvasId}/runs/run-ny-failed/retry`, {});
  assert.equal(res.status, 200);
  const retry = db.prepare('SELECT * FROM runs WHERE id = ?').get(res.data.run.id);
  assert.notEqual(retry.id, 'run-ny-failed');
  assert.equal(retry.parent_run_id, 'run-ny-failed');
  assert.equal(retry.mode, 'ask', 'retrying an ask run must not produce an act run');
  assert.equal(retry.initiated_by, 'pete@cloudtechgurus.com', 'workspace identity is the human clicking retry');
  assert.equal(retry.instruction, 'find the tier for Acme');
  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'run.retry' ORDER BY rowid DESC LIMIT 1").get();
  assert.ok(auditRow, 'run.retry is audited');
});

test('retry refuses active runs and unknown runs', async () => {
  insertRun('run-ny-running', 'running');
  const active = await call('POST', `/api/canvases/${canvasId}/runs/run-ny-running/retry`, {});
  assert.equal(active.status, 409);
  const missing = await call('POST', `/api/canvases/${canvasId}/runs/nope/retry`, {});
  assert.equal(missing.status, 404);
});

test('reaffirm supersedes with identical content and a fresh review date', async () => {
  const entry = memory.writeEntry({
    canvasId, content: 'Assume the Q3 price list still applies.', epistemic: 'assumption',
    authorType: 'user', authorId: 'pete@cloudtechgurus.com', reviewAt: '2020-01-01T00:00:00.000Z',
  });
  const newDate = '2026-09-15T00:00:00.000Z';
  const res = await call('POST', `/api/canvases/${canvasId}/memory/${entry.id}/reaffirm`, { review_at: newDate });
  assert.equal(res.status, 200);
  assert.equal(res.data.entry.content, entry.content, 'content unchanged — a re-affirmation, not an edit');
  assert.equal(res.data.entry.reviewAt, newDate);
  assert.equal(res.data.entry.supersedes, entry.id, 'append-only: the old entry is superseded, never edited');
  const old = db.prepare('SELECT superseded_by FROM memory_entries WHERE id = ?').get(entry.id);
  assert.equal(old.superseded_by, res.data.entry.id);

  const bad = await call('POST', `/api/canvases/${canvasId}/memory/${res.data.entry.id}/reaffirm`, { review_at: 'garbage' });
  assert.equal(bad.status, 400);
});

test('the correct route can replace or clear review_at (P1 fix from #182 review)', async () => {
  const entry = memory.writeEntry({
    canvasId, content: 'Old pricing assumption.', epistemic: 'assumption',
    authorType: 'user', authorId: 'pete@cloudtechgurus.com', reviewAt: '2020-01-01T00:00:00.000Z',
  });
  const res = await call('POST', `/api/canvases/${canvasId}/memory/${entry.id}/correct`, {
    content: 'New pricing confirmed for Q4.', epistemic: 'verified', reason: 'updated', review_at: '2099-01-01T00:00:00.000Z',
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.entry.reviewAt, '2099-01-01T00:00:00.000Z', 'correction must not inherit the overdue date when given a new one');

  const cleared = await call('POST', `/api/canvases/${canvasId}/memory/${res.data.entry.id}/correct`, {
    content: 'Pricing is a standing decision now.', epistemic: 'verified', reason: 'promoted', review_at: null,
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.entry.reviewAt, null);

  const bad = await call('POST', `/api/canvases/${canvasId}/memory/${cleared.data.entry.id}/correct`, {
    content: 'x', epistemic: 'verified', review_at: 'garbage',
  });
  assert.equal(bad.status, 400);
});

test('a reaffirmed entry leaves the overdue-review attention list', async () => {
  const entry = memory.writeEntry({
    canvasId, content: 'Assume Fred signs off by Friday.', epistemic: 'assumption',
    authorType: 'user', authorId: 'pete@cloudtechgurus.com', reviewAt: '2020-01-01T00:00:00.000Z',
  });
  const before = await call('GET', `/api/attention?canvas_id=${canvasId}`);
  assert.ok(before.data.attention.some((r) => r.type === 'overdue_review' && r.sourceRef.id === entry.id));

  await call('POST', `/api/canvases/${canvasId}/memory/${entry.id}/reaffirm`, { review_at: '2099-01-01T00:00:00.000Z' });
  const after = await call('GET', `/api/attention?canvas_id=${canvasId}`);
  assert.ok(!after.data.attention.some((r) => r.type === 'overdue_review' && r.sourceRef.id === entry.id),
    'superseded old entry and future-dated new entry both drop out');
});

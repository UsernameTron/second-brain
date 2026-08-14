'use strict';
// Wave 2: escalation capture. The server — not the resumed agent — records the
// human decision as verified memory under the human's identity, the resumed
// run inherits lineage (decision entry + the escalating agent's context
// entries), a blank answer is refused instead of silently no-opping, and a
// redirect target must live on the escalation's canvas.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-esc-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');
const { createEscalation } = require('../server/orchestrator/tools');

let base;
let cookie;

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

let canvasId;
let agentId;

function newEscalation(contextEntryIds = []) {
  return createEscalation({
    canvasId, runId: null, agentId, kind: 'question',
    question: 'Which tier is Company Z?',
    context: { detail: 'test', entry_ids: contextEntryIds, item_key: '' },
  });
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn('pete@cloudtechgurus.com');
  const created = await call('POST', '/api/canvases', { name: 'Escalation Capture' });
  canvasId = created.data.canvas.id;
  agentId = 'agent-esc-1';
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)")
    .run(agentId, canvasId, nowIso());
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('blank answer on accept is a 400 and the escalation stays open (was: silent no-op)', async () => {
  const esc = newEscalation();
  const res = await call('POST', `/api/escalations/${esc.id}/resolve`, { action: 'accept', answer: '   ' });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /answer required/);
  const row = db.prepare('SELECT status FROM escalations WHERE id = ?').get(esc.id);
  assert.equal(row.status, 'open');
});

test('redirect to an agent on another canvas is a 400, not an in-tx 404', async () => {
  const esc = newEscalation();
  db.prepare("INSERT INTO canvases (id, name, created_at) VALUES ('canvas-other', 'Other', ?)").run(nowIso());
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES ('agent-foreign', 'canvas-other', 'Alien', 'research', ?)")
    .run(nowIso());
  const res = await call('POST', `/api/escalations/${esc.id}/resolve`, {
    action: 'redirect', target_agent_id: 'agent-foreign', answer: 'ask the other one',
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /canvas/);
  assert.equal(db.prepare('SELECT status FROM escalations WHERE id = ?').get(esc.id).status, 'open');
});

test('resolve writes the verified decision entry under the human identity and resumes with lineage', async () => {
  const ctx = memory.writeEntry({
    canvasId, content: 'Company Z has 250 employees per registry', epistemic: 'inference',
    authorType: 'agent', authorId: agentId, authorName: 'Scout', source: 'registry',
  });
  const esc = newEscalation([ctx.id]);
  const res = await call('POST', `/api/escalations/${esc.id}/resolve`, {
    action: 'accept', answer: 'Mid-market tier. Use the 250-seat banding.',
  });
  assert.equal(res.status, 200);
  assert.ok(res.data.run && res.data.run.id, 'a resume run was dispatched');

  // The verified entry is authored by the human, not the agent.
  const decision = db.prepare(
    "SELECT * FROM memory_entries WHERE source = ? ORDER BY created_at DESC"
  ).get(`escalation ${esc.id} resolution`);
  assert.ok(decision, 'decision entry written');
  assert.equal(decision.epistemic, 'verified');
  assert.equal(decision.author_type, 'user');
  assert.equal(decision.author_id, 'pete@cloudtechgurus.com');
  assert.match(decision.content, /Mid-market tier/);

  // The resumed run inherits lineage: decision entry + escalation context entries.
  const reads = db.prepare('SELECT entry_id FROM run_reads WHERE run_id = ?').all(res.data.run.id).map((r) => r.entry_id);
  assert.ok(reads.includes(decision.id), 'run reads include the decision entry');
  assert.ok(reads.includes(ctx.id), 'run reads include the escalation context entries (previously dropped)');

  // The resume instruction no longer asks the agent to author the verified entry.
  const run = db.prepare('SELECT instruction FROM runs WHERE id = ?').get(res.data.run.id);
  assert.match(run.instruction, /already recorded as verified memory/);
  assert.doesNotMatch(run.instruction, /record it in memory as a "verified" entry/);
});

test('dismiss still works without an answer', async () => {
  const esc = newEscalation();
  const res = await call('POST', `/api/escalations/${esc.id}/resolve`, { action: 'dismiss' });
  assert.equal(res.status, 200);
  assert.equal(db.prepare('SELECT status FROM escalations WHERE id = ?').get(esc.id).status, 'dismissed');
  // No decision entry for a dismissal — transient choices are not institutional knowledge.
  const decision = db.prepare('SELECT COUNT(*) n FROM memory_entries WHERE source = ?').get(`escalation ${esc.id} resolution`);
  assert.equal(decision.n, 0);
});

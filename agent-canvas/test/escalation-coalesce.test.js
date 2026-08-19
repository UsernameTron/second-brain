'use strict';
// One open escalation per stuck run family: a handoff chain that stalls used
// to raise a separate card at every leg (five cards for one missing article,
// 2026-08-18). Sibling escalations now fold into the family's first open one.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-coalesce-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const { createEscalation } = require('../server/orchestrator/tools');

let base; let cookie; let canvasId;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}

function insertRun(id, parentId) {
  db.prepare(`INSERT INTO runs (id, canvas_id, agent_id, status, trigger_kind, instruction, step_budget, wall_ms_budget, created_at, parent_run_id)
    VALUES (?, ?, 'agent-co-1', 'running', 'user', 'rewrite the article', 10, 60000, ?, ?)`)
    .run(id, canvasId, nowIso(), parentId || null);
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn('pete@cloudtechgurus.com');
  const res = await fetch(`${base}/api/canvases`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ name: 'Coalesce' }),
  });
  canvasId = (await res.json()).canvas.id;
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES ('agent-co-1', ?, 'Quill', 'content', ?)").run(canvasId, nowIso());
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES ('agent-co-2', ?, 'Scout', 'research', ?)").run(canvasId, nowIso());
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('escalations from one handoff family fold into a single open card', () => {
  insertRun('run-co-parent');            // Quill's run
  insertRun('run-co-child', 'run-co-parent');   // Scout's handoff child
  insertRun('run-co-grand', 'run-co-child');    // a retry of the child

  const first = createEscalation({ canvasId, runId: 'run-co-child', agentId: 'agent-co-2', kind: 'question', question: 'Scout could not fetch the article.', context: {} });
  const second = createEscalation({ canvasId, runId: 'run-co-parent', agentId: 'agent-co-1', kind: 'question', question: 'Quill could not finish the rewrite.', context: {} });
  const third = createEscalation({ canvasId, runId: 'run-co-grand', agentId: 'agent-co-2', kind: 'steps', question: 'Retry ran out of steps.', context: {} });

  assert.equal(second.id, first.id, 'the parent-leg escalation folds into the first');
  assert.equal(third.id, first.id, 'a grandchild-leg escalation folds too');
  const rows = db.prepare("SELECT * FROM escalations WHERE canvas_id = ? AND status = 'open'").all(canvasId);
  assert.equal(rows.length, 1, 'one open card for the whole family');
  const ctx = JSON.parse(rows[0].context);
  assert.equal(ctx.updates.length, 2, 'later questions preserved as updates');
  assert.match(ctx.updates[0].question, /could not finish/);

  // Resolving the card ends the family; the NEXT stuck attempt is new news.
  db.prepare("UPDATE escalations SET status = 'resolved' WHERE id = ?").run(first.id);
  const fresh = createEscalation({ canvasId, runId: 'run-co-child', agentId: 'agent-co-2', kind: 'question', question: 'Still cannot fetch after the fix.', context: {} });
  assert.notEqual(fresh.id, first.id, 'a resolved family does not swallow new escalations');

  // Run-less escalations never coalesce.
  const manual = createEscalation({ canvasId, runId: null, agentId: null, kind: 'question', question: 'Unrelated human question.', context: {} });
  assert.notEqual(manual.id, fresh.id);
});

test('unrelated runs do not coalesce', () => {
  insertRun('run-co-solo-a');
  insertRun('run-co-solo-b');
  const a = createEscalation({ canvasId, runId: 'run-co-solo-a', agentId: 'agent-co-1', kind: 'question', question: 'A?', context: {} });
  const b = createEscalation({ canvasId, runId: 'run-co-solo-b', agentId: 'agent-co-1', kind: 'question', question: 'B?', context: {} });
  assert.notEqual(a.id, b.id);
});

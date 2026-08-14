'use strict';
// Wave 1: the Context Receipt. A run's receipt separates what was PROVIDED
// before it began (handoff payloads, escalation lineage), what it RETRIEVED
// via memory_search (query, rank, score — logged in memory_retrievals), and
// what it CITED (wrote to memory). Feedback is a human verdict on the run,
// stored as evidence about performance — never as truth.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-receipt-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');
const { executeTool } = require('../server/orchestrator/tools');

let base;
let cookie;
let canvasId;
const AGENT = 'agent-receipt-1';
const RUN = 'run-receipt-1';

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
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
  const created = await call('POST', '/api/canvases', { name: 'Receipt Canvas' });
  canvasId = created.data.canvas.id;
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)")
    .run(AGENT, canvasId, nowIso());
  db.prepare(
    `INSERT INTO runs (id, agent_id, canvas_id, trigger_kind, instruction, status, step_budget, wall_ms_budget, created_at, initiated_by)
     VALUES (?, ?, ?, 'user', 'test the receipt', 'completed', 12, 240000, ?, 'pete@cloudtechgurus.com')`
  ).run(RUN, AGENT, canvasId, nowIso());
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('receipt separates provided, retrieved (with query/rank/score), and cited', async () => {
  // PROVIDED: attached before start, the handoff/escalation path — run_reads only.
  // NOTE: provided is computed as run_reads minus retrievals, so an entry the
  // run ALSO retrieves later shows as retrieved, not provided. Keep this
  // fixture's content disjoint from the search query.
  const provided = memory.writeEntry({
    canvasId, content: 'handoff payload: budget approved for the pilot', epistemic: 'verified',
    authorType: 'user', authorId: 'pete@cloudtechgurus.com', source: 'handoff',
  });
  memory.recordRunReads(RUN, [provided.id]);

  // RETRIEVED: the run searches memory mid-run.
  const searchable = memory.writeEntry({
    canvasId, content: 'acme corp runs a 400 seat contact center', epistemic: 'inference',
    authorType: 'agent', authorId: AGENT, source: 'research',
  });
  const ctx = { run: { id: RUN, initiated_by: 'pete@cloudtechgurus.com' }, agent: { id: AGENT, name: 'Scout', role: 'research' }, canvas: { id: canvasId } };
  const searchRes = await executeTool('memory_search', { query: 'acme corp seat count' }, ctx);
  assert.ok(!searchRes.isError);

  // CITED: the run writes a conclusion citing what it retrieved.
  const written = memory.writeEntry({
    canvasId, content: 'acme corp is mid-market', epistemic: 'inference',
    authorType: 'agent', authorId: AGENT, source: 'derived', runId: RUN, cites: [searchable.id],
  });

  const { status, data } = await call('GET', `/api/canvases/${canvasId}/runs/${RUN}/receipt`);
  assert.equal(status, 200);

  // provided: run_reads with no retrieval record
  assert.ok(data.provided.some((e) => e.id === provided.id), 'handoff-attached entry is PROVIDED');
  assert.ok(!data.provided.some((e) => e.id === searchable.id), 'searched entry is not PROVIDED');

  // searches: query + ranked results with scores
  assert.equal(data.searches.length, 1);
  assert.equal(data.searches[0].query, 'acme corp seat count');
  const hit = data.searches[0].results.find((r) => r.entry.id === searchable.id);
  assert.ok(hit, 'searched entry appears in the search results');
  assert.equal(hit.rank, 1);
  assert.ok(hit.score >= 2, 'multi-token score recorded');

  // cited: what the run wrote, carrying its cites
  assert.ok(data.cited.some((e) => e.id === written.id && e.cites.includes(searchable.id)));

  // delivered = provided ∪ retrieved
  assert.equal(data.deliveredCount, 2);
  assert.equal(data.feedback, null);
});

test('feedback: up/down with note, one verdict per run, invalid verdict rejected', async () => {
  const bad = await call('POST', `/api/canvases/${canvasId}/runs/${RUN}/feedback`, { verdict: 'meh' });
  assert.equal(bad.status, 400);

  const up = await call('POST', `/api/canvases/${canvasId}/runs/${RUN}/feedback`, { verdict: 'up', note: 'nailed it' });
  assert.equal(up.status, 200);

  // Re-rating replaces, not duplicates.
  const down = await call('POST', `/api/canvases/${canvasId}/runs/${RUN}/feedback`, { verdict: 'down', note: 'on reflection, no' });
  assert.equal(down.status, 200);
  const rows = db.prepare('SELECT * FROM run_feedback WHERE run_id = ?').all(RUN);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, 'down');
  assert.equal(rows[0].by, 'pete@cloudtechgurus.com');

  const { data } = await call('GET', `/api/canvases/${canvasId}/runs/${RUN}/receipt`);
  assert.equal(data.feedback.verdict, 'down');
  assert.match(data.feedback.note, /on reflection/);
});

test('receipt 404s for a run on another canvas (canvas ACL holds)', async () => {
  const { status } = await call('GET', `/api/canvases/${canvasId}/runs/not-a-run/receipt`);
  assert.equal(status, 404);
});

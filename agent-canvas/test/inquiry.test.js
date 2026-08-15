'use strict';
// P1 inquiries: ask the company without picking an agent. POST parses AND
// dispatches server-side; selection is fast-tier with a deterministic
// role-priority fallback; the inquiry row and its run land in one tx.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-inquiry-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test'; // placeholder, never called

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const anthropic = require('../server/orchestrator/anthropic');
const control = require('../server/orchestrator/control');
const runner = require('../server/orchestrator/runner');

// Every successful inquiry queues a REAL background run — stub the run
// loop's model so those finish instantly instead of hitting the network
// with the placeholder key (claude-review finding on #173).
runner._internal.setCallModel(async () => ({
  content: [{ type: 'text', text: 'stubbed answer' }], stop_reason: 'end_turn', usage: {},
}));

let base;
let cookie;
let canvasId;
const SCOUT = 'agent-inq-scout';
const CODER = 'agent-inq-coder';
const OWNER = 'pete@cloudtechgurus.com';

// Stub the module's callModel (routes.js resolves it at call time).
const realCallModel = anthropic.callModel;
function stubSelection(fn) { anthropic.callModel = fn; return () => { anthropic.callModel = realCallModel; }; }

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(method, apiPath, body) {
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
  cookie = await signIn(OWNER);
  const created = await call('POST', '/api/canvases', { name: 'Inquiry Canvas' });
  canvasId = created.data.canvas.id;
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)").run(SCOUT, canvasId, nowIso());
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Forge', 'coding', ?)").run(CODER, canvasId, nowIso());
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('auto selection: the fast-tier pick is used when it names a real agent', async () => {
  const restore = stubSelection(async () => ({
    content: [{ type: 'text', text: `{"agent_id": "${CODER}", "echo": "Asking Forge (coding)"}` }],
    usage: { input_tokens: 10, output_tokens: 10 },
  }));
  try {
    const { status, data } = await call('POST', `/api/canvases/${canvasId}/inquiries`, { question: 'why does the build fail?' });
    assert.equal(status, 200);
    assert.equal(data.inquiry.agent.id, CODER);
    assert.equal(data.selection.auto, true);
    assert.match(data.selection.echo, /Forge/);
    assert.ok(data.inquiry.runId, 'run dispatched and stamped');
    assert.equal(data.inquiry.mode, 'ask');
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(data.inquiry.runId);
    assert.equal(run.mode, 'ask');
    assert.equal(run.initiated_by, OWNER);
  } finally { restore(); }
});

test('selection fallback: a garbage parse falls back to role priority (research first) — never a dead end', async () => {
  const restore = stubSelection(async () => ({ content: [{ type: 'text', text: 'no json here' }], usage: {} }));
  try {
    const { status, data } = await call('POST', `/api/canvases/${canvasId}/inquiries`, { question: 'what do we know about acme?' });
    assert.equal(status, 200);
    assert.equal(data.inquiry.agent.id, SCOUT, 'research agent picked deterministically');
    assert.match(data.selection.echo, /picked automatically/);
  } finally { restore(); }
});

test('explicit agent_id override skips selection; bad agent_id 400s', async () => {
  const restore = stubSelection(async () => { throw new Error('selection must not be called on override'); });
  try {
    const ok = await call('POST', `/api/canvases/${canvasId}/inquiries`, { question: 'q', agent_id: CODER, mode: 'act' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.inquiry.agent.id, CODER);
    assert.equal(ok.data.selection.auto, false);
    const bad = await call('POST', `/api/canvases/${canvasId}/inquiries`, { question: 'q', agent_id: 'nope' });
    assert.equal(bad.status, 400);
  } finally { restore(); }
});

test('budget rejection rolls the inquiry row back (both halves or neither)', async () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM inquiries').get().n;
  const realBudget = control.budgetExceeded;
  // The route gate passes, then dispatchRun's own budget check throws 429
  // inside the tx — exactly the race the tx exists for.
  let calls = 0;
  control.budgetExceeded = () => (calls++ >= 1);
  try {
    const { status } = await call('POST', `/api/canvases/${canvasId}/inquiries`, { question: 'q', agent_id: SCOUT });
    assert.equal(status, 429);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inquiries').get().n, before, 'no orphaned inquiry row');
  } finally { control.budgetExceeded = realBudget; }
});

test('status derives from the run; saved toggle persists; list and detail endpoints agree', async () => {
  const restore = stubSelection(async () => ({ content: [{ type: 'text', text: 'x' }], usage: {} }));
  let id;
  try {
    const { data } = await call('POST', `/api/canvases/${canvasId}/inquiries`, { question: 'status check', agent_id: SCOUT });
    id = data.inquiry.id;
    assert.equal(data.inquiry.status, 'pending');
    // Terminal run → derived + written back.
    db.prepare("UPDATE runs SET status = 'completed', summary = 'done' WHERE id = ?").run(data.inquiry.runId);
    const detail = await call('GET', `/api/inquiries/${id}`);
    assert.equal(detail.data.inquiry.status, 'answered');
    assert.equal(db.prepare('SELECT status FROM inquiries WHERE id = ?').get(id).status, 'answered');

    const saved = await call('PATCH', `/api/inquiries/${id}`, { saved: true });
    assert.equal(saved.data.inquiry.saved, true);
    const list = await call('GET', `/api/canvases/${canvasId}/inquiries?saved=1`);
    assert.ok(list.data.inquiries.some((i) => i.id === id));
  } finally { restore(); }
});

test('invalid mode and empty question 400; refused/halted runs read unanswered', async () => {
  const badMode = await call('POST', `/api/canvases/${canvasId}/inquiries`, { question: 'q', agent_id: SCOUT, mode: 'yolo' });
  assert.equal(badMode.status, 400);
  const empty = await call('POST', `/api/canvases/${canvasId}/inquiries`, { question: '  ', agent_id: SCOUT });
  assert.equal(empty.status, 400);

  const { data } = await call('POST', `/api/canvases/${canvasId}/inquiries`, { question: 'will be refused', agent_id: SCOUT });
  db.prepare("UPDATE runs SET status = 'refused' WHERE id = ?").run(data.inquiry.runId);
  const detail = await call('GET', `/api/inquiries/${data.inquiry.id}`);
  assert.equal(detail.data.inquiry.status, 'unanswered');
});

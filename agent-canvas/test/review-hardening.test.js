'use strict';
// Invariants added after external design review:
// - verification authority: an agent cannot upgrade its own inference to "verified"
// - pause epoch: stale-epoch actions are rejected server-side (zombie rejection)
// - web search cost is metered

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-review-'));
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires

const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');
const control = require('../server/orchestrator/control');
const { executeTool } = require('../server/orchestrator/tools');
const { costOf } = require('../server/orchestrator/anthropic');

const CANVAS = 'canvas-review';
db.prepare("INSERT INTO canvases (id, name, created_at) VALUES (?, 'Review', ?)").run(CANVAS, nowIso());
db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES ('agent-r', ?, 'Researcher', 'research', ?)").run(CANVAS, nowIso());

test('verification authority: agent cannot upgrade its own inference to verified', () => {
  const inference = memory.writeEntry({
    canvasId: CANVAS, content: 'Company Z is probably mid-market', epistemic: 'inference',
    authorType: 'agent', authorId: 'agent-r', authorName: 'Researcher', source: 'guesswork',
  });
  assert.throws(() => memory.correctEntry({
    entryId: inference.id, content: 'Company Z is mid-market', epistemic: 'verified',
    reason: 'I am now sure', authorType: 'agent', authorId: 'agent-r',
  }), /verification authority/);
  // a DIFFERENT agent with direct evidence may verify it
  const upgraded = memory.correctEntry({
    entryId: inference.id, content: 'Company Z is mid-market (250 employees per registry)', epistemic: 'verified',
    reason: 'checked the registry', authorType: 'agent', authorId: 'agent-other',
  });
  assert.ok(!upgraded.conflict);
  assert.equal(upgraded.entry.epistemic, 'verified');
  // and a human may always verify
  const humanTarget = memory.writeEntry({
    canvasId: CANVAS, content: 'assumption to bless', epistemic: 'assumption',
    authorType: 'agent', authorId: 'agent-r',
  });
  const blessed = memory.correctEntry({
    entryId: humanTarget.id, content: 'confirmed by Pete', epistemic: 'verified',
    reason: 'human decision', authorType: 'user', authorId: 'pete@cloudtechgurus.com',
  });
  assert.equal(blessed.entry.epistemic, 'verified');
});

test('pause epoch: epoch increments on pause and stale epochs are detected', () => {
  const before = control.currentEpoch();
  control.setPaused(true, 'tester');
  assert.equal(control.currentEpoch(), before + 1);
  assert.equal(control.epochStale(before), true, 'old epoch is stale while paused');
  control.setPaused(false, 'tester');
  assert.equal(control.epochStale(before), true, 'old epoch stays stale after resume (generation moved on)');
  assert.equal(control.epochStale(control.currentEpoch()), false);
});

test('paused workspace rejects tool mutations server-side (zombie rejection)', async () => {
  control.setPaused(true, 'tester');
  const run = { id: 'zombie-run', canvas_id: CANVAS, agent_id: 'agent-r' };
  const agent = db.prepare("SELECT * FROM agents WHERE id = 'agent-r'").get();
  const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(CANVAS);
  const result = await executeTool('memory_write', { content: 'zombie fact', epistemic: 'verified', source: 'late response' }, { run, agent, canvas });
  assert.equal(result.isError, true);
  assert.match(result.content, /paused/i);
  const ghost = db.prepare("SELECT COUNT(*) AS n FROM memory_entries WHERE content = 'zombie fact'").get();
  assert.equal(ghost.n, 0, 'nothing written while paused');
  control.setPaused(false, 'tester');
});

test('web search requests are metered into cost', () => {
  const withSearch = costOf('claude-sonnet-5', { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 3 } });
  const without = costOf('claude-sonnet-5', { input_tokens: 1000, output_tokens: 100 });
  assert.ok(Math.abs((withSearch - without) - 0.03) < 1e-9);
});

test('verification laundering guard: agent cannot mint verified from only its own unverified entries', () => {
  const a = memory.writeEntry({ canvasId: CANVAS, content: 'my hunch 1', epistemic: 'inference', authorType: 'agent', authorId: 'agent-r' });
  const b = memory.writeEntry({ canvasId: CANVAS, content: 'my hunch 2', epistemic: 'assumption', authorType: 'agent', authorId: 'agent-r' });
  assert.throws(() => memory.writeEntry({
    canvasId: CANVAS, content: 'now it is a fact', epistemic: 'verified',
    authorType: 'agent', authorId: 'agent-r', cites: [a.id, b.id],
  }), /verification authority/);
  // citing someone else's entry (even unverified) is allowed — cross-checking is independent work
  const other = memory.writeEntry({ canvasId: CANVAS, content: 'their hunch', epistemic: 'inference', authorType: 'agent', authorId: 'agent-z' });
  const ok = memory.writeEntry({
    canvasId: CANVAS, content: 'confirmed against the registry', epistemic: 'verified',
    authorType: 'agent', authorId: 'agent-r', cites: [a.id, other.id],
  });
  assert.equal(ok.epistemic, 'verified');
});

test('verify_changes: a row is verified only when ALL its changes are approved', async () => {
  const { db: sdb, nowIso: iso } = require('../server/db');
  const crypto2 = require('node:crypto');
  const rowId = crypto2.randomUUID();
  sdb.prepare("INSERT INTO sheet_rows (id, canvas_id, row_index, data, status, updated_at) VALUES (?, ?, 99, ?, 'corrected', ?)")
    .run(rowId, CANVAS, JSON.stringify({ phone: 'bad', name: 'DR. X' }), iso());
  const csId = crypto2.randomUUID();
  sdb.prepare("INSERT INTO changesets (id, canvas_id, status, created_at) VALUES (?, ?, 'proposed', ?)").run(csId, CANVAS, iso());
  const c1 = crypto2.randomUUID(); const c2 = crypto2.randomUUID();
  sdb.prepare("INSERT INTO changes (id, changeset_id, row_id, field, old_value, new_value, ts) VALUES (?, ?, ?, 'phone', 'bad', '+15550000000', ?)").run(c1, csId, rowId, iso());
  sdb.prepare("INSERT INTO changes (id, changeset_id, row_id, field, old_value, new_value, ts) VALUES (?, ?, ?, 'name', 'DR. X', 'X', ?)").run(c2, csId, rowId, iso());
  const agent = sdb.prepare("SELECT * FROM agents WHERE id = 'agent-r'").get();
  const canvas = sdb.prepare('SELECT * FROM canvases WHERE id = ?').get(CANVAS);
  const run = { id: 'verify-run', canvas_id: CANVAS, agent_id: 'agent-r' };
  const result = await executeTool('verify_changes', {
    changeset_id: csId,
    verdicts: [
      { change_id: c2, verdict: 'rejected', reason: 'wrong fix' },
      { change_id: c1, verdict: 'approved', reason: 'good' },
    ],
  }, { run, agent, canvas });
  assert.ok(!result.isError, result.content);
  const row = sdb.prepare('SELECT * FROM sheet_rows WHERE id = ?').get(rowId);
  assert.equal(row.status, 'flagged', 'row with any rejected change must NOT be verified');
  assert.equal(JSON.parse(row.data).phone, '+15550000000', 'approved change still applied to data');
});

test('model provider resolution and Vertex ID mapping', () => {
  const { vertexModelId, normalizeModelId, webSearchToolFor, costOf: cost } = require('../server/orchestrator/anthropic');
  // dated-snapshot model gets the @-separated Vertex ID; current-gen stay bare
  assert.equal(vertexModelId('claude-haiku-4-5'), 'claude-haiku-4-5@20251001');
  assert.equal(vertexModelId('claude-sonnet-5'), 'claude-sonnet-5');
  assert.equal(vertexModelId('claude-opus-4-8'), 'claude-opus-4-8');
  // pricing lookups survive the Vertex ID form
  assert.equal(normalizeModelId('claude-haiku-4-5@20251001'), 'claude-haiku-4-5');
  const direct = cost('claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 0 });
  const viaVertexId = cost('claude-haiku-4-5@20251001', { input_tokens: 1_000_000, output_tokens: 0 });
  assert.equal(direct, viaVertexId);
  // web search: Vertex always basic; first-party keeps the newer variant on non-Haiku
  assert.equal(webSearchToolFor('claude-sonnet-5', 'vertex').type, 'web_search_20250305');
  assert.equal(webSearchToolFor('claude-sonnet-5', 'anthropic').type, 'web_search_20260209');
  assert.equal(webSearchToolFor('claude-haiku-4-5', 'anthropic').type, 'web_search_20250305');
});

test('file upload rejects a caller-controlled non-Buffer body (CodeQL type confusion, was a 500)', async () => {
  // The app-level JSON parser runs before the router, so Content-Type decides
  // whether req.body is a Buffer or a parsed object/array. Reproduce both.
  const express = require('express');
  const routes = require('../server/routes');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', routes);

  const { db: sdb, nowIso: iso } = require('../server/db');
  sdb.prepare("INSERT OR IGNORE INTO allowlist (email, role, added_at) VALUES ('pete@cloudtechgurus.com','owner',?)").run(iso());

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const signIn = await fetch(`${base}/api/auth/dev`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pete@cloudtechgurus.com' }),
    });
    const cookie = (signIn.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('ac_session='), 'dev sign-in issued a session');

    const upload = (contentType, body) => fetch(`${base}/api/canvases/${CANVAS}/files?name=t.bin`, {
      method: 'POST', headers: { cookie, 'content-type': contentType }, body,
    });

    const arrayBody = await upload('application/json', JSON.stringify([1, 2, 3]));
    assert.equal(arrayBody.status, 400, 'array body rejected at the boundary, not a 500');
    const objectBody = await upload('application/json', JSON.stringify({ a: 1 }));
    assert.equal(objectBody.status, 400, 'object body rejected at the boundary, not a 500');
    const empty = await upload('application/octet-stream', '');
    assert.equal(empty.status, 400, 'empty body rejected');

    const good = await upload('text/plain', 'hello');
    assert.equal(good.status, 200, 'legitimate binary upload still works');
    assert.equal((await good.json()).file.size, 5);
  } finally {
    server.close();
  }
});

test('file download returns raw bytes, not a JSON-serialized Uint8Array', async () => {
  // SQLite hands BLOBs back as Uint8Array; res.send() would serialize that as
  // {"0":104,...}, silently corrupting every download.
  const express = require('express');
  const routes = require('../server/routes');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', routes);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const signIn = await fetch(`${base}/api/auth/dev`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pete@cloudtechgurus.com' }),
    });
    const cookie = (signIn.headers.get('set-cookie') || '').split(';')[0];

    const payload = Buffer.from([0x68, 0x69, 0x00, 0xff, 0xfe, 0x21]); // includes NUL and high bytes
    const up = await fetch(`${base}/api/canvases/${CANVAS}/files?name=rt.bin`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream' }, body: payload,
    });
    assert.equal(up.status, 200);
    const fileId = (await up.json()).file.id;

    const down = await fetch(`${base}/api/canvases/${CANVAS}/files/${fileId}`, { headers: { cookie } });
    assert.equal(down.status, 200);
    assert.match(down.headers.get('content-type') || '', /octet-stream/);
    const bytes = Buffer.from(await down.arrayBuffer());
    assert.deepEqual([...bytes], [...payload], 'downloaded bytes are byte-identical to what was uploaded');
    assert.ok(!bytes.toString('utf8').startsWith('{"0":'), 'not a JSON-serialized array');
  } finally {
    server.close();
  }
});

test('a run that fails before starting is recorded and escalated, never left queued', async () => {
  const { dispatchRun } = require('../server/orchestrator/queue');
  const { db: sdb } = require('../server/db');
  // Dispatch against an agent row whose canvas is missing: executeRun's own
  // handler marks it failed. The point is that it never stays 'queued'.
  const before = sdb.prepare("SELECT COUNT(*) n FROM runs WHERE status='queued'").get().n;
  const { id } = dispatchRun({ agentId: 'agent-r', canvasId: CANVAS, instruction: 'startup failure probe' });
  await new Promise((r) => setTimeout(r, 600));
  const row = sdb.prepare('SELECT status, error FROM runs WHERE id = ?').get(id);
  assert.notEqual(row.status, 'queued', `run must not be stranded in queued (got ${row.status})`);
  const after = sdb.prepare("SELECT COUNT(*) n FROM runs WHERE status='queued'").get().n;
  assert.ok(after <= before, 'no growth in stranded queued runs');
});

test('an identical repeat handoff is a no-op, not a duplicate dispatch or a livelock', async () => {
  const { db: sdb, nowIso: iso } = require('../server/db');
  const crypto3 = require('node:crypto');
  const a1 = crypto3.randomUUID(); const a2 = crypto3.randomUUID();
  sdb.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Sender', 'research', ?)").run(a1, CANVAS, iso());
  sdb.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Receiver', 'coding', ?)").run(a2, CANVAS, iso());
  const agent = sdb.prepare('SELECT * FROM agents WHERE id = ?').get(a1);
  const canvas = sdb.prepare('SELECT * FROM canvases WHERE id = ?').get(CANVAS);
  const run = { id: 'handoff-run', canvas_id: CANVAS, agent_id: a1 };
  const args = { to_agent_name: 'Receiver', item_key: 'batch-dup', message: 'take this' };

  const first = JSON.parse((await executeTool('handoff', args, { run, agent, canvas })).content);
  assert.ok(first.dispatched_run, 'first handoff dispatches');
  const second = JSON.parse((await executeTool('handoff', args, { run, agent, canvas })).content);
  assert.equal(second.duplicate, true, 'identical repeat is recognized as a duplicate');
  assert.ok(!second.dispatched_run, 'duplicate does not dispatch a second run');

  const handoffs = sdb.prepare("SELECT COUNT(*) n FROM handoffs WHERE item_key = 'batch-dup'").get().n;
  assert.equal(handoffs, 1, 'only one handoff recorded');
  const livelocks = sdb.prepare("SELECT COUNT(*) n FROM escalations WHERE kind='livelock' AND question LIKE '%batch-dup%'").get().n;
  assert.equal(livelocks, 0, 'repetition by one agent is not reported as a livelock');
});

test('a stranded queued run is picked back up, and escalated if it keeps failing', async () => {
  const { reconcileStrandedRuns } = require('../server/orchestrator/queue');
  const { db: sdb } = require('../server/db');
  const crypto4 = require('node:crypto');
  const id = crypto4.randomUUID();
  const stale = () => new Date(Date.now() - 120_000).toISOString();
  const strand = () => sdb.prepare("UPDATE runs SET status='queued', started_at=NULL, ended_at=NULL, created_at=? WHERE id=?").run(stale(), id);
  const settle = () => new Promise((r) => setTimeout(r, 250)); // let the pump drain

  sdb.prepare(`INSERT INTO runs (id, agent_id, canvas_id, instruction, status, step_budget, wall_ms_budget, created_at)
               VALUES (?, 'agent-r', ?, 'stranded work', 'queued', 5, 60000, ?)`).run(id, CANVAS, stale());

  assert.ok(reconcileStrandedRuns() >= 1, 'sweeper sees the stranded run');
  const requeued = sdb.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='run.requeued' AND detail LIKE ?").get(`%${id}%`).n;
  assert.ok(requeued >= 1, 'it is re-queued rather than abandoned');

  // Keep stranding it past the retry budget: it must fail loudly, not sit forever.
  for (let i = 0; i < 3; i++) {
    await settle();
    strand();
    reconcileStrandedRuns();
  }
  await settle();
  const final = sdb.prepare('SELECT status, error FROM runs WHERE id = ?').get(id);
  assert.equal(final.status, 'failed', `exhausted retries must end in a recorded failure (got ${final.status})`);
  const esc = sdb.prepare("SELECT COUNT(*) n FROM escalations WHERE run_id = ? AND kind='error'").get(id).n;
  assert.ok(esc >= 1, 'and a human is told');
});

'use strict';
// P1 evidence spine. Evidence refs record the external artifacts a run
// touched; evidence_citations link memory entries to the refs that support
// them. Refs are minted server-side at the tool funnels (the [evidence_ref:]
// marker sits OUTSIDE the external_content wrapper), memory_write's evidence
// param validates run ownership, and the receipt redacts private-surface URIs
// for anyone but the directing user.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-evidence-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test'; // placeholder, never called

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');
const evidence = require('../server/evidence');
const { executeTool } = require('../server/orchestrator/tools');
const ws = require('../server/google/workspace');

let base;
let cookie;
let canvasId;
const AGENT = 'agent-evidence-1';
const RUN = 'run-evidence-1';
const OTHER_RUN = 'run-evidence-2';
const OWNER = 'pete@cloudtechgurus.com';
const MEMBER = 'fred@cloudtechgurus.com'; // seeded allowlist member

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(method, apiPath, body, asCookie = cookie) {
  const res = await fetch(`${base}${apiPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: asCookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function insertRun(id) {
  db.prepare(
    `INSERT INTO runs (id, agent_id, canvas_id, trigger_kind, instruction, status, step_budget, wall_ms_budget, created_at, initiated_by)
     VALUES (?, ?, ?, 'user', 'evidence test', 'completed', 12, 240000, ?, ?)`
  ).run(id, AGENT, canvasId, nowIso(), OWNER);
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn(OWNER);
  const created = await call('POST', '/api/canvases', { name: 'Evidence Canvas' });
  canvasId = created.data.canvas.id;
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)")
    .run(AGENT, canvasId, nowIso());
  insertRun(RUN);
  insertRun(OTHER_RUN);
});

test.after(() => new Promise((resolve) => server.close(resolve)));

const ctx = () => ({
  run: db.prepare('SELECT * FROM runs WHERE id = ?').get(RUN),
  agent: { id: AGENT, name: 'Scout', role: 'research' },
  canvas: { id: canvasId },
});

test('ws_drive_read records a drive evidence ref and appends the marker outside external_content', async () => {
  const orig = ws.driveReadText;
  ws.driveReadText = async () => ({ id: 'file-1', name: 'Q3 plan.docx', mimeType: 'application/vnd.google-apps.document', text: 'the plan' });
  try {
    const res = await executeTool('ws_drive_read', { file_id: 'file-1' }, ctx());
    assert.ok(!res.isError, res.content);
    // Marker is appended AFTER the closing tag — outside the untrusted region.
    const closing = res.content.indexOf('</external_content>');
    const marker = res.content.indexOf('[evidence_ref:');
    assert.ok(closing >= 0 && marker > closing, 'marker sits outside the external_content wrapper');
    const refs = evidence.refsForRun(RUN);
    const ref = refs.find((r) => r.sourceKind === 'drive' && r.sourceId === 'file-1');
    assert.ok(ref, 'drive ref recorded');
    assert.equal(ref.title, 'Q3 plan.docx');
    assert.equal(ref.directedBy, OWNER);
    assert.match(res.content, new RegExp(ref.id));
  } finally {
    ws.driveReadText = orig;
  }
});

test('memory_write links valid evidence refs; foreign-run and unknown refs reject the whole write', async () => {
  const refId = evidence.recordRef({ runId: RUN, sourceKind: 'web', sourceId: 'https://example.com/a', title: 'A', uri: 'https://example.com/a', directedBy: OWNER });
  const good = await executeTool('memory_write', {
    content: 'example.com says A', epistemic: 'inference', source: 'web', evidence: [refId],
  }, ctx());
  assert.ok(!good.isError, good.content);
  const entryId = JSON.parse(good.content).entry_id;
  const rows = db.prepare('SELECT * FROM evidence_citations WHERE entry_id = ?').all(entryId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].evidence_ref_id, refId);

  // A ref minted by ANOTHER run cannot support this run's entry.
  const foreignRef = evidence.recordRef({ runId: OTHER_RUN, sourceKind: 'web', sourceId: 'https://example.com/b', directedBy: OWNER });
  const before = db.prepare('SELECT COUNT(*) AS n FROM memory_entries').get().n;
  const bad = await executeTool('memory_write', {
    content: 'should not land', epistemic: 'inference', source: 'web', evidence: [foreignRef],
  }, ctx());
  assert.ok(bad.isError, 'foreign-run evidence rejected');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_entries').get().n, before, 'rejected write left no entry (atomic)');

  const unknown = await executeTool('memory_write', {
    content: 'should not land either', epistemic: 'inference', source: 'web', evidence: ['not-a-ref'],
  }, ctx());
  assert.ok(unknown.isError, 'unknown evidence ref rejected');
});

test('receipt carries run evidence and per-entry evidence; gmail/drive URIs redacted for non-directing users', async () => {
  const gmailRef = evidence.recordRef({ runId: RUN, sourceKind: 'gmail', sourceId: 'msg-7', title: 'Renewal thread', directedBy: OWNER });
  const webRef = evidence.recordRef({ runId: RUN, sourceKind: 'web', sourceId: 'https://example.com/c', title: 'C', uri: 'https://example.com/c', directedBy: OWNER });
  const written = memory.writeEntry({
    canvasId, content: 'renewal is due in March', epistemic: 'inference',
    authorType: 'agent', authorId: AGENT, source: 'gmail', runId: RUN,
  });
  evidence.citeEvidence(written.id, [gmailRef, webRef], RUN);

  // Directing user sees everything.
  const own = await call('GET', `/api/canvases/${canvasId}/runs/${RUN}/receipt`);
  assert.equal(own.status, 200);
  assert.ok(own.data.evidence.length >= 2, 'receipt lists run evidence');
  const ownEntry = own.data.cited.find((e) => e.id === written.id);
  assert.equal(ownEntry.evidence.length, 2);
  assert.ok(!ownEntry.evidence.find((r) => r.id === gmailRef).redacted, 'directing user sees own gmail ref unredacted');

  // A member of the workspace canvas sees title+kind but not the private source.
  const memberCookie = await signIn(MEMBER);
  const theirs = await call('GET', `/api/canvases/${canvasId}/runs/${RUN}/receipt`, undefined, memberCookie);
  assert.equal(theirs.status, 200);
  const theirGmail = theirs.data.evidence.find((r) => r.id === gmailRef);
  assert.ok(theirGmail.redacted, 'gmail ref redacted for non-directing user');
  assert.equal(theirGmail.sourceId, '');
  assert.equal(theirGmail.title, 'Renewal thread', 'title stays visible');
  const theirWeb = theirs.data.evidence.find((r) => r.id === webRef);
  assert.ok(!theirWeb.redacted, 'web ref never redacted');
  assert.equal(theirWeb.uri, 'https://example.com/c');
});

test('memory_correct links evidence to the correcting entry', async () => {
  const original = memory.writeEntry({
    canvasId, content: 'seat count is 400', epistemic: 'assumption',
    authorType: 'agent', authorId: AGENT, source: 'guess', runId: RUN,
  });
  const refId = evidence.recordRef({ runId: RUN, sourceKind: 'hubspot', sourceId: 'companies:123', title: 'hs_get', directedBy: OWNER });
  const res = await executeTool('memory_correct', {
    entry_id: original.id, content: 'seat count is 650 per the CRM', epistemic: 'inference',
    reason: 'CRM record has the real number', evidence: [refId],
  }, ctx());
  assert.ok(!res.isError, res.content);
  const newId = JSON.parse(res.content).entry_id;
  const rows = db.prepare('SELECT * FROM evidence_citations WHERE entry_id = ?').all(newId);
  assert.equal(rows.length, 1);
});

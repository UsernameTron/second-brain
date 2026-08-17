'use strict';
// P1 Explain Map. Run-centric graph over existing records: deterministic
// (same map twice), node-capped with visible collapse, three lenses, verb
// mapping (contradicted on superseded cites), map/receipt evidence parity,
// cross-canvas redaction, and a read-as-steps chronology.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-explain-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test'; // placeholder, never called

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');
const evidence = require('../server/evidence');
const { buildExplainMap, NODE_CAP } = require('../server/explain');

let base;
let cookie;
let canvasId;
const AGENT = 'agent-explain-1';
const RUN = 'run-explain-1';
const OWNER = 'pete@cloudtechgurus.com';

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}
async function call(method, apiPath, body, asCookie = cookie) {
  const res = await fetch(`${base}${apiPath}`, {
    method, headers: { 'Content-Type': 'application/json', Cookie: asCookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn(OWNER);
  const created = await call('POST', '/api/canvases', { name: 'Explain Canvas' });
  canvasId = created.data.canvas.id;
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)").run(AGENT, canvasId, nowIso());
  db.prepare(
    `INSERT INTO runs (id, agent_id, canvas_id, trigger_kind, instruction, status, summary, step_budget, wall_ms_budget, created_at, initiated_by)
     VALUES (?, ?, ?, 'user', 'what do we know about acme?', 'completed', 'acme is mid-market', 12, 240000, ?, ?)`
  ).run(RUN, AGENT, canvasId, nowIso(), OWNER);

  // A search, an evidence ref, a supported entry, and a contradicted cite.
  const old = memory.writeEntry({ canvasId, content: 'acme has 100 seats', epistemic: 'assumption', authorType: 'user', authorId: OWNER, source: 'guess' });
  memory.correctEntry({ entryId: old.id, content: 'acme has 650 seats', epistemic: 'verified', reason: 'CRM', authorType: 'user', authorId: OWNER });
  memory.recordRetrievals(RUN, 'acme seats', [{ id: old.id, score: 2 }]);
  const ref = evidence.recordRef({ runId: RUN, sourceKind: 'web', sourceId: 'https://acme.example', title: 'acme.example', uri: 'https://acme.example', directedBy: OWNER });
  const written = memory.writeEntry({
    canvasId, content: 'acme is mid-market by seat count', epistemic: 'inference',
    authorType: 'agent', authorId: AGENT, source: 'derived', runId: RUN, cites: [old.id],
  });
  evidence.citeEvidence(written.id, [ref], RUN);
  db.prepare("INSERT INTO run_events (run_id, canvas_id, agent_id, type, payload, ts) VALUES (?, ?, ?, 'web_search', ?, ?)")
    .run(RUN, canvasId, AGENT, JSON.stringify({ query: 'acme corp' }), nowIso());
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('deterministic: the same map twice, byte-identical', () => {
  const a = buildExplainMap(RUN, { lens: 'flow' });
  const b = buildExplainMap(RUN, { lens: 'flow' });
  assert.deepEqual(a, b);
});

test('evidence lens: supported and contradicted verbs; map and receipt share the same evidence refs', async () => {
  const map = buildExplainMap(RUN, { lens: 'evidence' });
  const verbs = map.edges.map((e) => e.verb);
  assert.ok(verbs.includes('supported'), 'evidence ref supports the written entry');
  assert.ok(verbs.includes('contradicted'), 'cite of a superseded entry reads contradicted');

  // Done-when: the map and the receipt contain the same underlying evidence.
  const { data: receipt } = await call('GET', `/api/canvases/${canvasId}/runs/${RUN}/receipt`);
  const receiptRefIds = new Set(receipt.evidence.map((r) => r.id));
  const mapRefIds = new Set(map.nodes.filter((n) => n.type === 'evidence').map((n) => n.meta.refId));
  assert.deepEqual([...mapRefIds].sort(), [...receiptRefIds].sort(), 'map evidence == receipt evidence');
});

test('flow lens keeps actions and outputs; steps read as an ordered chronology', () => {
  db.prepare("INSERT INTO changesets (id, canvas_id, run_id, agent_id, status, created_at) VALUES ('legacy-explain-cs', ?, ?, ?, 'proposed', ?)")
    .run(canvasId, RUN, AGENT, nowIso());
  const map = buildExplainMap(RUN, { lens: 'flow' });
  assert.ok(map.nodes.some((n) => n.type === 'question'));
  assert.ok(map.nodes.some((n) => n.type === 'action' && /web search/.test(n.label)));
  assert.ok(!map.nodes.some((n) => n.type === 'evidence'), 'evidence nodes belong to the evidence lens');
  assert.ok(!map.nodes.some((n) => /changeset/i.test(n.label)), 'preserved demo changesets are not presented as current work');
  assert.match(map.steps[0], /was asked/);
  assert.match(map.steps[map.steps.length - 1], /Run completed/);
});

test('node cap: an oversized run collapses into +N more, deterministically', () => {
  const BIG = 'run-explain-big';
  db.prepare(
    `INSERT INTO runs (id, agent_id, canvas_id, trigger_kind, instruction, status, step_budget, wall_ms_budget, created_at)
     VALUES (?, ?, ?, 'user', 'big run', 'completed', 12, 240000, ?)`
  ).run(BIG, AGENT, canvasId, nowIso());
  for (let i = 0; i < 20; i++) {
    memory.writeEntry({ canvasId, content: `finding number ${i}`, epistemic: 'inference', authorType: 'agent', authorId: AGENT, source: 's', runId: BIG });
  }
  const map = buildExplainMap(BIG, { lens: 'evidence' });
  assert.ok(map.nodes.length <= NODE_CAP + 2, `capped (${map.nodes.length})`);
  const more = map.nodes.find((n) => n.type === 'more');
  assert.ok(more, 'collapse node present');
  assert.ok(more.meta.dropped.length > 0);
  assert.deepEqual(buildExplainMap(BIG, { lens: 'evidence' }), map, 'collapse is stable');
});

test('route: canvas-scoped 404, bad lens 400, cross-canvas impact redacted', async () => {
  const notFound = await call('GET', `/api/canvases/${canvasId}/runs/not-a-run/explain-map`);
  assert.equal(notFound.status, 404);
  const badLens = await call('GET', `/api/canvases/${canvasId}/runs/${RUN}/explain-map?lens=xray`);
  assert.equal(badLens.status, 400);

  // A restricted canvas cites this run's entry → the impact node must be
  // present-but-redacted for a member without access.
  const restricted = await call('POST', '/api/canvases', { name: 'Restricted' });
  const rid = restricted.data.canvas.id;
  db.prepare("UPDATE canvases SET access_mode = 'restricted' WHERE id = ?").run(rid);
  const sourceEntry = db.prepare('SELECT id FROM memory_entries WHERE run_id = ?').get(RUN).id;
  memory.writeEntry({ canvasId: rid, content: 'secret downstream plan built on acme sizing', epistemic: 'inference', authorType: 'user', authorId: OWNER, source: 's', cites: [sourceEntry] });

  const memberCookie = await signIn('fred@cloudtechgurus.com');
  const { status, data } = await call('GET', `/api/canvases/${canvasId}/runs/${RUN}/explain-map?lens=impact`, undefined, memberCookie);
  assert.equal(status, 200);
  const redacted = data.nodes.find((n) => n.redacted);
  assert.ok(redacted, 'cross-canvas impact node present but redacted');
  assert.ok(!JSON.stringify(redacted).includes('secret downstream'), 'content does not leak');
  // The owner sees it unredacted.
  const own = await call('GET', `/api/canvases/${canvasId}/runs/${RUN}/explain-map?lens=impact`);
  assert.ok(own.data.nodes.some((n) => /secret downstream/.test(n.label)));
});

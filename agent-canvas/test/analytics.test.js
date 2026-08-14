'use strict';
// Wave 5: operational analytics + deterministic contradiction surfacing.
// Analytics aggregates records that already exist; conflicts are computed on
// read from typed subjects — nothing stored, nothing auto-demoted.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-analytics-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');

let base;
let cookie;
let canvasId;
const AGENT = 'agent-an-1';

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
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

function seedRun(id, status, startedAt, endedAt, cost) {
  db.prepare(
    `INSERT INTO runs (id, agent_id, canvas_id, trigger_kind, instruction, status, step_budget, wall_ms_budget, created_at, started_at, ended_at, cost_usd)
     VALUES (?, ?, ?, 'user', 'x', ?, 12, 240000, ?, ?, ?, ?)`
  ).run(id, AGENT, canvasId, status, nowIso(), startedAt, endedAt, cost);
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn('pete@cloudtechgurus.com');
  const created = await call('POST', '/api/canvases', { name: 'Analytics Canvas' });
  canvasId = created.data.canvas.id;
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)")
    .run(AGENT, canvasId, nowIso());
  seedRun('run-an-1', 'completed', '2026-08-14T10:00:00.000Z', '2026-08-14T10:00:10.000Z', 0.10);
  seedRun('run-an-2', 'completed', '2026-08-14T11:00:00.000Z', '2026-08-14T11:00:30.000Z', 0.20);
  seedRun('run-an-3', 'failed', '2026-08-14T12:00:00.000Z', '2026-08-14T12:00:05.000Z', 0.05);
  seedRun('run-an-4', 'halted_steps', '2026-08-14T13:00:00.000Z', '2026-08-14T13:01:00.000Z', 0.15);
  db.prepare("INSERT INTO run_feedback (run_id, verdict, note, by, ts) VALUES ('run-an-1', 'up', '', 'pete@cloudtechgurus.com', ?)").run(nowIso());
  db.prepare("INSERT INTO run_feedback (run_id, verdict, note, by, ts) VALUES ('run-an-3', 'down', '', 'pete@cloudtechgurus.com', ?)").run(nowIso());
  db.prepare("INSERT INTO escalations (id, canvas_id, agent_id, kind, question, created_at) VALUES ('esc-an-1', ?, ?, 'question', 'q', ?)")
    .run(canvasId, AGENT, nowIso());
  memory.recordRetrievals('run-an-1', 'acme seats', [{ id: seedEntry('retrieval target'), score: 2 }]);
});

function seedEntry(content, extra = {}) {
  return memory.writeEntry({
    canvasId, content, epistemic: extra.epistemic || 'inference',
    authorType: 'user', authorId: 'pete@cloudtechgurus.com', source: 'test', ...extra,
  }).id;
}

test.after(() => new Promise((resolve) => server.close(resolve)));

test('analytics aggregates run outcomes, duration, cost, feedback, escalations, retrievals per agent', async () => {
  const { status, data } = await call('GET', `/api/canvases/${canvasId}/analytics`);
  assert.equal(status, 200);
  const row = data.perAgent.find((r) => r.agent_id === AGENT);
  assert.equal(row.runs, 4);
  assert.equal(row.completed, 2);
  assert.equal(row.failed, 1);
  assert.equal(row.halted, 1);
  assert.ok(Math.abs(row.cost_usd - 0.5) < 1e-9);
  // durations: 10s, 30s, 5s, 60s → avg 26.25s
  assert.ok(Math.abs(row.avg_duration_ms - 26250) < 50, `avg_duration_ms was ${row.avg_duration_ms}`);
  assert.equal(row.feedback_up, 1);
  assert.equal(row.feedback_down, 1);
  const esc = data.escalations.find((e) => e.agent_id === AGENT);
  assert.equal(esc.total, 1);
  assert.equal(esc.open, 1);
  const ret = data.retrievals.find((r) => r.agent_id === AGENT);
  assert.equal(ret.searches, 1);
});

test('conflicts: two live verified entries on the same subject with different content surface; nothing auto-changes', async () => {
  seedEntry('Acme runs 400 seats', { epistemic: 'verified', kind: 'fact', subject: 'Acme Corp' });
  const bId = seedEntry('Acme runs 900 seats', { epistemic: 'verified', kind: 'fact', subject: 'acme corp' });
  seedEntry('Acme is in Phoenix', { epistemic: 'verified', kind: 'fact', subject: 'acme hq' }); // different subject — no conflict
  seedEntry('Acme might expand', { epistemic: 'inference', subject: 'acme corp' }); // not verified — no conflict

  const { data } = await call('GET', `/api/canvases/${canvasId}/memory/conflicts`);
  assert.equal(data.conflicts.length, 1, 'exactly one verified-vs-verified pair');
  assert.match(data.conflicts[0].subject.toLowerCase(), /acme corp/);

  // Nothing was demoted or superseded by detection.
  const entries = memory.listEntries({ canvasId, subject: 'acme corp' });
  assert.ok(entries.every((e) => !e.supersededBy));

  // Resolving through the normal correction path clears the conflict.
  memory.correctEntry({
    entryId: bId, content: 'Acme runs 400 seats (900 was the parent org)', epistemic: 'verified',
    reason: 'resolved conflict', authorType: 'user', authorId: 'pete@cloudtechgurus.com',
  });
  // The correction supersedes b; a-vs-correction still differ in content but the
  // correction now cites/supersedes — recompute: pair (a, correction) shares the
  // subject and both are verified with different content, so it still surfaces
  // until the human aligns content or corrects a. Assert the ORIGINAL pair is gone.
  const after = await call('GET', `/api/canvases/${canvasId}/memory/conflicts`);
  assert.ok(!after.data.conflicts.some((c) => c.entries.some((e) => e.id === bId)),
    'a superseded entry never appears in conflicts');
});

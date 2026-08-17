'use strict';
// P2 T2: the NEEDS YOU attention projection. One read-time union over
// authoritative records — no attention-side tables — with Mine/Team/All
// scoping, failed-run/escalation dedupe, and conflict parity with the
// existing /memory/conflicts endpoint.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-attn-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');
const { createEscalation } = require('../server/orchestrator/tools');

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

function insertRun(id, status, opts = {}) {
  db.prepare(`INSERT INTO runs (id, canvas_id, agent_id, status, trigger_kind, instruction, step_budget, wall_ms_budget, created_at)
    VALUES (?, ?, ?, ?, 'user', ?, 10, 60000, ?)`)
    .run(id, canvasId, agentId, status, opts.instruction || 'do the thing', nowIso());
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn('pete@cloudtechgurus.com');
  const created = await call('POST', '/api/canvases', { name: 'Attention T2' });
  canvasId = created.data.canvas.id;
  agentId = 'agent-attn-1';
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)")
    .run(agentId, canvasId, nowIso());
  await call('POST', '/api/allowlist', { email: 'darren@cloudtechgurus.com' });
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('every source type projects a full-contract card', async () => {
  // 1. open escalation
  const esc = createEscalation({ canvasId, runId: null, agentId, kind: 'question', question: 'Tier for X?', context: {} });
  // 2. verified-vs-verified conflict on the same subject
  const writeCommon = { canvasId, epistemic: 'verified', authorType: 'user', authorId: 'pete@cloudtechgurus.com' };
  memory.writeEntry({ ...writeCommon, content: 'Acme is tier 1.', subject: 'acme tier' });
  memory.writeEntry({ ...writeCommon, content: 'Acme is tier 3.', subject: 'acme tier' });
  // 3. overdue review
  memory.writeEntry({ canvasId, content: 'Assume Q3 pricing holds.', epistemic: 'assumption', authorType: 'user', authorId: 'pete@cloudtechgurus.com', reviewAt: '2020-01-01T00:00:00.000Z' });
  // 4. failed run with NO escalation (dedupe leaves it standing)
  insertRun('run-attn-fail', 'failed');
  // A preserved historical changeset is deliberately no longer an attention
  // source now that the workbook demo surface is retired.
  db.prepare("INSERT INTO changesets (id, canvas_id, run_id, agent_id, status, created_at) VALUES ('cs-attn-1', ?, NULL, ?, 'proposed', ?)")
    .run(canvasId, agentId, nowIso());

  const res = await call('GET', `/api/attention?canvas_id=${canvasId}`);
  assert.equal(res.status, 200);
  const byType = Object.groupBy ? Object.groupBy(res.data.attention, (r) => r.type)
    : res.data.attention.reduce((m, r) => ((m[r.type] = m[r.type] || []).push(r), m), {});
  for (const type of ['escalation', 'conflict', 'overdue_review', 'failed_run']) {
    assert.ok(byType[type] && byType[type].length >= 1, `missing ${type} card`);
  }
  assert.ok(!byType.pending_changeset, 'preserved demo changesets must not surface as current user work');
  // Full contract on every card.
  for (const row of res.data.attention) {
    for (const key of ['type', 'decision', 'context', 'consequence', 'recommendation', 'owner', 'due', 'actions', 'sourceRef', 'created_at']) {
      assert.ok(key in row, `${row.type} card missing ${key}`);
    }
    assert.ok(row.sourceRef.kind && row.sourceRef.id, `${row.type} card has no source record`);
    assert.ok(row.actions.length >= 1, `${row.type} card has no actions`);
  }
  assert.equal(byType.escalation[0].sourceRef.id, esc.id);
});

test('a run already referenced by an escalation yields no failed_run card', async () => {
  insertRun('run-attn-halted', 'halted_steps');
  createEscalation({ canvasId, runId: 'run-attn-halted', agentId, kind: 'steps', question: 'Out of steps.', context: {} });
  const res = await call('GET', `/api/attention?canvas_id=${canvasId}`);
  const failedIds = res.data.attention.filter((r) => r.type === 'failed_run').map((r) => r.sourceRef.id);
  assert.ok(!failedIds.includes('run-attn-halted'), 'escalated run must not double-report');
  assert.ok(failedIds.includes('run-attn-fail'), 'unescalated failure still reports');
});

test('halted_paused is a deliberate park, not attention', async () => {
  insertRun('run-attn-paused', 'halted_paused');
  const res = await call('GET', `/api/attention?canvas_id=${canvasId}`);
  assert.ok(!res.data.attention.some((r) => r.sourceRef.id === 'run-attn-paused'));
});

test('mine/team/all scoping follows the owner email', async () => {
  const escMine = createEscalation({ canvasId, runId: null, agentId, kind: 'question', question: 'Mine?', context: {} });
  const escTeam = createEscalation({ canvasId, runId: null, agentId, kind: 'question', question: 'Theirs?', context: {} });
  await call('POST', `/api/escalations/${escMine.id}/assign`, { owner_email: 'pete@cloudtechgurus.com' });
  await call('POST', `/api/escalations/${escTeam.id}/assign`, { owner_email: 'darren@cloudtechgurus.com' });

  const mine = await call('GET', `/api/attention?canvas_id=${canvasId}&scope=mine`);
  const mineIds = mine.data.attention.map((r) => r.sourceRef.id);
  assert.ok(mineIds.includes(escMine.id));
  assert.ok(!mineIds.includes(escTeam.id));
  assert.ok(mine.data.attention.every((r) => r.owner.email === 'pete@cloudtechgurus.com'));

  const team = await call('GET', `/api/attention?canvas_id=${canvasId}&scope=team`);
  const teamIds = team.data.attention.map((r) => r.sourceRef.id);
  assert.ok(teamIds.includes(escTeam.id));
  assert.ok(!teamIds.includes(escMine.id));

  const all = await call('GET', `/api/attention?canvas_id=${canvasId}`);
  const allIds = all.data.attention.map((r) => r.sourceRef.id);
  assert.ok(allIds.includes(escMine.id) && allIds.includes(escTeam.id));
});

test('conflict cards agree with the /memory/conflicts endpoint', async () => {
  const conflicts = await call('GET', `/api/canvases/${canvasId}/memory/conflicts`);
  const attn = await call('GET', `/api/attention?canvas_id=${canvasId}`);
  const conflictCards = attn.data.attention.filter((r) => r.type === 'conflict');
  assert.equal(conflictCards.length, conflicts.data.conflicts.length);
  const pair = conflicts.data.conflicts[0].entries.map((e) => e.id).sort();
  const cardPair = [conflictCards[0].sourceRef.id, conflictCards[0].sourceRef.secondId].sort();
  assert.deepEqual(cardPair, pair);
});

test('a resolved QUESTION escalation does not suppress a later failure card', async () => {
  insertRun('run-attn-qfail', 'failed');
  const esc = createEscalation({ canvasId, runId: 'run-attn-qfail', agentId, kind: 'question', question: 'Mid-run question?', context: {} });
  // Open question → escalation card carries the demand, run card suppressed.
  let res = await call('GET', `/api/attention?canvas_id=${canvasId}`);
  assert.ok(!res.data.attention.some((r) => r.type === 'failed_run' && r.sourceRef.id === 'run-attn-qfail'));
  // Resolved question → the failure is unhandled again and must resurface.
  await call('POST', `/api/escalations/${esc.id}/resolve`, { action: 'dismiss' });
  res = await call('GET', `/api/attention?canvas_id=${canvasId}`);
  assert.ok(res.data.attention.some((r) => r.type === 'failed_run' && r.sourceRef.id === 'run-attn-qfail'));
});

test('mine scope survives 100+ newer escalations owned by others', async () => {
  const mineEsc = createEscalation({ canvasId, runId: null, agentId, kind: 'question', question: 'Oldest, but mine.', context: {} });
  await call('POST', `/api/escalations/${mineEsc.id}/assign`, { owner_email: 'pete@cloudtechgurus.com' });
  for (let i = 0; i < 110; i += 1) {
    const e = createEscalation({ canvasId, runId: null, agentId, kind: 'question', question: `Noise ${i}`, context: {} });
    db.prepare('UPDATE escalations SET owner_email = ? WHERE id = ?').run('darren@cloudtechgurus.com', e.id);
  }
  const mine = await call('GET', `/api/attention?canvas_id=${canvasId}&scope=mine`);
  assert.ok(mine.data.attention.some((r) => r.sourceRef.id === mineEsc.id),
    'ownership must be applied before the row limit');
});

test('workspace-wide listing covers accessible canvases without canvas_id', async () => {
  const res = await call('GET', '/api/attention');
  assert.equal(res.status, 200);
  assert.ok(res.data.attention.some((r) => r.sourceRef.canvasId === canvasId));
});

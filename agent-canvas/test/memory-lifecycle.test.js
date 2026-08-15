'use strict';
// P2 T4: review defaults for NEW entries only (assumption +14d, inference
// +45d, verified/decision/constraint none unless explicit) and the compact
// lifecycle timeline derived from the supersession chain.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-lifecycle-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');

let base;
let cookie;
let canvasId;

const AUTHOR = { authorType: 'user', authorId: 'pete@cloudtechgurus.com' };

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

function daysFromNow(iso) {
  return (Date.parse(iso) - Date.now()) / (24 * 3600 * 1000);
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = await signIn('pete@cloudtechgurus.com');
  const created = await call('POST', '/api/canvases', { name: 'Lifecycle T4' });
  canvasId = created.data.canvas.id;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('review defaults: assumption +14d, inference +45d', () => {
  const a = memory.writeEntry({ canvasId, content: 'Assume renewal in Q4.', epistemic: 'assumption', ...AUTHOR });
  assert.ok(Math.abs(daysFromNow(a.reviewAt) - 14) < 0.1, `assumption default ~14d, got ${daysFromNow(a.reviewAt)}`);
  const i = memory.writeEntry({ canvasId, content: 'Likely a 500-seat deployment.', epistemic: 'inference', ...AUTHOR });
  assert.ok(Math.abs(daysFromNow(i.reviewAt) - 45) < 0.1, `inference default ~45d, got ${daysFromNow(i.reviewAt)}`);
});

test('verified entries and decision/constraint kinds get no default', () => {
  const v = memory.writeEntry({ canvasId, content: 'Contract signed 2026-08-01.', epistemic: 'verified', ...AUTHOR });
  assert.equal(v.reviewAt, null, 'verified external facts need an explicit date');
  const d = memory.writeEntry({ canvasId, content: 'We standardize on ask-mode probes.', epistemic: 'assumption', kind: 'decision', ...AUTHOR });
  assert.equal(d.reviewAt, null, 'decisions do not expire');
  const c = memory.writeEntry({ canvasId, content: 'Never name vendors in prompts.', epistemic: 'inference', kind: 'constraint', ...AUTHOR });
  assert.equal(c.reviewAt, null, 'constraints do not expire');
});

test('an explicit reviewAt always wins the default', () => {
  const e = memory.writeEntry({ canvasId, content: 'Assume booth budget is fixed.', epistemic: 'assumption', reviewAt: '2099-01-01T00:00:00.000Z', ...AUTHOR });
  assert.equal(e.reviewAt, '2099-01-01T00:00:00.000Z');
});

test('the HTTP write route defaults review_at when the field is omitted (live-probe regression)', async () => {
  const omitted = await call('POST', `/api/canvases/${canvasId}/memory`, { content: 'HTTP assumption, no review field.', epistemic: 'assumption' });
  assert.equal(omitted.status, 200);
  assert.ok(Math.abs(daysFromNow(omitted.data.entry.reviewAt) - 14) < 0.1,
    'the route must not coerce omitted review_at to an explicit null opt-out');
  const optedOut = await call('POST', `/api/canvases/${canvasId}/memory`, { content: 'HTTP assumption, explicit null.', epistemic: 'assumption', review_at: null });
  assert.equal(optedOut.data.entry.reviewAt, null);
});

test('an explicit null reviewAt opts out of the default entirely', () => {
  const e = memory.writeEntry({ canvasId, content: 'Assume this never needs review.', epistemic: 'assumption', reviewAt: null, ...AUTHOR });
  assert.equal(e.reviewAt, null, 'explicit null = unscheduled, not defaulted');
});

test('corrections inherit rather than re-defaulting (NEW entries only)', () => {
  const orig = memory.writeEntry({ canvasId, content: 'Assume 10 seats.', epistemic: 'assumption', reviewAt: '2030-06-01T00:00:00.000Z', ...AUTHOR });
  const { entry } = memory.correctEntry({ entryId: orig.id, content: 'Actually 12 seats.', epistemic: 'assumption', reason: 'recount', ...AUTHOR });
  assert.equal(entry.reviewAt, '2030-06-01T00:00:00.000Z', 'correction inherits, never re-defaults');
});

test('timeline classifies created → corrected → reclassified → reaffirmed across the chain', async () => {
  const e1 = memory.writeEntry({ canvasId, content: 'Acme runs 300 seats.', epistemic: 'assumption', subject: 'acme seats', ...AUTHOR });
  const { entry: e2 } = memory.correctEntry({ entryId: e1.id, content: 'Acme runs 340 seats.', epistemic: 'assumption', reason: 'updated count', ...AUTHOR });
  // Reclassify: same content, epistemic upgraded (human authority).
  const { entry: e3 } = memory.correctEntry({ entryId: e2.id, content: e2.content, epistemic: 'verified', reason: 'confirmed on the account call', ...AUTHOR });
  // Reaffirm via the T3 endpoint: same content, same epistemic, fresh date.
  const re = await call('POST', `/api/canvases/${canvasId}/memory/${e3.id}/reaffirm`, { review_at: '2099-01-01T00:00:00.000Z' });
  assert.equal(re.status, 200);

  // The timeline is identical from any entry in the chain.
  for (const id of [e1.id, e3.id, re.data.entry.id]) {
    const res = await call('GET', `/api/memory/${id}/timeline`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.events.map((ev) => ev.event), ['created', 'corrected', 'reclassified', 'reaffirmed']);
    assert.deepEqual(res.data.entries, [e1.id, e2.id, e3.id, re.data.entry.id]);
  }
});

test('a no-op correction (same content/label/date) reads corrected, not reaffirmed', () => {
  const e1 = memory.writeEntry({ canvasId, content: 'Same words forever.', epistemic: 'verified', ...AUTHOR });
  const { entry: e2 } = memory.correctEntry({ entryId: e1.id, content: e1.content, epistemic: 'verified', reason: 'noop', ...AUTHOR });
  const t = memory.entryTimeline(e2.id);
  assert.deepEqual(t.events.map((ev) => ev.event), ['created', 'corrected'],
    'reaffirmed is earned by a refreshed review date');
});

test('a chain longer than the hop cap says so instead of inventing a created event', () => {
  let e = memory.writeEntry({ canvasId, content: 'v0', epistemic: 'assumption', ...AUTHOR });
  const rootId = e.id;
  for (let i = 1; i <= 15; i += 1) {
    e = memory.correctEntry({ entryId: e.id, content: `v${i}`, epistemic: 'assumption', reason: 'iterate', ...AUTHOR }).entry;
  }
  const fromHead = memory.entryTimeline(e.id);
  assert.equal(fromHead.events[0].event, 'earlier history truncated');
  assert.notEqual(fromHead.events[0].entryId, rootId, 'the cap stops before the true root');
  const fromRoot = memory.entryTimeline(rootId);
  assert.equal(fromRoot.events[0].event, 'created');
  assert.equal(fromRoot.events[0].entryId, rootId);
});

test('timeline 404s on unknown entries and carries author names', async () => {
  const missing = await call('GET', '/api/memory/nope/timeline');
  assert.equal(missing.status, 404);
  const solo = memory.writeEntry({ canvasId, content: 'Standalone note.', epistemic: 'verified', authorType: 'user', authorId: 'pete@cloudtechgurus.com', authorName: 'Pete' });
  const res = await call('GET', `/api/memory/${solo.id}/timeline`);
  assert.deepEqual(res.data.events.map((ev) => ev.event), ['created']);
  assert.equal(res.data.events[0].byName, 'Pete');
});

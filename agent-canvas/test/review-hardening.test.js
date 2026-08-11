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

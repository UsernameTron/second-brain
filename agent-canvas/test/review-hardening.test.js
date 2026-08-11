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

'use strict';
// P1 run modes. ask/rehearse runs never mutate the world; one MUTATING_TOOLS
// set enforced twice — filtered from the offer (toolsForRole) AND refused at
// call time (executeTool). Memory stays writable; child runs inherit mode.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-modes-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test'; // placeholder, never called

const { db, nowIso } = require('../server/db');
const { toolsForRole, executeTool, blockedInMode, MUTATING_TOOLS } = require('../server/orchestrator/tools');
const { dispatchRun } = require('../server/orchestrator/queue');
require('../server/index'); // boots seed (canvases/allowlist) for dispatch fixtures

const CANVAS = 'canvas-modes-1';
const AGENT = 'agent-modes-1';

test.before(() => {
  db.prepare("INSERT INTO canvases (id, name, created_at) VALUES (?, 'Modes Canvas', ?)").run(CANVAS, nowIso());
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)").run(AGENT, CANVAS, nowIso());
});

test('ask runs are never OFFERED mutating tools; act runs are unchanged', () => {
  const askNames = toolsForRole('research', { mode: 'ask' }).map((t) => t.name);
  for (const name of MUTATING_TOOLS) {
    assert.ok(!askNames.includes(name), `${name} must not be offered in ask mode`);
  }
  assert.ok(askNames.includes('memory_write'), 'memory stays writable — receipts need it');
  assert.ok(askNames.includes('memory_search'));
  assert.ok(askNames.includes('escalate'));

  const actNames = toolsForRole('research', { mode: 'act' }).map((t) => t.name);
  assert.ok(actNames.includes('handoff'), 'act mode unchanged');
  const defaultNames = toolsForRole('research', {}).map((t) => t.name);
  assert.deepEqual(defaultNames, actNames, 'omitted mode defaults to act');
});

test('rehearse offers hs_preview_change (already a dry run) but nothing else mutating', () => {
  const names = toolsForRole('research', { mode: 'rehearse' }).map((t) => t.name);
  assert.ok(names.includes('hs_preview_change'));
  assert.ok(!names.includes('hs_apply_change'));
  assert.ok(!names.includes('ws_gmail_draft'));
  assert.ok(!names.includes('handoff'));
});

test('call-time re-check: a forced mutating call in an ask run is refused server-side', async () => {
  const ctx = {
    run: { id: 'run-mode-ask', canvas_id: CANVAS, agent_id: AGENT, initiated_by: 'pete@cloudtechgurus.com', mode: 'ask' },
    agent: { id: AGENT, name: 'Scout', role: 'research' },
    canvas: { id: CANVAS },
  };
  const res = await executeTool('ws_gmail_draft', { to: 'x@y.z', subject: 's', body: 'b' }, ctx);
  assert.ok(res.isError);
  assert.match(res.content, /REFUSED: this is a ask run/);
  const mcp = await executeTool('mcp_anything_at_all', {}, ctx);
  assert.ok(mcp.isError, 'all MCP tools blocked in ask mode');
});

test('blockedInMode: mcp_* always blocked outside act; preview exempt only in rehearse', () => {
  assert.equal(blockedInMode('mcp_soi_org_knowledge_search', 'ask'), true);
  assert.equal(blockedInMode('mcp_soi_org_knowledge_search', 'act'), false);
  assert.equal(blockedInMode('hs_preview_change', 'rehearse'), false);
  assert.equal(blockedInMode('hs_preview_change', 'ask'), true);
  assert.equal(blockedInMode('memory_write', 'ask'), false);
});

test('dispatchRun stores mode; child runs inherit the parent mode', () => {
  const parent = dispatchRun({ agentId: AGENT, canvasId: CANVAS, instruction: 'parent', initiatedBy: 'pete@cloudtechgurus.com', mode: 'rehearse' });
  assert.equal(db.prepare('SELECT mode FROM runs WHERE id = ?').get(parent.id).mode, 'rehearse');
  const child = dispatchRun({ agentId: AGENT, canvasId: CANVAS, instruction: 'child', triggerKind: 'handoff', parentRunId: parent.id });
  const childRow = db.prepare('SELECT mode, initiated_by FROM runs WHERE id = ?').get(child.id);
  assert.equal(childRow.mode, 'rehearse', 'mode inherited like initiated_by');
  assert.equal(childRow.initiated_by, 'pete@cloudtechgurus.com');
  assert.throws(() => dispatchRun({ agentId: AGENT, canvasId: CANVAS, instruction: 'x', mode: 'yolo' }), /mode must be one of/);
});

test('rehearse system prompt narrates; ask prompt says read-only', () => {
  const { _internal } = require('../server/orchestrator/runner');
  const agent = { name: 'Scout', role: 'research', system_prompt: 'do research' };
  const canvas = { id: CANVAS, name: 'Modes Canvas' };
  const ask = _internal.buildSystemPrompt(agent, canvas, { step_budget: 12, wall_ms_budget: 240000, mode: 'ask' });
  assert.match(ask, /Run mode: ASK/);
  const rehearse = _internal.buildSystemPrompt(agent, canvas, { step_budget: 12, wall_ms_budget: 240000, mode: 'rehearse' });
  assert.match(rehearse, /Run mode: REHEARSE/);
  const act = _internal.buildSystemPrompt(agent, canvas, { step_budget: 12, wall_ms_budget: 240000, mode: 'act' });
  assert.ok(!act.includes('Run mode:'), 'act prompt unchanged');
});

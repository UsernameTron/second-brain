'use strict';
// P4 T1: the Authority Map is enforced (offer + execute), legacy agents are
// untouched, config changes are versioned, and rollback restores config
// through an append-only history.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-auth-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const { toolsForRole, executeTool, governedTool, authorityMenu } = require('../server/orchestrator/tools');

const OWNER = 'pete@cloudtechgurus.com';
let base;
let ownerCookie;
let memberCookie;
let canvasId;
let agentId;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(cookie, method, apiPath, body) {
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
  ownerCookie = await signIn(OWNER);
  assert.equal((await call(ownerCookie, 'POST', '/api/allowlist', { email: 'darren@cloudtechgurus.com', role: 'member' })).status, 200);
  memberCookie = await signIn('darren@cloudtechgurus.com');
  const created = await call(ownerCookie, 'POST', '/api/canvases', { name: 'Authority T1' });
  canvasId = created.data.canvas.id;
  agentId = crypto.randomUUID();
  db.prepare(`INSERT INTO agents (id, canvas_id, name, role, model_tier, system_prompt, created_at)
    VALUES (?, ?, 'Scout', 'research', 'fast', 'find things', ?)`).run(agentId, canvasId, nowIso());
});

test.after(() => server.close());

test('offer filter: an explicit authority map strips ungranted governed tools, keeps cognition', () => {
  const full = toolsForRole('research', {});
  assert.ok(full.some((t) => t.name === 'ws_gmail_draft'), 'legacy surface includes workspace writes');

  const authority = ['hs_search', 'hs_get'];
  const trimmed = toolsForRole('research', { authority });
  const names = trimmed.map((t) => t.name);
  assert.ok(!names.includes('ws_gmail_draft'), 'ungranted workspace write absent');
  assert.ok(!names.includes('hs_apply_change'), 'ungranted hubspot write absent');
  assert.ok(!names.includes('enrich_contact'), 'ungranted enrichment absent');
  assert.ok(names.includes('hs_search'), 'granted tool present');
  assert.ok(names.includes('memory_write'), 'cognition tools never governed');
  assert.ok(names.includes('escalate'), 'escalate never governed');

  // Intersection only: an allowlist can never ADD beyond role/mode gates.
  const rehearse = toolsForRole('research', { authority: ['ws_gmail_draft'], mode: 'rehearse' });
  assert.ok(!rehearse.some((t) => t.name === 'ws_gmail_draft'), 'mode gate still wins over authority');
});

test('execute-time re-check refuses governed tools outside the authority map', async () => {
  db.prepare('UPDATE agents SET tools_json = ? WHERE id = ?').run(JSON.stringify(['hs_search']), agentId);
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
  const run = { id: 'run-auth-1', mode: 'act', canvas_id: canvasId, agent_id: agentId, initiated_by: OWNER };

  const refused = await executeTool('ws_gmail_search', { query: 'x' }, { run, agent, canvas });
  assert.equal(refused.isError, true);
  assert.match(refused.content, /authority map/);

  // Ungoverned tools still execute for the same agent.
  const rows = await executeTool('read_rows', {}, { run, agent, canvas });
  assert.ok(!rows.isError, `read_rows should work: ${rows.content}`);
  db.prepare('UPDATE agents SET tools_json = NULL WHERE id = ?').run(agentId);
});

test('authority menu is registry-grounded and governed-only', () => {
  const menu = authorityMenu('research', {});
  assert.ok(menu.length > 0);
  assert.ok(menu.every((m) => governedTool(m.name)), 'menu holds only governed tools');
  assert.ok(menu.every((m) => m.description.length > 0), 'every permission has plain language');
  assert.ok(!menu.some((m) => m.name === 'memory_write'), 'cognition never on the menu');
});

test('prompt/tier changes write versions (baseline first); rollback restores config, owner-only', async () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_versions WHERE agent_id = ?').get(agentId).n, 0);

  const patched = await call(ownerCookie, 'PATCH', `/api/canvases/${canvasId}/agents/${agentId}`, { system_prompt: 'find things carefully' });
  assert.equal(patched.status, 200);
  const versions = (await call(ownerCookie, 'GET', `/api/canvases/${canvasId}/agents/${agentId}/versions`)).data.versions;
  assert.equal(versions.length, 2, 'baseline + patch');
  assert.equal(versions[0].source, 'patch');
  assert.equal(versions[0].system_prompt, 'find things carefully');
  assert.equal(versions[1].source, 'baseline');
  assert.equal(versions[1].system_prompt, 'find things');

  const baseline = versions[1];
  assert.equal((await call(memberCookie, 'POST', `/api/canvases/${canvasId}/agents/${agentId}/rollback/${baseline.id}`)).status, 403);

  const rolled = await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/agents/${agentId}/rollback/${baseline.id}`);
  assert.equal(rolled.status, 200);
  assert.equal(rolled.data.agent.system_prompt, 'find things');
  assert.ok(rolled.data.diff.system_prompt, 'diff names the restored field');
  const after = (await call(ownerCookie, 'GET', `/api/canvases/${canvasId}/agents/${agentId}/versions`)).data.versions;
  assert.equal(after.length, 3, 'rollback appended, never rewrote');
  assert.equal(after[0].source, 'rollback');
  assert.equal(after[0].restored_from, baseline.id);
});

test('draft-lifecycle agents are invisible on canvas and inquiry surfaces', async () => {
  const draftId = crypto.randomUUID();
  db.prepare(`INSERT INTO agents (id, canvas_id, name, role, model_tier, system_prompt, created_at, lifecycle)
    VALUES (?, ?, 'Shadow', 'research', 'fast', 'draft prompt', ?, 'draft')`).run(draftId, canvasId, nowIso());

  const state = (await call(ownerCookie, 'GET', `/api/canvases/${canvasId}`)).data;
  assert.ok(!state.agents.some((a) => a.id === draftId), 'draft absent from canvas state');

  const inq = await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/inquiries`, { question: 'test?', agent_id: draftId });
  assert.equal(inq.status, 400, 'draft not selectable for inquiries');
});

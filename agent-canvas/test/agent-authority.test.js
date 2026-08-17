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
// The hs_* tools are disabled-by-absence (tools.js gates them on
// opsrunner.configured()), and these tests exercise them — so this deployment
// has the lane wired, exactly as hubspot-opsrunner.test.js does.
process.env.HS_OPS_RUNNER_URL = 'https://ops-runner.test.example';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const { toolsForRole, executeTool, governedTool, authorityMenu, parseAuthority, createEscalation } = require('../server/orchestrator/tools');
const { dispatchRun } = require('../server/orchestrator/queue');
const runner = require('../server/orchestrator/runner');
const builder = require('../server/builder');

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

test('retired demo tools are offered to no role and cannot execute', async () => {
  const retired = ['apply_row_fix', 'read_rows', 'set_row_status', 'propose_changes', 'read_changesets', 'verify_changes'];
  const roles = ['research', 'coding', 'review', 'strategic', 'commercial', 'targeting', 'unknown-role'];
  for (const role of roles) {
    const names = toolsForRole(role, { userRole: 'owner' }).map((t) => t.name);
    for (const name of retired) assert.ok(!names.includes(name), `${role} must not be offered ${name}`);
  }

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
  const run = { id: 'run-retired-tools', mode: 'act', canvas_id: canvasId, agent_id: agentId, initiated_by: OWNER };
  for (const name of retired) {
    const result = await executeTool(name, {}, { run, agent, canvas });
    assert.equal(result.isError, true, `${name} must be rejected at execution time`);
    assert.match(result.content, /^Unknown tool:/);
  }
});

test('the retired demo kickoff endpoint is absent', async () => {
  const res = await fetch(`${base}/api/canvases/${canvasId}/demo/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: '{}',
  });
  assert.equal(res.status, 404);
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
  db.prepare(`INSERT INTO notes (id, canvas_id, title, content, pinned, updated_at, deleted_at)
    VALUES ('retired-note-auth-test', ?, 'Retired demo note', 'must stay hidden', 0, ?, ?)`)
    .run(canvasId, nowIso(), nowIso());
  const notes = await executeTool('read_notes', {}, { run, agent, canvas });
  assert.ok(!notes.isError, `read_notes should work: ${notes.content}`);
  assert.ok(!JSON.parse(notes.content).some((note) => note.id === 'retired-note-auth-test'),
    'soft-deleted demo notes stay out of agent context');
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

// ---------- web_search: a PROVIDER-executed tool, so executeTool's call-time
// re-check never sees it. Its authority gate lives in the runner's per-call
// tool list, and both ends of that gate are covered here.

function waitForRun(runId, tries = 100) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
      if (run && !['queued', 'running'].includes(run.status)) return resolve(run);
      if (--tries <= 0) return reject(new Error('run never finished'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

// Runs the loop with a scripted model, capturing the tool list offered on each
// model call. `between` runs after the first call, before the second.
async function captureOfferedTools({ authorityJson = null, between = null } = {}) {
  const offered = [];
  let nth = 0;
  const restore = runner._internal.setCallModel(async ({ tools }) => {
    offered.push(tools.map((t) => t.name));
    nth += 1;
    if (nth === 1 && between) {
      between();
      return {
        content: [{ type: 'tool_use', id: 'tu-1', name: 'read_notes', input: {} }],
        stop_reason: 'tool_use', usage: {},
      };
    }
    return { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: {} };
  });
  try {
    const run = dispatchRun({
      agentId, canvasId, instruction: 'look something up', initiatedBy: OWNER, authorityJson,
    });
    await waitForRun(run.id);
  } finally { restore(); }
  return offered;
}

test('web_search is never offered to a research agent whose authority map omits it', async () => {
  db.prepare('UPDATE agents SET tools_json = NULL WHERE id = ?').run(agentId);
  const legacy = await captureOfferedTools();
  assert.ok(legacy[0].includes('web_search'), 'legacy (no allowlist) agent still gets web search');

  db.prepare('UPDATE agents SET tools_json = ? WHERE id = ?').run(JSON.stringify(['hs_search']), agentId);
  const trimmed = await captureOfferedTools();
  assert.ok(!trimmed[0].includes('web_search'), 'ungranted web_search must never be offered');

  db.prepare('UPDATE agents SET tools_json = ? WHERE id = ?').run(JSON.stringify(['web_search']), agentId);
  const granted = await captureOfferedTools();
  assert.ok(granted[0].includes('web_search'), 'granted web_search is offered');

  // The standing-grant dimension: the run's dispatch snapshot is intersected
  // with live authority, so a snapshot without web_search wins over an agent
  // that has it.
  const snapshotted = await captureOfferedTools({ authorityJson: JSON.stringify(['hs_search']) });
  assert.ok(!snapshotted[0].includes('web_search'), 'dispatch snapshot narrows the live grant');
  db.prepare('UPDATE agents SET tools_json = NULL WHERE id = ?').run(agentId);
});

test('web_search authority is re-checked between model calls, not only at run start', async () => {
  db.prepare('UPDATE agents SET tools_json = ? WHERE id = ?').run(JSON.stringify(['web_search', 'hs_search']), agentId);
  const offered = await captureOfferedTools({
    // The owner narrows the agent mid-run, exactly as the executeTool re-check
    // already honours for ordinary governed tools.
    between: () => db.prepare('UPDATE agents SET tools_json = ? WHERE id = ?').run(JSON.stringify(['hs_search']), agentId),
  });
  assert.equal(offered.length, 2, 'the loop made a second model call');
  assert.ok(offered[0].includes('web_search'), 'offered while the authority held');
  assert.ok(!offered[1].includes('web_search'), 'withdrawn authority removes it from the next model call');
  db.prepare('UPDATE agents SET tools_json = NULL WHERE id = ?').run(agentId);
});

test('rollback restores authority faithfully — including a legacy NULL (see routes.js)', async () => {
  // The pre-P4 shape: an agent with no allowlist, i.e. the full role surface.
  db.prepare('UPDATE agents SET tools_json = NULL WHERE id = ?').run(agentId);
  const legacy = builder.recordVersion(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId),
    { source: 'baseline', actor: OWNER });
  assert.equal(builder.getVersion(legacy).tools_json, null, 'the snapshot preserves NULL, not "[]"');

  // A P4 publish narrows it to an explicit grant.
  db.prepare('UPDATE agents SET tools_json = ? WHERE id = ?').run(JSON.stringify(['hs_search']), agentId);
  assert.ok(!toolsForRole('research', { authority: ['hs_search'] }).some((t) => t.name === 'ws_gmail_draft'));

  const rolled = await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/agents/${agentId}/rollback/${legacy}`);
  assert.equal(rolled.status, 200);
  assert.equal(rolled.data.agent.tools_json, null, 'the pre-P4 config comes back as it was');
  // DELIBERATE, DOCUMENTED WIDENING: NULL means "no allowlist", so the role
  // surface returns. The owner must be able to see it happen.
  assert.ok(rolled.data.diff.tools_json, 'the diff names tools_json — the widening is never silent');
  assert.equal(rolled.data.diff.tools_json.to, null);
  const restored = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  assert.equal(parseAuthority(restored.tools_json), null, 'NULL parses as legacy full role surface');
  assert.ok(toolsForRole('research', { authority: parseAuthority(restored.tools_json) })
    .some((t) => t.name === 'ws_gmail_draft'), 'the legacy surface is genuinely back');
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.rollback'").get().n >= 1, 'audited');
});

test('draft-lifecycle agents are invisible on canvas, inquiry, handoff and NEEDS YOU surfaces', async () => {
  const draftId = crypto.randomUUID();
  db.prepare(`INSERT INTO agents (id, canvas_id, name, role, model_tier, system_prompt, created_at, lifecycle)
    VALUES (?, ?, 'Shadow', 'research', 'fast', 'draft prompt', ?, 'draft')`).run(draftId, canvasId, nowIso());

  const state = (await call(ownerCookie, 'GET', `/api/canvases/${canvasId}`)).data;
  assert.ok(!state.agents.some((a) => a.id === draftId), 'draft absent from canvas state');

  const inq = await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/inquiries`, { question: 'test?', agent_id: draftId });
  assert.equal(inq.status, 400, 'draft not selectable for inquiries');

  // Reachability: a LIVE agent must not be able to route work into a shadow
  // draft, so name resolution has to exclude it too — not just the UI.
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
  const run = { id: 'run-auth-draft', mode: 'act', canvas_id: canvasId, agent_id: agentId, initiated_by: OWNER };
  const listed = JSON.parse((await executeTool('list_agents', {}, { run, agent, canvas })).content);
  assert.ok(!listed.some((a) => a.name === 'Shadow'), 'draft absent from list_agents');
  const handed = await executeTool('handoff', { to_agent_name: 'Shadow', message: 'take this' }, { run, agent, canvas });
  assert.equal(handed.isError, true);
  assert.match(handed.content, /No agent named/);

  // NEEDS YOU: a draft's escalation and its rehearsal failure belong to the
  // builder flow, not the human tray.
  createEscalation({
    canvasId, runId: null, agentId: draftId, kind: 'question',
    question: 'Should the shadow do this?', context: {},
  });
  db.prepare(`INSERT INTO runs (id, agent_id, canvas_id, trigger_kind, instruction, status, step_budget, wall_ms_budget, created_at, mode)
    VALUES ('run-auth-shadow-failed', ?, ?, 'user', 'rehearse me', 'failed', 8, 60000, ?, 'rehearse')`)
    .run(draftId, canvasId, nowIso());

  const tray = (await call(ownerCookie, 'GET', `/api/attention?canvas_id=${canvasId}`)).data.attention;
  assert.ok(!tray.some((c) => c.escalatingAgentId === draftId), 'draft escalation absent from NEEDS YOU');
  assert.ok(!tray.some((c) => c.sourceRef.id === 'run-auth-shadow-failed'), 'draft rehearsal failure absent from NEEDS YOU');

  // The same two records on a LIVE agent DO reach the tray — proving the
  // filter is lifecycle-scoped, not just an empty query.
  db.prepare(`INSERT INTO runs (id, agent_id, canvas_id, trigger_kind, instruction, status, step_budget, wall_ms_budget, created_at, mode)
    VALUES ('run-auth-live-failed', ?, ?, 'user', 'do the thing', 'failed', 8, 60000, ?, 'act')`)
    .run(agentId, canvasId, nowIso());
  const tray2 = (await call(ownerCookie, 'GET', `/api/attention?canvas_id=${canvasId}`)).data.attention;
  assert.ok(tray2.some((c) => c.sourceRef.id === 'run-auth-live-failed'), 'a live agent\'s failed run still demands a human');
});

'use strict';
// Google Workspace integration — guardrail proofs.
// The owner's contract: READ broadly, WRITE reasonably, DESTROY never.
// These tests prove the "never" is structural, not behavioral.

process.env.DEV_AUTH = '1';
process.env.JWT_SECRET = 'test-secret-material-32-bytes-xx';
process.env.DB_PATH = ':memory:';

const { test } = require('node:test');
const assert = require('node:assert');

const ws = require('../server/google/workspace');
const { db } = require('../server/db');

// ---------- structural absence of destructive operations ----------
test('no send, delete, or update-in-place operation exists to be called', () => {
  const exported = Object.keys(ws).filter((k) => typeof ws[k] === 'function');
  for (const name of exported) {
    assert.ok(!/send|delete|remove|trash|clear|archive/i.test(name),
      `exported function ${name} looks destructive`);
  }
  // and the known-safe surface is exactly what we expect
  const surface = exported.sort().join(',');
  for (const required of ['sheetsRead', 'sheetsAppend', 'sheetsUpdate', 'driveSearch', 'driveReadText',
    'docsCreate', 'gmailSearch', 'gmailRead', 'gmailCreateDraft', 'calendarList', 'calendarCreate']) {
    assert.ok(surface.includes(required), `missing ${required}`);
  }
});

test('requested scopes never include send or full-drive access', () => {
  for (const scope of ws.SCOPES) {
    assert.ok(!scope.includes('gmail.send'), 'gmail.send must never be requested');
    assert.ok(!scope.endsWith('/drive'), 'full drive scope must never be requested');
    assert.ok(!scope.includes('admin'), 'admin scopes must never be requested');
  }
});

test('gmailCreateDraft targets the drafts endpoint, never send', async () => {
  db.prepare("INSERT OR REPLACE INTO google_tokens (user_email, refresh_token_enc, scopes, connected_at, updated_at) VALUES (?, ?, '', '', '')")
    .run('pete@cloudtechgurus.com', ws._internal.encrypt('fake-refresh'));
  const urls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    urls.push(new URL(String(url)));
    if (new URL(String(url)).hostname === 'oauth2.googleapis.com') {
      return { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'draft-1' }) };
  };
  try {
    const out = await ws.gmailCreateDraft({ email: 'pete@cloudtechgurus.com', to: 'x@y.com', subject: 's', body: 'b' });
    assert.equal(out.draftId, 'draft-1');
    // exact hostname comparison — a substring check would also match
    // evil.example/gmail.googleapis.com, and the assertion should prove the
    // call went to the real host, not just a lookalike path
    const apiCalls = urls.filter((u) => u.hostname === 'gmail.googleapis.com');
    assert.ok(apiCalls.length > 0, 'the draft call must go to gmail.googleapis.com');
    assert.ok(apiCalls.every((u) => u.pathname.includes('/drafts')), 'gmail call must hit /drafts');
    assert.ok(urls.every((u) => !u.pathname.includes('/send')), 'no URL path may contain /send');
  } finally { global.fetch = realFetch; }
});

// ---------- blanking writes are refused below the tool layer ----------
test('sheet writes that would only blank cells are refused', () => {
  const { assertValues } = ws._internal;
  assert.throws(() => assertValues([[]]), /non-empty|blank/);
  assert.throws(() => assertValues([['', '', '']]), /blank/);
  assert.throws(() => assertValues([[null, undefined], ['', '  ']]), /blank/);
  assert.doesNotThrow(() => assertValues([['real value', '']]));
});

// ---------- token crypto ----------
test('refresh tokens survive an encrypt/decrypt round trip and are not stored in the clear', () => {
  const { encrypt, decrypt } = ws._internal;
  const secret = 'refresh-token-abc-123';
  const blob = encrypt(secret);
  assert.ok(!blob.includes(secret), 'ciphertext must not contain the plaintext');
  assert.equal(decrypt(blob), secret);
  assert.notEqual(encrypt(secret), blob, 'random IV: same plaintext, different ciphertext');
});

// ---------- identity: tools act as the directing human, or not at all ----------
test('runs inherit the initiator through the handoff chain', () => {
  const { dispatchRun } = require('../server/orchestrator/queue');
  const crypto = require('node:crypto');
  const { nowIso } = require('../server/db');
  const canvasId = crypto.randomUUID();
  db.prepare("INSERT INTO canvases (id, name, access_mode, created_by, created_at) VALUES (?, 'c', 'workspace', 't', ?)").run(canvasId, nowIso());
  const a1 = crypto.randomUUID(); const a2 = crypto.randomUUID();
  for (const [id, name] of [[a1, 'A'], [a2, 'B']]) {
    db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, ?, 'research', '#2080D0', 'fast', '', 0, 0, ?)")
      .run(id, canvasId, name, nowIso());
  }
  const parent = dispatchRun({ agentId: a1, canvasId, instruction: 'root', initiatedBy: 'pete@cloudtechgurus.com' });
  const child = dispatchRun({ agentId: a2, canvasId, instruction: 'handed off', triggerKind: 'handoff', parentRunId: parent.id });
  assert.equal(db.prepare('SELECT initiated_by FROM runs WHERE id = ?').get(parent.id).initiated_by, 'pete@cloudtechgurus.com');
  assert.equal(db.prepare('SELECT initiated_by FROM runs WHERE id = ?').get(child.id).initiated_by, 'pete@cloudtechgurus.com',
    'handoff child must inherit the directing human');
  const orphan = dispatchRun({ agentId: a1, canvasId, instruction: 'system', triggerKind: 'system' });
  assert.equal(db.prepare('SELECT initiated_by FROM runs WHERE id = ?').get(orphan.id).initiated_by, null);
});

test('workspace tools refuse to act without a directing user', async () => {
  const { executeTool } = require('../server/orchestrator/tools');
  const res = await executeTool('ws_gmail_search', { query: 'x' }, {
    run: { id: 'r', initiated_by: null }, agent: { id: 'a' }, canvas: { id: 'c' },
  });
  assert.ok(res.isError);
  assert.match(res.content, /no directing user/i);
});

test('workspace tools guide the user to connect when no token exists', async () => {
  const { executeTool } = require('../server/orchestrator/tools');
  const res = await executeTool('ws_gmail_search', { query: 'x' }, {
    run: { id: 'r', initiated_by: 'nobody@cloudtechgurus.com' }, agent: { id: 'a' }, canvas: { id: 'c' },
  });
  assert.ok(res.isError);
  assert.match(res.content, /not connected/i);
  assert.match(res.content, /Capabilities panel/i);
});

// ---------- the UI matrix and the enforcement are the same object ----------
test('every advertised capability maps to a real tool; every cannot has no tool', () => {
  const { toolsForRole } = require('../server/orchestrator/tools');
  const toolNames = new Set(toolsForRole('research').map((t) => t.name));
  // advertised "can" ids exist as ws_ tools (where they name agent-invocable ops)
  const idToTool = {
    gmail_search: 'ws_gmail_search', gmail_draft: 'ws_gmail_draft',
    drive_search: 'ws_drive_search', drive_read: 'ws_drive_read', docs_create: 'ws_docs_create',
    sheets_read: 'ws_sheets_read', sheets_append: 'ws_sheets_append', sheets_update: 'ws_sheets_update',
    calendar_list: 'ws_calendar_list', calendar_create: 'ws_calendar_create',
  };
  for (const sf of ws.CAPABILITIES) {
    for (const c of sf.can) {
      assert.ok(toolNames.has(idToTool[c.id]), `capability ${c.id} advertised but tool missing`);
    }
  }
  // nothing tool-shaped exists for the forbidden verbs
  for (const t of toolNames) {
    assert.ok(!/send|delete|cancel|clear|share/i.test(t), `tool ${t} contradicts the cannot column`);
  }
});

// ---------- systems board ----------
test('health endpoint reports real statuses and never fakes green', async () => {
  const express = require('express');
  const routes = require('../server/routes');
  const jwt = require('jsonwebtoken');
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  db.prepare("INSERT OR IGNORE INTO allowlist (email, role, display_name, added_by, added_at) VALUES ('pete@cloudtechgurus.com', 'owner', 'Pete', 'test', '')").run();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  try {
    const auth = await fetch(`http://127.0.0.1:${port}/api/auth/dev`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pete@cloudtechgurus.com' }),
    });
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    const res = await fetch(`http://127.0.0.1:${port}/api/health/integrations`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    const byId = Object.fromEntries(body.integrations.map((i) => [i.id, i]));
    // no model credential in the test env -> the lamp is red, not green
    assert.equal(byId.model.status, 'down', 'model without credentials must show down');
    // no OAuth client in the test env -> workspace surfaces are dark, not green
    for (const id of ['gmail', 'drive', 'sheets', 'calendar']) {
      assert.equal(byId[id].status, 'planned', `${id} without an OAuth client must be dark`);
    }
    // unwired-by-design integrations are dark and say so
    assert.equal(byId.hubspot.status, 'planned');
    assert.match(byId.hubspot.detail, /not wired/i);
    // audit chain verifies green on a healthy database
    assert.equal(byId.audit.status, 'ready');
    // aggregate reflects the worst real state (model is down)
    assert.equal(body.aggregate, 'down');
    assert.ok(body.queue && typeof body.queue.queued === 'number');
    // probing an unconnected surface fails loudly, not silently
    const probe = await fetch(`http://127.0.0.1:${port}/api/health/probe`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ surface: 'gmail' }),
    });
    assert.ok(probe.status >= 400, 'probe without a connected account must error');
  } finally { server.close(); }
});

test('a configured lamp earns green only from probe evidence (finding 8)', async () => {
  const probestate = require('../server/probestate');
  const prev = process.env.HS_OPS_RUNNER_URL;
  process.env.HS_OPS_RUNNER_URL = 'https://ops-runner.test.example';
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', require('../server/routes'));
  db.prepare("INSERT OR IGNORE INTO allowlist (email, role, display_name, added_by, added_at) VALUES ('pete@cloudtechgurus.com', 'owner', 'Pete', 'test', '')").run();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  try {
    const auth = await fetch(`http://127.0.0.1:${port}/api/auth/dev`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pete@cloudtechgurus.com' }),
    });
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    const lamp = async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/health/integrations`, { headers: { cookie } });
      return (await res.json()).integrations.find((i) => i.id === 'hubspot');
    };
    // config present, never probed -> amber, not green
    let hs = await lamp();
    assert.equal(hs.status, 'attention', 'config presence alone must not be green');
    assert.match(hs.detail, /unprobed/i);
    // successful probe evidence -> green, with the measurement in the detail
    probestate.record('hubspot', { ok: true, ms: 42 });
    hs = await lamp();
    assert.equal(hs.status, 'ready');
    assert.match(hs.detail, /Probe OK \(42ms\)/);
    // failed probe evidence -> red with the named error
    probestate.record('hubspot', { ok: false, error: 'IAM says no' });
    hs = await lamp();
    assert.equal(hs.status, 'down');
    assert.match(hs.detail, /IAM says no/);
  } finally {
    server.close();
    probestate._state.delete('hubspot');
    if (prev === undefined) delete process.env.HS_OPS_RUNNER_URL; else process.env.HS_OPS_RUNNER_URL = prev;
  }
});

test('/intent sits behind the budget gate and the pause switch (finding 13)', async () => {
  const control = require('../server/orchestrator/control');
  const crypto = require('node:crypto');
  const { nowIso } = require('../server/db');
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', require('../server/routes'));
  db.prepare("INSERT OR IGNORE INTO allowlist (email, role, display_name, added_by, added_at) VALUES ('pete@cloudtechgurus.com', 'owner', 'Pete', 'test', '')").run();
  const canvasId = crypto.randomUUID();
  db.prepare("INSERT INTO canvases (id, name, access_mode, created_by, created_at) VALUES (?, 'i', 'workspace', 't', ?)").run(canvasId, nowIso());
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const prevBudget = control.getDailyBudget();
  try {
    const auth = await fetch(`http://127.0.0.1:${port}/api/auth/dev`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pete@cloudtechgurus.com' }),
    });
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    const intent = () => fetch(`http://127.0.0.1:${port}/api/canvases/${canvasId}/intent`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: 'ask scout to check the rows' }),
    });
    control.setDailyBudget(0, 'test');
    assert.equal((await intent()).status, 429, 'exhausted budget must refuse the model call');
    control.setDailyBudget(prevBudget, 'test');
    control.setPaused(true, 'test');
    assert.equal((await intent()).status, 409, 'a paused workspace must refuse the model call');
  } finally {
    control.setPaused(false, 'test');
    control.setDailyBudget(prevBudget, 'test');
    server.close();
  }
});

test('probe surface lookup ignores inherited properties (no prototype dispatch)', async () => {
  for (const evil of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    await assert.rejects(
      () => ws.probeSurface('pete@cloudtechgurus.com', evil),
      (err) => err.status === 404 && /no probe/.test(err.message),
      `PROBES lookup must reject inherited key ${evil}`,
    );
  }
});

// ---------- scope modes (the tester-gate escape hatch) ----------
test('standard scope mode drops exactly the restricted scopes and hides gmail tools', () => {
  const prev = process.env.GOOGLE_WORKSPACE_SCOPES;
  try {
    process.env.GOOGLE_WORKSPACE_SCOPES = 'standard';
    const active = ws.activeScopes();
    assert.equal(active.length, 3);
    for (const scope of active) {
      assert.ok(!scope.includes('gmail'), 'standard mode must request no gmail scope');
      assert.ok(!scope.endsWith('drive.readonly'), 'standard mode must not request drive.readonly');
    }
    assert.equal(ws.gmailEnabled(), false);
    const { toolsForRole } = require('../server/orchestrator/tools');
    const names = toolsForRole('research').map((t) => t.name);
    assert.ok(!names.some((n) => n.startsWith('ws_gmail')), 'gmail tools must be absent, not just refusing');
    assert.ok(names.includes('ws_sheets_read') && names.includes('ws_calendar_create'), 'non-restricted tools remain');

    process.env.GOOGLE_WORKSPACE_SCOPES = 'full';
    assert.equal(ws.activeScopes().length, 6);
    assert.ok(require('../server/orchestrator/tools').toolsForRole('research').some((t) => t.name === 'ws_gmail_draft'));
  } finally {
    if (prev === undefined) delete process.env.GOOGLE_WORKSPACE_SCOPES; else process.env.GOOGLE_WORKSPACE_SCOPES = prev;
  }
});

test('gmail operations refuse with the scope-mode explanation in standard mode', async () => {
  const prev = process.env.GOOGLE_WORKSPACE_SCOPES;
  try {
    process.env.GOOGLE_WORKSPACE_SCOPES = 'standard';
    await assert.rejects(() => ws.gmailSearch({ email: 'x@y.com', query: 'q' }), /GOOGLE_WORKSPACE_SCOPES=standard/);
    await assert.rejects(() => ws.gmailCreateDraft({ email: 'x@y.com', to: 'a@b.c', subject: 's', body: 'b' }), /standard/);
  } finally {
    if (prev === undefined) delete process.env.GOOGLE_WORKSPACE_SCOPES; else process.env.GOOGLE_WORKSPACE_SCOPES = prev;
  }
});

test('a bullet-masked ANTHROPIC_API_KEY shows a named down lamp, not a deep SDK error', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevProvider = process.env.MODEL_PROVIDER;
  try {
    process.env.MODEL_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-a••••';
    const express = require('express');
    const routes = require('../server/routes');
    const app = express(); app.use(express.json()); app.use('/api', routes);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    try {
      const auth = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/dev`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'pete@cloudtechgurus.com' }),
      });
      const cookie = auth.headers.get('set-cookie').split(';')[0];
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health/integrations`, { headers: { cookie } });
      const body = await res.json();
      const model = body.integrations.find((i) => i.id === 'model');
      assert.equal(model.status, 'down', 'corrupted key must show down, not ready');
      assert.match(model.detail, /masked terminal paste/i, 'the lamp names the actual failure');
    } finally { server.close(); }
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevProvider === undefined) delete process.env.MODEL_PROVIDER; else process.env.MODEL_PROVIDER = prevProvider;
  }
});

test('agent system-prompt edits are owner-only and audited (finding 11)', async () => {
  const crypto = require('node:crypto');
  const { nowIso } = require('../server/db');
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', require('../server/routes'));
  db.prepare("INSERT OR IGNORE INTO allowlist (email, role, display_name, added_by, added_at) VALUES ('pete@cloudtechgurus.com', 'owner', 'Pete', 'test', '')").run();
  db.prepare("INSERT OR IGNORE INTO allowlist (email, role, display_name, added_by, added_at) VALUES ('member@cloudtechgurus.com', 'member', 'M', 'test', '')").run();
  const canvasId = crypto.randomUUID();
  db.prepare("INSERT INTO canvases (id, name, access_mode, created_by, created_at) VALUES (?, 'p', 'workspace', 't', ?)").run(canvasId, nowIso());
  const agentId = crypto.randomUUID();
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, 'P', 'research', '#2080D0', 'fast', 'original', 0, 0, ?)").run(agentId, canvasId, nowIso());
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const signIn = async (email) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    return r.headers.get('set-cookie').split(';')[0];
  };
  const patch = (cookie, body) => fetch(`http://127.0.0.1:${port}/api/canvases/${canvasId}/agents/${agentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  try {
    const member = await signIn('member@cloudtechgurus.com');
    assert.equal((await patch(member, { system_prompt: 'member rewrite' })).status, 403, 'member prompt edit refused');
    assert.equal(db.prepare('SELECT system_prompt FROM agents WHERE id = ?').get(agentId).system_prompt, 'original');
    assert.equal((await patch(member, { x: 9, y: 9 })).status, 200, 'member can still move the agent');
    const owner = await signIn('pete@cloudtechgurus.com');
    assert.equal((await patch(owner, { system_prompt: 'owner rewrite' })).status, 200);
    assert.equal(db.prepare('SELECT system_prompt FROM agents WHERE id = ?').get(agentId).system_prompt, 'owner rewrite');
    const audits = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'agent.prompt_update'").get();
    assert.ok(audits.n >= 1, 'the owner edit is audited');
  } finally { server.close(); }
});

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

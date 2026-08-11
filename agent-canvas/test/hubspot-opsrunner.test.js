'use strict';
// HubSpot via the Ops Runner — guardrail proofs. The runner is the policy
// authority; these tests prove the CLIENT never asks it anything the canvas
// contract forbids, and that apply is gated on human approval.

process.env.DEV_AUTH = '1';
process.env.JWT_SECRET = 'test-secret-material-32-bytes-xx';
process.env.DB_PATH = ':memory:';
process.env.HS_OPS_RUNNER_URL = 'https://runner.test.example';
process.env.HS_OPS_RUNNER_ID_TOKEN = 'test-id-token';

const { test } = require('node:test');
const assert = require('node:assert');
const opsrunner = require('../server/hubspot/opsrunner');
const { executeTool } = require('../server/orchestrator/tools');

function mockFetch(handler) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return handler(String(url), opts);
  };
  return { calls, restore: () => { global.fetch = real; } };
}
const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

test('destructive and forbidden argv are refused client-side, before any network call', async () => {
  const { calls, restore } = mockFetch(() => okJson({}));
  try {
    for (const argv of [
      ['objects', 'delete', '123'],
      ['objects', 'merge'],
      ['properties', 'batch-archive'],
      ['workflows', 'delete', '9'],
      ['auth', 'login'],
      ['objects', 'update', '1', '--type', 'contacts', '--digest', 'x'],
      ['objects', 'update', '1', '--type', 'contacts', '--token', 'pat-x'],
    ]) {
      await assert.rejects(() => opsrunner.runArgv({ argv, actorEmail: 't@x' }), /refused client-side/);
    }
    assert.equal(calls.length, 0, 'no forbidden argv may reach the wire');
  } finally { restore(); }
});

test('builders produce exact runner argv and validate inputs', () => {
  assert.deepEqual(opsrunner.buildArgv('search', { type: 'contacts', filter: 'email~acme.com' }),
    ['objects', 'search', '--type', 'contacts', '--filter', 'email~acme.com']);
  assert.deepEqual(opsrunner.buildArgv('change', { operation: 'update', type: 'contacts', id: '42', properties: { tier: 'gold' } }),
    ['objects', 'update', '42', '--type', 'contacts', '--property', 'tier=gold']);
  assert.throws(() => opsrunner.buildArgv('change', { operation: 'delete', type: 'contacts', properties: { a: 1 } }), /create, update, or upsert/);
  assert.throws(() => opsrunner.buildArgv('search', { type: 'contacts; rm -rf', filter: 'x' }), /invalid object type/);
  assert.throws(() => opsrunner.buildArgv('get', { type: 'contacts', id: '1 OR 1=1' }), /invalid record id/);
  assert.throws(() => opsrunner.buildArgv('change', { operation: 'create', type: 'contacts', properties: { 'bad name': 'x' } }), /invalid property name/);
  // dynamic dispatch is own-property only
  for (const evil of ['constructor', '__proto__', 'toString']) {
    assert.throws(() => opsrunner.buildArgv(evil, {}), /unknown operation/);
  }
});

test('preview never sends confirm; apply sends confirm exactly once', async () => {
  const bodies = [];
  const { restore } = mockFetch((url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return okJson({ dry_run: true, applied: false });
  });
  try {
    const ctxBase = { agent: { id: 'a' }, canvas: { id: 'c' } };
    const preview = await executeTool('hs_preview_change',
      { operation: 'create', type: 'contacts', properties: { email: 'x@y.com' } },
      { run: { id: 'r1', initiated_by: 'pete@ctg.com', trigger_kind: 'user' }, ...ctxBase });
    assert.ok(!preview.isError, preview.content);
    assert.equal(bodies[0].confirm, undefined, 'preview must not carry confirm');
    assert.match(preview.content, /escalate with this preview/i);

    const blocked = await executeTool('hs_apply_change',
      { operation: 'create', type: 'contacts', properties: { email: 'x@y.com' } },
      { run: { id: 'r2', initiated_by: 'pete@ctg.com', trigger_kind: 'user' }, ...ctxBase });
    assert.ok(blocked.isError, 'apply outside escalation_resume must refuse');
    assert.match(blocked.content, /human-approved escalation/i);
    assert.equal(bodies.length, 1, 'refused apply must not reach the wire');

    const applied = await executeTool('hs_apply_change',
      { operation: 'create', type: 'contacts', properties: { email: 'x@y.com' } },
      { run: { id: 'r3', initiated_by: 'pete@ctg.com', trigger_kind: 'escalation_resume' }, ...ctxBase });
    assert.ok(!applied.isError, applied.content);
    assert.equal(bodies[1].confirm, true, 'approved apply carries confirm:true');
  } finally { restore(); }
});

test('requests carry the service identity token to the runner URL', async () => {
  const { calls, restore } = mockFetch(() => okJson({ portal_id: '246460341' }));
  try {
    const result = await opsrunner.probe('pete@ctg.com');
    assert.ok(result.ok && result.sandbox, 'probe confirms the sandbox portal');
    assert.match(calls[0].url, /^https:\/\/runner\.test\.example\/run$/);
    assert.equal(calls[0].opts.headers.authorization, 'Bearer test-id-token');
  } finally { restore(); }
});

test('tools refuse without a directing user, and explain when unconfigured', async () => {
  const ctxBase = { agent: { id: 'a' }, canvas: { id: 'c' } };
  const noUser = await executeTool('hs_search', { type: 'contacts', filter: 'x' },
    { run: { id: 'r', initiated_by: null }, ...ctxBase });
  assert.ok(noUser.isError);
  assert.match(noUser.content, /no directing user/i);
});

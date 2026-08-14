'use strict';
// Enrichment dispatch client — the guardrails, not the vendor logic. The
// service owns fan-out, merge, and gating; these tests prove the CANVAS never
// asks it for anything the fold-in spec forbids: no commit path, no unbounded
// spend, no tool offered to a role or a deployment that shouldn't have it.

process.env.DEV_AUTH = '1';
process.env.JWT_SECRET = 'test-secret-material-32-bytes-xx';
process.env.DB_PATH = ':memory:';
process.env.ED_DISPATCH_URL = 'https://enrichment.test.example';
process.env.ED_DISPATCH_ID_TOKEN = 'test-id-token';

const { test } = require('node:test');
const assert = require('node:assert');
const dispatch = require('../server/enrichment/dispatch');
const { toolsForRole, executeTool } = require('../server/orchestrator/tools');

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

test('there is no commit operation, and asking for one never reaches the wire', async () => {
  const { calls, restore } = mockFetch(() => okJson({}));
  try {
    for (const op of ['commit', 'v1/commit', 'writeback', 'constructor', '__proto__', 'toString']) {
      await assert.rejects(async () => dispatch.run(op, { email: 'a@b.com' }), /unknown enrichment operation/);
    }
    assert.equal(calls.length, 0, 'CRM-bound writes stay on the ops-runner lane');
  } finally { restore(); }
});

test('per-call spend is clamped to the ceiling whatever the model asks for', async () => {
  const { clampCredits, MAX_CREDITS_CEILING } = dispatch._internal;
  assert.equal(MAX_CREDITS_CEILING, 3);
  assert.equal(clampCredits(50), 3, 'a runaway ask is clamped, not honored');
  assert.equal(clampCredits(1.5), 1.5, 'a modest ask is respected');
  assert.equal(clampCredits(undefined), 3, 'omitted means the ceiling, never "unlimited"');
  assert.equal(clampCredits(0), 3);
  assert.equal(clampCredits(-9), 3);
  assert.equal(clampCredits('nonsense'), 3);

  const { calls, restore } = mockFetch(() => okJson({ cost_credits: 1 }));
  try {
    await dispatch.run('enrich_contact', { email: 'a@b.com', max_credits: 999, actorEmail: 'p@ctg' });
    assert.equal(JSON.parse(calls[0].opts.body).max_credits, 3);
  } finally { restore(); }
});

test('only known identity fields are forwarded; the caller email rides along for the ledger', async () => {
  const { pickIdentity } = dispatch._internal;
  assert.deepEqual(pickIdentity({ email: ' a@b.com ', nope: 'x', title: '' }), { email: 'a@b.com' });

  const { calls, restore } = mockFetch(() => okJson({ record_key: 'k1' }));
  try {
    await dispatch.run('enrich_contact', {
      email: 'a@b.com', company_name: 'Acme', injected: 'drop me', actorEmail: 'pete@cloudtechgurus.com',
    });
    const body = JSON.parse(calls[0].opts.body);
    assert.deepEqual(Object.keys(body).sort(), ['company_name', 'email', 'max_credits']);
    assert.equal(calls[0].opts.headers['x-caller-email'], 'pete@cloudtechgurus.com');
    assert.equal(calls[0].opts.headers.authorization, 'Bearer test-id-token');
  } finally { restore(); }
});

test('path inputs cannot traverse or smuggle another route', async () => {
  const { calls, restore } = mockFetch(() => okJson({}));
  try {
    await assert.rejects(async () => dispatch.run('get_enriched_contact', { key: '../../v1/commit' }), /invalid record key/);
    await assert.rejects(async () => dispatch.run('enrich_company', { domain: '../v1/commit' }), /invalid domain/);
    await assert.rejects(async () => dispatch.run('enrich_company', { domain: 'notadomain' }), /invalid domain/);
    assert.equal(calls.length, 0);

    await dispatch.run('get_enriched_contact', { key: 'a@b.com', actorEmail: 't@x' });
    assert.ok(calls[0].url.endsWith('/v1/contact/a%40b.com'));
  } finally { restore(); }
});

test('enrich_contact refuses an empty identity rather than paying for a blind lookup', async () => {
  const { calls, restore } = mockFetch(() => okJson({}));
  try {
    await assert.rejects(async () => dispatch.run('enrich_contact', { actorEmail: 't@x' }), /needs at least one of/);
    assert.equal(calls.length, 0);
  } finally { restore(); }
});

test('tools are offered only to the lead-gen roles', () => {
  const names = (role) => toolsForRole(role, { userRole: 'owner' }).map((t) => t.name);
  for (const role of ['research', 'targeting', 'commercial']) {
    assert.ok(names(role).includes('enrich_contact'), `${role} should have enrichment`);
    assert.ok(names(role).includes('get_enriched_contact'));
  }
  for (const role of ['coding', 'review', 'workspace', 'crm', 'strategic', 'operational']) {
    assert.ok(!names(role).includes('enrich_contact'), `${role} must not have enrichment`);
  }
  assert.ok(!names('research').some((n) => /commit/.test(n)), 'no commit tool is ever advertised');
});

test('an unconfigured deployment advertises nothing and executes nothing', async () => {
  const url = process.env.ED_DISPATCH_URL;
  delete process.env.ED_DISPATCH_URL;
  try {
    assert.equal(dispatch.configured(), false);
    assert.ok(!toolsForRole('research', { userRole: 'owner' }).map((t) => t.name).includes('enrich_contact'),
      'a model must never see a tool this deployment cannot honor');
    const res = await executeTool('enrich_contact', { email: 'a@b.com' }, {
      run: { id: 'r1', initiated_by: 'pete@cloudtechgurus.com' },
      agent: { id: 'a1', role: 'research' },
      canvas: { id: 'c1' },
    });
    assert.ok(res.isError);
    assert.match(res.content, /not wired on this deployment/);
  } finally { process.env.ED_DISPATCH_URL = url; }
});

test('executeTool requires a directing user and re-checks the role at call time', async () => {
  const { calls, restore } = mockFetch(() => okJson({ ok: true }));
  try {
    const noUser = await executeTool('enrich_contact', { email: 'a@b.com' }, {
      run: { id: 'r1', initiated_by: null }, agent: { id: 'a1', role: 'research' }, canvas: { id: 'c1' },
    });
    assert.ok(noUser.isError);
    assert.match(noUser.content, /no directing user/);

    const wrongRole = await executeTool('enrich_contact', { email: 'a@b.com' }, {
      run: { id: 'r1', initiated_by: 'pete@cloudtechgurus.com' }, agent: { id: 'a1', role: 'coding' }, canvas: { id: 'c1' },
    });
    assert.ok(wrongRole.isError);
    assert.match(wrongRole.content, /scoped to/);

    assert.equal(calls.length, 0, 'neither refusal may spend a credit');
  } finally { restore(); }
});

test('a service error surfaces as a tool error, not a thrown run', async () => {
  const { restore } = mockFetch(() => ({ ok: false, status: 429, json: async () => ({ detail: 'daily company-enrichment credit budget exhausted' }) }));
  try {
    const res = await executeTool('enrich_company', { domain: 'acme.com' }, {
      run: { id: 'r1', initiated_by: 'pete@cloudtechgurus.com' }, agent: { id: 'a1', role: 'targeting' }, canvas: { id: 'c1' },
    });
    assert.ok(res.isError);
    assert.match(res.content, /429/);
    assert.match(res.content, /budget exhausted/);
  } finally { restore(); }
});

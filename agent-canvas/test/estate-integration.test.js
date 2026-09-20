'use strict';
// CTG hub estate integration: the estate read tools (thin READ clients of
// seo-monitor / ops-automation) and the service-to-service "Needs You" count
// lane. Same guardrail focus as enrichment-dispatch.test.js: no write path,
// nothing offered to a role or deployment that shouldn't have it, and the
// pre-auth route fails closed at every step.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-estate-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';
process.env.SEO_MONITOR_URL = 'https://seo-monitor.test.example';
process.env.OPS_AUTOMATION_URL = 'https://ops-automation.test.example';
process.env.ESTATE_ID_TOKEN = 'test-id-token';
// The service lane must start disabled — the 503 test runs before these are set.
delete process.env.TICK_AUDIENCE;
delete process.env.STATUS_INVOKER_SA;

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const reads = require('../server/estate/reads');
const { toolsForRole, executeTool } = require('../server/orchestrator/tools');
const standingRules = require('../server/standing-rules');

const STATUS_SA = 'l10-hub-status@proj.iam.gserviceaccount.com';

let base;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

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

// ---------- estate read clients ----------

test('the three reads hit their fixed paths with the OIDC bearer, nothing else', async () => {
  const { calls, restore } = mockFetch(() => okJson({ ok: true }));
  try {
    await reads.run('estate_seo_metrics', 'pete@cloudtechgurus.com');
    await reads.run('estate_ops_hygiene', 'pete@cloudtechgurus.com');
    await reads.run('estate_pipeline_digest', 'pete@cloudtechgurus.com');
    assert.deepEqual(calls.map((c) => c.url), [
      'https://seo-monitor.test.example/metrics/today',
      'https://ops-automation.test.example/scan/hygiene',
      'https://ops-automation.test.example/digest/pipeline',
    ]);
    for (const c of calls) {
      assert.equal(c.opts.headers.authorization, 'Bearer test-id-token');
      assert.equal(c.opts.method, undefined, 'GET only — no method, no body');
      assert.equal(c.opts.body, undefined);
    }
  } finally { restore(); }
});

test('an unknown operation never reaches the wire', async () => {
  const { calls, restore } = mockFetch(() => okJson({}));
  try {
    for (const op of ['commit', 'v1/commit', 'constructor', '__proto__']) {
      await assert.rejects(async () => reads.run(op, 'p@ctg'), /unknown estate operation/);
    }
    assert.equal(calls.length, 0);
  } finally { restore(); }
});

test('tools are offered per-service to the enrichment roles only', () => {
  const names = (role) => toolsForRole(role, { userRole: 'owner' }).map((t) => t.name);
  for (const role of ['research', 'targeting', 'commercial', 'enrichment']) {
    assert.ok(names(role).includes('estate_seo_metrics'), `${role} should have estate reads`);
    assert.ok(names(role).includes('estate_ops_hygiene'));
    assert.ok(names(role).includes('estate_pipeline_digest'));
  }
  for (const role of ['coding', 'review', 'workspace', 'crm', 'strategic', 'operational']) {
    assert.ok(!names(role).includes('estate_seo_metrics'), `${role} must not have estate reads`);
  }
  // Half-configured deployment: only the tools the deployment can honor.
  const seoUrl = process.env.SEO_MONITOR_URL;
  delete process.env.SEO_MONITOR_URL;
  try {
    const offered = names('research');
    assert.ok(!offered.includes('estate_seo_metrics'), 'a model must never see a tool this deployment cannot honor');
    assert.ok(offered.includes('estate_ops_hygiene'), 'the ops-automation tools stay offered');
  } finally { process.env.SEO_MONITOR_URL = seoUrl; }
});

test('executeTool: unconfigured refuses, wrong role refuses, success wraps as external content', async () => {
  const ctx = (role) => ({
    run: { id: 'r-estate-1', initiated_by: 'pete@cloudtechgurus.com' },
    agent: { id: 'a-estate-1', role },
    canvas: { id: 'c-estate-1' },
  });
  const opsUrl = process.env.OPS_AUTOMATION_URL;
  delete process.env.OPS_AUTOMATION_URL;
  try {
    const res = await executeTool('estate_ops_hygiene', {}, ctx('research'));
    assert.ok(res.isError);
    assert.match(res.content, /OPS_AUTOMATION_URL unset/);
  } finally { process.env.OPS_AUTOMATION_URL = opsUrl; }

  const wrongRole = await executeTool('estate_seo_metrics', {}, ctx('coding'));
  assert.ok(wrongRole.isError);
  assert.match(wrongRole.content, /scoped to/);

  // Evidence refs need a real run row.
  db.prepare("INSERT INTO canvases (id, name, created_at) VALUES ('c-estate-1', 'Estate', ?)").run(nowIso());
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES ('a-estate-1', 'c-estate-1', 'Scout', 'research', ?)").run(nowIso());
  db.prepare(`INSERT INTO runs (id, canvas_id, agent_id, status, trigger_kind, instruction, step_budget, wall_ms_budget, created_at, initiated_by)
    VALUES ('r-estate-1', 'c-estate-1', 'a-estate-1', 'running', 'user', 'check seo', 10, 60000, ?, 'pete@cloudtechgurus.com')`).run(nowIso());
  const { restore } = mockFetch(() => okJson({ clicks: 12 }));
  try {
    const ok = await executeTool('estate_seo_metrics', {}, ctx('research'));
    assert.ok(!ok.isError, ok.content);
    assert.match(ok.content, /<external_content source="estate">/, 'third-party data is boundary-tagged');
    assert.match(ok.content, /\[evidence_ref: /, 'the read leaves an evidence ref');
  } finally { restore(); }
});

// ---------- the service "Needs You" count lane ----------

// The lane sits in the 10/min auth bucket, keyed by client IP. `ip` rides
// X-Forwarded-For (the app trusts one proxy hop) so a test with many requests
// draws from its own bucket instead of 429ing.
async function countHttp(bearer, actorEmail, ip = '') {
  const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {};
  if (actorEmail !== undefined) headers['X-Actor-Email'] = actorEmail;
  if (ip) headers['X-Forwarded-For'] = ip;
  const res = await fetch(`${base}/api/service/attention-count`, { headers });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, text };
}

test('lane disabled (503) while TICK_AUDIENCE / STATUS_INVOKER_SA are unset', async () => {
  const res = await countHttp('any-token');
  assert.equal(res.status, 503);
  assert.match(res.data.error, /STATUS_INVOKER_SA/);
});

test('missing token 401, bad token 401, wrong SA 403, unverified email 403, right SA 200 with the count', async () => {
  process.env.TICK_AUDIENCE = `${base}/api/standing-rules/tick`;
  process.env.STATUS_INVOKER_SA = STATUS_SA;
  try {
    assert.equal((await countHttp()).status, 401, 'no bearer token');

    let restore = standingRules._internal.setTickVerifier(async () => { throw new Error('invalid signature'); });
    try { assert.equal((await countHttp('garbage')).status, 401); } finally { restore(); }

    restore = standingRules._internal.setTickVerifier(async () => ({ email: 'evil@attacker.com', email_verified: true }));
    try { assert.equal((await countHttp('signed-but-wrong-sa')).status, 403); } finally { restore(); }

    restore = standingRules._internal.setTickVerifier(async () => ({ email: STATUS_SA, email_verified: false }));
    try { assert.equal((await countHttp('unverified')).status, 403); } finally { restore(); }

    // One open escalation on the canvas above → the count reflects it.
    db.prepare(`INSERT INTO escalations (id, canvas_id, kind, question, created_at) VALUES (?, 'c-estate-1', 'question', 'Which tier?', ?)`)
      .run(crypto.randomUUID(), nowIso());
    restore = standingRules._internal.setTickVerifier(async (idToken, audience) => {
      assert.equal(audience, process.env.TICK_AUDIENCE, 'verifies against the shared audience');
      return { email: STATUS_SA, email_verified: true };
    });
    try {
      const ok = await countHttp('valid-oidc');
      assert.equal(ok.status, 200);
      assert.ok(Number.isInteger(ok.data.needsYou) && ok.data.needsYou >= 1, `count includes the open escalation, got ${ok.data.needsYou}`);
      assert.ok(ok.data.generatedAt, 'stamps generatedAt');
    } finally { restore(); }
  } finally {
    delete process.env.TICK_AUDIENCE;
    delete process.env.STATUS_INVOKER_SA;
  }
});

test('X-Actor-Email narrows to that person: mine count, 5 capped items, address never echoed; invalid is 400', async () => {
  process.env.TICK_AUDIENCE = `${base}/api/standing-rules/tick`;
  process.env.STATUS_INVOKER_SA = STATUS_SA;
  const OWNER = 'mine-test@cloudtechgurus.com';
  const q = (email) => email;
  let restore = standingRules._internal.setTickVerifier(async () => ({ email: STATUS_SA, email_verified: true }));
  try {
    for (let i = 0; i < 6; i += 1) {
      db.prepare(`INSERT INTO escalations (id, canvas_id, kind, question, owner_email, created_at) VALUES (?, 'c-estate-1', 'question', ?, ?, ?)`)
        .run(crypto.randomUUID(), `Q${i} ${'x'.repeat(300)}`, OWNER, nowIso());
    }
    const mine = await countHttp('valid-oidc', q(OWNER), '10.0.0.1');
    assert.equal(mine.status, 200);
    assert.equal(mine.data.count, 6, 'only the cards this person owns - the unowned escalation above is excluded');
    assert.equal(mine.data.mine, true);
    assert.equal(mine.data.needsYou, undefined, 'a mine count is never labelled as the workspace count');
    assert.ok(mine.data.generatedAt);
    assert.equal(mine.data.items.length, 5, 'at most 5 items');
    for (const item of mine.data.items) {
      assert.deepEqual(Object.keys(item).sort(), ['created_at', 'kind', 'title']);
      assert.equal(item.kind, 'escalation');
      assert.equal(item.title.length, 120, 'titles are truncated to 120 chars');
    }
    assert.ok(!mine.text.toLowerCase().includes('mine-test'), 'the address is never echoed');

    const upper = await countHttp('valid-oidc', q('Mine-Test@CloudTechGurus.com'), '10.0.0.1');
    assert.equal(upper.data.count, 6, 'case-insensitive');

    const nobody = await countHttp('valid-oidc', q('nobody@cloudtechgurus.com'), '10.0.0.1');
    assert.deepEqual([nobody.status, nobody.data.count, nobody.data.items], [200, 0, []]);

    for (const bad of ['', 'pete@evil.com', 'pete@cloudtechgurus.com.evil.com', 'a@b@cloudtechgurus.com',
      '@cloudtechgurus.com', 'pe te@cloudtechgurus.com', 'cloudtechgurus.com', `${'x'.repeat(250)}@cloudtechgurus.com`]) {
      const res = await countHttp('valid-oidc', q(bad), '10.0.0.2');
      assert.equal(res.status, 400, `rejects ${JSON.stringify(bad.slice(0, 40))}`);
      assert.deepEqual(res.data, { error: 'invalid email' }, 'no fall back to the workspace count, no echo');
    }

    const plain = await countHttp('valid-oidc', undefined, '10.0.0.1');
    assert.ok(Number.isInteger(plain.data.needsYou) && plain.data.needsYou >= 7, 'without email the workspace-wide response is unchanged');
    assert.deepEqual(Object.keys(plain.data).sort(), ['generatedAt', 'needsYou']);

    restore();
    restore = standingRules._internal.setTickVerifier(async () => ({ email: 'evil@attacker.com', email_verified: true }));
    assert.equal((await countHttp('wrong-sa', q(OWNER), '10.0.0.1')).status, 403, 'the SA check still gates the email view');
  } finally {
    restore();
    delete process.env.TICK_AUDIENCE;
    delete process.env.STATUS_INVOKER_SA;
  }
});

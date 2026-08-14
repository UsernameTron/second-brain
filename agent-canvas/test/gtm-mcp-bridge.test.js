'use strict';
// GTM bridge — end-to-end proof: mcp/client.js (with ${GCP_IDTOKEN} header)
// → gtm-mcp-bridge HTTP front → (fake) BigQuery executor, and back. The
// real executor is never exercised here; its seam is _setRunQuery.

process.env.DEV_AUTH = '1';
process.env.JWT_SECRET = 'test-secret-material-32-bytes-xx';
process.env.DB_PATH = ':memory:';
process.env.MCP_GCP_ID_TOKEN = 'fake-id-token-for-tests'; // client escape hatch
process.env.PORT = '0';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let bridge; let stopBridge; let url;
const queries = []; // every (sql, params) the bridge tried to run

before(async () => {
  const mod = require('../gtm-mcp-bridge/server');
  bridge = mod.server; stopBridge = mod.stop;
  mod._setRunQuery(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [{ company_name: 'Acme Health', tier: 'A', score: '91', scored_at: '2026-08-14 06:00:00' }], totalRows: 1 };
  });
  await new Promise((resolve) => (bridge.listening ? resolve() : bridge.on('listening', resolve)));
  url = `http://127.0.0.1:${bridge.address().port}/gtm`;
  process.env.MCP_SERVERS = JSON.stringify([{
    name: 'gtm-marts', url,
    headers: { authorization: '${GCP_IDTOKEN}' },
    enabledTools: ['gtm_tier_list', 'gtm_account_lookup'],
    access: 'members',
  }]);
});
after(() => { stopBridge(); });

test('healthz answers', async () => {
  const res = await fetch(url.replace('/gtm', '/healthz'));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { ok: true });
});

test('client handshakes, lists 4 named tools, calls one end to end', async () => {
  const mcp = require('../server/mcp/client');
  mcp.reload();
  const probe = await mcp.probeServer('gtm-marts');
  assert.ok(probe.ok);
  assert.strictEqual(probe.tools, 4);
  const out = await mcp.callTool({ server: 'gtm-marts', tool: 'gtm_tier_list', args: { tier: 'A', limit: 999 }, actorEmail: 'test@x' });
  assert.match(out, /Acme Health/);
  const q = queries.at(-1);
  assert.match(q.sql, /account_scores/);
  assert.strictEqual(q.params.tier.value, 'A');
  assert.strictEqual(q.params.lim.value, '100', 'limit clamps to the server-side ceiling');
});

test('tool descriptions carry the routing rule and the tier caveat', async () => {
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const { result } = await res.json();
  assert.strictEqual(result.tools.length, 4);
  for (const t of result.tools) {
    assert.match(t.description, /hubspot-crm/, `${t.name} must carry the routing rule`);
    assert.match(t.description, /yesterday/, `${t.name} must flag staleness`);
    assert.ok(t.description.length <= 400, `${t.name} description survives the client's 400-char cap`);
  }
  for (const name of ['gtm_account_lookup', 'gtm_tier_list']) {
    assert.match(result.tools.find((t) => t.name === name).description, /SOURCING FILTER/i);
  }
});

test('unknown tool errors without touching BigQuery; query failure returns isError', async () => {
  const rpc = async (body) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const bad = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'gtm_drop_table', arguments: {} } });
  assert.ok(bad.error, 'unknown tool is a JSON-RPC error');
  require('../gtm-mcp-bridge/server')._setRunQuery(async () => { throw new Error('bigquery 403: denied'); });
  const fail = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'gtm_dq_snapshot', arguments: {} } });
  assert.strictEqual(fail.result.isError, true);
  assert.match(fail.result.content[0].text, /denied/);
});

test('id-token reference stays masked; non-gtm paths 404, bad json 400', async () => {
  const mcp = require('../server/mcp/client');
  const srv = mcp.listServers().find((s) => s.name === 'gtm-marts');
  assert.strictEqual(srv.headers.authorization, '${GCP_IDTOKEN}');
  assert.strictEqual((await fetch(url.replace('/gtm', '/other'), { method: 'POST', body: '{}' })).status, 404);
  assert.strictEqual((await fetch(url, { method: 'POST', body: 'not json' })).status, 400);
});

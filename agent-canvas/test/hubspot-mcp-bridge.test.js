'use strict';
// Phase 3 bridge — end-to-end proof: mcp/client.js (with ${GCP_IDTOKEN}
// header) → hubspot-mcp-bridge HTTP front → stdio child, and back.

process.env.DEV_AUTH = '1';
process.env.JWT_SECRET = 'test-secret-material-32-bytes-xx';
process.env.DB_PATH = ':memory:';
process.env.MCP_GCP_ID_TOKEN = 'fake-id-token-for-tests'; // client escape hatch
process.env.PORT = '0';
process.env.MCP_CHILD_CMD = `node ${require('node:path').join(__dirname, 'fixtures', 'fake-stdio-mcp.js')}`;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let bridge; let url;

let stopBridge;
before(async () => {
  ({ server: bridge, stop: stopBridge } = require('../hubspot-mcp-bridge/server'));
  await new Promise((resolve) => (bridge.listening ? resolve() : bridge.on('listening', resolve)));
  url = `http://127.0.0.1:${bridge.address().port}/crm`;
  process.env.MCP_SERVERS = JSON.stringify([{
    name: 'hubspot-crm', url,
    headers: { authorization: '${GCP_IDTOKEN}' },
    enabledTools: ['hubspot-get-contacts'],
    access: 'owner',
  }]);
});
after(() => { stopBridge(); });

test('healthz reports a live child', async () => {
  const res = await fetch(url.replace('/crm', '/healthz'));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { ok: true });
});

test('client completes handshake, lists and calls a tool through the bridge', async () => {
  const mcp = require('../server/mcp/client');
  mcp.reload();
  const probe = await mcp.probeServer('hubspot-crm');
  assert.ok(probe.ok);
  assert.strictEqual(probe.tools, 1);
  const out = await mcp.callTool({ server: 'hubspot-crm', tool: 'hubspot-get-contacts', args: { limit: 2 }, actorEmail: 'test@x' });
  assert.match(out, /called hubspot-get-contacts with {"limit":2}/);
});

test('id-token reference stays masked in listings', () => {
  const mcp = require('../server/mcp/client');
  const srv = mcp.listServers().find((s) => s.name === 'hubspot-crm');
  assert.strictEqual(srv.headers.authorization, '${GCP_IDTOKEN}');
});

test('non-crm paths 404, bad json 400', async () => {
  assert.strictEqual((await fetch(url.replace('/crm', '/other'), { method: 'POST', body: '{}' })).status, 404);
  assert.strictEqual((await fetch(url, { method: 'POST', body: 'not json' })).status, 400);
});

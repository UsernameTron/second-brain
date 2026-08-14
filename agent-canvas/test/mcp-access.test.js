'use strict';
// MCP connector access control: DB-backed config, header spreading with
// ${ENV:NAME} resolution, masking, owner/member + role filtering of tool
// defs, call-time re-check, owner-only management routes, seed idempotency.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-mcpaccess-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';
process.env.TEST_MCP_SECRET = 'sk-test-9876';
delete process.env.MCP_SERVERS; // force the DB path

const { server } = require('../server/index'); // boots + seeds (incl. seed_mcp_v1)
const { db, nowIso, getSetting } = require('../server/db');
const mcp = require('../server/mcp/client');
const { seedMcpServers } = require('../server/mcp/seed');
const { toolsForRole } = require('../server/orchestrator/tools');

let base;
let ownerCookie;
let memberCookie;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}
async function call(method, apiPath, cookie, body) {
  const res = await fetch(`${base}${apiPath}`, {
    method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

// Long-lived local MCP mock — several tests hit it; closed in the after hook.
const http = require('node:http');
const seenHeaders = [];
const mock = http.createServer((req, res) => {
  seenHeaders.push(req.headers);
  res.setHeader('content-type', 'application/json');
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const rpc = JSON.parse(body);
    const result = rpc.method === 'initialize' ? { capabilities: {} }
      : rpc.method === 'tools/list' ? { tools: [{ name: 'search', description: 'find things', inputSchema: { type: 'object', properties: {} } }] }
      : { content: [{ type: 'text', text: 'ok' }] };
    res.end(JSON.stringify(rpc.id === undefined ? {} : { jsonrpc: '2.0', id: rpc.id, result }));
  });
});

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  await new Promise((resolve) => mock.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ownerCookie = await signIn('pete@cloudtechgurus.com');
  memberCookie = await signIn('fred@cloudtechgurus.com');
});
test.after(() => Promise.all([
  new Promise((resolve) => server.close(resolve)),
  new Promise((resolve) => mock.close(resolve)),
]));

test('seed: LinkedIn + lead-finder connectors present, tools EMPTY, idempotent', () => {
  assert.ok(getSetting('seed_mcp_v2'));
  const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY name').all();
  assert.deepEqual(rows.map((r) => r.name), ['linkedin-blitz', 'linkedin-fresh', 'sr-icp-leadfinder']);
  for (const row of rows) {
    assert.equal(row.access, 'members');
    assert.deepEqual(JSON.parse(row.enabled_tools_json), [], 'inert until the owner enables tools');
    assert.deepEqual(JSON.parse(row.roles_json), ['research', 'targeting', 'commercial']);
  }
  for (const name of ['linkedin-blitz', 'linkedin-fresh']) {
    const headers = JSON.parse(rows.find((r) => r.name === name).headers_json);
    assert.equal(headers['x-api-key'], '${ENV:RAPIDAPI_KEY}', 'key stored as reference, not value');
  }
  const finder = rows.find((r) => r.name === 'sr-icp-leadfinder');
  assert.equal(finder.url, 'https://sr-icp-connector.fly.dev/mcp');
  assert.deepEqual(JSON.parse(finder.headers_json), {}, 'the lead finder takes no credential');
  assert.equal(seedMcpServers().seeded, false, 'second call no-ops');
});

test('seed v2 on an already-seeded workspace adds only the new row', () => {
  // Simulate the live workspace: v1-era rows present, v2 key absent. The
  // UNIQUE name + INSERT OR IGNORE means the loop is safe to re-run, and the
  // audit line must report what landed (1), not the constant's length (3).
  const { setSetting } = require('../server/db');
  db.prepare("DELETE FROM mcp_servers WHERE name = 'sr-icp-leadfinder'").run();
  setSetting('seed_mcp_v2', '');
  const out = seedMcpServers();
  assert.equal(out.seeded, true);
  assert.equal(out.servers, 1, 'only the genuinely new connector counts');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM mcp_servers').get().c, 3);
});

test('DB config reaches the client; masked listing never leaks a header value', () => {
  const ts = nowIso();
  db.prepare("INSERT INTO mcp_servers (id, name, url, headers_json, enabled_tools_json, access, roles_json, enabled, created_at, updated_at) VALUES ('t1', 'intel', 'https://intel.example/mcp', ?, ?, 'owner', '[]', 1, ?, ?)")
    .run(JSON.stringify({ 'x-api-key': 'super-secret-value-1234', authorization: '${ENV:TEST_MCP_SECRET}' }), JSON.stringify(['search']), ts, ts);
  mcp.reload();
  const listed = mcp.listServers().find((srv) => srv.name === 'intel');
  assert.ok(listed);
  assert.equal(listed.access, 'owner');
  assert.equal(listed.headers['x-api-key'], '••••1234', 'literal masked to last 4');
  assert.equal(listed.headers.authorization, '${ENV:TEST_MCP_SECRET}', 'reference shown as reference');
  assert.ok(!JSON.stringify(listed).includes('super-secret-value'), 'value never in a listing');
});

test('header resolution: \${ENV:NAME} resolves per request; requests carry all headers', async () => {
  const port = mock.address().port;
  const ts = nowIso();
  db.prepare("INSERT INTO mcp_servers (id, name, url, headers_json, enabled_tools_json, access, roles_json, enabled, created_at, updated_at) VALUES ('t2', 'mock', ?, ?, ?, 'members', '[]', 1, ?, ?)")
    .run(`http://127.0.0.1:${port}/mcp`, JSON.stringify({ 'x-api-key': '\${ENV:TEST_MCP_SECRET}', 'x-api-host': 'mock.example' }), JSON.stringify(['search']), ts, ts);
  mcp.reload();
  const out = await mcp.callTool({ server: 'mock', tool: 'search', args: {}, actorEmail: 'pete@cloudtechgurus.com' });
  assert.equal(out, 'ok');
  assert.ok(seenHeaders.length >= 2);
  for (const h of seenHeaders) {
    assert.equal(h['x-api-key'], 'sk-test-9876', 'reference resolved from env');
    assert.equal(h['x-api-host'], 'mock.example', 'second custom header rides along');
  }
  await mcp.refreshDefs();
  const defs = mcp.getCachedDefs();
  assert.ok(defs.some((d) => d.name === 'mcp_mock_search'), 'enabled tool becomes an agent def');
});

test('def filtering: owner-only connectors and role scoping', async () => {
  // 'intel' (owner-only) has enabledTools ['search'] but its host is fake —
  // its defs never load. Use metadata via resolveToolName on the mock instead:
  // patch mock server row to owner + role-scoped and confirm filtering.
  db.prepare("UPDATE mcp_servers SET access = 'owner', roles_json = ? WHERE name = 'mock'").run(JSON.stringify(['research']));
  mcp.reload();
  await mcp.refreshDefs();
  const asMemberResearch = toolsForRole('research', { userRole: 'member' }).map((t) => t.name);
  assert.ok(!asMemberResearch.includes('mcp_mock_search'), 'owner-only def hidden from member-directed run');
  const asOwnerResearch = toolsForRole('research', { userRole: 'owner' }).map((t) => t.name);
  assert.ok(asOwnerResearch.includes('mcp_mock_search'), 'offered to owner-directed run');
  const asOwnerStrategic = toolsForRole('strategic', { userRole: 'owner' }).map((t) => t.name);
  assert.ok(!asOwnerStrategic.includes('mcp_mock_search'), 'role scope excludes non-listed agent roles');
  const defaultCall = toolsForRole('research').map((t) => t.name);
  assert.ok(!defaultCall.includes('mcp_mock_search'), 'no userRole = least privilege (member)');
});

test('management routes are owner-only; probe returns tool inventory; mutation reloads', async () => {
  assert.equal((await call('GET', '/api/mcp/servers', memberCookie)).status, 403);
  assert.equal((await call('POST', '/api/mcp/servers', memberCookie, { name: 'x', url: 'https://x.example' })).status, 403);
  const listed = await call('GET', '/api/mcp/servers', ownerCookie);
  assert.equal(listed.status, 200);
  const fresh = listed.data.servers.find((srv) => srv.name === 'linkedin-fresh');
  assert.ok(fresh);
  assert.equal(fresh.headers['x-api-key'], '${ENV:RAPIDAPI_KEY}', 'reference visible, value never stored');
  assert.ok(!JSON.stringify(listed.data).includes('super-secret-value'), 'no literal header value in route payload');

  const created = await call('POST', '/api/mcp/servers', ownerCookie, { name: 'bad name!', url: 'https://ok.example' });
  assert.equal(created.status, 400, 'name validation');
  const dupe = await call('POST', '/api/mcp/servers', ownerCookie, { name: 'linkedin-fresh', url: 'https://ok.example' });
  assert.equal(dupe.status, 409);

  const mockRow = db.prepare("SELECT id FROM mcp_servers WHERE name = 'mock'").get();
  const patched = await call('PATCH', `/api/mcp/servers/${mockRow.id}`, ownerCookie, { access: 'members', roles: [] });
  assert.equal(patched.status, 200);
  assert.equal(db.prepare("SELECT access FROM mcp_servers WHERE id = ?").get(mockRow.id).access, 'members');
  const audits = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'mcp.server_update'").get();
  assert.ok(audits.n >= 1, 'mutations audited');
});

test('call-time re-check refuses a member on an owner-only connector even with a leaked def', async () => {
  db.prepare("UPDATE mcp_servers SET access = 'owner', roles_json = '[]' WHERE name = 'mock'").run();
  mcp.reload();
  await mcp.refreshDefs();
  const { executeTool } = require('../server/orchestrator/tools');
  const canvas = db.prepare('SELECT * FROM canvases LIMIT 1').get();
  const agent = db.prepare('SELECT * FROM agents WHERE canvas_id = ? LIMIT 1').get(canvas.id);
  const run = { id: 'r-test', initiated_by: 'fred@cloudtechgurus.com', canvas_id: canvas.id };
  const out = await executeTool('mcp_mock_search', {}, { run, agent, canvas });
  assert.equal(out.isError, true);
  assert.match(out.content, /owner-only/);
  const denied = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'mcp.denied'").get();
  assert.ok(denied.n >= 1, 'denial audited');
});

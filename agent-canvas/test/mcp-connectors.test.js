'use strict';
// MCP connector layer — consent, namespacing, and audit proofs against a real
// (local) JSON-RPC server speaking the MCP Streamable HTTP shape.

process.env.DEV_AUTH = '1';
process.env.JWT_SECRET = 'test-secret-material-32-bytes-xx';
process.env.DB_PATH = ':memory:';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

let server; let port;
const seen = { calls: [] };

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const msg = JSON.parse(body);
      seen.calls.push(msg.method);
      const reply = (result) => {
        res.setHeader('content-type', 'application/json');
        res.setHeader('mcp-session-id', 'sess-1');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      };
      if (msg.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock' } });
      if (msg.method === 'notifications/initialized') { res.statusCode = 202; return res.end(); }
      if (msg.method === 'tools/list') {
        return reply({ tools: [
          { name: 'search_signals', description: 'Search buying signals', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
          { name: 'dangerous_tool', description: 'Not enabled by owner', inputSchema: { type: 'object', properties: {} } },
        ] });
      }
      if (msg.method === 'tools/call') {
        if (msg.params.name === 'search_signals') return reply({ content: [{ type: 'text', text: `results for ${msg.params.arguments.q}` }] });
        return reply({ content: [{ type: 'text', text: 'should never run' }] });
      }
      reply({});
    });
  });
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  process.env.MCP_SERVERS = JSON.stringify([
    { name: 'crm-intel', url: `http://127.0.0.1:${port}/mcp`, enabledTools: ['search_signals'] },
  ]);
  require('../server/mcp/client').reload();
});
after(() => server && server.close());

const mcp = require('../server/mcp/client');

test('handshake + tools/list work, and only owner-enabled tools become agent defs', async () => {
  const defs = await mcp.enabledToolDefs();
  assert.equal(defs.length, 1, 'dangerous_tool must not be exposed');
  assert.equal(defs[0].name, 'mcp_crm_intel_search_signals');
  assert.match(defs[0].description, /\[MCP · crm-intel\]/);
  assert.deepEqual(defs[0].input_schema.required, ['q']);
  assert.ok(seen.calls.includes('initialize'), 'handshake performed');
});

test('calling an enabled tool round-trips; a non-enabled tool is refused without a network call', async () => {
  const out = await mcp.callTool({ server: 'crm-intel', tool: 'search_signals', args: { q: 'acme' }, actorEmail: 't@x' });
  assert.match(out, /results for acme/);
  const callsBefore = seen.calls.filter((m) => m === 'tools/call').length;
  await assert.rejects(
    () => mcp.callTool({ server: 'crm-intel', tool: 'dangerous_tool', args: {}, actorEmail: 't@x' }),
    /not enabled by the owner/,
  );
  assert.equal(seen.calls.filter((m) => m === 'tools/call').length, callsBefore, 'refusal happens before the wire');
  await assert.rejects(() => mcp.callTool({ server: 'nope', tool: 'x', args: {} }), /unknown MCP server/);
});

test('executeTool dispatches mcp_ names with the directing-user rule', async () => {
  await mcp.refreshDefs();
  const { executeTool, toolsForRole } = require('../server/orchestrator/tools');
  assert.ok(toolsForRole('research').some((t) => t.name === 'mcp_crm_intel_search_signals'), 'registry carries the MCP tool');
  const ctxBase = { agent: { id: 'a' }, canvas: { id: 'c' } };
  const noUser = await executeTool('mcp_crm_intel_search_signals', { q: 'x' }, { run: { id: 'r', initiated_by: null }, ...ctxBase });
  assert.ok(noUser.isError && /no directing user/i.test(noUser.content));
  const ok = await executeTool('mcp_crm_intel_search_signals', { q: 'widgets' }, { run: { id: 'r', initiated_by: 'pete@ctg.com' }, ...ctxBase });
  assert.ok(!ok.isError, ok.content);
  assert.match(ok.content, /results for widgets/);
  const unknown = await executeTool('mcp_bogus_tool', {}, { run: { id: 'r', initiated_by: 'pete@ctg.com' }, ...ctxBase });
  assert.ok(unknown.isError);
});

test('probe forces a fresh handshake and reports tool counts', async () => {
  const r = await mcp.probeServer('crm-intel');
  assert.ok(r.ok && r.tools === 2 && r.enabled === 1);
  assert.ok(typeof r.ms === 'number');
  await assert.rejects(() => mcp.probeServer('constructor'), /unknown MCP server/);
});

test('bad MCP config degrades to a named error, not a crash', () => {
  process.env.MCP_SERVERS = '{not json';
  mcp.reload();
  assert.ok(mcp.configError(), 'parse error surfaced');
  assert.equal(mcp.listServers().length, 0);
  process.env.MCP_SERVERS = JSON.stringify([{ name: 'crm-intel', url: `http://127.0.0.1:${port}/mcp`, enabledTools: ['search_signals'] }]);
  mcp.reload();
  assert.equal(mcp.configError(), null);
});

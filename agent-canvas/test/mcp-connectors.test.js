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
          { name: 'org_search', description: 'Attributed corpus search', inputSchema: { type: 'object', properties: { question: { type: 'string' }, asked_by: { type: 'string' } }, required: ['question'] } },
        ] });
      }
      if (msg.method === 'tools/call') {
        seen.lastArgs = msg.params.arguments;
        if (msg.params.name === 'search_signals') return reply({ content: [{ type: 'text', text: `results for ${msg.params.arguments.q}` }] });
        if (msg.params.name === 'org_search') return reply({ content: [{ type: 'text', text: 'grounded answer' }] });
        return reply({ content: [{ type: 'text', text: 'should never run' }] });
      }
      reply({});
    });
  });
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
  process.env.MCP_SERVERS = JSON.stringify([
    { name: 'crm-intel', url: `http://127.0.0.1:${port}/mcp`, enabledTools: ['search_signals', 'org_search'] },
  ]);
  require('../server/mcp/client').reload();
});
after(() => server && server.close());

const mcp = require('../server/mcp/client');

test('handshake + tools/list work, and only owner-enabled tools become agent defs', async () => {
  const defs = await mcp.enabledToolDefs();
  assert.equal(defs.length, 2, 'dangerous_tool must not be exposed');
  assert.ok(!defs.some((d) => d.name.includes('dangerous')));
  const search = defs.find((d) => d.name === 'mcp_crm_intel_search_signals');
  assert.match(search.description, /\[MCP · crm-intel\]/);
  assert.deepEqual(search.input_schema.required, ['q']);
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
  assert.ok(r.ok && r.tools === 3 && r.enabled === 2, `tools=${r.tools} enabled=${r.enabled}`);
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

test('asked_by is server-controlled: the directing user overwrites any model-supplied value (R2)', async () => {
  // The bad-config test above reloaded with only search_signals enabled — restore.
  process.env.MCP_SERVERS = JSON.stringify([
    { name: 'crm-intel', url: `http://127.0.0.1:${port}/mcp`, enabledTools: ['search_signals', 'org_search'] },
  ]);
  mcp.reload();
  await mcp.callTool({
    server: 'crm-intel', tool: 'org_search',
    args: { question: 'what is the ARR target?', asked_by: 'spoofed@evil.example' },
    actorEmail: 'pete@cloudtechgurus.com',
  });
  assert.equal(seen.lastArgs.asked_by, 'pete@cloudtechgurus.com', 'model-supplied asked_by must be overwritten');
  assert.equal(seen.lastArgs.question, 'what is the ARR target?');

  // A tool whose schema does NOT declare asked_by never gets the field injected.
  await mcp.callTool({ server: 'crm-intel', tool: 'search_signals', args: { q: 'acme' }, actorEmail: 'pete@cloudtechgurus.com' });
  assert.ok(!('asked_by' in seen.lastArgs), 'no schema field, no injection');
});

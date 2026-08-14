'use strict';
// Minimal stdio MCP server for bridge tests: answers initialize, tools/list,
// tools/call over newline-delimited JSON-RPC, ignores notifications.
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id == null) continue; // notification
    const result = msg.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } }
      : msg.method === 'tools/list'
        ? { tools: [{ name: 'hubspot-get-contacts', description: 'fake', inputSchema: { type: 'object', properties: {} } }] }
        : { content: [{ type: 'text', text: `called ${msg.params?.name} with ${JSON.stringify(msg.params?.arguments || {})}` }] };
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`);
  }
});

'use strict';
// MCP connector layer — minimal Model Context Protocol client over Streamable
// HTTP (JSON-RPC 2.0). Owner-configured servers only, with PER-TOOL explicit
// enablement: nothing a third-party server offers reaches an agent unless the
// owner named it in the config. We cannot guarantee the semantics of external
// tools — the honest guardrail here is consent + audit, not structural absence,
// and the Capabilities copy says so.
//
// Config (either source, env wins):
//   MCP_SERVERS='[{"name":"crm-intel","url":"https://...","authHeader":"Bearer x","enabledTools":["search_signals"]}]'
//   config/mcp.json — same shape.
//
// v1 scope: initialize / tools/list / tools/call over HTTP POST (JSON or SSE
// response bodies). No stdio transport (Cloud Run runs no child servers), no
// resources/prompts.

const fs = require('node:fs');
const path = require('node:path');
const { audit } = require('../audit');

const PROTOCOL_VERSION = '2025-06-18';
const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const OUTPUT_CAP = 30_000;

let loadError = null;
function loadConfig() {
  loadError = null;
  let raw = process.env.MCP_SERVERS;
  if (!raw) {
    const file = path.join(__dirname, '..', '..', 'config', 'mcp.json');
    if (fs.existsSync(file)) raw = fs.readFileSync(file, 'utf8');
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('MCP config must be an array');
    return parsed.filter((srv) => {
      if (!srv || !NAME_RE.test(String(srv.name || '')) || !/^https?:\/\//.test(String(srv.url || ''))) return false;
      srv.enabledTools = Array.isArray(srv.enabledTools) ? srv.enabledTools.filter((t) => NAME_RE.test(String(t))) : [];
      return true;
    });
  } catch (err) {
    loadError = String(err.message || err);
    return [];
  }
}
let servers = loadConfig();
function configError() { return loadError; }
function listServers() { return servers.map((srv) => ({ name: srv.name, url: srv.url, enabledTools: srv.enabledTools })); }
function reload() { servers = loadConfig(); sessions.clear(); toolCache.clear(); }

function serverByName(name) {
  return servers.find((srv) => srv.name === name) || null;
}

// ---------- JSON-RPC over Streamable HTTP ----------
async function parseBody(res) {
  const ctype = res.headers.get('content-type') || '';
  const text = await res.text();
  if (ctype.includes('text/event-stream')) {
    // take the last data: line carrying a JSON-RPC response
    const datas = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
    for (let i = datas.length - 1; i >= 0; i--) {
      try { const obj = JSON.parse(datas[i]); if (obj.jsonrpc) return obj; } catch { /* keep looking */ }
    }
    throw new Error('no JSON-RPC payload in SSE response');
  }
  try { return JSON.parse(text); } catch { throw new Error(`non-JSON MCP response (${res.status})`); }
}

const sessions = new Map(); // server name -> session id
let rpcId = 0;
async function rpc(srv, method, params, { notify = false } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL_VERSION,
  };
  if (srv.authHeader) headers.authorization = srv.authHeader;
  const sid = sessions.get(srv.name);
  if (sid) headers['mcp-session-id'] = sid;
  const body = notify
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: ++rpcId, method, params };
  const res = await fetch(srv.url, { method: 'POST', headers, body: JSON.stringify(body) });
  const newSid = res.headers.get('mcp-session-id');
  if (newSid) sessions.set(srv.name, newSid);
  if (notify) return null;
  if (!res.ok && res.status !== 202) {
    throw new Error(`MCP server ${srv.name}: HTTP ${res.status}`);
  }
  const payload = await parseBody(res);
  if (payload.error) throw new Error(`MCP server ${srv.name}: ${payload.error.message || JSON.stringify(payload.error).slice(0, 200)}`);
  return payload.result;
}

async function ensureSession(srv) {
  if (sessions.has(srv.name)) return;
  await rpc(srv, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'agent-canvas', version: '1.0.0' },
  });
  await rpc(srv, 'notifications/initialized', {}, { notify: true }).catch(() => {});
}

const toolCache = new Map(); // server name -> { tools, at }
async function listTools(srv) {
  const cached = toolCache.get(srv.name);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.tools;
  await ensureSession(srv);
  const result = await rpc(srv, 'tools/list', {});
  const tools = (result?.tools || []).filter((t) => NAME_RE.test(String(t.name || '')));
  toolCache.set(srv.name, { tools, at: Date.now() });
  return tools;
}

// Agent-facing defs: ONLY owner-enabled tools, namespaced mcp_<server>_<tool>.
async function enabledToolDefs() {
  const defs = [];
  for (const srv of servers) {
    if (!srv.enabledTools.length) continue;
    let tools;
    try { tools = await listTools(srv); } catch { continue; } // unreachable server = no tools, lamp shows it
    for (const t of tools) {
      if (!srv.enabledTools.includes(t.name)) continue;
      defs.push({
        name: `mcp_${srv.name}_${t.name}`.replace(/-/g, '_'),
        description: `[MCP · ${srv.name}] ${String(t.description || t.name).slice(0, 400)}`,
        input_schema: t.inputSchema || { type: 'object', properties: {}, required: [] },
        _mcp: { server: srv.name, tool: t.name },
      });
    }
  }
  return defs;
}

async function callTool({ server, tool, args, actorEmail }) {
  const srv = serverByName(server);
  if (!srv) throw Object.assign(new Error(`unknown MCP server ${String(server).slice(0, 40)}`), { status: 404 });
  if (!srv.enabledTools.includes(tool)) {
    throw new Error(`tool ${tool} on ${server} is not enabled by the owner — enable it in the MCP config to use it`);
  }
  await ensureSession(srv);
  const t0 = Date.now();
  let result;
  try {
    result = await rpc(srv, 'tools/call', { name: tool, arguments: args || {} });
  } catch (err) {
    audit('user', actorEmail || 'system', 'mcp.call', { server, tool, ok: false, ms: Date.now() - t0 });
    throw err;
  }
  audit('user', actorEmail || 'system', 'mcp.call', { server, tool, ok: !result?.isError, ms: Date.now() - t0 });
  const blocks = result?.content || [];
  const text = blocks.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n') || JSON.stringify(result);
  const capped = text.length > OUTPUT_CAP ? `${text.slice(0, OUTPUT_CAP)}…[truncated]` : text;
  if (result?.isError) throw new Error(`MCP tool error: ${capped.slice(0, 300)}`);
  return capped;
}

async function probeServer(name) {
  const srv = serverByName(name);
  if (!srv) throw Object.assign(new Error(`unknown MCP server ${String(name).slice(0, 40)}`), { status: 404 });
  const t0 = Date.now();
  sessions.delete(name); // probe forces a fresh handshake, not a cache hit
  toolCache.delete(name);
  const tools = await listTools(srv);
  return { ok: true, ms: Date.now() - t0, tools: tools.length, enabled: srv.enabledTools.length };
}

// ---------- synchronous snapshot for the tool registry ----------
// toolsForRole() is synchronous; agent tool defs come from this cache,
// refreshed in the background. A server that is down simply contributes no
// tools until it recovers — the lamp on the systems board says why.
let defsCache = [];
const defsByName = new Map();
async function refreshDefs() {
  try {
    const defs = await enabledToolDefs();
    defsCache = defs.map(({ _mcp, ...d }) => d);
    defsByName.clear();
    for (const d of defs) defsByName.set(d.name, d._mcp);
  } catch { /* keep last good snapshot */ }
}
function getCachedDefs() { return defsCache; }
function resolveToolName(name) { return defsByName.get(name) || null; }
if (servers.some((srv) => srv.enabledTools.length)) {
  refreshDefs();
  const t = setInterval(refreshDefs, 5 * 60_000);
  if (t.unref) t.unref();
}

module.exports = {
  listServers, configError, reload, enabledToolDefs, callTool, probeServer,
  getCachedDefs, refreshDefs, resolveToolName,
  _internal: { loadConfig, parseBody },
};

'use strict';
// MCP connector layer — minimal Model Context Protocol client over Streamable
// HTTP (JSON-RPC 2.0). Owner-configured servers only, with PER-TOOL explicit
// enablement: nothing a third-party server offers reaches an agent unless the
// owner named it in the config. We cannot guarantee the semantics of external
// tools — the honest guardrail here is consent + audit, not structural absence,
// and the Capabilities copy says so.
//
// Config sources, in precedence order (first non-empty wins for env/file;
// DB rows are the managed source edited in Admin -> Connectors):
//   MCP_SERVERS env — emergency override, same JSON shape
//   mcp_servers DB table — the normal path (per-server access + role scoping)
//   config/mcp.json — legacy file
// Server shape: { name, url, headers: {..}, enabledTools: [], access:
// 'owner'|'members', roles: [] }. Legacy authHeader is folded into
// headers.authorization. Header values may be ${ENV:NAME} references —
// resolved per request, never stored resolved, masked in listings.
//
// v1 scope: initialize / tools/list / tools/call over HTTP POST (JSON or SSE
// response bodies). No stdio transport (Cloud Run runs no child servers), no
// resources/prompts.

const fs = require('node:fs');
const path = require('node:path');
const { audit } = require('../audit');
const { db } = require('../db');

const PROTOCOL_VERSION = '2025-06-18';
const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const OUTPUT_CAP = 30_000;

let loadError = null;

function normalizeServer(srv) {
  if (!srv || !NAME_RE.test(String(srv.name || '')) || !/^https?:\/\//.test(String(srv.url || ''))) return null;
  const headers = {};
  if (srv.headers && typeof srv.headers === 'object') {
    for (const [k, v] of Object.entries(srv.headers)) {
      if (/^[a-zA-Z0-9-]{1,64}$/.test(k) && typeof v === 'string') headers[k.toLowerCase()] = v;
    }
  }
  if (srv.authHeader && !headers.authorization) headers.authorization = String(srv.authHeader); // legacy shape
  return {
    name: srv.name,
    url: srv.url,
    headers,
    enabledTools: (Array.isArray(srv.enabledTools) ? srv.enabledTools : []).filter((t) => NAME_RE.test(String(t))),
    access: srv.access === 'owner' ? 'owner' : 'members',
    roles: (Array.isArray(srv.roles) ? srv.roles : []).map(String).filter(Boolean),
  };
}

function loadFromDb() {
  try {
    return db.prepare('SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY name').all().map((row) => normalizeServer({
      name: row.name, url: row.url,
      headers: JSON.parse(row.headers_json || '{}'),
      enabledTools: JSON.parse(row.enabled_tools_json || '[]'),
      access: row.access,
      roles: JSON.parse(row.roles_json || '[]'),
    })).filter(Boolean);
  } catch (err) {
    loadError = `mcp_servers table: ${String(err.message || err)}`;
    return [];
  }
}

function loadConfig() {
  loadError = null;
  let raw = process.env.MCP_SERVERS;
  if (!raw) {
    const fromDb = loadFromDb();
    if (fromDb.length || loadError) return fromDb;
    const file = path.join(__dirname, '..', '..', 'config', 'mcp.json');
    if (fs.existsSync(file)) raw = fs.readFileSync(file, 'utf8');
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('MCP config must be an array');
    return parsed.map(normalizeServer).filter(Boolean);
  } catch (err) {
    loadError = String(err.message || err);
    return [];
  }
}

// ${ENV:NAME} references resolve per request. An unset variable resolves to
// '' — the server rejects the call, which is louder than sending the literal
// reference text to a third party.
function resolveHeaderValue(value) {
  return String(value).replace(/\$\{ENV:([A-Z0-9_]+)\}/g, (_, name) => process.env[name] || '');
}
function maskHeaderValue(value) {
  const v = String(value);
  if (/^\$\{ENV:[A-Z0-9_]+\}$/.test(v)) return v; // a reference reveals nothing
  return v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;
}
let servers = loadConfig();
function configError() { return loadError; }
function listServers() {
  return servers.map((srv) => ({
    name: srv.name, url: srv.url, enabledTools: srv.enabledTools,
    access: srv.access, roles: srv.roles,
    headers: Object.fromEntries(Object.entries(srv.headers).map(([k, v]) => [k, maskHeaderValue(v)])),
  }));
}
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
  for (const [k, v] of Object.entries(srv.headers || {})) headers[k] = resolveHeaderValue(v);
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
        _mcp: { server: srv.name, tool: t.name, access: srv.access, roles: srv.roles },
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

// Full tool inventory for the admin tab (names + descriptions, nothing enabled).
async function discoverTools(name) {
  const srv = serverByName(name);
  if (!srv) throw Object.assign(new Error(`unknown MCP server ${String(name).slice(0, 40)}`), { status: 404 });
  const tools = await listTools(srv);
  return tools.map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 300) }));
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
  listServers, configError, reload, enabledToolDefs, callTool, probeServer, discoverTools,
  getCachedDefs, refreshDefs, resolveToolName,
  _internal: { loadConfig, parseBody },
};

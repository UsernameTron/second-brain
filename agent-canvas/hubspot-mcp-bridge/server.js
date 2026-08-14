'use strict';
// hubspot-mcp-bridge — Streamable-HTTP → stdio MCP bridge (Phase 3, /crm).
//
// Why this exists: both HubSpot MCP servers are stdio-only, and Cloud Run
// containers in the canvas run no child servers (mcp/client.js v1 scope).
// This is one IAM-gated Cloud Run service (ops-runner pattern) that spawns
// @hubspot/mcp-server as a child with a READ-ONLY-scoped private-app token
// (Secret Manager → HUBSPOT_MCP_TOKEN) and forwards JSON-RPC messages
// between HTTP POST bodies and the child's newline-delimited stdio.
//
// Verified before building (2026-08-13): mcp.hubspot.com is OAuth-only
// (401 + resource_metadata; docs confirm no PAT support), so the remote
// endpoint cannot replace this bridge. CRM WRITES remain solely
// ctg-hs-ops-runner (ADR-0041) — the token here is read-only by scope.
//
// Auth: Cloud Run IAM (--no-allow-unauthenticated). The bridge itself
// trusts the platform gate and adds none of its own.
//
// /dev (Agent CLI server + GCS workspace) is deliberately NOT here yet —
// it depends on Phase 2's CLI landing. Add a second child then.
// ponytail: raw JSON-RPC pass-through, no MCP SDK — the canvas client only
// POSTs initialize/tools/list/tools/call, so a pending-map by id is enough.

const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PORT || 8080);
const CHILD_CMD = process.env.MCP_CHILD_CMD || 'mcp-hubspot';
const REQUEST_TIMEOUT_MS = Number(process.env.MCP_REQUEST_TIMEOUT_MS || 60_000);
const BODY_CAP = 256 * 1024;

if (!process.env.HUBSPOT_MCP_TOKEN && !process.env.MCP_CHILD_CMD) {
  console.error('HUBSPOT_MCP_TOKEN is required (read-only private-app token from Secret Manager)');
  process.exit(1);
}

// ---------- child lifecycle ----------
let child = null;
let stdoutBuf = '';
const pending = new Map(); // bridge id -> { resolve, reject, timer }
let nextId = 0;

function startChild() {
  const [cmd, ...args] = CHILD_CMD.split(' '); // space-split so tests can point at "node fixture.js"
  child = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, PRIVATE_APP_ACCESS_TOKEN: process.env.HUBSPOT_MCP_TOKEN || '' },
  });
  stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const entry = msg.id != null && pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        entry.resolve(msg);
      } // notifications from the child are dropped — no subscriber
    }
  });
  child.on('exit', (code) => {
    for (const [, entry] of pending) { clearTimeout(entry.timer); entry.reject(new Error(`mcp child exited (${code})`)); }
    pending.clear();
    child = null;
    if (!stopping) setTimeout(startChild, 1000).unref(); // supervise: Cloud Run restarts are slower than this
  });
}
let stopping = false;
function stop() { stopping = true; if (child) child.kill(); server.close(); }
startChild();

function forward(msg) {
  if (!child) return Promise.reject(new Error('mcp child not running'));
  if (msg.id == null) { child.stdin.write(`${JSON.stringify(msg)}\n`); return Promise.resolve(null); } // notification
  const bridgeId = ++nextId;
  const upstreamId = msg.id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(bridgeId); reject(new Error('mcp child timeout')); }, REQUEST_TIMEOUT_MS);
    pending.set(bridgeId, { resolve: (resp) => resolve({ ...resp, id: upstreamId }), reject, timer });
    child.stdin.write(`${JSON.stringify({ ...msg, id: bridgeId })}\n`);
  });
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(child ? 200 : 503, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: Boolean(child) }));
  }
  if (req.method !== 'POST' || !/^\/crm\/?$/.test(req.url.split('?')[0])) {
    res.writeHead(404); return res.end();
  }
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > BODY_CAP) { res.writeHead(413); res.end(); req.destroy(); }
  });
  req.on('end', async () => {
    let msg;
    try { msg = JSON.parse(body); } catch { res.writeHead(400); return res.end('bad json'); }
    try {
      const resp = await forward(msg);
      if (resp == null) { res.writeHead(202); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(resp));
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32000, message: String(err.message || err) } }));
    }
  });
});
server.listen(PORT, () => console.error(`hubspot-mcp-bridge listening on :${PORT}`));

module.exports = { server, stop, _internal: { forward, startChild: () => child } };

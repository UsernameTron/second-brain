'use strict';
// gtm-mcp-bridge — Streamable-HTTP MCP server over 4 NAMED BigQuery queries
// against ctg-hs-exec-tool:ctg_gtm_marts (the GTM data spine, mirrored
// nightly 06:00 CT). Spec: docs/PORTFOLIO-FOLD-IN.md §ctg-gtm-automation.
//
// Marts-only allowlist by construction: the only SQL that can run is the four
// strings below, all against physical TABLEs (never views that read through
// to ctg_gtm_raw — 44k contacts' PII lives there and is hard-excluded). All
// user input travels as BigQuery named query parameters, never SQL text.
// Query jobs run in (and bill to) BQ_PROJECT, reading DATA_PROJECT cross-
// project: bigquery.jobUser here, dataset-scoped READER there.
//
// Auth: Cloud Run IAM (--no-allow-unauthenticated). The bridge trusts the
// platform gate and adds none of its own. BigQuery auth is the runtime
// service account's access token from the metadata server — keyless.
// ponytail: raw JSON-RPC, no MCP SDK, no BigQuery SDK — the canvas client
// only POSTs initialize/tools/list/tools/call, and jobs.query is one fetch.

const http = require('node:http');

const PORT = Number(process.env.PORT || 8080);
const BQ_PROJECT = process.env.BQ_PROJECT || 'agent-canvas-ctg-0811';
const DATA_PROJECT = process.env.DATA_PROJECT || 'ctg-hs-exec-tool';
const BODY_CAP = 256 * 1024;
const QUERY_TIMEOUT_MS = Number(process.env.QUERY_TIMEOUT_MS || 30_000);

const M = (t) => `\`${DATA_PROJECT}.ctg_gtm_marts.${t}\``; // marts table ref
const ROUTING = 'Routing: live CRM record -> hubspot-crm; score/spend/DQ -> gtm_*. Marts are yesterday\'s data (nightly mirror); rows carry their timestamps.';
const TIER_NOTE = ' Tier/score is a SOURCING FILTER, not buy-probability.';

const ACCOUNT_COLS = 'company_name, domain, score, tier, reasons, reason_text, headcount, icp_vertical, contact_count, CAST(last_touch_at AS STRING) AS last_touch_at, CAST(scored_at AS STRING) AS scored_at, CAST(synced_at AS STRING) AS synced_at';

const TOOLS = [
  {
    name: 'gtm_account_lookup',
    description: `Look up scored GTM accounts by company name or domain (substring, top 10 by score) from marts account_scores (15.7k accounts): tier, plain-English reasons, headcount, vertical, contacts. ${ROUTING}${TIER_NOTE}`,
    inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'company name or domain substring' } }, required: ['q'] },
    sql: `SELECT ${ACCOUNT_COLS} FROM ${M('account_scores')} WHERE LOWER(company_name) LIKE @q OR LOWER(domain) LIKE @q ORDER BY score DESC LIMIT 10`,
    params: (a) => ({ q: { type: 'STRING', value: `%${String(a.q || '').toLowerCase()}%` } }),
  },
  {
    name: 'gtm_tier_list',
    description: `List scored GTM accounts by tier and/or minimum score, highest score first, from the marts account_scores table. Filters: tier (exact), min_score (0-100), limit (default 50, max 100). ${ROUTING}${TIER_NOTE}`,
    inputSchema: { type: 'object', properties: { tier: { type: 'string' }, min_score: { type: 'number' }, limit: { type: 'number' } } },
    sql: `SELECT ${ACCOUNT_COLS} FROM ${M('account_scores')} WHERE (@tier = '' OR tier = @tier) AND score >= @min_score ORDER BY score DESC LIMIT @lim`,
    params: (a) => ({
      tier: { type: 'STRING', value: String(a.tier || '') },
      min_score: { type: 'INT64', value: String(Math.max(0, Math.trunc(Number(a.min_score) || 0))) },
      lim: { type: 'INT64', value: String(Math.min(100, Math.max(1, Math.trunc(Number(a.limit) || 50)))) },
    }),
  },
  {
    name: 'gtm_enrichment_spend',
    description: `Enrichment provider spend and quality over the last N days (default 30) from the marts provider_scorecard_daily table: per-provider calls, hit/error/fill rates, cost, cost per filled field, p95 latency. ${ROUTING}`,
    inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'lookback window, default 30, max 365' } } },
    sql: `SELECT provider, SUM(calls) AS calls, ROUND(SAFE_DIVIDE(SUM(hits), SUM(calls)), 3) AS hit_rate, ROUND(SAFE_DIVIDE(SUM(errors), SUM(calls)), 3) AS error_rate, ROUND(SAFE_DIVIDE(SUM(fields_filled), SUM(fields_requested)), 3) AS fill_rate, ROUND(SUM(cost), 2) AS cost, ROUND(SAFE_DIVIDE(SUM(cost), SUM(fields_filled)), 4) AS cost_per_filled_field, MAX(p95_latency_ms) AS p95_latency_ms, CAST(MAX(as_of_date) AS STRING) AS latest_as_of_date, CAST(MAX(computed_at) AS STRING) AS computed_at FROM ${M('provider_scorecard_daily')} WHERE as_of_date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY) GROUP BY provider ORDER BY cost DESC`,
    params: (a) => ({ days: { type: 'INT64', value: String(Math.min(365, Math.max(1, Math.trunc(Number(a.days) || 30)))) } }),
  },
  {
    name: 'gtm_dq_snapshot',
    description: `Data-quality snapshot: every DQ metric (dimension, object, metric, value, detail) for the latest available day from the marts dq_daily table. ${ROUTING}`,
    inputSchema: { type: 'object', properties: {} },
    sql: `SELECT dimension, object, metric, value, detail, CAST(as_of_date AS STRING) AS as_of_date, CAST(computed_at AS STRING) AS computed_at FROM ${M('dq_daily')} WHERE as_of_date = (SELECT MAX(as_of_date) FROM ${M('dq_daily')}) ORDER BY dimension, object, metric`,
    params: () => ({}),
  },
];

// ---------- BigQuery via REST (jobs.query), metadata-server token ----------
let tokenCache = { token: null, exp: 0 };
async function accessToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error(`metadata token: ${res.status}`);
  const body = await res.json();
  tokenCache = { token: body.access_token, exp: Date.now() + (body.expires_in - 60) * 1000 };
  return tokenCache.token;
}

async function runQueryReal(sql, params) {
  const queryParameters = Object.entries(params).map(([name, p]) => ({
    name, parameterType: { type: p.type }, parameterValue: { value: p.value },
  }));
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT}/queries`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql, queryParameters, useLegacySql: false, parameterMode: 'NAMED', location: 'US', maxResults: 500, timeoutMs: QUERY_TIMEOUT_MS }),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS + 5_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`bigquery ${res.status}: ${(body.error && body.error.message) || 'unknown'}`);
  if (!body.jobComplete) throw new Error('bigquery: query did not complete within the timeout');
  const fields = (body.schema && body.schema.fields) || [];
  const rows = (body.rows || []).map((r) => Object.fromEntries(r.f.map((c, i) => [fields[i].name, c.v])));
  return { rows, totalRows: Number(body.totalRows || rows.length) };
}
let runQuery = runQueryReal; // seam for tests (runner.js callModelImpl precedent)

// ---------- JSON-RPC ----------
async function handle(msg) {
  if (msg.id == null) return null; // notification (notifications/initialized)
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') {
    return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ctg-gtm-marts', version: '1.0.0' } });
  }
  if (msg.method === 'tools/list') {
    return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (msg.method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === (msg.params && msg.params.name));
    if (!tool) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `unknown tool: ${msg.params && msg.params.name}` } };
    try {
      const out = await runQuery(tool.sql, tool.params(msg.params.arguments || {}));
      return reply({ content: [{ type: 'text', text: JSON.stringify(out) }] });
    } catch (err) {
      return reply({ content: [{ type: 'text', text: String(err.message || err) }], isError: true });
    }
  }
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method: ${msg.method}` } };
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method !== 'POST' || !/^\/gtm\/?$/.test(req.url.split('?')[0])) {
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
    const resp = await handle(msg);
    if (resp == null) { res.writeHead(202); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(resp));
  });
});
server.listen(PORT, () => console.error(`gtm-mcp-bridge listening on :${PORT}`));

function stop() { server.close(); }
module.exports = { server, stop, _setRunQuery: (fn) => { runQuery = fn; }, _internal: { handle, TOOLS } };

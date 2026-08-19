'use strict';
// Seeds the workspace's MCP connectors (idempotent, versioned settings-key
// guard). Data connectors only: both RapidAPI LinkedIn
// servers, member-visible, role-scoped to the lead-gen lanes (editable in
// Admin → Connectors — scoping is a token-cost lever, not a cage: every
// offered tool's schema rides in every model call of every offered agent).
//
// enabledTools is deliberately EMPTY at seed: a connector is inert until the
// owner probes it and ticks tools in the admin tab. Per-tool explicit
// enablement is the consent model and seeding must not bypass it.
//
// The x-api-key header is an ${ENV:RAPIDAPI_KEY} reference — resolved per
// request by mcp/client.js, never stored resolved, masked in listings. The
// key itself lives in Secret Manager, mapped by deploy.sh.
//
// HubSpot connectors are NOT seeded here — they arrive with the
// hubspot-mcp-bridge service (Phase 3): stdio-only servers need that bridge,
// and seeding a dead URL would just be a red lamp.
//
// The seed key is versioned (seed_mcp_v3) because `name` is UNIQUE and the
// insert is OR IGNORE: bumping the key re-runs the loop on an already-seeded
// workspace, where existing rows are ignored and only new ones land. Adding a
// connector is therefore "append to SEED_SERVERS + bump the key", nothing else.

const crypto = require('node:crypto');
const { db, nowIso, getSetting, setSetting } = require('./../db');
const { audit } = require('./../audit');

const SEED_SERVERS = [
  {
    name: 'linkedin-fresh',
    url: 'https://mcp.rapidapi.com',
    headers: { 'x-api-host': 'fresh-linkedin-profile-data.p.rapidapi.com', 'x-api-key': '${ENV:RAPIDAPI_KEY}' },
    access: 'members',
    roles: ['research', 'targeting', 'commercial'],
  },
  {
    name: 'linkedin-blitz',
    url: 'https://mcp.rapidapi.com',
    headers: { 'x-api-host': 'linkedin-b2b-data-enrichment-apis-blitzapi.p.rapidapi.com', 'x-api-key': '${ENV:RAPIDAPI_KEY}' },
    access: 'members',
    roles: ['research', 'targeting', 'commercial'],
  },
  {
    // ctg-signal-radar's deployed remote MCP ("CTG Lead Finder" v1.29.0):
    // LinkedIn people search scored against the same sr-icp registry the Radar
    // roster agent reads. Probed live 2026-08-14 — Streamable-HTTP with SSE
    // framing, three tools (ping, find_icp_leads, check_lead_search), and NO
    // auth header of any kind, which is why there is no ${ENV:...} here.
    //
    // find_icp_leads/check_lead_search are an async start/poll pair: the first
    // starts a search, the second collects it. Agents must be told to poll.
    //
    // Scoring version: this service scores server-side against the registry
    // baked into its deployment — re-exported to sr-icp-v7 on 2026-08-19, so
    // it now matches the canvas. Its `ping` tool reports the live version;
    // check it rather than assuming, and re-deploy the fly.dev service
    // whenever the canvas registry moves again.
    name: 'sr-icp-leadfinder',
    url: 'https://sr-icp-connector.fly.dev/mcp',
    headers: {},
    access: 'members',
    roles: ['research', 'targeting', 'commercial'],
  },
  {
    // gtm-mcp-bridge (in-repo sibling dir): 4 named BigQuery queries over
    // ctg-hs-exec-tool:ctg_gtm_marts — account lookup/tier list, enrichment
    // spend, DQ snapshot. IAM-gated Cloud Run, canvas SA sole invoker, hence
    // ${GCP_IDTOKEN}. Marts are aggregate company-level data (no PII), so
    // members + the lead-gen lanes, matching sr-icp-leadfinder.
    name: 'gtm-marts',
    url: 'https://gtm-mcp-bridge-1072020835166.us-central1.run.app/gtm',
    headers: { authorization: '${GCP_IDTOKEN}' },
    access: 'members',
    roles: ['research', 'targeting', 'commercial'],
  },
];

function seedMcpServers() {
  if (getSetting('seed_mcp_v3')) return { seeded: false };
  const ts = nowIso();
  let inserted = 0;
  for (const srv of SEED_SERVERS) {
    const res = db.prepare('INSERT OR IGNORE INTO mcp_servers (id, name, url, headers_json, enabled_tools_json, access, roles_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(crypto.randomUUID(), srv.name, srv.url, JSON.stringify(srv.headers), '[]', srv.access, JSON.stringify(srv.roles), ts, ts);
    inserted += res.changes;
  }
  setSetting('seed_mcp_v3', ts);
  // Report what actually landed, not the constant's length — on an
  // already-seeded workspace most of these are no-ops and an audit line
  // claiming otherwise is a lamp faking green.
  audit('system', 'seed', 'workspace.seed_mcp', { servers: inserted, candidates: SEED_SERVERS.length });
  return { seeded: true, servers: inserted };
}

module.exports = { seedMcpServers, SEED_SERVERS };

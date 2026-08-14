'use strict';
// Seeds the workspace's MCP connectors (idempotent, settings-key guard —
// the seed_exec_v2 pattern). Data connectors only: both RapidAPI LinkedIn
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
];

function seedMcpServers() {
  if (getSetting('seed_mcp_v1')) return { seeded: false };
  const ts = nowIso();
  for (const srv of SEED_SERVERS) {
    db.prepare('INSERT OR IGNORE INTO mcp_servers (id, name, url, headers_json, enabled_tools_json, access, roles_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(crypto.randomUUID(), srv.name, srv.url, JSON.stringify(srv.headers), '[]', srv.access, JSON.stringify(srv.roles), ts, ts);
  }
  setSetting('seed_mcp_v1', ts);
  audit('system', 'seed', 'workspace.seed_mcp', { servers: SEED_SERVERS.length });
  return { seeded: true, servers: SEED_SERVERS.length };
}

module.exports = { seedMcpServers, SEED_SERVERS };

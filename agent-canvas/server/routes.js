'use strict';
// HTTP API. Roles and per-canvas access are enforced here, server-side —
// the client is never trusted for authorization decisions.

const crypto = require('node:crypto');
const express = require('express');
const { db, tx, nowIso } = require('./db');
const roster = require('./roster');
const { audit, queryAudit, verifyChain, verifyChainTail } = require('./audit');
const memory = require('./memory');
const bus = require('./bus');
const auth = require('./auth');
const control = require('./orchestrator/control');
const { dispatchRun, resumePump, queueState } = require('./orchestrator/queue');
const { createEscalation } = require('./orchestrator/tools');
const { callModel, tierConfig, FAST_MODEL, STRONG_MODEL, currentProvider } = require('./orchestrator/anthropic');

const { rateLimit } = require('./ratelimit');
const workspace = require('./google/workspace');
const opsrunner = require('./hubspot/opsrunner');
const mcp = require('./mcp/client');
const probestate = require('./probestate');
const jwt = require('jsonwebtoken');

const router = express.Router();

function asyncRoute(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
    res.status(err.status || 500).json({ error: err.message || 'internal error' });
  });
}

// Query params can arrive as arrays (?a=1&a=2) — always reduce to one string.
function qstr(value, fallback = undefined) {
  if (Array.isArray(value)) value = value[0];
  return value === undefined || value === null ? fallback : String(value);
}

// Broad safety net for all API routes; tighter buckets on sensitive ones below.
router.use(rateLimit('api'));

// ---------- config + auth ----------
router.get('/config', (req, res) => {
  res.json({
    googleClientId: auth.GOOGLE_CLIENT_ID || null,
    devAuth: auth.DEV_AUTH,
    domain: auth.ALLOWED_DOMAIN,
    models: { fast: FAST_MODEL, strong: STRONG_MODEL },
  });
});

router.post('/auth/google', rateLimit('auth'), asyncRoute(async (req, res) => {
  const user = await auth.signInWithGoogle(req.body.credential);
  auth.issueSession(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/auth/dev', rateLimit('auth'), asyncRoute(async (req, res) => {
  const user = auth.signInDev(req.body.email);
  auth.issueSession(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/auth/logout', (req, res) => {
  auth.clearSession(res);
  res.json({ ok: true });
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, picture: u.picture, role: u.role, theme: u.theme || 'light' };
}

// Everything below requires a signed-in allowlisted user.
router.use(auth.requireAuth);

// ---------- Google Workspace: capabilities + per-user connection ----------
// The matrix the UI renders is the same object the tool layer enforces.
const HUBSPOT_SURFACE = {
  surface: 'HubSpot CRM (sandbox)', icon: 'grid',
  can: [
    { id: 'hs_search', label: 'Search and read the CRM', detail: 'All object types in the practice portal, including custom objects (commission, referral_partner, suppliers).' },
    { id: 'hs_preview', label: 'Preview changes as dry runs', detail: 'Create/update/upsert previews show exactly what would change. Nothing applies at this step.' },
    { id: 'hs_apply', label: 'Apply after a named human approves', detail: 'Apply only works in a run resumed from an approved escalation — the preview → approval → apply ceremony is enforced on both sides.' },
  ],
  cannot: [
    { label: 'Delete or merge anything', detail: 'Policy-denied at the Ops Runner and never exposed to agents here.' },
    { label: 'Change anything in the real customer portal', detail: 'Every write goes through the Ops Runner, which is locked to sandbox portal 246460341 — production is unwritable by design. Reads through the hubspot-crm connector DO reach production portal 243103424, under read-only scopes.' },
  ],
};
router.get('/capabilities', (req, res) => {
  const surfaces = [...workspace.CAPABILITIES];
  if (opsrunner.configured()) surfaces.splice(surfaces.length - 1, 0, HUBSPOT_SURFACE);
  const mcpServers = mcp.listServers().filter((srv) => srv.enabledTools.length);
  if (mcpServers.length) {
    surfaces.splice(surfaces.length - 1, 0, {
      surface: 'MCP connectors', icon: 'shield',
      can: mcpServers.map((srv) => ({
        id: `mcp:${srv.name}`, label: `${srv.name}: ${srv.enabledTools.join(', ')}`,
        detail: 'Owner-enabled tools on a trusted external MCP server. They do what their server says they do; every call is audited with the directing user.',
      })),
      cannot: [
        { label: 'Use any tool the owner has not named', detail: 'Per-tool explicit enablement — a server offering fifty tools exposes exactly the ones listed above.' },
      ],
    });
  }
  res.json({
    surfaces,
    oauthReady: workspace.oauthReady(),
    connected: workspace.isConnected(req.user.email),
    identityModel: 'Agents act with the Google permissions of the person who directed the run — never more.',
  });
});

function oauthStateSecret() {
  // Same secret as sessions: env-provided in production, persisted random in
  // dev. Never a hardcoded literal — a forgeable state token is a CSRF hole.
  return auth.sessionSecret();
}
function externalBase(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

router.post('/google/connect', rateLimit('auth'), (req, res) => {
  if (!workspace.oauthReady()) {
    return res.status(503).json({ error: 'Workspace OAuth is not configured on this deployment (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET unset).' });
  }
  const redirectUri = `${externalBase(req)}/api/google/oauth/callback`;
  const state = jwt.sign({ email: req.user.email, purpose: 'ws-connect' }, oauthStateSecret(), { expiresIn: '15m' });
  res.json({ url: workspace.buildAuthUrl({ state, redirectUri }) });
});

router.get('/google/oauth/callback', rateLimit('auth'), asyncRoute(async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    // access_denied from an unverified External app in Testing means "this
    // account is not on the tester list" — say that, not "cancelled".
    return res.redirect(error === 'access_denied' ? '/?ws=blocked' : '/?ws=denied');
  }
  let claims;
  try { claims = jwt.verify(String(state || ''), oauthStateSecret()); } catch { return res.status(400).send('invalid state'); }
  if (claims.purpose !== 'ws-connect' || claims.email !== req.user.email) return res.status(403).send('state mismatch');
  await workspace.exchangeCode({ code: String(code), redirectUri: `${externalBase(req)}/api/google/oauth/callback`, email: req.user.email });
  res.redirect('/?ws=connected');
}));

// ---------- per-user display preference ----------
// Stored on the account so a person's choice follows them across devices.
const THEMES = ['light', 'dark'];
router.patch('/me/theme', (req, res) => {
  const theme = String(req.body.theme || '');
  if (!THEMES.includes(theme)) return res.status(400).json({ error: `theme must be one of ${THEMES.join(', ')}` });
  db.prepare('UPDATE users SET theme = ? WHERE email = ?').run(theme, req.user.email);
  res.json({ ok: true, theme });
});

// ---------- systems board: integration health with real statuses ----------
// States: ready (green) / attention (amber) / down (red, blinking) /
// planned (dark lamp — declared, deliberately not wired yet; never fake green).
router.get('/health/integrations', (req, res) => {
  const provider = currentProvider();
  // A secret pasted through a masking terminal arrives as literal bullets
  // (U+2022) and then fails deep in the SDK as "cannot convert to ByteString".
  // Catch it here, where the lamp can say what actually happened.
  const rawKey = process.env.ANTHROPIC_API_KEY || '';
  const keyCorrupted = provider === 'anthropic' && rawKey !== '' && !/^[\x21-\x7E]+$/.test(rawKey);
  const modelConfigured = provider === 'anthropic'
    ? Boolean(rawKey) && !keyCorrupted
    : Boolean(process.env.VERTEX_PROJECT_ID);
  const connected = workspace.isConnected(req.user.email);
  const oauth = workspace.oauthReady();
  const standardMode = workspace.scopeMode() === 'standard';
  // Finding 8: a configured lamp earns green from probe EVIDENCE, not config
  // presence. No probe this process → attention; failed probe → down with the
  // named error; successful probe → ready. Evidence lives in probestate
  // (process lifetime — a restart honestly forgets).
  const provenStatus = (id) => {
    const p = probestate.get(id);
    if (!p) return { status: 'attention', note: ' Configured but unprobed this process — Probe to earn green.' };
    if (!p.ok) return { status: 'down', note: ` Last probe FAILED: ${p.error}` };
    return { status: 'ready', note: ` Probe OK (${p.ms}ms).` };
  };
  const wsSurface = (id, label, probe) => {
    if (id === 'gmail' && standardMode) {
      return {
        id, label, probe: false, status: 'planned',
        detail: 'Disabled: GOOGLE_WORKSPACE_SCOPES=standard drops the restricted Gmail scopes so Connect works without Google\'s tester list. Flip to full after verification or the org move.',
      };
    }
    const proven = connected ? provenStatus(id) : null;
    return {
      id, label, probe: probe && oauth && connected,
      status: !oauth ? 'planned' : (connected ? proven.status : 'attention'),
      detail: !oauth
        ? 'OAuth client not configured on this deployment — see docs/DEPLOY.md.'
        : (connected ? `Connected as you. Agents you direct act with your permissions.${id === 'drive' && standardMode ? ' Standard scopes: Drive is limited to files the app creates.' : ''}${proven.note}`
                     : 'Your Google account is not connected — Capabilities → Connect.'),
    };
  };
  let chainOk = true;
  // Finding 10: the 60s poll verifies only the chain tail (O(K), anchored on
  // the stored pre-tail hash); the full walk stays on the owner-only audit view.
  try { chainOk = verifyChainTail().ok !== false; } catch { chainOk = false; }
  const replicated = Boolean(process.env.LITESTREAM_REPLICA_URL);
  const integrations = [
    {
      id: 'model', label: `MODEL · ${provider.toUpperCase()}`, probe: modelConfigured,
      status: modelConfigured ? 'ready' : 'down',
      detail: modelConfigured
        ? `${FAST_MODEL} (fast) / ${STRONG_MODEL} (strong) via ${provider}`
        : (keyCorrupted
          ? 'ANTHROPIC_API_KEY contains non-ASCII characters (e.g. \u2022 bullets from a masked terminal paste) — the stored secret is not the real key. Re-add the secret version with the actual key and roll a new revision.'
          : 'No model credential: set VERTEX_PROJECT_ID (keyless) or ANTHROPIC_API_KEY. Every agent run fails until this is set.'),
    },
    wsSurface('gmail', 'GMAIL', true),
    wsSurface('drive', 'DRIVE / DOCS', true),
    wsSurface('sheets', 'SHEETS', true),
    wsSurface('calendar', 'CALENDAR', true),
    {
      id: 'audit', label: 'AUDIT CHAIN',
      status: chainOk ? 'ready' : 'down',
      detail: chainOk ? 'Hash chain tail verified just now (full walk runs on the audit view).' : 'AUDIT CHAIN BROKEN — records were altered or lost. Investigate before trusting any log.',
    },
    {
      id: 'db', label: 'DATABASE',
      status: replicated ? 'ready' : (process.env.NODE_ENV === 'production' ? 'attention' : 'ready'),
      detail: replicated ? 'SQLite replicated continuously to Cloud Storage (Litestream).'
        : (process.env.NODE_ENV === 'production' ? 'PRODUCTION WITHOUT REPLICATION — a container restart loses data.' : 'Local dev disk — replication applies on Cloud Run.'),
    },
    {
      id: 'websearch', label: 'WEB SEARCH',
      status: process.env.ENABLE_WEB_SEARCH === '0' ? 'planned' : 'ready',
      detail: process.env.ENABLE_WEB_SEARCH === '0' ? 'Disabled by ENABLE_WEB_SEARCH=0.' : 'Research agents can search with citations; $10/1k searches, metered per run.',
    },
    {
      id: 'hubspot', label: 'HUBSPOT · OPS RUNNER', probe: opsrunner.configured(),
      status: opsrunner.configured() ? provenStatus('hubspot').status : 'planned',
      detail: opsrunner.configured()
        ? `Wired to ctg-hs-ops-runner (sandbox portal 246460341 — real CRM unreachable by design). Reads free; changes preview-first, applied only after human approval.${provenStatus('hubspot').note}`
        : 'Not wired — set HS_OPS_RUNNER_URL and grant run.invoker to the canvas service account (see docs/DEPLOY.md).',
    },
    ...(mcp.configError() ? [{
      id: 'mcp', label: 'MCP CONFIG',
      status: 'down',
      detail: `MCP configuration failed to parse: ${mcp.configError()} — no connector is active until this is fixed.`,
    }] : (mcp.listServers().length ? mcp.listServers().map((srv) => {
      const refused = (mcp.refusedToolReport().find((r) => r.server === srv.name) || {}).tools || [];
      // Amber, not red: the connector works and every read tool it was given
      // is live. Amber says "your intent was partly denied, come look" —
      // the honest colour for a partial refusal.
      const refusalNote = refused.length
        ? ` ${refused.length} tool(s) refused as writes (${refused.join(', ')}) — connectors are read lanes; CRM writes go through the ops-runner preview/apply lane.`
        : '';
      const proven = provenStatus(`mcp:${srv.name}`);
      return {
        id: `mcp:${srv.name}`, label: `MCP · ${srv.name.toUpperCase()}`, probe: true,
        status: refused.length ? 'attention' : (srv.enabledTools.length ? proven.status : 'attention'),
        detail: (srv.enabledTools.length
          ? `${srv.enabledTools.length} tool(s) enabled by the owner: ${srv.enabledTools.join(', ')}. Third-party tools do what their server says they do — every call is audited.${proven.note}`
          : 'Server configured but no tools enabled — nothing is exposed to agents until the owner names tools in enabledTools.') + refusalNote,
      };
    }) : [{
      id: 'mcp', label: 'MCP CONNECTORS',
      status: 'planned',
      detail: 'No connectors configured. Set MCP_SERVERS (or config/mcp.json) with per-tool enablement — see docs/DEPLOY.md.',
    }])),
  ];
  const rank = { down: 3, attention: 2, ready: 1, planned: 0 };
  const aggregate = integrations.reduce((worst, i) => (rank[i.status] > rank[worst] ? i.status : worst), 'ready');
  res.json({ integrations, aggregate, queue: queueState(), provider });
});

router.post('/health/probe', rateLimit('auth'), asyncRoute(async (req, res) => {
  const surface = String(req.body.surface || '');
  // Every outcome — success or failure — is recorded as probe evidence:
  // the lamps read this record, so a probe is how a lamp earns its colour.
  const recorded = async (fn) => {
    try {
      const result = await fn();
      probestate.record(surface, result);
      return result;
    } catch (err) {
      probestate.record(surface, { ok: false, error: err.message || err });
      throw err;
    }
  };
  if (surface === 'model') {
    // One tiny live call through the real model path. This is the difference
    // between "credential present" and "Model Garden actually enabled" — a 403
    // here is the enablement detector, surfaced with the upstream message.
    const { model } = tierConfig('fast');
    return res.json(await recorded(async () => {
      const t0 = Date.now();
      await callModel({ model, system: 'Reply with the single word: ok', messages: [{ role: 'user', content: 'ping' }], maxTokens: 8 });
      audit('user', req.user.email, 'health.model_probe', { model, ms: Date.now() - t0 });
      return { ok: true, ms: Date.now() - t0, model };
    }));
  }
  if (surface === 'hubspot') {
    return res.json(await recorded(() => opsrunner.probe(req.user.email)));
  }
  if (surface.startsWith('mcp:')) {
    return res.json(await recorded(() => mcp.probeServer(surface.slice(4))));
  }
  res.json(await recorded(() => workspace.probeSurface(req.user.email, surface)));
}));

router.post('/google/disconnect', (req, res) => {
  workspace.disconnect(req.user.email);
  res.json({ ok: true });
});

// ---------- allowlist (owner only) ----------
router.get('/allowlist', auth.requireOwner, (req, res) => {
  res.json({ allowlist: db.prepare('SELECT * FROM allowlist ORDER BY added_at').all() });
});

router.post('/allowlist', auth.requireOwner, (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const role = req.body.role === 'owner' ? 'owner' : 'member';
  if (!email.endsWith(`@${auth.ALLOWED_DOMAIN}`)) {
    return res.status(400).json({ error: `only ${auth.ALLOWED_DOMAIN} addresses can be allowlisted` });
  }
  db.prepare('INSERT INTO allowlist (email, role, display_name, added_by, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, display_name = COALESCE(excluded.display_name, display_name)')
    .run(email, role, req.body.display_name || null, req.user.email, nowIso());
  audit('user', req.user.email, 'allowlist.add', { email, role });
  res.json({ ok: true });
});

router.delete('/allowlist/:email', auth.requireOwner, (req, res) => {
  const email = String(req.params.email).toLowerCase();
  if (email === req.user.email.toLowerCase()) return res.status(400).json({ error: 'cannot remove yourself' });
  db.prepare('DELETE FROM allowlist WHERE email = ?').run(email);
  audit('user', req.user.email, 'allowlist.remove', { email });
  res.json({ ok: true });
});

// ---------- agent roster (workspace-level template library) ----------
router.get('/roster', (req, res) => {
  const rows = db.prepare('SELECT * FROM roster_agents ORDER BY sort, created_at').all();
  // Members staff canvases from enabled entries; the owner also sees disabled
  // ones (the Roster tab is where they get re-enabled).
  res.json({ roster: req.user.role === 'owner' ? rows : rows.filter((r) => r.enabled) });
});

router.post('/roster', auth.requireOwner, (req, res) => {
  const { name, role = 'research', color = '#2080D0', model_tier = 'strong', system_prompt = '', companion_note_key = null, enabled = true, default_on = false, sort } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = crypto.randomUUID();
  const ts = nowIso();
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM roster_agents').get().m;
  db.prepare('INSERT INTO roster_agents (id, name, role, color, model_tier, system_prompt, companion_note_key, enabled, default_on, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, role, color, ['fast', 'strong'].includes(model_tier) ? model_tier : 'strong', system_prompt,
      companion_note_key, enabled ? 1 : 0, default_on ? 1 : 0, sort ?? maxSort + 1, ts, ts);
  audit('user', req.user.email, 'roster.create', { rosterId: id, name });
  res.json({ entry: db.prepare('SELECT * FROM roster_agents WHERE id = ?').get(id) });
});

router.patch('/roster/:id', auth.requireOwner, (req, res) => {
  const entry = db.prepare('SELECT * FROM roster_agents WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'roster entry not found' });
  const { name, role, color, model_tier, system_prompt, companion_note_key, enabled, default_on, sort } = req.body;
  db.prepare('UPDATE roster_agents SET name = ?, role = ?, color = ?, model_tier = ?, system_prompt = ?, companion_note_key = ?, enabled = ?, default_on = ?, sort = ?, updated_at = ? WHERE id = ?')
    .run(name ?? entry.name, role ?? entry.role, color ?? entry.color,
      ['fast', 'strong'].includes(model_tier) ? model_tier : entry.model_tier,
      system_prompt ?? entry.system_prompt,
      companion_note_key === undefined ? entry.companion_note_key : companion_note_key,
      enabled === undefined ? entry.enabled : (enabled ? 1 : 0),
      default_on === undefined ? entry.default_on : (default_on ? 1 : 0),
      sort ?? entry.sort, nowIso(), entry.id);
  audit('user', req.user.email, 'roster.update', { rosterId: entry.id });
  res.json({ entry: db.prepare('SELECT * FROM roster_agents WHERE id = ?').get(entry.id) });
});

// ---------- MCP connectors (owner-managed; served to agents via mcp/client) ----------
router.get('/mcp/servers', auth.requireOwner, (req, res) => {
  const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY name').all().map((r) => ({
    id: r.id, name: r.name, url: r.url, access: r.access, enabled: r.enabled,
    enabledTools: JSON.parse(r.enabled_tools_json || '[]'),
    roles: JSON.parse(r.roles_json || '[]'),
    headers: mcpMaskedHeaders(r.headers_json),
    created_at: r.created_at, updated_at: r.updated_at,
  }));
  res.json({ servers: rows, configError: mcp.configError(), refusedTools: mcp.refusedToolReport() });
});

const MCP_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
function mcpMaskedHeaders(headersJson) {
  let headers;
  try { headers = JSON.parse(headersJson || '{}'); } catch { return {}; }
  const masked = {};
  for (const [k, v] of Object.entries(headers)) {
    const val = String(v);
    masked[k] = /^\$\{ENV:[A-Z0-9_]+\}$/.test(val) ? val : (val.length <= 4 ? '••••' : `••••${val.slice(-4)}`);
  }
  return masked;
}
function mcpValidate({ name, url, access, enabledTools, model }) {
  if (name !== undefined && !MCP_NAME_RE.test(String(name))) return 'name must be 1-64 chars [a-zA-Z0-9_-]';
  // https, or loopback for local development. mcp/client.js mints a
  // Google-signed identity token and sends it as a Bearer header over whatever
  // scheme this URL carries; the same check runs in normalizeServer, which is
  // the layer that actually loads env/file/DB rows.
  if (url !== undefined && !mcp.safeMcpUrl(url)) return 'url must be https (or a loopback address for local development)';
  if (access !== undefined && !['owner', 'members'].includes(access)) return "access must be 'owner' or 'members'";
  return null;
}

// Write tools are STRIPPED from a save, never a reason to reject it.
// Rejecting trapped the owner: the stored config already contained write tools,
// so every save that tried to remove them was refused for containing them. The
// enforced config is normalizeServer's, so making the stored config converge on
// it — and reporting what was dropped — is both kinder and more correct.
function splitMutating(enabledTools) {
  const list = Array.isArray(enabledTools) ? enabledTools.map(String) : [];
  return { kept: list.filter((t) => !mcp.isMutatingToolName(t)), refused: list.filter((t) => mcp.isMutatingToolName(t)) };
}

router.post('/mcp/servers', auth.requireOwner, (req, res) => {
  const { name, url, headers = {}, enabledTools = [], access = 'members', roles = [], enabled = true } = req.body || {};
  const bad = mcpValidate({ name: name || '', url: url || '', access });
  if (!name || !url || bad) return res.status(400).json({ error: bad || 'name and url required' });
  const tools = splitMutating(enabledTools);
  if (db.prepare('SELECT id FROM mcp_servers WHERE name = ?').get(name)) return res.status(409).json({ error: 'a connector with that name exists' });
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare('INSERT INTO mcp_servers (id, name, url, headers_json, enabled_tools_json, access, roles_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, url, JSON.stringify(headers), JSON.stringify(tools.kept), access, JSON.stringify(roles), enabled ? 1 : 0, ts, ts);
  audit('user', req.user.email, 'mcp.server_create', { serverId: id, name, access, refusedTools: tools.refused });
  mcp.reload();
  mcp.refreshDefs();
  res.json({ ok: true, id, refusedTools: tools.refused });
});

router.patch('/mcp/servers/:id', auth.requireOwner, (req, res) => {
  const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'connector not found' });
  const { name, url, headers, enabledTools, access, roles, enabled } = req.body || {};
  const bad = mcpValidate({ name, url, access });
  if (bad) return res.status(400).json({ error: bad });
  const tools = enabledTools === undefined ? null : splitMutating(enabledTools);
  db.prepare('UPDATE mcp_servers SET name = ?, url = ?, headers_json = ?, enabled_tools_json = ?, access = ?, roles_json = ?, enabled = ?, updated_at = ? WHERE id = ?')
    .run(name ?? row.name, url ?? row.url,
      headers === undefined ? row.headers_json : JSON.stringify(headers),
      tools === null ? row.enabled_tools_json : JSON.stringify(tools.kept),
      access ?? row.access,
      roles === undefined ? row.roles_json : JSON.stringify(roles),
      enabled === undefined ? row.enabled : (enabled ? 1 : 0),
      nowIso(), row.id);
  audit('user', req.user.email, 'mcp.server_update', { serverId: row.id, name: name ?? row.name, refusedTools: tools ? tools.refused : [] });
  mcp.reload();
  mcp.refreshDefs();
  res.json({ ok: true, refusedTools: tools ? tools.refused : [] });
});

// Probe: fresh handshake + tools/list, returning the tool inventory so the
// admin tab can render per-tool enable checkboxes. Probing enables NOTHING.
router.post('/mcp/servers/:id/probe', auth.requireOwner, asyncRoute(async (req, res) => {
  const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'connector not found' });
  mcp.reload();
  try {
    const result = await mcp.probeServer(row.name);
    const tools = await mcp.discoverTools(row.name);
    probestate.record(`mcp:${row.name}`, result); // admin probes are lamp evidence too
    res.json({ ok: true, ms: result.ms, tools });
  } catch (err) {
    probestate.record(`mcp:${row.name}`, { ok: false, error: err.message || err });
    res.status(502).json({ error: String(err.message || err) });
  }
}));

// ---------- canvases ----------
router.get('/canvases', (req, res) => {
  const all = db.prepare('SELECT * FROM canvases ORDER BY created_at').all();
  const visible = all.filter((c) => auth.canAccessCanvas(req.user, c.id).ok);
  // Archived canvases leave everyone's switcher. The owner gets them back in a
  // separate list (the "Archived" section) — archive is tidiness, not
  // destruction: rows, memory, audit lineage all stay.
  res.json({
    canvases: visible.filter((c) => !c.archived),
    archived: req.user.role === 'owner' ? visible.filter((c) => Boolean(c.archived)) : [],
  });
});

router.post('/canvases', (req, res) => {
  const rosterIds = Array.isArray(req.body.roster_ids) ? req.body.roster_ids : [];
  const id = crypto.randomUUID();
  try {
    // Canvas + staffed agents + companion notes land atomically or not at all.
    tx(() => {
      db.prepare('INSERT INTO canvases (id, name, description, access_mode, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, req.body.name || 'Untitled canvas', req.body.description || '', 'workspace', req.user.email, nowIso());
      for (const rosterId of rosterIds) {
        roster.instantiateOnCanvas({ canvasId: id, rosterId, actor: req.user.email });
      }
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  audit('user', req.user.email, 'canvas.create', { canvasId: id, roster: rosterIds.length });
  res.json({ canvas: db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) });
});

router.get('/canvases/:canvasId', auth.requireCanvas, (req, res) => {
  const canvasId = req.params.canvasId;
  const agents = db.prepare('SELECT * FROM agents WHERE canvas_id = ?').all(canvasId);
  const notes = db.prepare('SELECT * FROM notes WHERE canvas_id = ?').all(canvasId);
  const tasks = db.prepare('SELECT * FROM tasks WHERE canvas_id = ?').all(canvasId);
  const files = db.prepare('SELECT id, canvas_id, name, mime, size, x, y, uploaded_by, created_at FROM files WHERE canvas_id = ?').all(canvasId);
  const rows = db.prepare('SELECT id, row_index, data, status, notes FROM sheet_rows WHERE canvas_id = ? ORDER BY row_index').all(canvasId)
    .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  const escalations = db.prepare("SELECT * FROM escalations WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 50").all(canvasId)
    .map((e) => ({ ...e, context: JSON.parse(e.context) }));
  const handoffs = db.prepare('SELECT * FROM handoffs WHERE canvas_id = ? ORDER BY ts DESC LIMIT 100').all(canvasId)
    .map((h) => ({ ...h, payload_entry_ids: JSON.parse(h.payload_entry_ids) }));
  const runs = db.prepare('SELECT id, agent_id, status, trigger_kind, instruction, steps_used, step_budget, model, input_tokens, output_tokens, cost_usd, summary, error, started_at, ended_at, created_at FROM runs WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 100').all(canvasId);
  const changesets = db.prepare('SELECT * FROM changesets WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 20').all(canvasId)
    .map((cs) => ({
      ...cs,
      changes: db.prepare('SELECT c.*, r.row_index FROM changes c JOIN sheet_rows r ON r.id = c.row_id WHERE c.changeset_id = ?').all(cs.id)
        .map((c) => ({ ...c, cite_entry_ids: JSON.parse(c.cite_entry_ids) })),
    }));
  res.json({
    canvas: req.canvas, agents, notes, tasks, files, rows, escalations, handoffs, runs, changesets,
    budget: control.getDailyUsage(), queue: queueState(),
  });
});

router.patch('/canvases/:canvasId', auth.requireOwner, (req, res) => {
  const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(req.params.canvasId);
  if (!canvas) return res.status(404).json({ error: 'canvas not found' });
  const { access_mode: mode, archived } = req.body;
  // Validate everything before writing anything — a two-field patch must be
  // all-or-nothing, never half-applied.
  if (mode === undefined && archived === undefined) {
    return res.status(400).json({ error: 'nothing to update — provide access_mode and/or archived' });
  }
  if (mode !== undefined && !['workspace', 'restricted'].includes(mode)) {
    return res.status(400).json({ error: 'access_mode must be workspace|restricted' });
  }
  if (archived !== undefined && typeof archived !== 'boolean') {
    return res.status(400).json({ error: 'archived must be true or false' });
  }
  if (mode !== undefined) {
    db.prepare('UPDATE canvases SET access_mode = ? WHERE id = ?').run(mode, canvas.id);
    audit('user', req.user.email, 'canvas.set_access_mode', { canvasId: canvas.id, mode });
  }
  if (archived !== undefined) {
    db.prepare('UPDATE canvases SET archived = ? WHERE id = ?').run(archived ? 1 : 0, canvas.id);
    audit('user', req.user.email, archived ? 'canvas.archive' : 'canvas.unarchive', { canvasId: canvas.id });
  }
  res.json({ ok: true });
});

router.post('/canvases/:canvasId/members', auth.requireOwner, (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  if (!auth.allowlistEntry(email)) return res.status(400).json({ error: 'member must be on the workspace allowlist' });
  db.prepare("INSERT INTO canvas_members (canvas_id, user_email, access) VALUES (?, ?, 'edit') ON CONFLICT(canvas_id, user_email) DO NOTHING")
    .run(req.params.canvasId, email);
  audit('user', req.user.email, 'canvas.member_add', { canvasId: req.params.canvasId, email });
  res.json({ ok: true });
});

router.delete('/canvases/:canvasId/members/:email', auth.requireOwner, (req, res) => {
  db.prepare('DELETE FROM canvas_members WHERE canvas_id = ? AND user_email = ?')
    .run(req.params.canvasId, String(req.params.email).toLowerCase());
  audit('user', req.user.email, 'canvas.member_remove', { canvasId: req.params.canvasId, email: req.params.email });
  res.json({ ok: true });
});

// ---------- agents ----------
router.post('/canvases/:canvasId/agents', auth.requireCanvas, (req, res) => {
  if (req.body.roster_id) {
    // Instantiate from the roster: template fields win; only placement is caller's.
    try {
      const out = tx(() => roster.instantiateOnCanvas({
        canvasId: req.params.canvasId, rosterId: req.body.roster_id, actor: req.user.email,
        x: req.body.x, y: req.body.y,
      }));
      audit('user', req.user.email, 'agent.create', { agentId: out.agent.id, canvasId: req.params.canvasId, role: out.agent.role, rosterId: req.body.roster_id });
      bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
      return res.json({ agent: out.agent });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }
  const id = crypto.randomUUID();
  const { name, role = 'research', color = '#2080D0', model_tier = 'strong', system_prompt = '', x = 0, y = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  db.prepare('INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.canvasId, name, role, color, model_tier === 'fast' ? 'fast' : 'strong', system_prompt, x, y, nowIso());
  audit('user', req.user.email, 'agent.create', { agentId: id, canvasId: req.params.canvasId, role });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ agent: db.prepare('SELECT * FROM agents WHERE id = ?').get(id) });
});

router.patch('/canvases/:canvasId/agents/:agentId', auth.requireCanvas, (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND canvas_id = ?').get(req.params.agentId, req.params.canvasId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const { x, y, system_prompt, model_tier, name, color } = req.body;
  // Finding 11: a system-prompt rewrite changes what an agent IS — it gets an
  // audit line naming who changed it. (Whether it should be owner-only is a
  // pending decision for Pete; the accountability half need not wait.)
  if (system_prompt != null && system_prompt !== agent.system_prompt) {
    audit('user', req.user.email, 'agent.prompt_update', {
      agentId: agent.id, canvasId: agent.canvas_id,
      fromLen: (agent.system_prompt || '').length, toLen: String(system_prompt).length,
    });
  }
  db.prepare('UPDATE agents SET x = ?, y = ?, system_prompt = ?, model_tier = ?, name = ?, color = ? WHERE id = ?')
    .run(x ?? agent.x, y ?? agent.y, system_prompt ?? agent.system_prompt,
      ['fast', 'strong'].includes(model_tier) ? model_tier : agent.model_tier, name ?? agent.name, color ?? agent.color, agent.id);
  res.json({ ok: true });
});

// Owner-only: re-copy prompt + tier from the source roster entry. Name and
// color stay — they are per-canvas identity the owner may have customized.
router.post('/canvases/:canvasId/agents/:agentId/resync', auth.requireOwner, (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND canvas_id = ?').get(req.params.agentId, req.params.canvasId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  if (!agent.roster_id) return res.status(404).json({ error: 'agent has no roster provenance' });
  const entry = db.prepare('SELECT * FROM roster_agents WHERE id = ?').get(agent.roster_id);
  if (!entry) return res.status(404).json({ error: 'source roster entry no longer exists' });
  db.prepare('UPDATE agents SET system_prompt = ?, model_tier = ? WHERE id = ?').run(entry.system_prompt, entry.model_tier, agent.id);
  audit('user', req.user.email, 'agent.resync', { agentId: agent.id, canvasId: req.params.canvasId, rosterId: entry.id });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ agent: db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id) });
});

// ---------- runs ----------
router.post('/canvases/:canvasId/agents/:agentId/dispatch', rateLimit('model'), auth.requireCanvas, (req, res) => {
  if (control.isPaused()) return res.status(409).json({ error: 'workspace is paused — resume before dispatching' });
  const instruction = String(req.body.instruction || '').trim();
  if (!instruction) return res.status(400).json({ error: 'instruction required' });
  try {
    const run = dispatchRun({
      agentId: req.params.agentId, canvasId: req.params.canvasId, instruction,
      triggerKind: 'user', actor: req.user.email, initiatedBy: req.user.email,
      stepBudget: req.body.step_budget, wallMs: req.body.wall_ms,
    });
    res.json({ run });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/canvases/:canvasId/runs/:runId/events', auth.requireCanvas, (req, res) => {
  const events = db.prepare('SELECT * FROM run_events WHERE run_id = ? AND canvas_id = ? ORDER BY id').all(req.params.runId, req.params.canvasId)
    .map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  res.json({ events });
});

router.get('/canvases/:canvasId/activity', auth.requireCanvas, (req, res) => {
  const limit = Math.min(Number(qstr(req.query.limit)) || 200, 1000);
  const events = db.prepare('SELECT * FROM run_events WHERE canvas_id = ? ORDER BY id DESC LIMIT ?').all(req.params.canvasId, limit)
    .map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  res.json({ events });
});

// ---------- memory ----------
router.get('/canvases/:canvasId/memory', auth.requireCanvas, (req, res) => {
  const entries = memory.listEntries({
    canvasId: req.params.canvasId,
    includeSuperseded: qstr(req.query.include_superseded) === '1',
    epistemic: qstr(req.query.epistemic),
    since: qstr(req.query.since),
    query: qstr(req.query.q),
    limit: qstr(req.query.limit),
  });
  res.json({ entries });
});

router.post('/canvases/:canvasId/memory', auth.requireCanvas, (req, res) => {
  const { content, epistemic, source = '', cites = [] } = req.body;
  try {
    const entry = memory.writeEntry({
      canvasId: req.params.canvasId, content, epistemic,
      authorType: 'user', authorId: req.user.email, authorName: req.user.name || req.user.email,
      source, cites,
    });
    bus.emit('event', { type: 'memory_write', canvasId: req.params.canvasId, entry });
    res.json({ entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/canvases/:canvasId/memory/:entryId/correct', auth.requireCanvas, (req, res) => {
  const { content, epistemic, reason = '', source = '', cites = [] } = req.body;
  try {
    const result = memory.correctEntry({
      entryId: req.params.entryId, content, epistemic, reason, source,
      authorType: 'user', authorId: req.user.email, authorName: req.user.name || req.user.email, cites,
    });
    if (result.conflict) {
      const escalation = createEscalation({
        canvasId: req.params.canvasId, runId: null, agentId: null, kind: 'conflict',
        question: `Concurrent correction conflict: "${result.original.content.slice(0, 120)}" was corrected twice in parallel. Which correction stands?`,
        context: { existing: result.current ? result.current.id : null, attempted: content },
      });
      return res.status(409).json({ conflict: true, escalationId: escalation.id, current: result.current });
    }
    bus.emit('event', { type: 'memory_ripple', canvasId: req.params.canvasId, entry: result.entry, supersededId: req.params.entryId, affected: result.affected });
    res.json({ entry: result.entry, affected: result.affected });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/memory/:entryId/lineage', (req, res) => {
  const trace = memory.lineage(req.params.entryId);
  if (!trace) return res.status(404).json({ error: 'entry not found' });
  if (trace.entry.canvasId) {
    const check = auth.canAccessCanvas(req.user, trace.entry.canvasId);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
  }
  // Cross-canvas hydration must not leak restricted content: entries from
  // canvases the requester cannot access are redacted, not returned.
  const accessCache = new Map();
  const canSee = (canvasId) => {
    if (!canvasId) return true;
    if (!accessCache.has(canvasId)) accessCache.set(canvasId, auth.canAccessCanvas(req.user, canvasId).ok);
    return accessCache.get(canvasId);
  };
  const redact = (entry) => (canSee(entry.canvasId) ? entry : {
    id: entry.id, canvasId: entry.canvasId, epistemic: entry.epistemic, depth: entry.depth,
    tainted: entry.tainted, redacted: true, content: '[entry on a canvas you cannot access]',
    author: { type: 'redacted', id: '', name: '' }, source: '', cites: [], citedBy: [],
  });
  res.json({
    ...trace,
    upstream: trace.upstream.map(redact),
    downstream: trace.downstream.map(redact),
    runReads: trace.runReads.map(redact),
  });
});

// ---------- notes ----------
router.post('/canvases/:canvasId/notes', auth.requireCanvas, (req, res) => {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO notes (id, canvas_id, title, content, pinned, x, y, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.canvasId, req.body.title || 'Note', req.body.content || '', req.body.pinned ? 1 : 0, req.body.x || 0, req.body.y || 0, req.user.email, nowIso());
  audit('user', req.user.email, 'note.create', { noteId: id, canvasId: req.params.canvasId });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ note: db.prepare('SELECT * FROM notes WHERE id = ?').get(id) });
});

// Versioned update with a three-way merge so simultaneous edits never clobber.
router.put('/canvases/:canvasId/notes/:noteId', auth.requireCanvas, (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND canvas_id = ?').get(req.params.noteId, req.params.canvasId);
  if (!note) return res.status(404).json({ error: 'note not found' });
  const { content, base_version, base_content, title, pinned } = req.body;
  let finalContent = content ?? note.content;
  let merged = false;
  if (content !== undefined && base_version !== undefined && base_version < note.version) {
    finalContent = threeWayMerge(base_content ?? '', note.content, content);
    merged = true;
  }
  const newPinned = pinned === undefined ? note.pinned : (pinned ? 1 : 0);
  db.prepare('UPDATE notes SET content = ?, title = ?, pinned = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(finalContent, title ?? note.title, newPinned, req.user.email, nowIso(), note.id);
  if (newPinned !== note.pinned) audit('user', req.user.email, newPinned ? 'note.pin' : 'note.unpin', { noteId: note.id });
  const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id);
  bus.emit('event', { type: 'note_update', canvasId: req.params.canvasId, note: updated, by: req.user.email, merged });
  res.json({ note: updated, merged });
});

// Concurrent-edit merge: apply both sides when they touch different regions;
// keep both (marked) when they collide. Never silently drops either edit.
function threeWayMerge(base, current, mine) {
  if (current === base) return mine;
  if (mine === base) return current;
  if (mine === current) return mine;
  const b = base.split('\n'); const c = current.split('\n'); const m = mine.split('\n');
  let prefix = 0;
  while (prefix < Math.min(b.length, c.length, m.length) && b[prefix] === c[prefix] && b[prefix] === m[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(b.length, c.length, m.length) - prefix &&
    b[b.length - 1 - suffix] === c[c.length - 1 - suffix] &&
    b[b.length - 1 - suffix] === m[m.length - 1 - suffix]
  ) suffix++;
  const bMid = b.slice(prefix, b.length - suffix).join('\n');
  const cMid = c.slice(prefix, c.length - suffix).join('\n');
  const mMid = m.slice(prefix, m.length - suffix).join('\n');
  let mid;
  if (cMid === bMid) mid = mMid;
  else if (mMid === bMid) mid = cMid;
  else mid = `${mMid}\n⚠ concurrent edit — both versions kept:\n${cMid}`;
  return [...c.slice(0, prefix), ...(mid ? mid.split('\n') : []), ...c.slice(c.length - suffix)].join('\n');
}

// ---------- tasks ----------
router.post('/canvases/:canvasId/tasks', auth.requireCanvas, (req, res) => {
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare('INSERT INTO tasks (id, canvas_id, title, description, status, assignee_agent_id, x, y, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.canvasId, req.body.title || 'Task', req.body.description || '', 'todo', req.body.assignee_agent_id || null, req.body.x || 0, req.body.y || 0, ts, ts);
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) });
});

router.patch('/canvases/:canvasId/tasks/:taskId', auth.requireCanvas, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND canvas_id = ?').get(req.params.taskId, req.params.canvasId);
  if (!task) return res.status(404).json({ error: 'task not found' });
  db.prepare('UPDATE tasks SET title = ?, description = ?, status = ?, x = ?, y = ?, updated_at = ? WHERE id = ?')
    .run(req.body.title ?? task.title, req.body.description ?? task.description, req.body.status ?? task.status,
      req.body.x ?? task.x, req.body.y ?? task.y, nowIso(), task.id);
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ ok: true });
});

// ---------- node positions (notes/files/tasks share the same shape) ----------
router.post('/canvases/:canvasId/positions', auth.requireCanvas, (req, res) => {
  const { kind, id, x, y } = req.body;
  const tables = { agent: 'agents', note: 'notes', task: 'tasks', file: 'files' };
  const table = tables[kind];
  if (!table) return res.status(400).json({ error: 'kind must be agent|note|task|file' });
  db.prepare(`UPDATE ${table} SET x = ?, y = ? WHERE id = ? AND canvas_id = ?`).run(x, y, id, req.params.canvasId);
  bus.emit('event', { type: 'node_move', canvasId: req.params.canvasId, kind, id, x, y, by: req.user.email });
  res.json({ ok: true });
});

// ---------- files ----------
router.post('/canvases/:canvasId/files', auth.requireCanvas, express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  // The TYPE of req.body is caller-controlled: the app-level JSON parser runs
  // before this router, so a JSON content-type yields a parsed object/array
  // here instead of a Buffer, and express.raw() then skips. Validate at the
  // boundary rather than trusting the middleware to have produced a Buffer.
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'upload requires a non-empty binary body; do not send a JSON content-type' });
  }
  // Normalize into a value whose type is established here rather than inherited
  // from the request, so nothing downstream depends on what the caller sent.
  const bytes = Buffer.from(req.body);
  const size = bytes.byteLength;
  const id = crypto.randomUUID();
  const name = qstr(req.query.name, 'file.bin').slice(0, 200);
  const mime = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 128);
  db.prepare('INSERT INTO files (id, canvas_id, name, mime, size, content, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.canvasId, name, mime, size, bytes, req.user.email, nowIso());
  audit('user', req.user.email, 'file.upload', { fileId: id, name, size });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ file: { id, name, mime, size } });
});

router.get('/canvases/:canvasId/files/:fileId', auth.requireCanvas, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND canvas_id = ?').get(req.params.fileId, req.params.canvasId);
  if (!file) return res.status(404).json({ error: 'file not found' });
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${file.name.replace(/"/g, '')}"`);
  // SQLite returns BLOBs as Uint8Array; res.send() would JSON-serialize that
  // ({"0":104,...}) instead of sending bytes. Convert to a Buffer.
  res.send(Buffer.from(file.content));
});

// ---------- escalations (the needs-you tray) ----------
router.get('/escalations', (req, res) => {
  const all = db.prepare("SELECT * FROM escalations WHERE status = 'open' ORDER BY created_at DESC LIMIT 100").all()
    .map((e) => ({ ...e, context: JSON.parse(e.context) }));
  const visible = all.filter((e) => !e.canvas_id || auth.canAccessCanvas(req.user, e.canvas_id).ok);
  res.json({ escalations: visible });
});

router.post('/escalations/:id/resolve', asyncRoute(async (req, res) => {
  const escalation = db.prepare('SELECT * FROM escalations WHERE id = ?').get(req.params.id);
  if (!escalation) return res.status(404).json({ error: 'escalation not found' });
  if (escalation.status !== 'open') return res.status(409).json({ error: 'already resolved' });
  if (escalation.canvas_id) {
    const check = auth.canAccessCanvas(req.user, escalation.canvas_id);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
  }
  const { action, answer = '', target_agent_id } = req.body; // 'accept' | 'redirect' | 'dismiss'
  if (!['accept', 'redirect', 'dismiss'].includes(action)) return res.status(400).json({ error: 'action must be accept|redirect|dismiss' });

  let agentId = escalation.agent_id;
  if (action === 'redirect') {
    if (!target_agent_id) return res.status(400).json({ error: 'target_agent_id required for redirect' });
    agentId = target_agent_id;
  }
  const status = action === 'dismiss' ? 'dismissed' : action === 'redirect' ? 'redirected' : 'accepted';

  // Both halves or neither. Ordering alone cannot fix this: `dispatchRun`
  // throws 429 on a spent daily budget (a designed state), and each order
  // fails a different way. Record-then-dispatch loses the human's decision —
  // the escalation reads 'accepted', so it leaves the tray, and no run ever
  // applies it. Dispatch-then-record is worse in KIND: a live run carrying
  // trigger_kind='escalation_resume' — the only gate hs_apply_change checks —
  // while the escalation still reads 'open' with no resolved_by and no
  // escalation.resolve audit line. A sandbox CRM apply would execute with no
  // record of the approval that authorized it, and the still-open row invites
  // a second human to resolve it into a second run.
  //
  // node:sqlite is synchronous and dispatchRun's pump is deferred via
  // setImmediate, so both fit inside one transaction and a 429 rolls the whole
  // thing back.
  let run = null;
  tx(() => {
    db.prepare('UPDATE escalations SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
      .run(status, answer, req.user.email, nowIso(), escalation.id);
    if (action !== 'dismiss' && agentId && answer.trim()) {
      run = dispatchRun({
        agentId, canvasId: escalation.canvas_id,
        instruction: `A human resolved your escalation (escalation_id: ${escalation.id}).\nOriginal question: ${escalation.question}\nHuman decision (${req.user.email}): ${answer}\nApply this decision now: record it in memory as a "verified" entry (source: "human decision ${req.user.email}"), and if it fixes workbook fields, apply them with apply_row_fix using escalation_id ${escalation.id}. Then complete. Your summary must state exactly what you changed — nothing more.`,
        triggerKind: 'escalation_resume', actor: req.user.email, initiatedBy: req.user.email,
      });
    }
  });
  audit('user', req.user.email, 'escalation.resolve', { escalationId: escalation.id, action });
  bus.emit('event', { type: 'escalation_resolved', canvasId: escalation.canvas_id, escalationId: escalation.id, status, by: req.user.email });
  res.json({ ok: true, run });
}));

// ---------- voice/text intent parsing (fast model; echo before dispatch) ----------
router.post('/canvases/:canvasId/intent', rateLimit('model'), auth.requireCanvas, asyncRoute(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  // Finding 13: this was the one model call outside both the budget gate and
  // the pause registry. Same contract as dispatch: no spend past the budget,
  // and a global pause aborts it in flight.
  if (control.isPaused()) return res.status(409).json({ error: 'workspace is paused — resume before sending commands' });
  if (control.budgetExceeded()) return res.status(429).json({ error: 'daily budget exhausted — raise it or wait for the reset' });
  const abort = new AbortController();
  const intentAbortId = `intent-${crypto.randomUUID()}`;
  control.registerAbort(intentAbortId, abort);
  const agents = db.prepare('SELECT id, name, role FROM agents WHERE canvas_id = ?').all(req.params.canvasId);
  const fastTier = tierConfig('fast');
  let response;
  try {
    response = await callModel({
    provider: fastTier.provider,
    model: fastTier.model,
    signal: abort.signal,
    system: `You parse spoken/typed commands for a multi-agent canvas. Available agents:\n${agents.map((a) => `- ${a.name} (${a.role}, id ${a.id})`).join('\n')}\nReturn ONLY a JSON object, no prose: {"action": "dispatch"|"pause"|"resume"|"unknown", "agent_id": "<id or null>", "agent_name": "<name or null>", "instruction": "<what the agent should do, cleaned up>", "echo": "<short confirmation of what will happen, e.g. 'Ask Scout (research) to re-check rows 3-5'>"}. If the command names no agent but implies a role, pick the matching agent. If genuinely unclear, action "unknown" with echo explaining why.`,
    messages: [{ role: 'user', content: text }],
    maxTokens: 300,
    });
  } finally {
    control.unregisterAbort(intentAbortId);
  }
  control.addUsage(response.model || fastTier.model, response.usage || {});
  const raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch {
    parsed = { action: 'unknown', echo: 'Could not parse that command — try rephrasing.' };
  }
  audit('user', req.user.email, 'intent.parse', { canvasId: req.params.canvasId, text: text.slice(0, 200), action: parsed.action });
  res.json({ intent: parsed });
}));

// ---------- global pause / budget ----------
router.get('/control/status', (req, res) => {
  res.json({ ...control.getDailyUsage(), queue: queueState() });
});

// Anyone signed in can hit the emergency stop; only the owner can resume.
router.post('/control/pause', (req, res) => {
  control.setPaused(true, req.user.email);
  res.json({ ok: true, paused: true });
});

router.post('/control/resume', auth.requireOwner, (req, res) => {
  control.setPaused(false, req.user.email);
  resumePump();
  res.json({ ok: true, paused: false });
});

router.post('/control/budget', auth.requireOwner, (req, res) => {
  const usd = Number(req.body.daily_budget_usd);
  if (!Number.isFinite(usd) || usd < 0) return res.status(400).json({ error: 'daily_budget_usd must be a non-negative number' });
  control.setDailyBudget(usd, req.user.email);
  res.json({ ok: true, daily_budget_usd: usd });
});

// Per-agent and per-canvas spend rollups for the UI.
router.get('/canvases/:canvasId/spend', auth.requireCanvas, (req, res) => {
  const perAgent = db.prepare(`
    SELECT a.id AS agent_id, a.name, a.role, COUNT(r.id) AS runs,
           COALESCE(SUM(r.input_tokens),0) AS input_tokens, COALESCE(SUM(r.output_tokens),0) AS output_tokens,
           COALESCE(SUM(r.cost_usd),0) AS cost_usd
    FROM agents a LEFT JOIN runs r ON r.agent_id = a.id
    WHERE a.canvas_id = ? GROUP BY a.id
  `).all(req.params.canvasId);
  const canvasTotal = db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS cost_usd, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens FROM runs WHERE canvas_id = ?').get(req.params.canvasId);
  res.json({ perAgent, canvasTotal, daily: control.getDailyUsage(), monthly: control.getMonthlyUsage() });
});

// ---------- audit (owner only) ----------
router.get('/audit', auth.requireOwner, (req, res) => {
  res.json({
    entries: queryAudit({
      action: qstr(req.query.action),
      actorId: qstr(req.query.actorId),
      since: qstr(req.query.since),
      until: qstr(req.query.until),
      limit: qstr(req.query.limit),
      offset: qstr(req.query.offset),
    }),
    chain: verifyChain(),
  });
});

// ---------- export (owner only) ----------
router.get('/export', auth.requireOwner, (req, res) => {
  audit('user', req.user.email, 'workspace.export', {});
  const dump = {
    exported_at: nowIso(),
    exported_by: req.user.email,
    canvases: db.prepare('SELECT * FROM canvases').all(),
    agents: db.prepare('SELECT * FROM agents').all(),
    notes: db.prepare('SELECT * FROM notes').all(),
    tasks: db.prepare('SELECT * FROM tasks').all(),
    files: db.prepare('SELECT id, canvas_id, name, mime, size, uploaded_by, created_at FROM files').all(),
    memory_entries: db.prepare('SELECT * FROM memory_entries').all(),
    citations: db.prepare('SELECT * FROM citations').all(),
    run_reads: db.prepare('SELECT * FROM run_reads').all(),
    runs: db.prepare('SELECT * FROM runs').all(),
    run_events: db.prepare('SELECT * FROM run_events').all().map((e) => ({ ...e, payload: JSON.parse(e.payload) })),
    handoffs: db.prepare('SELECT * FROM handoffs').all(),
    escalations: db.prepare('SELECT * FROM escalations').all(),
    sheet_rows: db.prepare('SELECT * FROM sheet_rows').all().map((r) => ({ ...r, data: JSON.parse(r.data) })),
    changesets: db.prepare('SELECT * FROM changesets').all(),
    changes: db.prepare('SELECT * FROM changes').all(),
    audit_log: db.prepare('SELECT * FROM audit_log ORDER BY seq').all(),
    usage_daily: db.prepare('SELECT * FROM usage_daily').all(),
    allowlist: db.prepare('SELECT * FROM allowlist').all(),
  };
  res.setHeader('Content-Disposition', `attachment; filename="agent-canvas-export-${nowIso().slice(0, 10)}.json"`);
  res.json(dump);
});

module.exports = router;
// Exposed for the regression test that pins "strip, never reject".
module.exports._internal = { splitMutating };

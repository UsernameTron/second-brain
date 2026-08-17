'use strict';
// HTTP API. Roles and per-canvas access are enforced here, server-side —
// the client is never trusted for authorization decisions.

const crypto = require('node:crypto');
const express = require('express');
const { db, tx, nowIso, getSetting } = require('./db');
const roster = require('./roster');
const { audit, queryAudit, verifyChain, verifyChainTail } = require('./audit');
const memory = require('./memory');
const evidence = require('./evidence');
const explain = require('./explain');
const attention = require('./attention');
const rooms = require('./rooms');
const builder = require('./builder');
const standingRules = require('./standing-rules');
const bus = require('./bus');
const auth = require('./auth');
const control = require('./orchestrator/control');
const { dispatchRun, resumePump, queueState, RUN_MODES } = require('./orchestrator/queue');
const { createEscalation, canvasFileFormat, readCanvasFile } = require('./orchestrator/tools');
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

// Node rejects non-Latin-1 response-header characters. Keep a conservative
// ASCII filename for older clients and add the real UTF-8 name through RFC
// 5987. Never interpolate the caller-controlled name directly into a header.
function attachmentDisposition(name) {
  const original = String(name || 'download');
  const extension = original.match(/\.[A-Za-z0-9]{1,10}$/)?.[0] || '';
  let fallback = original
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\/;=?]/g, '_')
    .trim();
  const stem = extension && fallback.endsWith(extension)
    ? fallback.slice(0, -extension.length)
    : fallback;
  if (!/[A-Za-z0-9]/.test(stem)) fallback = `download${extension}`;
  fallback = (fallback || 'download').slice(0, 120);
  const encoded = encodeURIComponent(original)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
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
    // P1 reversible exposure: Inquiry Home as the signed-in landing view.
    // setSetting('inquiry_home', '0') reverts sign-in to the canvas, no deploy.
    inquiryHome: getSetting('inquiry_home', '1') === '1',
    // P2 reversible exposure: unified NEEDS YOU view (Tray collapses to the
    // badge). setSetting('needs_you', '0') reverts to the inline tray list.
    needsYou: getSetting('needs_you', '1') === '1',
    // P3 reversible exposure: Evidence Rooms. setSetting('rooms', '0') hides
    // the Rooms view, no deploy. Data stays; the flag gates the UI only.
    rooms: getSetting('rooms', '1') === '1',
    // P4 reversible exposure: plain-language agent builder as the default
    // AddAgent tab. setSetting('agent_builder', '0') reverts, no deploy.
    agentBuilder: getSetting('agent_builder', '1') === '1',
    // P5 reversible exposure: standing rules & briefs. setSetting(
    // 'standing_rules', '0') hides the UI AND no-ops the scheduler tick
    // before any rule is read — scheduled execution stops, no deploy.
    standingRules: getSetting('standing_rules', '1') === '1',
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

// ---------- P5 standing rules: the scheduler tick ----------
// Registered ABOVE requireAuth (the /auth/google placement pattern). Two
// lanes into one handler: a signed-in OWNER session (manual/dev/recovery
// ticks), else a Google-signed OIDC ID token from Cloud Scheduler — verified
// with the same google-auth-library machinery sign-in uses, against
// TICK_AUDIENCE, and the caller must BE the configured invoker SA. Either
// env var unset → the OIDC lane is disabled (503), never open by default.
router.post('/standing-rules/tick', rateLimit('auth'), asyncRoute(async (req, res) => {
  const sessionToken = auth.tokenFromReq(req);
  if (sessionToken) {
    let user = null;
    try { user = auth.verifySessionToken(sessionToken); } catch { /* stale cookie — fall through to OIDC */ }
    if (user) {
      if (user.role !== 'owner') return res.status(403).json({ error: 'owner only' });
      return res.json(standingRules.tick({ source: 'owner', actor: user.email }));
    }
  }
  const audience = process.env.TICK_AUDIENCE;
  const invoker = process.env.TICK_INVOKER_SA;
  if (!audience || !invoker) {
    return res.status(503).json({ error: 'scheduled tick lane disabled (TICK_AUDIENCE / TICK_INVOKER_SA unset)' });
  }
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'missing bearer token' });
  let payload;
  try {
    payload = await standingRules.verifyTickOidc(header.slice(7), audience);
  } catch {
    return res.status(401).json({ error: 'OIDC token verification failed' });
  }
  if (!payload || payload.email !== invoker || !payload.email_verified) {
    return res.status(403).json({ error: 'caller is not the tick invoker service account' });
  }
  res.json(standingRules.tick({ source: 'scheduler', actor: invoker }));
}));

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
    {
      id: 'enrichment', label: 'ENRICHMENT · DISPATCH', probe: require('./enrichment/dispatch').configured(),
      status: require('./enrichment/dispatch').configured() ? provenStatus('enrichment').status : 'planned',
      detail: require('./enrichment/dispatch').configured()
        ? `Wired to enrichment-dispatch (IAM client, keyless). Reads free (get_enriched_contact); paid enrichment spends real credits, research/targeting/commercial agents only, never on system-triggered runs.${provenStatus('enrichment').note}`
        : 'Not wired — ED_DISPATCH_URL unset (held dark until the owner lights it; see HANDOFF).',
    },
    // P5: the scheduling lane. Without it a rule can be written, rehearsed,
    // activated and displayed as "active · next 08:00" while NOTHING will ever
    // run it — the loudest possible fake green, and the documented state of the
    // current production revision. Never green from env presence: two set
    // strings prove nothing about whether a Cloud Scheduler job exists. Green
    // is earned from an OIDC-verified tick that actually arrived, the same way
    // provenStatus earns it from a probe.
    (() => {
      const id = 'standing_rules';
      const label = 'STANDING RULES · TICK';
      if (!standingRules.flagOn()) {
        return { id, label, status: 'planned', detail: 'Switched off: setSetting(\'standing_rules\',\'0\'). The nav is hidden and the tick no-ops before a rule row is read — the no-deploy rollback.' };
      }
      if (!process.env.TICK_AUDIENCE || !process.env.TICK_INVOKER_SA) {
        return {
          id, label, status: 'planned',
          detail: 'Declared, NOT wired: TICK_AUDIENCE / TICK_INVOKER_SA unset on this revision, so POST /api/standing-rules/tick 503s every scheduled caller. Rules can still be written, rehearsed and activated — and none of them will ever run. Set both vars (deploy/deploy.sh passes them through) and create the Cloud Scheduler job.',
        };
      }
      const last = standingRules.lastSchedulerTick();
      // ponytail: 6h staleness bound — hourly is the fastest cadence, so a lane
      // silent for six hours is not delivering. Tighten if cadences get finer.
      const stale = !last || Date.now() - Date.parse(last) > 6 * 3_600_000;
      return {
        id, label, status: stale ? 'attention' : 'ready',
        detail: last
          ? `Last scheduler-signed tick ${last}.${stale ? ' NO TICK IN OVER 6 HOURS — check the Cloud Scheduler job; nothing has been dispatched since.' : ''}`
          : 'Configured, but no scheduler-signed tick has ever reached this deployment — the Cloud Scheduler job may not exist. Env presence is not evidence; a manual owner tick does not count.',
      };
    })(),
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

router.post('/health/probe', rateLimit('probe'), asyncRoute(async (req, res) => {
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
  if (surface === 'enrichment') {
    return res.json(await recorded(() => require('./enrichment/dispatch').probe(req.user.email)));
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

router.post('/mcp/servers', auth.requireOwner, asyncRoute(async (req, res) => {
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
  // Persistence is the save contract. Discovery is bounded, serialized cache
  // maintenance; an unreachable connector must not make a successful insert
  // look failed to the client. reload() already invalidated stale defs.
  void mcp.refreshDefs();
  res.json({ ok: true, id, refusedTools: tools.refused });
}));

router.patch('/mcp/servers/:id', auth.requireOwner, asyncRoute(async (req, res) => {
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
  void mcp.refreshDefs();
  res.json({ ok: true, refusedTools: tools ? tools.refused : [] });
}));

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
  const all = db.prepare('SELECT * FROM canvases WHERE removed_at IS NULL ORDER BY created_at').all();
  // Effective access rides along so the client can render view-only sessions.
  const visible = all
    .map((c) => ({ canvas: c, check: auth.canAccessCanvas(req.user, c.id) }))
    .filter((e) => e.check.ok)
    .map((e) => ({ ...e.canvas, access: e.check.access }));
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
    // Canvas + selected agents land atomically or not at all.
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
  const agents = db.prepare("SELECT * FROM agents WHERE canvas_id = ? AND lifecycle = 'active'").all(canvasId);
  const notes = db.prepare('SELECT * FROM notes WHERE canvas_id = ? AND deleted_at IS NULL').all(canvasId);
  const tasks = db.prepare('SELECT * FROM tasks WHERE canvas_id = ?').all(canvasId);
  const people = db.prepare('SELECT * FROM canvas_people WHERE canvas_id = ?').all(canvasId);
  const files = db.prepare('SELECT id, canvas_id, name, mime, size, x, y, uploaded_by, created_at FROM files WHERE canvas_id = ? AND deleted_at IS NULL').all(canvasId);
  const escalations = db.prepare(`SELECT * FROM escalations e WHERE e.canvas_id = ?
    AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.id = e.agent_id AND a.lifecycle = 'draft')
    ORDER BY e.created_at DESC LIMIT 50`).all(canvasId)
    .map((e) => ({ ...e, context: JSON.parse(e.context) }));
  const handoffs = db.prepare('SELECT * FROM handoffs WHERE canvas_id = ? ORDER BY ts DESC LIMIT 100').all(canvasId)
    .map((h) => ({ ...h, payload_entry_ids: JSON.parse(h.payload_entry_ids) }));
  const runs = db.prepare('SELECT id, agent_id, status, trigger_kind, instruction, steps_used, step_budget, model, input_tokens, output_tokens, cost_usd, summary, error, started_at, ended_at, created_at FROM runs WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 100').all(canvasId);
  res.json({
    canvas: req.canvas, access: req.canvasAccess, agents, notes, tasks, people, files, escalations, handoffs, runs,
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
  const access = req.body.access === undefined ? 'edit' : req.body.access;
  if (!['view', 'edit'].includes(access)) return res.status(400).json({ error: 'access must be view|edit' });
  db.prepare('INSERT INTO canvas_members (canvas_id, user_email, access) VALUES (?, ?, ?) ON CONFLICT(canvas_id, user_email) DO UPDATE SET access = excluded.access')
    .run(req.params.canvasId, email, access);
  audit('user', req.user.email, 'canvas.member_add', { canvasId: req.params.canvasId, email, access });
  res.json({ ok: true });
});

router.delete('/canvases/:canvasId/members/:email', auth.requireOwner, (req, res) => {
  db.prepare('DELETE FROM canvas_members WHERE canvas_id = ? AND user_email = ?')
    .run(req.params.canvasId, String(req.params.email).toLowerCase());
  audit('user', req.user.email, 'canvas.member_remove', { canvasId: req.params.canvasId, email: req.params.email });
  res.json({ ok: true });
});

// ---------- rooms (P3): metadata over a canvas, restricted by default ----------
// Access is ALWAYS decided through the room's canvas (canAccessCanvas /
// canEditCanvas) — a Room grants nothing its canvas doesn't.
function roomAccess(req, res, edit = false) {
  const room = rooms.getRoom(req.params.roomId);
  if (!room) { res.status(404).json({ error: 'room not found' }); return null; }
  const check = edit ? auth.canEditCanvas(req.user, room.canvasId) : auth.canAccessCanvas(req.user, room.canvasId);
  if (!check.ok) { res.status(check.status).json({ error: check.error }); return null; }
  return { room, access: check.access };
}

router.post('/rooms', auth.requireOwner, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const roomType = req.body.room_type;
  if (!rooms.ROOM_TYPES.includes(roomType)) return res.status(400).json({ error: `room_type must be one of ${rooms.ROOM_TYPES.join(', ')}` });
  const rosterIds = Array.isArray(req.body.roster_ids) ? req.body.roster_ids : [];
  const canvasId = crypto.randomUUID();
  const roomId = crypto.randomUUID();
  try {
    // Canvas (restricted by default), staffing, and the room record land
    // atomically — a Room never exists without its canvas or vice versa.
    tx(() => {
      db.prepare('INSERT INTO canvases (id, name, description, access_mode, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(canvasId, name, req.body.description || '', 'restricted', req.user.email, nowIso());
      for (const rosterId of rosterIds) {
        roster.instantiateOnCanvas({ canvasId, rosterId, actor: req.user.email });
      }
      db.prepare('INSERT INTO rooms (id, canvas_id, room_type, external_ref, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(roomId, canvasId, roomType, String(req.body.external_ref || '').slice(0, 300), req.user.email, nowIso());
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  audit('user', req.user.email, 'room.create', { roomId, canvasId, roomType, roster: rosterIds.length });
  bus.emit('event', { type: 'canvas_structure', canvasId });
  res.json({ room: rooms.getRoom(roomId) });
});

router.get('/rooms', (req, res) => {
  const visible = rooms.listRooms().filter((r) => auth.canAccessCanvas(req.user, r.canvasId).ok);
  res.json({ rooms: visible.filter((r) => r.lifecycle === 'active'), archived: visible.filter((r) => r.lifecycle === 'archived') });
});

router.get('/rooms/:roomId', (req, res) => {
  const ctx = roomAccess(req, res);
  if (!ctx) return;
  const built = rooms.buildRoom(ctx.room.id, { lens: qstr(req.query.lens) || 'now', viewer: req.user });
  res.json({ ...built, access: ctx.access });
});

// Explicit Refresh Room: one directing-user-scoped ask-mode run. The run's
// normal outputs (memory entries + evidence refs) ARE the stored result —
// refresh never replicates a source system. Time + actor are recorded.
router.post('/rooms/:roomId/refresh', rateLimit('model'), (req, res) => {
  const ctx = roomAccess(req, res, true);
  if (!ctx) return;
  if (control.isPaused()) return res.status(409).json({ error: 'workspace is paused — resume before refreshing' });
  if (control.budgetExceeded()) return res.status(429).json({ error: 'daily budget exhausted — raise it or wait for the reset' });
  const canvasId = ctx.room.canvasId;
  const body = req.body || {}; // a bare POST with no JSON body is valid — both fields are optional
  const agents = db.prepare("SELECT id, name, role FROM agents WHERE canvas_id = ? AND lifecycle = 'active'").all(canvasId);
  if (!agents.length) return res.status(409).json({ error: 'this room has no agents — staff it first' });
  let agentId = body.agent_id || null;
  if (agentId && !agents.some((a) => a.id === agentId)) return res.status(400).json({ error: 'agent_id is not on this room' });
  if (!agentId) {
    const ranked = [...agents].sort((a, b) => {
      const ia = INQUIRY_ROLE_ORDER.indexOf(a.role); const ib = INQUIRY_ROLE_ORDER.indexOf(b.role);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    agentId = ranked[0].id;
  }
  const instruction = `Refresh this ${ctx.room.roomType} room ("${ctx.room.name}"${ctx.room.externalRef ? `, external ref ${ctx.room.externalRef}` : ''}). Re-check the current state of what this room tracks, then record ONLY selected conclusions as memory entries with evidence references — never copies of whole source records. Flag anything that changed since the last refresh.`;
  const refreshId = crypto.randomUUID();
  let run = null;
  try {
    tx(() => {
      run = dispatchRun({
        agentId, canvasId, instruction,
        triggerKind: 'user', actor: req.user.email, initiatedBy: req.user.email, mode: 'ask',
      });
      db.prepare('INSERT INTO room_refreshes (id, room_id, run_id, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(refreshId, ctx.room.id, run.id, req.user.email, String(body.note || '').slice(0, 300), nowIso());
      db.prepare('UPDATE rooms SET refreshed_at = ?, refreshed_by = ? WHERE id = ?').run(nowIso(), req.user.email, ctx.room.id);
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  audit('user', req.user.email, 'room.refresh', { roomId: ctx.room.id, canvasId, agentId, runId: run.id });
  // dispatchRun returns only {id} — hand the caller the real row.
  res.json({ room: rooms.getRoom(ctx.room.id), run: db.prepare('SELECT id, agent_id, canvas_id, status, mode, instruction, created_at FROM runs WHERE id = ?').get(run.id) });
});

// Disclosure preview: the export's exact included/excluded split, reviewed
// BEFORE anything leaves. Reading it requires edit access; producing the
// export itself is owner-only and audited. No anonymous links, ever.
router.get('/rooms/:roomId/export/preview', (req, res) => {
  const ctx = roomAccess(req, res, true);
  if (!ctx) return;
  res.json(rooms.exportManifest(ctx.room.id));
});

router.post('/rooms/:roomId/export', auth.requireOwner, (req, res) => {
  const room = rooms.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room not found' });
  const manifest = rooms.exportManifest(room.id);
  // The export ships ONLY the manifest the owner reviewed: the preview's
  // content hash must match the current one, or the review is stale.
  const reviewedHash = (req.body || {}).manifest_hash;
  if (!reviewedHash) return res.status(400).json({ error: 'manifest_hash required — review the disclosure preview first' });
  if (reviewedHash !== manifest.manifestHash) {
    return res.status(409).json({ error: 'room content changed since the disclosure preview — re-review before exporting' });
  }
  const html = rooms.renderExportHtml(manifest, req.user.email);
  audit('user', req.user.email, 'room.export', {
    roomId: room.id, canvasId: room.canvasId,
    included: { decisions: manifest.included.decisions.length, facts: manifest.included.facts.length, evidence: manifest.included.evidence.length, tasks: manifest.included.tasks.length },
    excluded: { soft: manifest.excluded.assumptionsAndInferences.length, tainted: manifest.excluded.taintedEntries.length, privateEvidence: manifest.excluded.privateEvidence.length, openEscalations: manifest.excluded.openEscalations.length },
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="room-${room.id.slice(0, 8)}-recommendation.html"`);
  res.send(html);
});

router.patch('/rooms/:roomId', auth.requireOwner, (req, res) => {
  const room = rooms.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room not found' });
  const { lifecycle } = req.body;
  if (!['active', 'archived'].includes(lifecycle)) return res.status(400).json({ error: 'lifecycle must be active|archived' });
  // Archive is tidiness, not destruction, and there is ONE flag: the room's
  // lifecycle is derived from canvases.archived, so archiving via either the
  // room route or the canvas route can never desync the two.
  db.prepare('UPDATE canvases SET archived = ? WHERE id = ?').run(lifecycle === 'archived' ? 1 : 0, room.canvasId);
  audit('user', req.user.email, lifecycle === 'archived' ? 'room.archive' : 'room.unarchive', { roomId: room.id, canvasId: room.canvasId });
  res.json({ room: rooms.getRoom(room.id) });
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
  const { name, role = 'research', color = '#2080D0', model_tier = 'strong', system_prompt = '', x = 0, y = 0, tools_json } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  // The advanced path may pass an explicit authority list (validated against
  // the registry menu, like builder proposals). Omitting it keeps the legacy
  // full role surface — a deliberate expert escape hatch, and the pre-P4
  // behavior for scripts/tests that create agents directly.
  let authorityJson = null;
  if (tools_json !== undefined && tools_json !== null) {
    let requested;
    try { requested = Array.isArray(tools_json) ? tools_json : JSON.parse(tools_json); } catch { requested = null; }
    if (!Array.isArray(requested)) return res.status(400).json({ error: 'tools_json must be an array of tool names' });
    const menu = new Set(require('./orchestrator/tools').authorityMenu(role, { userRole: auth.workspaceRole(req.user.email), modelTier: model_tier }).map((m) => m.name));
    authorityJson = JSON.stringify([...new Set(requested.map(String))].filter((n) => menu.has(n)));
  }
  db.prepare('INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at, tools_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.canvasId, name, role, color, model_tier === 'fast' ? 'fast' : 'strong', system_prompt, x, y, nowIso(), authorityJson);
  audit('user', req.user.email, 'agent.create', { agentId: id, canvasId: req.params.canvasId, role, explicitAuthority: authorityJson !== null });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ agent: db.prepare('SELECT * FROM agents WHERE id = ?').get(id) });
});

router.patch('/canvases/:canvasId/agents/:agentId', auth.requireCanvas, (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND canvas_id = ?').get(req.params.agentId, req.params.canvasId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const { x, y, system_prompt, model_tier, name, color } = req.body;
  // Finding 11 (both halves): a system-prompt rewrite changes what an agent
  // IS — owner-only (Pete's decision, 2026-08-14) and audited. Position,
  // name, color, and tier stay member-editable.
  if (system_prompt != null && system_prompt !== agent.system_prompt) {
    if (auth.workspaceRole(req.user.email) !== 'owner') {
      return res.status(403).json({ error: 'only the owner can change an agent\'s system prompt' });
    }
    audit('user', req.user.email, 'agent.prompt_update', {
      agentId: agent.id, canvasId: agent.canvas_id,
      fromLen: (agent.system_prompt || '').length, toLen: String(system_prompt).length,
    });
  }
  const nextTier = ['fast', 'strong'].includes(model_tier) ? model_tier : agent.model_tier;
  const promptChanged = system_prompt != null && system_prompt !== agent.system_prompt;
  const tierChanged = nextTier !== agent.model_tier;
  // P4: config-shaping changes are versioned (append-only) so every agent
  // has a rollback source. Pre-P4 agents get a baseline snapshot first.
  if (promptChanged || tierChanged) builder.ensureBaseline(agent, req.user.email);
  db.prepare('UPDATE agents SET x = ?, y = ?, system_prompt = ?, model_tier = ?, name = ?, color = ? WHERE id = ?')
    .run(x ?? agent.x, y ?? agent.y, system_prompt ?? agent.system_prompt,
      nextTier, name ?? agent.name, color ?? agent.color, agent.id);
  if (promptChanged || tierChanged) {
    builder.recordVersion(db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id), { source: 'patch', actor: req.user.email });
  }
  res.json({ ok: true });
});

// P4: version history + owner-only rollback. Rollback restores CONFIG
// (prompt, tier, authority, budgets) — never name/color/position, which are
// per-canvas identity (same rule as resync). History never rewrites: the
// restore itself lands as a new version row.
//
// Authority restore is FAITHFUL, including tools_json = NULL. A pre-P4
// agent's baseline snapshot holds NULL, which tools.js reads as "no
// allowlist — full role surface", so rolling a P4-published agent back to
// that baseline does widen authority relative to the published grant. That is
// deliberate: rollback's contract is "restore the config that WAS active",
// and flooring NULL to an empty allowlist would make undoing a bad publish a
// one-way trapdoor — the legacy agent could never get its working surface
// back. The widening is owner-only, audited, named in the returned diff, and
// still bounded by the role/mode gates. Pinned by test/agent-authority.test.js.
router.get('/canvases/:canvasId/agents/:agentId/versions', auth.requireCanvas, (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND canvas_id = ?').get(req.params.agentId, req.params.canvasId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  res.json({ versions: builder.listVersions(agent.id) });
});

router.post('/canvases/:canvasId/agents/:agentId/rollback/:versionId', auth.requireOwner, (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND canvas_id = ?').get(req.params.agentId, req.params.canvasId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const version = builder.getVersion(req.params.versionId);
  if (!version || version.agent_id !== agent.id) return res.status(404).json({ error: 'version not found for this agent' });
  builder.ensureBaseline(agent, req.user.email);
  const diff = builder.diffConfigs(agent, version, ['model_tier', 'system_prompt', 'tools_json', 'step_budget', 'wall_ms_budget']);
  db.prepare('UPDATE agents SET system_prompt = ?, model_tier = ?, tools_json = ?, step_budget = ?, wall_ms_budget = ? WHERE id = ?')
    .run(version.system_prompt, version.model_tier, version.tools_json, version.step_budget, version.wall_ms_budget, agent.id);
  const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id);
  const newVersionId = builder.recordVersion(updated, { source: 'rollback', actor: req.user.email, restoredFrom: version.id });
  audit('user', req.user.email, 'agent.rollback', { agentId: agent.id, canvasId: agent.canvas_id, restoredFrom: version.id, versionId: newVersionId, changed: Object.keys(diff) });
  bus.emit('event', { type: 'canvas_structure', canvasId: agent.canvas_id });
  res.json({ agent: updated, diff, versionId: newVersionId });
});

// ---------- agent builder (P4): describe -> review -> rehearse -> publish ----------
// Access rides the draft's canvas. Members with edit access can propose and
// rehearse; PUBLISHING an agent (or changing one) is owner-only, matching the
// owner-only prompt rule above.
function draftAccess(req, res, { edit = true, mutate = false } = {}) {
  const draft = builder.draftRow(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'draft not found' }); return null; }
  const check = edit ? auth.canEditCanvas(req.user, draft.canvas_id) : auth.canAccessCanvas(req.user, draft.canvas_id);
  if (!check.ok) { res.status(check.status).json({ error: check.error }); return null; }
  // Mutating someone else's draft would silently change what THEY rehearse —
  // only its creator or the owner may edit/rehearse/abandon it.
  if (mutate && draft.created_by !== req.user.email && auth.workspaceRole(req.user.email) !== 'owner') {
    res.status(403).json({ error: 'only the draft creator or the owner can change this draft' });
    return null;
  }
  return draft;
}

router.get('/canvases/:canvasId/agent-drafts', auth.requireCanvas, (req, res) => {
  const drafts = db.prepare("SELECT * FROM agent_drafts WHERE canvas_id = ? AND state != 'abandoned' ORDER BY created_at DESC LIMIT 50")
    .all(req.params.canvasId).map((d) => ({ ...d, proposal: JSON.parse(d.proposal_json) }));
  res.json({ drafts, menu: builder.unionMenu(auth.workspaceRole(req.user.email)) });
});

router.get('/agent-drafts/:draftId', (req, res) => {
  const draft = draftAccess(req, res, { edit: false });
  if (!draft) return;
  const run = draft.rehearsal_run_id
    ? db.prepare('SELECT id, status, mode, summary, error, created_at, ended_at FROM runs WHERE id = ?').get(draft.rehearsal_run_id)
    : null;
  res.json({ draft: { ...draft, proposal: JSON.parse(draft.proposal_json) }, rehearsalRun: run });
});

// Generate (or regenerate) the 9-part proposal from a plain-language brief.
// The authority menu is server-supplied and re-validated after parsing, so a
// generated configuration can never hold authority the deployment cannot
// honor — hallucinated tool names are dropped, and the caller is told.
router.post('/agent-drafts/propose', rateLimit('model'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const draftId = body.draft_id || null;
  let canvasId = body.canvas_id;
  let existing = null;
  if (draftId) {
    existing = draftAccess({ ...req, params: { draftId } }, res, { mutate: true });
    if (!existing) return;
    canvasId = existing.canvas_id;
  } else {
    const check = auth.canEditCanvas(req.user, canvasId);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
  }
  const brief = String(body.brief || '').trim();
  if (!brief) return res.status(400).json({ error: 'brief required — describe the job in plain language' });
  if (control.isPaused()) return res.status(409).json({ error: 'workspace is paused' });
  if (control.budgetExceeded()) return res.status(429).json({ error: 'daily budget exhausted' });
  if (body.target_agent_id && !db.prepare("SELECT id FROM agents WHERE id = ? AND canvas_id = ? AND lifecycle = 'active'").get(body.target_agent_id, canvasId)) {
    return res.status(400).json({ error: 'target_agent_id is not an active agent on this canvas' });
  }

  const userRole = auth.workspaceRole(req.user.email);
  const menu = builder.unionMenu(userRole);
  let parsed;
  try {
    const abort = new AbortController();
    const abortId = `builder-${crypto.randomUUID()}`;
    control.registerAbort(abortId, abort);
    const fastTier = tierConfig('fast');
    let response;
    try {
      // Resolved at call time so tests can stub the module's callModel.
      response = await require('./orchestrator/anthropic').callModel({
        provider: fastTier.provider, model: fastTier.model, signal: abort.signal,
        system: builder.PROPOSAL_SYSTEM(menu),
        messages: [{ role: 'user', content: brief }],
        maxTokens: 1500,
      });
    } finally {
      control.unregisterAbort(abortId);
    }
    control.addUsage(response.model || fastTier.model, response.usage || {});
    const raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch {
    return res.status(502).json({ error: 'proposal generation failed to produce valid JSON — try again or rephrase the brief' });
  }
  let validated;
  try {
    validated = builder.validateProposal(parsed, { userRole });
  } catch (err) {
    return res.status(502).json({ error: `generated proposal was invalid (${err.message}) — try again or rephrase the brief` });
  }

  const ts = nowIso();
  let draft;
  if (existing) {
    db.prepare("UPDATE agent_drafts SET brief = ?, proposal_json = ?, state = 'draft', rehearsal_run_id = NULL, updated_at = ? WHERE id = ?")
      .run(brief, JSON.stringify(validated.proposal), ts, existing.id);
    draft = builder.draftRow(existing.id);
  } else {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO agent_drafts (id, canvas_id, brief, proposal_json, target_agent_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, canvasId, brief, JSON.stringify(validated.proposal), body.target_agent_id || null, req.user.email, ts, ts);
    draft = builder.draftRow(id);
  }
  const warnings = builder.lintProposal(validated.proposal);
  audit('user', req.user.email, 'agent_draft.propose', { draftId: draft.id, canvasId, dropped: validated.dropped, warnings: warnings.length });
  res.json({ draft: { ...draft, proposal: validated.proposal }, dropped: validated.dropped, warnings, menu });
}));

// Owner/creator edits of a reviewed proposal (trim authority, budgets, text).
// Any edit resets the rehearsal gate — what publishes must be what rehearsed.
router.patch('/agent-drafts/:draftId', (req, res) => {
  const draft = draftAccess(req, res, { mutate: true });
  if (!draft) return;
  if (['published', 'abandoned'].includes(draft.state)) return res.status(409).json({ error: `draft is ${draft.state}` });
  let validated;
  try {
    validated = builder.validateProposal((req.body || {}).proposal, { userRole: auth.workspaceRole(req.user.email) });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  db.prepare("UPDATE agent_drafts SET proposal_json = ?, state = 'draft', rehearsal_run_id = NULL, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(validated.proposal), nowIso(), draft.id);
  res.json({ draft: { ...builder.draftRow(draft.id), proposal: validated.proposal }, dropped: validated.dropped, warnings: builder.lintProposal(validated.proposal) });
});

// Rehearse: one narrate-only run on the shadow agent carrying EXACTLY the
// proposed config. The entire proven rehearse machinery applies — mutating
// tools absent and refused, mode inherited by any child.
router.post('/agent-drafts/:draftId/rehearse', rateLimit('model'), (req, res) => {
  const draft = draftAccess(req, res, { mutate: true });
  if (!draft) return;
  if (['published', 'abandoned'].includes(draft.state)) return res.status(409).json({ error: `draft is ${draft.state}` });
  if (control.isPaused()) return res.status(409).json({ error: 'workspace is paused' });
  if (control.budgetExceeded()) return res.status(429).json({ error: 'daily budget exhausted' });
  const proposal = JSON.parse(draft.proposal_json);
  const scenario = String((req.body || {}).scenario || '').trim()
    || `Rehearse your job. A representative task has arrived: ${draft.brief}. Walk through exactly how you would handle it.`;
  let run = null;
  let shadowId = null;
  try {
    tx(() => {
      shadowId = builder.syncShadowAgent(draft, proposal);
      run = dispatchRun({
        agentId: shadowId, canvasId: draft.canvas_id, instruction: scenario,
        triggerKind: 'user', actor: req.user.email, initiatedBy: req.user.email, mode: 'rehearse',
      });
      db.prepare("UPDATE agent_drafts SET state = 'rehearsed', rehearsal_run_id = ?, updated_at = ? WHERE id = ?")
        .run(run.id, nowIso(), draft.id);
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  audit('user', req.user.email, 'agent_draft.rehearse', { draftId: draft.id, canvasId: draft.canvas_id, runId: run.id, shadowAgentId: shadowId });
  const updatedDraft = builder.draftRow(draft.id);
  res.json({ draft: { ...updatedDraft, proposal: JSON.parse(updatedDraft.proposal_json) }, run: db.prepare('SELECT id, status, mode FROM runs WHERE id = ?').get(run.id) });
});

// Publish: owner-only ceremony. Requires a COMPLETED rehearsal of the exact
// current proposal (any edit resets the gate). Returns and audits the exact
// diff of what becomes active; writes the version row; optionally saves the
// config as a reusable roster template.
router.post('/agent-drafts/:draftId/publish', auth.requireOwner, (req, res) => {
  const draft = builder.draftRow(req.params.draftId);
  if (!draft) return res.status(404).json({ error: 'draft not found' });
  if (draft.state !== 'rehearsed') return res.status(409).json({ error: 'rehearse before publishing — the rehearsal is the review' });
  const run = db.prepare('SELECT id, status FROM runs WHERE id = ?').get(draft.rehearsal_run_id);
  if (!run || run.status !== 'completed') {
    return res.status(409).json({ error: `rehearsal run is ${run ? run.status : 'missing'} — publish requires a completed rehearsal` });
  }
  const proposal = JSON.parse(draft.proposal_json);
  const fields = builder.agentFields(proposal);
  const target = draft.target_agent_id
    ? db.prepare("SELECT * FROM agents WHERE id = ? AND canvas_id = ? AND lifecycle = 'active'").get(draft.target_agent_id, draft.canvas_id)
    : null;
  if (draft.target_agent_id && !target) return res.status(409).json({ error: 'target agent no longer exists on this canvas' });

  let agentId = null;
  let diff = null;
  let versionId = null;
  tx(() => {
    if (target) {
      builder.ensureBaseline(target, req.user.email);
      diff = builder.diffConfigs(target, fields);
      db.prepare('UPDATE agents SET name = ?, role = ?, model_tier = ?, system_prompt = ?, tools_json = ?, step_budget = ?, wall_ms_budget = ? WHERE id = ?')
        .run(fields.name, fields.role, fields.model_tier, fields.system_prompt, fields.tools_json, fields.step_budget, fields.wall_ms_budget, target.id);
      agentId = target.id;
    } else {
      const shadowId = builder.syncShadowAgent(draft, proposal);
      db.prepare("UPDATE agents SET lifecycle = 'active' WHERE id = ?").run(shadowId);
      diff = builder.diffConfigs(null, fields);
      agentId = shadowId;
    }
    versionId = builder.recordVersion(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId), {
      source: 'publish', actor: req.user.email, draftId: draft.id,
    });
    db.prepare("UPDATE agent_drafts SET state = 'published', published_agent_id = ?, updated_at = ? WHERE id = ?")
      .run(agentId, nowIso(), draft.id);
    if (req.body && req.body.save_as_template) {
      db.prepare(`INSERT INTO roster_agents (id, name, role, color, model_tier, system_prompt, tools_json, step_budget, wall_ms_budget, enabled, default_on, sort, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 999, ?, ?)`)
        .run(crypto.randomUUID(), fields.name, proposal.role, fields.color || proposal.color, fields.model_tier, fields.system_prompt,
          fields.tools_json, fields.step_budget, fields.wall_ms_budget, nowIso(), nowIso());
    }
  });
  const warnings = builder.lintProposal(proposal);
  audit('user', req.user.email, 'agent.publish', {
    draftId: draft.id, canvasId: draft.canvas_id, agentId, versionId,
    changed: Object.keys(diff), authority: proposal.authority, template: !!(req.body && req.body.save_as_template),
    promptWarnings: warnings.length,
  });
  bus.emit('event', { type: 'canvas_structure', canvasId: draft.canvas_id });
  const publishedDraft = builder.draftRow(draft.id);
  res.json({ agent: db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId), diff, versionId, warnings, draft: { ...publishedDraft, proposal: JSON.parse(publishedDraft.proposal_json) } });
});

router.post('/agent-drafts/:draftId/abandon', (req, res) => {
  const draft = draftAccess(req, res, { mutate: true });
  if (!draft) return;
  if (draft.state === 'published') return res.status(409).json({ error: 'draft is already published' });
  db.prepare("UPDATE agent_drafts SET state = 'abandoned', updated_at = ? WHERE id = ?").run(nowIso(), draft.id);
  audit('user', req.user.email, 'agent_draft.abandon', { draftId: draft.id, canvasId: draft.canvas_id });
  res.json({ draft: builder.draftRow(draft.id) });
});

// ---------- standing rules (P5): parse -> review -> rehearse -> activate ----------
// Access rides the rule's canvas (the draftAccess pattern). Members with edit
// access parse and rehearse; ACTIVATING a rule (granting a standing
// authorization), pausing, resuming, and revoking are owner-only ceremonies.
function ruleAccess(req, res, { edit = true, mutate = false } = {}) {
  const rule = standingRules.getRule(req.params.ruleId);
  if (!rule) { res.status(404).json({ error: 'standing rule not found' }); return null; }
  const check = edit ? auth.canEditCanvas(req.user, rule.canvas_id) : auth.canAccessCanvas(req.user, rule.canvas_id);
  if (!check.ok) { res.status(check.status).json({ error: check.error }); return null; }
  if (mutate && rule.created_by !== req.user.email && auth.workspaceRole(req.user.email) !== 'owner') {
    res.status(403).json({ error: 'only the rule creator or the owner can change this rule' });
    return null;
  }
  return rule;
}

// Rule history is canvas-readable by every member, and a scheduled run's
// output refs can name a private Drive file or a mailbox message. Same
// read-time redaction the run receipt applies: only the directing user (the
// grantor whose Google identity the reads acted as) sees the raw id + URI.
// The raw output_refs_json column is dropped from the payload — spreading it
// would hand back exactly what the redaction just removed.
function ruleRunView(r, viewerEmail) {
  const parse = (j) => { try { const a = JSON.parse(j || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const { output_refs_json: refsJson, retry_run_ids_json: retryJson, ...rest } = r;
  return {
    ...rest,
    output_refs: parse(refsJson).map((ref) => evidence.redactRef(ref, viewerEmail)),
    retry_run_ids: parse(retryJson),
  };
}

// Parse: plain language → validated interpretation (D9, the P4 propose
// pattern). Creates a draft rule, or re-interprets an existing one — either
// way the rehearsal gate resets. The model proposes; the server re-validates
// everything (agent on canvas, cadence enum, budget clamps) — it grants nothing.
router.post('/canvases/:canvasId/standing-rules/parse', rateLimit('model'), auth.requireCanvas, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const instruction = String(body.instruction || '').trim();
  if (!instruction) return res.status(400).json({ error: 'instruction required — describe the standing rule in plain language' });
  if (control.isPaused()) return res.status(409).json({ error: 'workspace is paused' });
  if (control.budgetExceeded()) return res.status(429).json({ error: 'daily budget exhausted' });
  let existing = null;
  if (body.rule_id) {
    existing = db.prepare('SELECT * FROM standing_rules WHERE id = ? AND canvas_id = ?').get(body.rule_id, req.params.canvasId);
    if (!existing) return res.status(404).json({ error: 'standing rule not found on this canvas' });
    if (existing.created_by !== req.user.email && auth.workspaceRole(req.user.email) !== 'owner') {
      return res.status(403).json({ error: 'only the rule creator or the owner can change this rule' });
    }
    if (existing.state === 'revoked') return res.status(409).json({ error: 'rule is revoked' });
  }
  const agents = db.prepare("SELECT id, name, role FROM agents WHERE canvas_id = ? AND lifecycle = 'active'").all(req.params.canvasId);
  if (!agents.length) return res.status(409).json({ error: 'this canvas has no agents — staff it first' });
  let parsed;
  try {
    const abort = new AbortController();
    const abortId = `standing-rule-${crypto.randomUUID()}`;
    control.registerAbort(abortId, abort);
    const fastTier = tierConfig('fast');
    let response;
    try {
      // Resolved at call time so tests can stub the module's callModel.
      response = await require('./orchestrator/anthropic').callModel({
        provider: fastTier.provider, model: fastTier.model, signal: abort.signal,
        system: standingRules.PARSE_SYSTEM(agents),
        messages: [{ role: 'user', content: instruction }],
        maxTokens: 1000,
      });
    } finally {
      control.unregisterAbort(abortId);
    }
    control.addUsage(response.model || fastTier.model, response.usage || {});
    const raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch {
    return res.status(502).json({ error: 'rule interpretation failed to produce valid JSON — try again or rephrase' });
  }
  let interp;
  try {
    interp = standingRules.validateInterpretation(parsed, { agents });
  } catch (err) {
    return res.status(502).json({ error: `generated interpretation was invalid (${err.message}) — try again or rephrase` });
  }
  const rule = standingRules.upsertDraft({
    canvasId: req.params.canvasId, ruleId: existing ? existing.id : null, instruction, interp, actor: req.user.email,
  });
  audit('user', req.user.email, existing ? 'standing_rule.parse' : 'standing_rule.create',
    { ruleId: rule.id, canvasId: req.params.canvasId, version: rule.version, agentId: rule.agent_id });
  // The retired grant rides back, same shape revoke uses: an edit retires the
  // authorization (upsertDraft), and there is no refetch path behind this
  // response — a client that merged only { rule } would keep rendering the
  // pre-edit "Authorized by … · expires …" over a rule that can no longer run.
  res.json({ rule: standingRules.ruleView(rule), authorization: standingRules.latestAuthorization(rule.id) || null });
}));

router.get('/canvases/:canvasId/standing-rules', auth.requireCanvas, (req, res) => {
  const rules = db.prepare('SELECT * FROM standing_rules WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(req.params.canvasId).map(standingRules.ruleView);
  res.json({ rules });
});

router.get('/standing-rules/:ruleId', (req, res) => {
  const rule = ruleAccess(req, res, { edit: false });
  if (!rule) return;
  // The LATEST authorization, revoked or not: filtering revoked rows out meant
  // a revoked rule's page had no authorization block at all after a reload,
  // and the pre-revoke one stayed on screen before it. The row carries
  // revoked_at/revoked_by — the client renders the true state from it.
  const authz = standingRules.latestAuthorization(rule.id) || null;
  const runs = db.prepare('SELECT * FROM standing_rule_runs WHERE rule_id = ? ORDER BY created_at DESC LIMIT 10').all(rule.id)
    .map((r) => ruleRunView(r, req.user.email));
  // initiated_by is the identity the rehearsal's reads ACTED AS — the consent
  // card's "Reads as" field, and what activation must match.
  const rehearsalRun = rule.rehearsal_run_id
    ? db.prepare('SELECT id, status, mode, initiated_by, summary, error, created_at, ended_at FROM runs WHERE id = ?').get(rule.rehearsal_run_id)
    : null;
  res.json({ rule: standingRules.ruleView(rule), authorization: authz, runs, rehearsalRun });
});

// Edits reset the rehearsal gate: state→draft, version++, rehearsal cleared —
// what activates must be what rehearsed (D8).
router.patch('/standing-rules/:ruleId', (req, res) => {
  const rule = ruleAccess(req, res, { mutate: true });
  if (!rule) return;
  if (rule.state === 'revoked') return res.status(409).json({ error: 'rule is revoked' });
  const body = req.body || {};
  const instruction = body.instruction === undefined ? rule.instruction : String(body.instruction || '').trim();
  if (!instruction) return res.status(400).json({ error: 'instruction cannot be empty' });
  let interp;
  if (body.interpretation !== undefined) {
    const agents = db.prepare("SELECT id, name, role FROM agents WHERE canvas_id = ? AND lifecycle = 'active'").all(rule.canvas_id);
    try {
      interp = standingRules.validateInterpretation(body.interpretation, { agents });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  } else if (body.instruction !== undefined) {
    interp = JSON.parse(rule.interpretation_json || '{}');
  } else {
    return res.status(400).json({ error: 'nothing to update — provide instruction and/or interpretation' });
  }
  const updated = standingRules.upsertDraft({ canvasId: rule.canvas_id, ruleId: rule.id, instruction, interp, actor: req.user.email });
  audit('user', req.user.email, 'standing_rule.edit', { ruleId: rule.id, canvasId: rule.canvas_id, version: updated.version });
  // Same as the parse route above: the edit retired the grant, so the response
  // carries the retired row rather than leaving the client's live-grant claim
  // standing with nothing to correct it.
  res.json({ rule: standingRules.ruleView(updated), authorization: standingRules.latestAuthorization(rule.id) || null });
});

// Rehearse: one rehearse-mode run on the rule's agent — "report what WOULD
// have matched; change nothing". The proven rehearse machinery applies:
// mutating tools absent and refused.
router.post('/standing-rules/:ruleId/rehearse', rateLimit('model'), (req, res) => {
  const rule = ruleAccess(req, res, { mutate: true });
  if (!rule) return;
  if (!['draft', 'rehearsed'].includes(rule.state)) return res.status(409).json({ error: `rule is ${rule.state} — edit it back to draft first` });
  // State flips to 'rehearsed' the moment the run is DISPATCHED, so the state
  // check above still admits a second rehearsal while the first is queued or
  // running: two runs burning budget, and rehearsal_run_id pointing at whichever
  // landed last. Terminal-or-nothing, like the run-retry gate.
  const inFlight = rule.rehearsal_run_id
    ? db.prepare('SELECT status FROM runs WHERE id = ?').get(rule.rehearsal_run_id)
    : null;
  if (inFlight && ['queued', 'running'].includes(inFlight.status)) {
    return res.status(409).json({ error: `a rehearsal is already ${inFlight.status} — wait for it to finish before rehearsing again` });
  }
  if (control.isPaused()) return res.status(409).json({ error: 'workspace is paused' });
  if (control.budgetExceeded()) return res.status(429).json({ error: 'daily budget exhausted' });
  const rehearsalAgent = db.prepare("SELECT id, role, tools_json, model_tier FROM agents WHERE id = ? AND canvas_id = ? AND lifecycle = 'active'").get(rule.agent_id, rule.canvas_id);
  if (!rehearsalAgent) {
    return res.status(409).json({ error: 'the rule’s agent is no longer active on this canvas — re-parse or edit the rule' });
  }
  // The SAME reachability checks verifyAuthorization applies per dispatch, now
  // against the REHEARSER — because "the rehearsal is the review", and a
  // rehearsal that read nothing reviews nothing. Without them a rehearser with
  // no Google connection gets isError on every call, the model writes prose
  // over an empty result, the run finishes `completed`, and Activate lights up
  // on a review that never reached a single source.
  const rehearsalGrant = standingRules.grantedTools(rule, rehearsalAgent, req.user.email);
  if (standingRules.touchesWorkspace(rule) && !workspace.isConnected(req.user.email)) {
    return res.status(409).json({
      error: 'this rule reads Google Workspace as whoever runs it, and your Google account is not connected — the rehearsal would read nothing and prove nothing. Connect it under Capabilities, then rehearse.',
    });
  }
  const rehearsalDark = standingRules.unreadableSources(rule, rehearsalGrant);
  if (rehearsalDark.length) {
    return res.status(409).json({
      error: `this rule reviewed ${rehearsalDark.join(', ')}, but ${rehearsalDark.length > 1 ? 'those sources grant' : 'that source grants'} no readable tool to ${rehearsalAgent.role} agents on this deployment — the rehearsal could never look. Remove the source, widen the agent’s authority, or enable the connector.`,
    });
  }
  let run = null;
  try {
    tx(() => {
      run = dispatchRun({
        agentId: rule.agent_id, canvasId: rule.canvas_id, instruction: standingRules.rehearsalInstruction(rule),
        triggerKind: 'user', actor: req.user.email, initiatedBy: req.user.email, mode: 'rehearse',
        stepBudget: rule.step_budget || undefined, wallMs: rule.wall_ms_budget || undefined,
        // The rehearsal runs against the SAME source-limited surface the
        // eventual scheduled run gets — the identical grantedTools resolution
        // activation uses. Without it the rehearsal offers the agent's full
        // live authority: it reads sources the owner never reviewed, and it
        // stops demonstrating what the restricted run will actually do, which
        // is the entire point of a rehearse gate. The prompt's "and nothing
        // else" is a request, not a boundary.
        authorityJson: JSON.stringify(rehearsalGrant),
      });
      db.prepare("UPDATE standing_rules SET state = 'rehearsed', rehearsal_run_id = ?, updated_at = ? WHERE id = ?")
        .run(run.id, nowIso(), rule.id);
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  audit('user', req.user.email, 'standing_rule.rehearse', { ruleId: rule.id, canvasId: rule.canvas_id, runId: run.id });
  res.json({ rule: standingRules.ruleView(standingRules.getRule(rule.id)), run: db.prepare('SELECT id, status, mode FROM runs WHERE id = ?').get(run.id) });
});

// Activate: owner-only ceremony. Requires a COMPLETED rehearsal of the exact
// current version (any edit resets the gate — the P4 publish 409 pattern).
// Creates the standing authorization snapshot and computes next_run_at.
router.post('/standing-rules/:ruleId/activate', auth.requireOwner, (req, res) => {
  const rule = standingRules.getRule(req.params.ruleId);
  if (!rule) return res.status(404).json({ error: 'standing rule not found' });
  if (rule.state !== 'rehearsed') return res.status(409).json({ error: 'rehearse before activating — the rehearsal is the review' });
  const run = db.prepare('SELECT id, status, initiated_by FROM runs WHERE id = ?').get(rule.rehearsal_run_id);
  if (!run || run.status !== 'completed') {
    return res.status(409).json({ error: `rehearsal run is ${run ? run.status : 'missing'} — activation requires a completed rehearsal` });
  }
  // The grant is spent as the ACTIVATOR: every scheduled run is dispatched with
  // initiatedBy = authorized_by, and tools.js resolves Google/HubSpot/enrichment
  // calls from run.initiated_by while grantedTools resolves the menu from the
  // grantor's workspace role. A rehearsal run by someone else therefore read a
  // DIFFERENT mailbox under a DIFFERENT authority — a member rehearses "flag
  // mail about the comp plan" against his own inbox, it comes back clean, and
  // every scheduled run then reads the owner's. Identity is the half of "what
  // activates must be what rehearsed" that version alone never covered.
  // Deliberately NOT fixed by dispatching the rehearsal as the grantor: that
  // would let any member read the owner's mailbox with one click.
  if (String(run.initiated_by || '').toLowerCase() !== String(req.user.email).toLowerCase()) {
    return res.status(409).json({
      error: `this rehearsal ran as ${run.initiated_by || 'nobody'}, but the rule would run as you — it read ${run.initiated_by ? 'their' : 'no one’s'} mail, files and CRM access, not yours. Rehearse it yourself, then activate.`,
    });
  }
  const ruleAgent = db.prepare("SELECT id, role, tools_json, model_tier FROM agents WHERE id = ? AND canvas_id = ? AND lifecycle = 'active'").get(rule.agent_id, rule.canvas_id);
  if (!ruleAgent) {
    return res.status(409).json({ error: 'the rule’s agent is no longer active on this canvas' });
  }
  // A reviewed source that resolves to no readable tool is a lamp faking
  // green: the card says the rule watches Gmail, the grant is empty, the run
  // cannot look, and it finalizes NOTHING MATCHED with no alert forever.
  // Refuse the grant instead — naming the source, because the fix (turn on
  // full Google scopes / widen the agent's authority / drop the source) is
  // different per source and the owner is the only one who can pick.
  const unreadable = standingRules.unreadableSources(rule, standingRules.grantedTools(rule, ruleAgent, req.user.email));
  if (unreadable.length) {
    return res.status(409).json({
      error: `this rule reviewed ${unreadable.join(', ')}, but ${unreadable.length > 1 ? 'those sources grant' : 'that source grants'} no readable tool to ${ruleAgent.role} agents on this deployment — the scheduled run could never look. Remove the source, widen the agent’s authority, or enable the connector, then rehearse again.`,
    });
  }
  const interp = JSON.parse(rule.interpretation_json || '{}');
  const expiresAt = new Date(Date.now() + (interp.expires_days || 90) * 86_400_000).toISOString();
  const firstRunAt = standingRules.nextRunAt(rule);
  // "Brief me weekly on the migration until Friday", said on a Monday: the
  // rule sits active for six days, is never selected by the due query, and the
  // first tick that reaches it flips it straight to expired having dispatched
  // nothing — silently, no card, no bus event. Refuse the grant instead, and
  // name both dates so the owner can see which one to change.
  if (expiresAt <= firstRunAt) {
    return res.status(409).json({
      error: `this rule would expire on ${expiresAt.slice(0, 10)}, before its first ${rule.cadence} run on ${firstRunAt.slice(0, 10)} — it would never run once. Give it a longer horizon or a sooner cadence, then rehearse again.`,
    });
  }
  let authz = null;
  tx(() => {
    authz = standingRules.createAuthorization({ rule, authorizedBy: req.user.email, expiresAt });
    db.prepare("UPDATE standing_rules SET state = 'active', expires_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?")
      .run(expiresAt, firstRunAt, nowIso(), rule.id);
  });
  const updated = standingRules.getRule(rule.id);
  audit('user', req.user.email, 'standing_rule.activate', {
    ruleId: rule.id, canvasId: rule.canvas_id, authorizationId: authz.id, expiresAt, nextRunAt: updated.next_run_at,
  });
  res.json({ rule: standingRules.ruleView(updated), authorization: authz });
});

router.post('/standing-rules/:ruleId/pause', auth.requireOwner, (req, res) => {
  const rule = standingRules.getRule(req.params.ruleId);
  if (!rule) return res.status(404).json({ error: 'standing rule not found' });
  if (rule.state !== 'active') return res.status(409).json({ error: `only active rules can be paused (rule is ${rule.state})` });
  // Pausing stops the rule, including the occurrence already in flight — an
  // unhalted run would keep reading and writing memory after the owner paused.
  // next_run_at cleared with the state: the UI renders the column on
  // truthiness alone, so a paused rule kept advertising a next run that will
  // never arrive — and the fatal-invalidation path already clears it, making
  // two paused rules render differently purely by how they got there. Resume
  // recomputes it from nextRunAt.
  let halted = 0;
  tx(() => {
    db.prepare("UPDATE standing_rules SET state = 'paused', next_run_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), rule.id);
    halted = standingRules.haltRuleRuns(rule.id, 'rule paused');
  });
  audit('user', req.user.email, 'standing_rule.pause', { ruleId: rule.id, canvasId: rule.canvas_id, haltedRuns: halted });
  res.json({ rule: standingRules.ruleView(standingRules.getRule(rule.id)) });
});

// Resume re-checks authorization validity — a rule whose grantor lost access
// (or whose authorization expired) does not come back to life.
router.post('/standing-rules/:ruleId/resume', auth.requireOwner, (req, res) => {
  const rule = standingRules.getRule(req.params.ruleId);
  if (!rule) return res.status(404).json({ error: 'standing rule not found' });
  if (rule.state !== 'paused') return res.status(409).json({ error: `only paused rules can resume (rule is ${rule.state})` });
  const authz = standingRules.currentAuthorization(rule.id);
  const check = standingRules.verifyAuthorization({ ...rule, state: 'active' }, authz, new Date(), { checkWorkspace: false });
  if (!check.ok) return res.status(409).json({ error: `cannot resume: ${check.reason} — revoke and re-activate instead` });
  db.prepare("UPDATE standing_rules SET state = 'active', next_run_at = ?, updated_at = ? WHERE id = ?")
    .run(standingRules.nextRunAt(rule), nowIso(), rule.id);
  audit('user', req.user.email, 'standing_rule.resume', { ruleId: rule.id, canvasId: rule.canvas_id });
  res.json({ rule: standingRules.ruleView(standingRules.getRule(rule.id)) });
});

router.post('/standing-rules/:ruleId/revoke', auth.requireOwner, (req, res) => {
  const rule = standingRules.getRule(req.params.ruleId);
  if (!rule) return res.status(404).json({ error: 'standing rule not found' });
  if (rule.state === 'revoked') return res.status(409).json({ error: 'rule is already revoked' });
  // Revoking the authorization rows is not enough: an occurrence already
  // queued or running would finish its reads and memory writes under an
  // authorization that no longer exists. Halt it in the same transaction.
  let halted = 0;
  tx(() => {
    standingRules.revokeAuthorization(rule.id, req.user.email);
    // next_run_at cleared with the state, same reason as pause.
    db.prepare("UPDATE standing_rules SET state = 'revoked', next_run_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), rule.id);
    halted = standingRules.haltRuleRuns(rule.id, 'rule revoked');
  });
  audit('user', req.user.email, 'standing_rule.revoke', { ruleId: rule.id, canvasId: rule.canvas_id, haltedRuns: halted });
  // The revoked authorization rides back with the rule (the activate response's
  // shape), so the client can render "revoked by … " instead of keeping the
  // pre-revoke grant on screen — there is no refetch path behind this button.
  res.json({ rule: standingRules.ruleView(standingRules.getRule(rule.id)), authorization: standingRules.latestAuthorization(rule.id) || null });
});

router.get('/standing-rules/:ruleId/runs', (req, res) => {
  const rule = ruleAccess(req, res, { edit: false });
  if (!rule) return;
  const runs = db.prepare('SELECT * FROM standing_rule_runs WHERE rule_id = ? ORDER BY created_at DESC LIMIT 50').all(rule.id)
    .map((r) => ruleRunView(r, req.user.email));
  res.json({ runs });
});

// Acknowledge resolves the NEEDS YOU card (source-record style, like every
// other attention producer). Idempotent: acknowledging twice is a no-op.
router.post('/standing-rule-runs/:ruleRunId/acknowledge', (req, res) => {
  const rr = db.prepare(`SELECT rr.*, r.canvas_id FROM standing_rule_runs rr
    JOIN standing_rules r ON r.id = rr.rule_id WHERE rr.id = ?`).get(req.params.ruleRunId);
  if (!rr) return res.status(404).json({ error: 'standing rule run not found' });
  const check = auth.canEditCanvas(req.user, rr.canvas_id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  if (!rr.acknowledged_at) {
    db.prepare('UPDATE standing_rule_runs SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?')
      .run(nowIso(), req.user.email, rr.id);
    audit('user', req.user.email, 'standing_rule_run.acknowledge', { ruleRunId: rr.id, ruleId: rr.rule_id, canvasId: rr.canvas_id });
  }
  res.json({ run: ruleRunView(db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id), req.user.email) });
});

// Owner-only: re-copy prompt + tier from the source roster entry. Name and
// color stay — they are per-canvas identity the owner may have customized.
router.post('/canvases/:canvasId/agents/:agentId/resync', auth.requireOwner, (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND canvas_id = ?').get(req.params.agentId, req.params.canvasId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  if (!agent.roster_id) return res.status(404).json({ error: 'agent has no roster provenance' });
  const entry = db.prepare('SELECT * FROM roster_agents WHERE id = ?').get(agent.roster_id);
  if (!entry) return res.status(404).json({ error: 'source roster entry no longer exists' });
  builder.ensureBaseline(agent, req.user.email);
  db.prepare('UPDATE agents SET system_prompt = ?, model_tier = ? WHERE id = ?').run(entry.system_prompt, entry.model_tier, agent.id);
  builder.recordVersion(db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id), { source: 'resync', actor: req.user.email });
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
      mode: req.body.mode || null, // act|ask|rehearse; validated in dispatchRun
    });
    res.json({ run });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// P2: retry a terminal run as a NEW run (append-only, like everything else).
// parentRunId carries the failed run so mode and initiated_by inherit —
// retrying an ask/rehearse run must not silently produce an act run.
router.post('/canvases/:canvasId/runs/:runId/retry', rateLimit('model'), auth.requireCanvas, (req, res) => {
  if (control.isPaused()) return res.status(409).json({ error: 'workspace is paused — resume before dispatching' });
  const run = db.prepare('SELECT * FROM runs WHERE id = ? AND canvas_id = ?').get(req.params.runId, req.params.canvasId);
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (['queued', 'running'].includes(run.status)) return res.status(409).json({ error: 'run is still active — only terminal runs can be retried' });
  // Standing-rule attempts belong to the occurrence lifecycle, not here. The
  // attention projection already hides their cards, but every attempt's run id
  // is readable from GET /standing-rules/:id/runs, so the endpoint itself has
  // to refuse. Rejecting beats re-validating the grant: a generic retry
  // produces a run with no occurrence row, so it is outside the lease, the
  // attempt budget, the needs_attention card AND — the decisive one —
  // haltRuleRuns, which finds attempts only through run_id/retry_run_ids_json.
  // Revoke and pause could not stop it. There is no version of "re-validate
  // and let it through" that the standing-rule stop path can see.
  if (standingRules.isStandingRuleRun(run.id)) {
    return res.status(409).json({ error: 'this run belongs to a standing rule — the rule dispatches its own retries. Open the rule to review, resume, or re-activate it.' });
  }
  if (!db.prepare("SELECT id FROM agents WHERE id = ? AND canvas_id = ? AND lifecycle = 'active'").get(run.agent_id, req.params.canvasId)) {
    return res.status(400).json({ error: 'the run’s agent is no longer on this canvas' });
  }
  try {
    const retry = dispatchRun({
      agentId: run.agent_id, canvasId: req.params.canvasId, instruction: run.instruction,
      // initiatedBy is the human clicking retry — workspace tools act as them,
      // never as the original initiator. Mode still inherits via parentRunId.
      triggerKind: 'user', actor: req.user.email, initiatedBy: req.user.email, parentRunId: run.id,
    });
    audit('user', req.user.email, 'run.retry', { runId: run.id, retryRunId: retry.id, canvasId: req.params.canvasId });
    res.json({ run: retry });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/canvases/:canvasId/runs/:runId/events', auth.requireCanvas, (req, res) => {
  const events = db.prepare('SELECT * FROM run_events WHERE run_id = ? AND canvas_id = ? ORDER BY id').all(req.params.runId, req.params.canvasId)
    .map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  res.json({ events });
});

// Context Receipt: what this run knew and how it came to know it.
//   provided  — entries attached before the run began (handoff payloads,
//               escalation lineage): run_reads rows with no retrieval record
//   retrieved — every memory_search this run made: query, rank, score
//   cited     — entries this run wrote, with what they cite
//   delivered — the full run_reads set (provided ∪ retrieved)
router.get('/canvases/:canvasId/runs/:runId/receipt', auth.requireCanvas, (req, res) => {
  const run = db.prepare(
    'SELECT id, agent_id, trigger_kind, status, instruction, summary, steps_used, step_budget, cost_usd, started_at, ended_at, created_at FROM runs WHERE id = ? AND canvas_id = ?'
  ).get(req.params.runId, req.params.canvasId);
  if (!run) return res.status(404).json({ error: 'run not found' });

  const delivered = db.prepare('SELECT entry_id FROM run_reads WHERE run_id = ?').all(run.id).map((r) => r.entry_id);
  const retrievalRows = db.prepare('SELECT entry_id, query, rank, score, ts FROM memory_retrievals WHERE run_id = ? ORDER BY id').all(run.id);
  const retrievedIds = new Set(retrievalRows.map((r) => r.entry_id));
  const providedIds = delivered.filter((id) => !retrievedIds.has(id));
  const written = db.prepare('SELECT id FROM memory_entries WHERE run_id = ?').all(run.id).map((r) => r.id);

  const hydrate = (id) => memory.getEntry(id);
  // Group retrievals by query so the receipt reads as "searches this run made".
  const searches = [];
  for (const r of retrievalRows) {
    let s = searches.find((x) => x.query === r.query && x.ts === r.ts);
    if (!s) { s = { query: r.query, ts: r.ts, results: [] }; searches.push(s); }
    s.results.push({ rank: r.rank, score: r.score, entry: hydrate(r.entry_id) });
  }
  const feedback = db.prepare('SELECT verdict, note, by, ts FROM run_feedback WHERE run_id = ?').get(run.id) || null;

  // P1 evidence spine: the external artifacts this run touched, plus per-entry
  // links. Private-surface URIs (gmail/drive/sheet) are the directing user's
  // own view — redacted for everyone else. Purely additive keys.
  const redact = (ref) => evidence.redactRef(ref, req.user.email);
  const evMaps = evidence.evidenceMapsFor(written);
  res.json({
    run,
    provided: providedIds.map(hydrate).filter(Boolean),
    searches,
    cited: written.map(hydrate).filter(Boolean).map((e) => ({ ...e, evidence: (evMaps.get(e.id) || []).map(redact) })),
    deliveredCount: delivered.length,
    evidence: evidence.refsForRun(run.id).map(redact),
    feedback,
  });
});

// P1 Explain Map: run-centric graph over existing records; three lenses.
// Cross-canvas impact entries are redacted with the lineage-route pattern —
// present but stubbed, never silently dropped.
router.get('/canvases/:canvasId/runs/:runId/explain-map', auth.requireCanvas, (req, res) => {
  const run = db.prepare('SELECT id FROM runs WHERE id = ? AND canvas_id = ?').get(req.params.runId, req.params.canvasId);
  if (!run) return res.status(404).json({ error: 'run not found' });
  let map;
  try {
    map = explain.buildExplainMap(run.id, { lens: qstr(req.query.lens) || 'flow' });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
  const accessCache = new Map();
  const canSee = (canvasId) => {
    if (!canvasId || canvasId === req.params.canvasId) return true;
    if (!accessCache.has(canvasId)) accessCache.set(canvasId, auth.canAccessCanvas(req.user, canvasId).ok);
    return accessCache.get(canvasId);
  };
  map.nodes = map.nodes.map((n) => (n.meta && n.meta.canvasId && !canSee(n.meta.canvasId)
    ? { ...n, label: '(restricted — on a canvas you cannot access)', meta: { redacted: true }, redacted: true }
    : n));
  res.json(map);
});

router.post('/canvases/:canvasId/runs/:runId/feedback', auth.requireCanvas, (req, res) => {
  const run = db.prepare('SELECT id, status FROM runs WHERE id = ? AND canvas_id = ?').get(req.params.runId, req.params.canvasId);
  if (!run) return res.status(404).json({ error: 'run not found' });
  const { verdict, note = '' } = req.body;
  if (!['up', 'down'].includes(verdict)) return res.status(400).json({ error: 'verdict must be up|down' });
  db.prepare('INSERT OR REPLACE INTO run_feedback (run_id, verdict, note, by, ts) VALUES (?, ?, ?, ?, ?)')
    .run(run.id, verdict, String(note).slice(0, 1000), req.user.email, nowIso());
  audit('user', req.user.email, 'run.feedback', { runId: run.id, verdict });
  res.json({ ok: true, feedback: { verdict, note, by: req.user.email } });
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
    kind: qstr(req.query.kind),
    subject: qstr(req.query.subject),
    since: qstr(req.query.since),
    query: qstr(req.query.q),
    limit: qstr(req.query.limit),
  });
  res.json({ entries });
});

router.post('/canvases/:canvasId/memory', auth.requireCanvas, (req, res) => {
  // review_at deliberately has NO destructuring default: omitted must reach
  // writeEntry as undefined (apply the epistemic default), while an explicit
  // null opts out of scheduled review. `= null` here erased that distinction
  // and silently disabled the P2 review defaults for every HTTP write.
  const { content, epistemic, source = '', cites = [], kind = null, subject = null, applies_to_type = null, applies_to_id = null, effective_at = null, review_at } = req.body;
  try {
    const entry = memory.writeEntry({
      canvasId: req.params.canvasId, content, epistemic,
      authorType: 'user', authorId: req.user.email, authorName: req.user.name || req.user.email,
      source, cites,
      kind, subject, appliesToType: applies_to_type, appliesToId: applies_to_id, effectiveAt: effective_at, reviewAt: review_at,
    });
    bus.emit('event', { type: 'memory_write', canvasId: req.params.canvasId, entry });
    res.json({ entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/canvases/:canvasId/memory/:entryId/correct', auth.requireCanvas, (req, res) => {
  const { content, epistemic, reason = '', source = '', cites = [], review_at: reviewAt } = req.body;
  if (reviewAt !== undefined && reviewAt !== null && Number.isNaN(Date.parse(reviewAt))) {
    return res.status(400).json({ error: 'review_at must be an ISO date or null' });
  }
  try {
    const result = memory.correctEntry({
      entryId: req.params.entryId, content, epistemic, reason, source,
      authorType: 'user', authorId: req.user.email, authorName: req.user.name || req.user.email, cites,
      // Omitted = inherit the old review date; null = clear it; a date replaces
      // it — without this an overdue entry's correction was overdue at birth
      // (claude-review P1 on #182).
      ...(reviewAt !== undefined ? { reviewAt } : {}),
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

// P2: "still true — extend review". An append-only re-affirmation: the same
// content corrected over itself with a fresh review date, so the timeline
// records that a human looked. Nothing is edited in place, ever.
router.post('/canvases/:canvasId/memory/:entryId/reaffirm', auth.requireCanvas, (req, res) => {
  const old = db.prepare('SELECT * FROM memory_entries WHERE id = ? AND canvas_id = ?').get(req.params.entryId, req.params.canvasId);
  if (!old) return res.status(404).json({ error: 'memory entry not found' });
  const reviewAt = req.body.review_at;
  if (!reviewAt || Number.isNaN(Date.parse(reviewAt))) return res.status(400).json({ error: 'review_at must be an ISO date' });
  try {
    const result = memory.correctEntry({
      entryId: old.id, content: old.content, epistemic: old.epistemic,
      reason: 'review re-affirmed — still true', reviewAt,
      authorType: 'user', authorId: req.user.email, authorName: req.user.name || req.user.email,
    });
    if (result.conflict) return res.status(409).json({ conflict: true, current: result.current });
    // affected is deliberately empty: unchanged content is not a correction,
    // so dependents are neither tainted nor flashed (codex P1 on #183).
    bus.emit('event', { type: 'memory_ripple', canvasId: req.params.canvasId, entry: result.entry, supersededId: old.id, affected: [] });
    res.json({ entry: result.entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// P2: compact lifecycle timeline (created → corrected/reclassified/reaffirmed)
// derived from the supersession chain. Same-canvas by construction, so one
// access check covers the whole chain.
router.get('/memory/:entryId/timeline', (req, res) => {
  const timeline = memory.entryTimeline(req.params.entryId);
  if (!timeline) return res.status(404).json({ error: 'entry not found' });
  if (timeline.canvasId) {
    const check = auth.canAccessCanvas(req.user, timeline.canvasId);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
  }
  res.json(timeline);
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
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND canvas_id = ? AND deleted_at IS NULL').get(req.params.noteId, req.params.canvasId);
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

// Notes are working context, not an immutable belief ledger. Removal is
// user-visible and immediate, but recoverable in the operational export:
// tombstone the row, force it unpinned, and keep its version/history intact.
router.delete('/canvases/:canvasId/notes/:noteId', auth.requireCanvas, (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND canvas_id = ?').get(req.params.noteId, req.params.canvasId);
  if (!note) return res.status(404).json({ error: 'note not found' });
  if (note.deleted_at) return res.json({ ok: true, alreadyRemoved: true, note: { id: note.id, deleted_at: note.deleted_at } });
  const ts = nowIso();
  tx(() => {
    db.prepare('UPDATE notes SET pinned = 0, deleted_at = ?, deleted_by = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(ts, req.user.email, req.user.email, ts, note.id);
    audit('user', req.user.email, 'note.remove', {
      noteId: note.id, canvasId: req.params.canvasId, title: note.title, wasPinned: Boolean(note.pinned),
    });
  });
  bus.emit('event', { type: 'note_removed', canvasId: req.params.canvasId, noteId: note.id, by: req.user.email });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ ok: true, note: { id: note.id, deleted_at: ts } });
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
  audit('user', req.user.email, 'task.create', { taskId: id, canvasId: req.params.canvasId });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) });
});

router.patch('/canvases/:canvasId/tasks/:taskId', auth.requireCanvas, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND canvas_id = ?').get(req.params.taskId, req.params.canvasId);
  if (!task) return res.status(404).json({ error: 'task not found' });
  // P2: assignable to a person OR an agent. null clears; undefined keeps.
  let assigneeEmail = task.assignee_email;
  let assigneeAgentId = task.assignee_agent_id;
  if (req.body.assignee_email !== undefined) {
    const email = req.body.assignee_email === null ? null : String(req.body.assignee_email).toLowerCase().trim();
    if (email && !auth.allowlistEntry(email)) return res.status(400).json({ error: 'assignee_email is not on the workspace allowlist' });
    assigneeEmail = email;
  }
  if (req.body.assignee_agent_id !== undefined) {
    const agentId = req.body.assignee_agent_id;
    if (agentId && !db.prepare("SELECT id FROM agents WHERE id = ? AND canvas_id = ? AND lifecycle = 'active'").get(agentId, req.params.canvasId)) {
      return res.status(400).json({ error: 'assignee agent is not on this canvas' });
    }
    assigneeAgentId = agentId;
  }
  db.prepare('UPDATE tasks SET title = ?, description = ?, status = ?, assignee_email = ?, assignee_agent_id = ?, x = ?, y = ?, updated_at = ? WHERE id = ?')
    .run(req.body.title ?? task.title, req.body.description ?? task.description, req.body.status ?? task.status,
      assigneeEmail, assigneeAgentId, req.body.x ?? task.x, req.body.y ?? task.y, nowIso(), task.id);
  audit('user', req.user.email, 'task.update', { taskId: task.id, canvasId: req.params.canvasId });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ ok: true, task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) });
});

// ---------- people (P2): presentation-only human cards ----------
// Identity is the allowlist; a card is just where a person sits on the canvas.
router.post('/canvases/:canvasId/people', auth.requireCanvas, (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  if (!auth.allowlistEntry(email)) return res.status(400).json({ error: 'email is not on the workspace allowlist' });
  const id = crypto.randomUUID();
  try {
    db.prepare('INSERT INTO canvas_people (id, canvas_id, email, display, color, x, y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.params.canvasId, email, String(req.body.display || email.split('@')[0]).slice(0, 80),
        String(req.body.color || '#8b5cf6').slice(0, 16), req.body.x || 0, req.body.y || 0, nowIso());
  } catch {
    return res.status(409).json({ error: 'that person already has a card on this canvas' });
  }
  audit('user', req.user.email, 'person.create', { canvasId: req.params.canvasId, email });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ person: db.prepare('SELECT * FROM canvas_people WHERE id = ?').get(id) });
});

router.delete('/canvases/:canvasId/people/:personId', auth.requireCanvas, (req, res) => {
  const person = db.prepare('SELECT * FROM canvas_people WHERE id = ? AND canvas_id = ?').get(req.params.personId, req.params.canvasId);
  if (!person) return res.status(404).json({ error: 'person not found' });
  db.prepare('DELETE FROM canvas_people WHERE id = ?').run(person.id);
  audit('user', req.user.email, 'person.delete', { canvasId: req.params.canvasId, email: person.email });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ ok: true });
});

// ---------- node positions (notes/files/tasks share the same shape) ----------
router.post('/canvases/:canvasId/positions', auth.requireCanvas, (req, res) => {
  const { kind, id, x, y } = req.body;
  const tables = { agent: 'agents', note: 'notes', task: 'tasks', file: 'files', person: 'canvas_people' };
  const table = tables[kind];
  if (!table) return res.status(400).json({ error: 'kind must be agent|note|task|file|person' });
  db.prepare(`UPDATE ${table} SET x = ?, y = ? WHERE id = ? AND canvas_id = ?`).run(x, y, id, req.params.canvasId);
  bus.emit('event', { type: 'node_move', canvasId: req.params.canvasId, kind, id, x, y, by: req.user.email });
  res.json({ ok: true });
});

// ---------- files ----------
router.post('/canvases/:canvasId/files', auth.requireCanvas, express.raw({ type: '*/*', limit: '5mb' }), asyncRoute(async (req, res) => {
  // The TYPE of req.body is caller-controlled. The main app deliberately skips
  // its JSON parser for this path so legitimate JSON documents reach the raw
  // parser, but alternate mounts/tests may not. Validate the boundary anyway.
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
  const candidate = { name, mime, size, content: bytes };
  if (!canvasFileFormat(candidate)) {
    return res.status(415).json({ error: `Unsupported file "${name}" (${mime}). Upload a .txt, .md, .csv, .json, or .xlsx file.` });
  }
  // Validate readability before persistence. A binary renamed .txt or a
  // corrupt .xlsx would otherwise create the same dead-end artifact this
  // endpoint is meant to replace.
  try {
    await readCanvasFile(candidate);
  } catch (err) {
    return res.status(415).json({ error: String(err.message || err) });
  }
  db.prepare('INSERT INTO files (id, canvas_id, name, mime, size, content, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.canvasId, name, mime, size, bytes, req.user.email, nowIso());
  audit('user', req.user.email, 'file.upload', { fileId: id, name, size });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ file: { id, name, mime, size } });
}));

router.get('/canvases/:canvasId/files/:fileId', auth.requireCanvas, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND canvas_id = ? AND deleted_at IS NULL').get(req.params.fileId, req.params.canvasId);
  if (!file) return res.status(404).json({ error: 'file not found' });
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', attachmentDisposition(file.name));
  // SQLite returns BLOBs as Uint8Array; res.send() would JSON-serialize that
  // ({"0":104,...}) instead of sending bytes. Convert to a Buffer.
  res.send(Buffer.from(file.content));
});

// Removal is recoverable and export-visible: the bytes stay in the ledger,
// while every active read surface filters the tombstone immediately.
router.delete('/canvases/:canvasId/files/:fileId', auth.requireCanvas, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND canvas_id = ?').get(req.params.fileId, req.params.canvasId);
  if (!file) return res.status(404).json({ error: 'file not found' });
  if (file.deleted_at) return res.json({ ok: true, alreadyRemoved: true, file: { id: file.id, deleted_at: file.deleted_at } });
  const ts = nowIso();
  tx(() => {
    db.prepare('UPDATE files SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL')
      .run(ts, req.user.email, file.id);
    audit('user', req.user.email, 'file.remove', {
      fileId: file.id, canvasId: req.params.canvasId, name: file.name, size: file.size,
    });
  });
  bus.emit('event', { type: 'file_removed', canvasId: req.params.canvasId, fileId: file.id, by: req.user.email });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ ok: true, file: { id: file.id, deleted_at: ts } });
});

// ---------- escalations (the needs-you tray) ----------
router.get('/escalations', (req, res) => {
  const all = db.prepare("SELECT * FROM escalations WHERE status = 'open' ORDER BY created_at DESC LIMIT 100").all()
    .map((e) => ({ ...e, context: JSON.parse(e.context) }));
  const visible = all.filter((e) => !e.canvas_id || auth.canAccessCanvas(req.user, e.canvas_id).ok);
  res.json({ escalations: visible });
});

// P2: unified NEEDS YOU — a projection over authoritative records (open
// escalations, memory conflicts, overdue reviews, failed runs, and scheduled
// rule output. Access is decided per canvas before projecting any records.
router.get('/attention', (req, res) => {
  const scopeRaw = qstr(req.query.scope); // repeated ?scope= arrives as an array — normalize first
  const scope = ['mine', 'team', 'all'].includes(scopeRaw) ? scopeRaw : 'all';
  const canvasId = qstr(req.query.canvas_id) || null;
  let canvasIds;
  if (canvasId) {
    const check = auth.canAccessCanvas(req.user, canvasId);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
    canvasIds = [canvasId];
  } else {
    canvasIds = db.prepare('SELECT id FROM canvases WHERE archived = 0').all()
      .map((c) => c.id)
      .filter((id) => auth.canAccessCanvas(req.user, id).ok);
  }
  res.json({ attention: attention.listAttention({ email: req.user.email, scope, canvasIds }), scope });
});

// P2: assign an open escalation to a person (allowlisted email) or an agent,
// with an optional due date. Assignment is attention routing, never resolution.
router.post('/escalations/:id/assign', (req, res) => {
  const escalation = db.prepare('SELECT * FROM escalations WHERE id = ?').get(req.params.id);
  if (!escalation) return res.status(404).json({ error: 'escalation not found' });
  if (escalation.status !== 'open') return res.status(409).json({ error: 'only open escalations can be assigned' });
  if (escalation.canvas_id) {
    const check = auth.canEditCanvas(req.user, escalation.canvas_id);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
  }
  const { owner_email, owner_agent_id, due_at } = req.body;
  if (owner_email && owner_agent_id) return res.status(400).json({ error: 'assign to a person OR an agent, not both' });
  let email = escalation.owner_email;
  let agentId = escalation.owner_agent_id;
  if (owner_email !== undefined) {
    email = owner_email === null ? null : String(owner_email).toLowerCase().trim();
    if (email && !auth.allowlistEntry(email)) return res.status(400).json({ error: 'owner_email is not on the workspace allowlist' });
    if (email) agentId = null;
  }
  if (owner_agent_id !== undefined) {
    agentId = owner_agent_id;
    if (agentId && !db.prepare("SELECT id FROM agents WHERE id = ? AND canvas_id = ? AND lifecycle = 'active'").get(agentId, escalation.canvas_id)) {
      return res.status(400).json({ error: 'owner agent is not on this escalation’s canvas' });
    }
    if (agentId) email = null;
  }
  let due = escalation.due_at;
  if (due_at !== undefined) {
    if (due_at !== null && Number.isNaN(Date.parse(due_at))) return res.status(400).json({ error: 'due_at must be an ISO date or null' });
    due = due_at;
  }
  db.prepare('UPDATE escalations SET owner_email = ?, owner_agent_id = ?, due_at = ? WHERE id = ?')
    .run(email, agentId, due, escalation.id);
  audit('user', req.user.email, 'escalation.assign', { escalationId: escalation.id, ownerEmail: email, ownerAgentId: agentId, dueAt: due });
  bus.emit('event', { type: 'escalation', canvasId: escalation.canvas_id, escalation: { ...db.prepare('SELECT * FROM escalations WHERE id = ?').get(escalation.id), context: JSON.parse(escalation.context) } });
  res.json({ ok: true, escalation: db.prepare('SELECT * FROM escalations WHERE id = ?').get(escalation.id) });
});

router.post('/escalations/:id/resolve', asyncRoute(async (req, res) => {
  const escalation = db.prepare('SELECT * FROM escalations WHERE id = ?').get(req.params.id);
  if (!escalation) return res.status(404).json({ error: 'escalation not found' });
  if (escalation.status !== 'open') return res.status(409).json({ error: 'already resolved' });
  if (escalation.canvas_id) {
    const check = auth.canEditCanvas(req.user, escalation.canvas_id);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
  }
  const { action, answer = '', target_agent_id } = req.body; // 'accept' | 'redirect' | 'dismiss'
  if (!['accept', 'redirect', 'dismiss'].includes(action)) return res.status(400).json({ error: 'action must be accept|redirect|dismiss' });
  // A blank answer used to mark the escalation resolved and dispatch nothing —
  // the decision left the tray but never reached an agent. Refuse it up front.
  if (action !== 'dismiss' && !answer.trim()) return res.status(400).json({ error: 'answer required: the decision text is what the resumed agent applies' });

  let agentId = escalation.agent_id;
  if (action === 'redirect') {
    if (!target_agent_id) return res.status(400).json({ error: 'target_agent_id required for redirect' });
    const target = db.prepare("SELECT id FROM agents WHERE id = ? AND canvas_id = ? AND lifecycle = 'active'").get(target_agent_id, escalation.canvas_id);
    if (!target) return res.status(400).json({ error: 'target agent is not on this escalation’s canvas' });
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
  let decisionEntry = null;
  tx(() => {
    db.prepare('UPDATE escalations SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
      .run(status, answer, req.user.email, nowIso(), escalation.id);
    if (action !== 'dismiss' && agentId) {
      // The server records the human decision as verified memory under the
      // human's own identity — the resumed agent no longer authors (and can no
      // longer reword) the verified entry it was told to write.
      decisionEntry = memory.writeEntry({
        canvasId: escalation.canvas_id,
        content: `Human decision on escalation "${String(escalation.question).slice(0, 200)}": ${answer}`,
        epistemic: 'verified',
        authorType: 'user', authorId: req.user.email, authorName: req.user.email,
        source: `escalation ${escalation.id} resolution`,
      });
      // Lineage: the resumed run reads the decision entry plus whatever the
      // escalating agent attached as context — previously dropped on resume.
      const context = JSON.parse(escalation.context || '{}');
      const contextIds = Array.isArray(context.entry_ids) ? context.entry_ids : [];
      run = dispatchRun({
        agentId, canvasId: escalation.canvas_id,
        instruction: `A human resolved your escalation (escalation_id: ${escalation.id}).\nOriginal question: ${escalation.question}\nHuman decision (${req.user.email}): ${answer}\nThe decision is already recorded as verified memory (entry ${decisionEntry.id}) — do not re-record it. Apply the decision using only your currently granted tools, then complete. Your summary must state exactly what you changed — nothing more.`,
        triggerKind: 'escalation_resume', actor: req.user.email, initiatedBy: req.user.email,
        // Carry the escalating run as parent so the resume INHERITS its mode —
        // resolving an ask/rehearse run's question must not silently produce
        // an act run with mutating tools (claude-review finding on #173).
        parentRunId: escalation.run_id || null,
        initialReads: [...new Set([decisionEntry.id, ...contextIds])],
      });
      // P5: if the escalating run belonged to a standing-rule occurrence, this
      // resume is another attempt of it — it inherits the rule's frozen grant
      // (queue.js) and keeps reading. Unrecorded, pause/revoke/edit cannot see
      // it: haltRuleRuns finds attempts only through run_id/retry_run_ids_json,
      // so revoking the rule would halt every tracked attempt while this one
      // ran on. Covers `redirect` too — it re-targets the same dispatch.
      standingRules.adoptChildRun(escalation.run_id, run.id);
    }
  });
  audit('user', req.user.email, 'escalation.resolve', { escalationId: escalation.id, action });
  bus.emit('event', { type: 'escalation_resolved', canvasId: escalation.canvas_id, escalationId: escalation.id, status, by: req.user.email });
  res.json({ ok: true, run });
}));

// ---------- P1 inquiries: ask the company without picking an agent ----------
// POST parses AND dispatches server-side (unlike /intent, which echoes for a
// client confirm) — that is the Inquiry Home contract. Selection: explicit
// agent_id override wins; otherwise a fast-tier pick with a deterministic
// role-priority fallback so an ask never dead-ends on a flaky parse.
const INQUIRY_ROLE_ORDER = ['research', 'strategic', 'commercial', 'operational', 'review', 'coding', 'workspace'];

function deriveInquiryStatus(runStatus) {
  if (!runStatus || runStatus === 'queued' || runStatus === 'running') return 'pending';
  return runStatus === 'completed' ? 'answered' : 'unanswered';
}

function inquiryWithRun(row) {
  const run = row.run_id
    ? db.prepare('SELECT id, agent_id, status, summary, error, cost_usd, started_at, ended_at FROM runs WHERE id = ?').get(row.run_id) || null
    : null;
  const status = deriveInquiryStatus(run && run.status);
  // Lazy write-back: the stored status catches up once the run is terminal.
  // The returned object carries the SAME timestamp the write lands, so the
  // first post-terminal read and the second agree.
  if (status !== 'pending' && row.status !== status) {
    const ts = nowIso();
    db.prepare('UPDATE inquiries SET status = ?, updated_at = ? WHERE id = ?').run(status, ts, row.id);
    row = { ...row, status, updated_at: ts };
  }
  const agent = row.selected_agent_id
    ? db.prepare('SELECT id, name, role, color FROM agents WHERE id = ?').get(row.selected_agent_id) || null
    : null;
  return {
    id: row.id, canvasId: row.canvas_id, question: row.question, requestedBy: row.requested_by,
    agent, selectionAuto: !!row.selection_auto, runId: row.run_id, mode: row.mode,
    status, saved: !!row.saved, createdAt: row.created_at, updatedAt: row.updated_at, run,
  };
}

router.post('/canvases/:canvasId/inquiries', rateLimit('model'), auth.requireCanvas, asyncRoute(async (req, res) => {
  const question = String(req.body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question required' });
  const mode = req.body.mode || 'ask';
  if (!RUN_MODES.includes(mode)) return res.status(400).json({ error: `mode must be one of ${RUN_MODES.join(', ')}` });
  if (control.isPaused()) return res.status(409).json({ error: 'workspace is paused — resume before asking' });
  if (control.budgetExceeded()) return res.status(429).json({ error: 'daily budget exhausted — raise it or wait for the reset' });
  const agents = db.prepare("SELECT id, name, role FROM agents WHERE canvas_id = ? AND lifecycle = 'active'").all(req.params.canvasId);
  if (!agents.length) return res.status(409).json({ error: 'this canvas has no agents to ask' });

  let agentId = req.body.agent_id || null;
  let auto = false;
  let echo = '';
  if (agentId) {
    if (!agents.some((a) => a.id === agentId)) return res.status(400).json({ error: 'agent_id is not on this canvas' });
  } else {
    auto = true;
    // Fast-tier selection, same gates as /intent. A parse failure falls
    // through to the deterministic pick — never a dead end.
    try {
      const abort = new AbortController();
      const abortId = `inquiry-${crypto.randomUUID()}`;
      control.registerAbort(abortId, abort);
      const fastTier = tierConfig('fast');
      let response;
      try {
        // Resolved at call time (not the destructured import) so tests can
        // stub the module's callModel — same seam idea as runner.setCallModel.
        response = await require('./orchestrator/anthropic').callModel({
          provider: fastTier.provider, model: fastTier.model, signal: abort.signal,
          system: `You route a company question to the best agent. Available agents:\n${agents.map((a) => `- ${a.name} (${a.role}, id ${a.id})`).join('\n')}\nReturn ONLY JSON: {"agent_id": "<id>", "echo": "<short confirmation, e.g. 'Asking Scout (research)'>"}. Pick the agent whose role best fits the question.`,
          messages: [{ role: 'user', content: question }],
          maxTokens: 200,
        });
      } finally {
        control.unregisterAbort(abortId);
      }
      control.addUsage(response.model || fastTier.model, response.usage || {});
      const raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      if (agents.some((a) => a.id === parsed.agent_id)) {
        agentId = parsed.agent_id;
        echo = String(parsed.echo || '');
      }
    } catch { /* fall through to the deterministic pick */ }
    if (!agentId) {
      const ranked = [...agents].sort((a, b) => {
        const ia = INQUIRY_ROLE_ORDER.indexOf(a.role); const ib = INQUIRY_ROLE_ORDER.indexOf(b.role);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
      agentId = ranked[0].id;
      echo = `Asking ${ranked[0].name} (${ranked[0].role}) — picked automatically`;
    }
  }

  // A pause that landed while the selection call was in flight must not slip
  // through as a fallback dispatch — the abort reads like a parse failure.
  if (control.isPaused()) return res.status(409).json({ error: 'workspace was paused while routing — resume before asking' });

  // Both halves or neither, exactly like escalation resolve: the inquiry row
  // and its dispatched run land in one tx; a 429/409 rolls both back.
  const inquiryId = crypto.randomUUID();
  let run = null;
  tx(() => {
    db.prepare(
      `INSERT INTO inquiries (id, canvas_id, question, requested_by, selected_agent_id, selection_auto, run_id, mode, status, saved, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'queued', 0, ?, ?)`
    ).run(inquiryId, req.params.canvasId, question, req.user.email, agentId, auto ? 1 : 0, mode, nowIso(), nowIso());
    run = dispatchRun({
      agentId, canvasId: req.params.canvasId, instruction: question,
      triggerKind: 'user', actor: req.user.email, initiatedBy: req.user.email, mode,
    });
    db.prepare('UPDATE inquiries SET run_id = ? WHERE id = ?').run(run.id, inquiryId);
  });
  audit('user', req.user.email, 'inquiry.create', { inquiryId, canvasId: req.params.canvasId, agentId, auto, mode, runId: run.id });
  const row = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(inquiryId);
  res.json({ inquiry: inquiryWithRun(row), selection: { agentId, auto, echo } });
}));

router.get('/canvases/:canvasId/inquiries', auth.requireCanvas, (req, res) => {
  const limit = Math.min(Math.max(Math.floor(Number(qstr(req.query.limit)) || 25), 1), 100);
  const savedOnly = qstr(req.query.saved) === '1';
  const rows = db.prepare(
    `SELECT * FROM inquiries WHERE canvas_id = ? ${savedOnly ? 'AND saved = 1' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`
  ).all(req.params.canvasId, limit);
  res.json({ inquiries: rows.map(inquiryWithRun) });
});

router.get('/inquiries/:inquiryId', (req, res) => {
  const row = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(req.params.inquiryId);
  if (!row) return res.status(404).json({ error: 'inquiry not found' });
  const check = auth.canAccessCanvas(req.user, row.canvas_id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  res.json({ inquiry: inquiryWithRun(row) });
});

router.patch('/inquiries/:inquiryId', (req, res) => {
  const row = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(req.params.inquiryId);
  if (!row) return res.status(404).json({ error: 'inquiry not found' });
  const check = auth.canEditCanvas(req.user, row.canvas_id);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  if (typeof req.body.saved !== 'boolean') return res.status(400).json({ error: 'saved (boolean) required' });
  db.prepare('UPDATE inquiries SET saved = ?, updated_at = ? WHERE id = ?').run(req.body.saved ? 1 : 0, nowIso(), row.id);
  audit('user', req.user.email, 'inquiry.save', { inquiryId: row.id, saved: req.body.saved });
  res.json({ inquiry: inquiryWithRun(db.prepare('SELECT * FROM inquiries WHERE id = ?').get(row.id)) });
});

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
  const agents = db.prepare("SELECT id, name, role FROM agents WHERE canvas_id = ? AND lifecycle = 'active'").all(req.params.canvasId);
  const fastTier = tierConfig('fast');
  let response;
  try {
    response = await callModel({
    provider: fastTier.provider,
    model: fastTier.model,
    signal: abort.signal,
    system: `You parse spoken/typed commands for a multi-agent canvas. Available agents:\n${agents.map((a) => `- ${a.name} (${a.role}, id ${a.id})`).join('\n')}\nReturn ONLY a JSON object, no prose: {"action": "dispatch"|"pause"|"resume"|"unknown", "agent_id": "<id or null>", "agent_name": "<name or null>", "instruction": "<what the agent should do, cleaned up>", "echo": "<short confirmation of what will happen, e.g. 'Ask Scout (research) to review the uploaded brief'>"}. If the command names no agent but implies a role, pick the matching agent. If genuinely unclear, action "unknown" with echo explaining why.`,
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

// Wave 5: operational analytics — diagnosis, not a leaderboard. Everything is
// computed from records that already exist (runs, escalations, run_feedback,
// memory_retrievals); nothing is stored.
router.get('/canvases/:canvasId/analytics', auth.requireCanvas, (req, res) => {
  const perAgent = db.prepare(`
    SELECT a.id AS agent_id, a.name, a.role,
           COUNT(r.id) AS runs,
           SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN r.status IN ('failed','refused') THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN r.status LIKE 'halted%' THEN 1 ELSE 0 END) AS halted,
           COALESCE(SUM(r.cost_usd),0) AS cost_usd,
           COALESCE(AVG(CASE WHEN r.started_at IS NOT NULL AND r.ended_at IS NOT NULL
             THEN (julianday(r.ended_at) - julianday(r.started_at)) * 86400000 END), 0) AS avg_duration_ms,
           SUM(CASE WHEN f.verdict = 'up' THEN 1 ELSE 0 END) AS feedback_up,
           SUM(CASE WHEN f.verdict = 'down' THEN 1 ELSE 0 END) AS feedback_down
    FROM agents a
    LEFT JOIN runs r ON r.agent_id = a.id
    LEFT JOIN run_feedback f ON f.run_id = r.id
    WHERE a.canvas_id = ? GROUP BY a.id
  `).all(req.params.canvasId);
  const escalations = db.prepare(`
    SELECT agent_id, COUNT(*) AS total,
           SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open
    FROM escalations WHERE canvas_id = ? AND agent_id IS NOT NULL GROUP BY agent_id
  `).all(req.params.canvasId);
  const retrievals = db.prepare(`
    SELECT r.agent_id, COUNT(DISTINCT mr.query || mr.ts) AS searches, COUNT(*) AS results
    FROM memory_retrievals mr JOIN runs r ON r.id = mr.run_id
    WHERE r.canvas_id = ? GROUP BY r.agent_id
  `).all(req.params.canvasId);
  res.json({ perAgent, escalations, retrievals });
});

// Wave 5: deterministic contradiction surfacing — two live entries with the
// same subject, both claiming "verified", different content. Computed on
// read, nothing stored, nothing auto-demoted; a human resolves via the
// normal correction path. ponytail: semantic detection when typed data
// accumulates enough to need it.
router.get('/canvases/:canvasId/memory/conflicts', auth.requireCanvas, (req, res) => {
  res.json({ conflicts: memory.findConflicts(req.params.canvasId) });
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

// ---------- operational-ledger export (owner only) ----------
// Deliberately not described as a full backup: credentials/tokens stay out, and
// newer product tables require an explicit portability contract before joining
// this stable owner export.
router.get('/export', auth.requireOwner, (req, res) => {
  audit('user', req.user.email, 'workspace.export', {});
  const dump = {
    exported_at: nowIso(),
    exported_by: req.user.email,
    canvases: db.prepare('SELECT * FROM canvases').all(),
    agents: db.prepare('SELECT * FROM agents').all(),
    notes: db.prepare('SELECT * FROM notes').all(),
    tasks: db.prepare('SELECT * FROM tasks').all(),
    files: db.prepare('SELECT id, canvas_id, name, mime, size, uploaded_by, created_at, deleted_at, deleted_by FROM files').all(),
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

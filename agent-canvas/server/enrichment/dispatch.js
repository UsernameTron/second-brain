'use strict';
// Agent Canvas → ctg-enrichment-dispatch client.
//
// Enrichment-dispatch (Pete's estate, own repo) is a FastAPI fan-out service:
// tiered vendor orchestration behind a deterministic merge, two-axis gating,
// and per-field lineage. This file is a thin READ client of it — same shape as
// hubspot/opsrunner.js: no credential of its own, keyless service-to-service
// identity, named operations only, every call audited.
//
// Three rules this file exists to enforce, all from the fold-in spec:
//
//   1. THERE IS NO COMMIT TOOL, and there must never be one. Enrichment results
//      come back to the agent as data. Anything CRM-bound goes through the
//      existing ops-runner preview/apply lane (ADR-0041), which is the only
//      write authority in this product. The service's own /v1/commit endpoint
//      is deliberately not reachable from here.
//   2. Per-call spend is capped client-side. Agents loop; humans don't. The
//      service prices each dispatch against max_credits and fails closed, so
//      clamping it here bounds the worst case a runaway run can cost.
//   3. Spend cannot happen at all while the service's ED_DAILY_BUDGET_CREDITS
//      is unset — verified in its source 2026-08-14: an unset budget makes
//      paid enrichment return {"status": "budget_unconfigured"} rather than
//      spending uncapped. That is the service's guarantee, not ours; the cap
//      above is ours.
//
// Disabled by default: with ED_DISPATCH_URL unset there is no client, and
// tools.js does not offer the tools at all — a model should never see a tool
// the deployment cannot honor (the gmail-scope precedent).

const { audit } = require('../audit');
const { identityToken } = require('../gcp-identity');

function baseUrl() { return (process.env.ED_DISPATCH_URL || '').replace(/\/+$/, ''); }
function audience() { return process.env.ED_DISPATCH_AUDIENCE || baseUrl(); }
function configured() { return Boolean(baseUrl()); }

// Ceiling on any single dispatch. The spec's number; kept here rather than in
// config because nothing tunes it and a knob for a constant is the abstraction
// the ladder says to skip.
const MAX_CREDITS_CEILING = 3;
const OUTPUT_CAP = 30_000;

function clampCredits(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return MAX_CREDITS_CEILING;
  return Math.min(n, MAX_CREDITS_CEILING);
}

// Identity fields the service accepts. Anything else an agent invents is
// dropped rather than forwarded — an unknown key is a 422 from FastAPI, and a
// clear client-side drop beats a confusing server-side rejection.
const IDENTITY_FIELDS = [
  'domain', 'email', 'linkedin_url', 'hubspot_id', 'company_name',
  'first_name', 'last_name', 'title',
];

function pickIdentity(input) {
  const out = {};
  for (const key of IDENTITY_FIELDS) {
    const v = input?.[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim();
  }
  return out;
}

// A record key or bare email in a URL path. Anything outside this set could
// traverse the path or smuggle a query string onto another route.
function assertKey(key) {
  const s = String(key || '');
  if (!/^[A-Za-z0-9._@+-]{1,200}$/.test(s)) throw new Error('invalid record key');
  return s;
}
function assertDomain(domain) {
  const s = String(domain || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(s) || !s.includes('.')) throw new Error(`invalid domain: ${s.slice(0, 40)}`);
  return s;
}

async function request({ method, path, body, actorEmail, op }) {
  if (!configured()) {
    const e = new Error('Enrichment dispatch is not configured on this deployment (ED_DISPATCH_URL unset).');
    e.notConfigured = true;
    throw e;
  }
  const token = await identityToken(audience(), { escapeHatchEnv: 'ED_DISPATCH_ID_TOKEN' });
  const t0 = Date.now();
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      // The service stamps this into its provider-call ledger (its MCP
      // attribution contract), so a spend row traces to the human who
      // directed the run rather than to the canvas service account.
      'x-caller-email': actorEmail || 'agent-canvas',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    // Vendor fan-out is the slow part; 60s is the ceiling, not the target.
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  audit('user', actorEmail || 'system', 'enrichment.call', {
    op, status: res.status, ms: Date.now() - t0,
    credits: typeof data?.cost_credits === 'number' ? data.cost_credits : undefined,
  });
  if (!res.ok) {
    const detail = String(data.detail || data.error || JSON.stringify(data)).slice(0, 300);
    throw new Error(`enrichment-dispatch ${res.status}: ${detail}`);
  }
  const text = JSON.stringify(data);
  return text.length > OUTPUT_CAP ? `${text.slice(0, OUTPUT_CAP)}…[truncated]` : text;
}

// ---------- named operations (the only things agents can invoke) ----------
const ops = {
  enrich_contact: ({ actorEmail, ...input }) => {
    const identity = pickIdentity(input);
    if (!Object.keys(identity).length) {
      throw new Error('enrich_contact needs at least one of: email, domain, linkedin_url, company_name + first_name/last_name');
    }
    const body = { ...identity, max_credits: clampCredits(input.max_credits) };
    if (Array.isArray(input.fields) && input.fields.length) {
      body.fields = input.fields.map((f) => String(f).slice(0, 60));
    }
    return request({ method: 'POST', path: '/v1/enrich', body, actorEmail, op: 'enrich_contact' });
  },
  enrich_company: ({ actorEmail, domain, titles }) => {
    const clean = assertDomain(domain);
    const qs = Array.isArray(titles) && titles.length
      ? `?${titles.slice(0, 10).map((t) => `titles=${encodeURIComponent(String(t).slice(0, 80))}`).join('&')}`
      : '';
    return request({ method: 'GET', path: `/v1/company/${encodeURIComponent(clean)}${qs}`, actorEmail, op: 'enrich_company' });
  },
  verify_email: ({ actorEmail, email }) => {
    const s = String(email || '').trim();
    if (!s.includes('@')) throw new Error('verify_email needs an email address');
    return request({ method: 'POST', path: '/v1/verify', body: { email: s }, actorEmail, op: 'verify_email' });
  },
  get_enriched_contact: ({ actorEmail, key }) => request({
    method: 'GET', path: `/v1/contact/${encodeURIComponent(assertKey(key))}`, actorEmail, op: 'get_enriched_contact',
  }),
};

function run(op, input) {
  const builder = Object.hasOwn(ops, op) ? ops[op] : null; // no inherited-key dispatch
  if (!builder) throw Object.assign(new Error(`unknown enrichment operation ${String(op).slice(0, 40)}`), { status: 404 });
  return builder(input || {});
}

async function probe(actorEmail) {
  const t0 = Date.now();
  await request({ method: 'GET', path: '/health', actorEmail: actorEmail || 'probe', op: 'probe' });
  return { ok: true, ms: Date.now() - t0 };
}

module.exports = {
  configured, run, probe,
  _internal: { pickIdentity, clampCredits, assertKey, assertDomain, ops, MAX_CREDITS_CEILING },
};

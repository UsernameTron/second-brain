'use strict';
// Agent Canvas → ctg-hs-ops-runner client.
//
// The Ops Runner (ADR-0041 Rev A, Pete's estate) is the SOLE execution
// authority for HubSpot: an IAM-gated Cloud Run service wrapping the pinned
// HubSpot Agent CLI behind a deny-by-default 73-command policy engine, with
// dry-run-defaulted mutations, a fail-closed sandbox portal guard
// (246460341 — real customer data is unreachable by design), and one
// structured audit line per call.
//
// This file therefore holds NO HubSpot credential and NO policy authority.
// It builds argv for named operations, authenticates service-to-service with
// a Google-signed identity token (keyless, Cloud Run metadata server), and
// mirrors the runner's refusal surface client-side as defense in depth —
// the runner remains authoritative.
//
// Write ceremony (two independent gates):
//   preview: confirm is never sent → the runner dry-runs by default.
//   apply:   tools.js only permits it in a run resumed from a human-approved
//            escalation; only then is confirm:true sent.

const { audit } = require('../audit');

function runnerUrl() { return (process.env.HS_OPS_RUNNER_URL || '').replace(/\/+$/, ''); }
function audience() { return process.env.HS_OPS_RUNNER_AUDIENCE || runnerUrl(); }
function configured() { return Boolean(runnerUrl()); }

// ---------- service identity (keyless) ----------
let tokenCache = { token: null, exp: 0 };
async function identityToken() {
  if (process.env.HS_OPS_RUNNER_ID_TOKEN) return process.env.HS_OPS_RUNNER_ID_TOKEN; // dev/test escape hatch
  if (tokenCache.token && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience())}`,
    { headers: { 'Metadata-Flavor': 'Google' } },
  ).catch(() => null);
  if (!res || !res.ok) {
    throw new Error('no service identity available — this call needs Cloud Run (or HS_OPS_RUNNER_ID_TOKEN for local dev)');
  }
  const token = await res.text();
  tokenCache = { token, exp: Date.now() + 45 * 60_000 };
  return token;
}

// ---------- client-side mirror of the runner's refusal surface ----------
// Authoritative list lives in the runner's app/policy.py; this mirror exists
// so a refused operation dies here with a clear message instead of a 400.
const FORBIDDEN_PREFIXES = [
  'objects delete', 'objects merge',
  'pipelines delete', 'pipelines stages-delete',
  'properties delete', 'properties batch-archive',
  'associations delete', 'associations batch-delete', 'associations batch-delete-labels',
  'associations labels-delete', 'associations limits-delete',
  'schemas update', 'schemas delete',
  'workflows update', 'workflows delete',
  'views delete', 'activities transcript delete', 'reports delete',
  'auth', 'secrets',
];
const FORBIDDEN_FLAGS = ['--digest', '--token', '--config'];
function assertSafeArgv(argv) {
  const joined = argv.join(' ');
  for (const p of FORBIDDEN_PREFIXES) {
    if (joined === p || joined.startsWith(`${p} `)) {
      throw new Error(`refused client-side: "${p}" is not exposed to agents (destructive/forbidden at the runner too)`);
    }
  }
  for (const el of argv) {
    if (FORBIDDEN_FLAGS.some((f) => String(el).startsWith(f))) {
      throw new Error(`refused client-side: forbidden flag ${el}`);
    }
  }
}

const TYPE_RE = /^[a-z0-9_]+$/i;
function assertType(t) {
  if (!TYPE_RE.test(String(t || ''))) throw new Error(`invalid object type: ${String(t).slice(0, 40)}`);
  return String(t);
}
function assertId(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(id || ''))) throw new Error('invalid record id');
  return String(id);
}
function propsToArgs(properties) {
  const out = [];
  for (const [k, v] of Object.entries(properties || {})) {
    if (!/^[a-zA-Z0-9_]+$/.test(k)) throw new Error(`invalid property name: ${String(k).slice(0, 40)}`);
    out.push('--property', `${k}=${String(v)}`);
  }
  if (!out.length) throw new Error('at least one property is required');
  return out;
}

const OUTPUT_CAP = 30_000;

async function runArgv({ argv, confirm = false, stdinJsonl, actorEmail }) {
  if (!configured()) {
    const e = new Error('HubSpot Ops Runner is not configured on this deployment (HS_OPS_RUNNER_URL unset).');
    e.notConfigured = true;
    throw e;
  }
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string')) {
    throw new Error('argv must be a non-empty array of strings');
  }
  assertSafeArgv(argv);
  const token = await identityToken();
  const body = { argv };
  if (confirm === true) body.confirm = true;
  if (stdinJsonl) body.stdin_jsonl = String(stdinJsonl);
  const t0 = Date.now();
  const res = await fetch(`${runnerUrl()}/run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  audit('user', actorEmail || 'system', 'hubspot.run', {
    argv: argv.slice(0, 6).join(' '), confirm: confirm === true, status: res.status, ms: Date.now() - t0,
  });
  if (!res.ok) {
    throw new Error(`ops-runner ${res.status}: ${String(data.error || data.detail || JSON.stringify(data)).slice(0, 300)}`);
  }
  const text = JSON.stringify(data);
  return text.length > OUTPUT_CAP ? `${text.slice(0, OUTPUT_CAP)}…[truncated]` : text;
}

// ---------- named operations (the only things agents can invoke) ----------
const ops = {
  types: () => ['objects', 'types'],
  list: ({ type, properties }) => {
    const argv = ['objects', 'list', '--type', assertType(type)];
    if (properties) argv.push('--properties', properties.map((p) => assertType(p)).join(','));
    return argv;
  },
  get: ({ type, id, properties }) => {
    const argv = ['objects', 'get', assertId(id), '--type', assertType(type)];
    if (properties) argv.push('--properties', properties.map((p) => assertType(p)).join(','));
    return argv;
  },
  search: ({ type, filter, properties }) => {
    const argv = ['objects', 'search', '--type', assertType(type), '--filter', String(filter || '')];
    if (properties) argv.push('--properties', properties.map((p) => assertType(p)).join(','));
    return argv;
  },
  pipelines: ({ type }) => ['pipelines', 'list', '--type', assertType(type)],
  pipeline_stages: ({ type }) => ['pipelines', 'stages', '--type', assertType(type)],
  owners: () => ['owners', 'list'],
  properties: ({ type }) => ['properties', 'list', '--type', assertType(type)],
  associations: ({ from_type, from_id, to_type }) => [
    'associations', 'list', '--from-type', assertType(from_type), '--from-id', assertId(from_id), '--to-type', assertType(to_type),
  ],
  change: ({ operation, type, id, properties }) => {
    const op = String(operation || '');
    if (!['create', 'update', 'upsert'].includes(op)) throw new Error('operation must be create, update, or upsert');
    const argv = ['objects', op];
    if (op === 'update') argv.push(assertId(id));
    argv.push('--type', assertType(type), ...propsToArgs(properties));
    return argv;
  },
};

function buildArgv(op, input) {
  const builder = Object.hasOwn(ops, op) ? ops[op] : null; // no inherited-key dispatch
  if (!builder) throw Object.assign(new Error(`unknown operation ${String(op).slice(0, 40)}`), { status: 404 });
  return builder(input || {});
}

async function probe(actorEmail) {
  const t0 = Date.now();
  const out = await runArgv({ argv: ['whoami'], actorEmail: actorEmail || 'probe' });
  return { ok: true, ms: Date.now() - t0, sandbox: out.includes('246460341') };
}

module.exports = { configured, runArgv, buildArgv, probe, _internal: { assertSafeArgv, propsToArgs, ops } };

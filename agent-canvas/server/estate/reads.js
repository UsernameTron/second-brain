'use strict';
// Agent Canvas → CTG estate read clients (seo-monitor, ops-automation).
//
// Same shape as enrichment/dispatch.js: thin READ clients with no credential
// of their own, keyless service-to-service identity, named operations only,
// every call audited. They reach two IAM-gated Cloud Run services in the
// estate:
//
//   seo-monitor      GET /metrics/today    - today's CTG SEO health metrics
//   ops-automation   GET /scan/hygiene     - pipeline hygiene scan
//   ops-automation   GET /digest/pipeline  - pipeline digest
//
// Read-only by construction: only GET, only these three fixed paths, and no
// agent-supplied input ever reaches a URL. Free reads - nothing here spends
// credits, so there is no spend ceiling to clamp. Disabled by default: with
// the relevant URL env unset the tool is absent from the offer (the
// gmail-scope precedent) and executeTool refuses.

const { audit } = require('../audit');
const { identityToken } = require('../gcp-identity');

const OUTPUT_CAP = 30_000; // same cap as the ops-runner/enrichment clients

function seoBase() { return (process.env.SEO_MONITOR_URL || '').replace(/\/+$/, ''); }
function opsBase() { return (process.env.OPS_AUTOMATION_URL || '').replace(/\/+$/, ''); }

async function request({ base, envName, path, actorEmail, op }) {
  if (!base) {
    const e = new Error(`Estate read is not configured on this deployment (${envName} unset).`);
    e.notConfigured = true;
    throw e;
  }
  // The audience is the service URL itself, the enrichment default.
  const token = await identityToken(base, { escapeHatchEnv: 'ESTATE_ID_TOKEN' });
  const t0 = Date.now();
  const res = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    // Plain metrics reads, no vendor fan-out - half the enrichment ceiling.
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  audit('user', actorEmail || 'system', 'estate.read', { op, status: res.status, ms: Date.now() - t0 });
  if (!res.ok) {
    const detail = String(data.detail || data.error || JSON.stringify(data)).slice(0, 300);
    throw new Error(`estate read ${res.status}: ${detail}`);
  }
  const text = JSON.stringify(data);
  return text.length > OUTPUT_CAP ? `${text.slice(0, OUTPUT_CAP)}…[truncated]` : text;
}

// ---------- fetchers ----------
function seoMetricsToday(actorEmail) {
  return request({ base: seoBase(), envName: 'SEO_MONITOR_URL', path: '/metrics/today', actorEmail, op: 'estate_seo_metrics' });
}
function opsHygiene(actorEmail) {
  return request({ base: opsBase(), envName: 'OPS_AUTOMATION_URL', path: '/scan/hygiene', actorEmail, op: 'estate_ops_hygiene' });
}
function opsPipelineDigest(actorEmail) {
  return request({ base: opsBase(), envName: 'OPS_AUTOMATION_URL', path: '/digest/pipeline', actorEmail, op: 'estate_pipeline_digest' });
}

// ---------- named operations (the only things agents can invoke) ----------
const ops = {
  estate_seo_metrics: seoMetricsToday,
  estate_ops_hygiene: opsHygiene,
  estate_pipeline_digest: opsPipelineDigest,
};

// Per-tool: the SEO tool needs seo-monitor, the two ops tools need
// ops-automation. A half-configured deployment offers exactly what it can honor.
function configured(op) {
  return op === 'estate_seo_metrics' ? Boolean(seoBase()) : Boolean(opsBase());
}

function run(op, actorEmail) {
  const builder = Object.hasOwn(ops, op) ? ops[op] : null; // no inherited-key dispatch
  if (!builder) throw Object.assign(new Error(`unknown estate operation ${String(op).slice(0, 40)}`), { status: 404 });
  return builder(actorEmail);
}

module.exports = {
  configured, run, seoMetricsToday, opsHygiene, opsPipelineDigest,
  _internal: { ops },
};

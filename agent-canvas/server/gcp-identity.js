'use strict';
// One Google-signed identity token helper for every IAM-gated Cloud Run
// service this canvas calls (ops-runner, MCP bridges, enrichment-dispatch).
//
// Keyless by construction: the token comes from the Cloud Run metadata server,
// so no service-account key is ever minted, stored, or rotated. Cached per
// audience — a token is only valid for the audience it was issued for, so a
// single-slot cache would silently hand the wrong service the wrong token.
//
// This file exists because the third caller was about to become the third
// copy. The escape hatch's env-var name differs per caller (each predates the
// others), so it is a parameter rather than a constant.

const cache = new Map(); // audience -> { token, exp }

async function identityToken(audience, { escapeHatchEnv } = {}) {
  if (escapeHatchEnv && process.env[escapeHatchEnv]) return process.env[escapeHatchEnv]; // dev/test
  if (!audience) throw new Error('identityToken needs an audience');
  const hit = cache.get(audience);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const res = await fetch(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
    { headers: { 'Metadata-Flavor': 'Google' } },
  ).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(`no service identity available for ${audience} — this call needs Cloud Run (or set ${escapeHatchEnv || 'an id-token env var'} for local dev)`);
  }
  const token = await res.text();
  // Metadata tokens live an hour; 45 minutes leaves headroom for a slow call.
  cache.set(audience, { token, exp: Date.now() + 45 * 60_000 });
  return token;
}

function _clearCache() { cache.clear(); }

module.exports = { identityToken, _clearCache };

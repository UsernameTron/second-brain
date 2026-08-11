'use strict';
// Rate limiting via express-rate-limit (in-memory store — fine for the
// single-instance Cloud Run deployment, max-instances=1). Buckets:
//   auth   — sign-in attempts (credential stuffing surface)
//   model  — routes that trigger Anthropic API spend
//   api    — broad safety net across /api
//   static — SPA fallback file serving

const { rateLimit: expressRateLimit } = require('express-rate-limit');

const BUCKETS = {
  auth: { windowMs: 60_000, limit: 10 },
  model: { windowMs: 60_000, limit: 30 },
  api: { windowMs: 60_000, limit: 300 },
  static: { windowMs: 60_000, limit: 120 },
};

const limiters = new Map();

function rateLimit(bucket) {
  if (!limiters.has(bucket)) {
    const config = BUCKETS[bucket] || BUCKETS.api;
    limiters.set(bucket, expressRateLimit({
      windowMs: config.windowMs,
      limit: config.limit,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'rate limit exceeded — slow down' },
    }));
  }
  return limiters.get(bucket);
}

module.exports = { rateLimit };

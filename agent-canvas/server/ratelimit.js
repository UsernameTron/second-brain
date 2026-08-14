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
  // The demo-kickoff route asked for 10/min in its (silently discarded)
  // arguments and got the shared model bucket's 30. Honouring the intent
  // it wrote down, as a bucket, which is the only thing this table reads.
  demo: { windowMs: 60_000, limit: 10 },
  api: { windowMs: 60_000, limit: 300 },
  static: { windowMs: 60_000, limit: 120 },
};

const limiters = new Map();

function rateLimit(bucket) {
  if (!limiters.has(bucket)) {
    const config = Object.hasOwn(BUCKETS, bucket) ? BUCKETS[bucket] : BUCKETS.api; // no inherited-key dispatch
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

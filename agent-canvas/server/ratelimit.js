'use strict';
// Minimal in-memory sliding-window rate limiter (per client IP per bucket).
// Suitable for a single-instance Cloud Run service (max-instances=1).

const windows = new Map(); // `${bucket}:${ip}` -> number[] (timestamps)

function rateLimit(bucket, max, windowMs) {
  return (req, res, next) => {
    const key = `${bucket}:${req.ip || 'unknown'}`;
    const now = Date.now();
    const hits = (windows.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: 'rate limit exceeded — slow down' });
    }
    hits.push(now);
    windows.set(key, hits);
    next();
  };
}

// Periodic sweep so idle keys don't accumulate.
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of windows) {
    const alive = hits.filter((t) => now - t < 300_000);
    if (alive.length === 0) windows.delete(key);
    else windows.set(key, alive);
  }
}, 300_000).unref();

module.exports = { rateLimit };

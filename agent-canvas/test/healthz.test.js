'use strict';
// Liveness must be reachable THROUGH the path prefix production actually
// forwards. Cloud Run's Google Frontend reserves /healthz and answers its own
// 404 before the request reaches the container — proven live 2026-08-16, when
// /api/config returned 200 anonymously while /healthz served Google's error
// page on both hostnames, authenticated or not. So the same handler answers at
// /api/healthz, and it must do so WITHOUT a session: a probe that needs a
// cookie is not a liveness probe.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-healthz-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index');

let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

for (const p of ['/healthz', '/api/healthz']) {
  test(`${p} answers 200 with { ok } and no authentication`, async () => {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.paused, 'boolean');
  });
}

test('the two health paths are the same handler, not two drifting copies', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  assert.match(src, /app\.get\('\/healthz', health\)/);
  assert.match(src, /app\.get\('\/api\/healthz', health\)/);
});

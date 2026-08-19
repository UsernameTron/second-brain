'use strict';
// The MODEL lamp and /api/config must report the models actually serving —
// tierConfig() truth, not the module-level Claude constants (house rule:
// lamps never fake green). Regression test for the pre-Gemini-flip bug where
// MODEL_PROVIDER=gemini still displayed claude-* ids.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-lamp-'));
process.env.DEV_AUTH = '1';
process.env.MODEL_PROVIDER = 'gemini';
process.env.VERTEX_PROJECT_ID = 'test-project';
delete process.env.ANTHROPIC_API_KEY;

const { server } = require('../server/index');

let base;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

test('config models follow tierConfig under MODEL_PROVIDER=gemini', async () => {
  const res = await fetch(`${base}/api/config`);
  const cfg = await res.json();
  assert.match(cfg.models.fast, /^gemini/);
  assert.match(cfg.models.strong, /^gemini/);
});

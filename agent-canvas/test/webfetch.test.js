'use strict';
// web_fetch SSRF guards + HTML-to-text. Network-free: the guards are the
// security boundary and get exercised directly; live fetching is not tested
// here (no external network in CI).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-webfetch-'));
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { assertPublicHttpsUrl, htmlToText, isPrivateAddress, enabled } = require('../server/webfetch');

test('private and reserved addresses are recognized', () => {
  for (const addr of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1']) {
    assert.ok(isPrivateAddress(addr), `${addr} must read as private`);
  }
  for (const addr of ['8.8.8.8', '104.18.0.1', '172.15.0.1', '172.32.0.1', '2607:f8b0::1']) {
    assert.ok(!isPrivateAddress(addr), `${addr} must read as public`);
  }
});

test('non-https, credentialed, and internal-host URLs are refused before any network I/O', async () => {
  await assert.rejects(() => assertPublicHttpsUrl('http://example.com/'), /only https/);
  await assert.rejects(() => assertPublicHttpsUrl('ftp://example.com/'), /only https/);
  await assert.rejects(() => assertPublicHttpsUrl('not a url'), /not a valid URL/);
  await assert.rejects(() => assertPublicHttpsUrl('https://user:pass@example.com/'), /credentials/);
  await assert.rejects(() => assertPublicHttpsUrl('https://localhost/'), /not a public site/);
  await assert.rejects(() => assertPublicHttpsUrl('https://metadata.google.internal/computeMetadata/v1/'), /not a public site/);
  await assert.rejects(() => assertPublicHttpsUrl('https://foo.internal/x'), /not a public site/);
  await assert.rejects(() => assertPublicHttpsUrl('https://printer.local/'), /not a public site/);
});

test('IP-literal URLs are gated by the address check', async () => {
  await assert.rejects(() => assertPublicHttpsUrl('https://127.0.0.1/'), /not public/);
  await assert.rejects(() => assertPublicHttpsUrl('https://169.254.169.254/latest/meta-data/'), /not public/);
  await assert.rejects(() => assertPublicHttpsUrl('https://[::1]/'), /not public/);
  const ok = await assertPublicHttpsUrl('https://8.8.8.8/');
  assert.equal(ok.url.hostname, '8.8.8.8');
  assert.equal(ok.address, '8.8.8.8', 'the validated address is pinned for the connection');
});

test('htmlToText strips markup, scripts, and entities into readable text', () => {
  const text = htmlToText('<html><head><style>p{}</style><script>evil()</script></head>' +
    '<body><h1>CCaaS Migration</h1><p>Plan the cutover &amp; keep service up.</p><!-- note --><ul><li>Step one</li><li>Step two</li></ul></body></html>');
  assert.ok(text.includes('CCaaS Migration'));
  assert.ok(text.includes('Plan the cutover & keep service up.'));
  assert.ok(text.includes('Step one'));
  assert.ok(!text.includes('evil'));
  assert.ok(!text.includes('<'));
});

test('the kill switch reads ENABLE_WEB_FETCH', () => {
  const prev = process.env.ENABLE_WEB_FETCH;
  try {
    delete process.env.ENABLE_WEB_FETCH;
    assert.equal(enabled(), true, 'on by default — the tool needs no config');
    process.env.ENABLE_WEB_FETCH = '0';
    assert.equal(enabled(), false);
  } finally {
    if (prev === undefined) delete process.env.ENABLE_WEB_FETCH; else process.env.ENABLE_WEB_FETCH = prev;
  }
});

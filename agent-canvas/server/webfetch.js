'use strict';
// web_fetch: read one public https page as text. Exists because web_search is
// a search-index tool — a page the index has not crawled (most cloudtechgurus
// posts) is unreachable, and the 2026-08-18 ccaas-migration incident turned
// that gap into five escalations for one article. Read-only, no credentials,
// hard SSRF guards: https only, public addresses only, every redirect hop
// re-validated, bounded size and time.

const dns = require('node:dns').promises;
const net = require('node:net');
const https = require('node:https');

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 2_000_000;
const OUTPUT_CAP = 30_000; // same cap as the ops-runner/enrichment clients
const TEXT_TYPES = /^(text\/(html|plain|markdown)|application\/(xhtml\+xml|json))\b/i;

// Private/reserved ranges an outbound fetch must never reach — including the
// cloud metadata service, the actual prize an SSRF hunts for on Cloud Run.
function isPrivateAddress(addr) {
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || a >= 224;
  }
  const low = addr.toLowerCase();
  return low === '::' || low === '::1' || low.startsWith('fc') || low.startsWith('fd')
    || low.startsWith('fe80') || low.startsWith('::ffff:'); // v4-mapped re-checked as v4 upstream
}

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata']);

// Validate scheme + hostname, resolve DNS, and refuse anything that lands on
// a private or reserved address. Returns { url, address, family } — the
// caller CONNECTS to the validated address (security-review finding #1:
// re-resolving at fetch time reopens the DNS-rebinding TOCTOU this check
// exists to close). Exported for tests.
async function assertPublicHttpsUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl)); } catch { throw new Error(`not a valid URL: ${String(rawUrl).slice(0, 200)}`); }
  if (url.protocol !== 'https:') throw new Error('only https:// URLs can be fetched');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are refused');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error(`host "${host}" is not a public site`);
  }
  const bareHost = host.replace(/^\[|\]$/g, ''); // IPv6 literals arrive bracketed
  if (net.isIP(bareHost)) {
    if (isPrivateAddress(bareHost)) throw new Error(`address "${bareHost}" is not public`);
    return { url, address: bareHost, family: net.isIP(bareHost) };
  }
  let records;
  try { records = await dns.lookup(host, { all: true, verbatim: true }); } catch {
    throw new Error(`host "${host}" does not resolve`);
  }
  for (const r of records) {
    const addr = r.address.replace(/^::ffff:/i, '');
    if (isPrivateAddress(addr)) throw new Error(`host "${host}" resolves to a non-public address`);
  }
  const pick = records[0];
  return { url, address: pick.address, family: pick.family };
}

// Strip a fetched HTML page to readable text — no parser dependency, this is
// context material for a model, not a render.
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

// One GET against the ADDRESS the guard validated — the TLS handshake still
// verifies the certificate against the original hostname via servername/SNI,
// so pinning closes the rebinding window without weakening cert checks.
function getPinned({ url, address, family }, deadlineAt) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: url.hostname,
      servername: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'GET',
      // Pin the connection to the validated address; a rebinding DNS record
      // never gets a second resolution to exploit.
      lookup: (hostname, opts, cb) => (opts && opts.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
      headers: {
        host: url.host,
        'user-agent': 'agent-canvas-webfetch/1.0 (+cloudtechgurus.com)',
        accept: 'text/html, text/plain, application/json;q=0.8',
      },
      timeout: Math.max(1, deadlineAt - Date.now()),
    }, (res) => {
      const status = res.statusCode || 0;
      const headers = res.headers;
      if (status >= 300 && status < 400 && headers.location) {
        res.resume();
        return resolve({ redirect: headers.location });
      }
      if (status < 200 || status >= 300) { res.resume(); return reject(new Error(`fetch failed: HTTP ${status}`)); }
      const contentType = headers['content-type'] || '';
      if (!TEXT_TYPES.test(contentType)) { res.resume(); return reject(new Error(`unsupported content type: ${contentType.slice(0, 100) || 'unknown'} — only text pages can be fetched`)); }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) { req.destroy(new Error(`page exceeds the ${MAX_BYTES / 1_000_000}MB fetch limit`)); }
        else chunks.push(chunk);
      });
      res.on('end', () => resolve({ contentType, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('fetch timed out')));
    req.on('error', reject);
    req.end();
  });
}

// Fetch one page, following at most MAX_REDIRECTS hops, re-validating AND
// re-pinning every hop against the public-address guard.
// Returns { url, contentType, text }.
async function fetchUrl(rawUrl) {
  let target = await assertPublicHttpsUrl(rawUrl);
  const deadlineAt = Date.now() + TIMEOUT_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (Date.now() >= deadlineAt) throw new Error('fetch timed out');
    const res = await getPinned(target, deadlineAt);
    if (res.redirect) {
      if (hop === MAX_REDIRECTS) throw new Error('too many redirects');
      target = await assertPublicHttpsUrl(new URL(res.redirect, target.url).href);
      continue;
    }
    const text = /html/i.test(res.contentType) ? htmlToText(res.body) : res.body;
    return {
      url: target.url.href,
      contentType: res.contentType,
      text: text.length > OUTPUT_CAP ? `${text.slice(0, OUTPUT_CAP)}…[truncated]` : text,
    };
  }
  throw new Error('too many redirects');
}

function enabled() {
  return process.env.ENABLE_WEB_FETCH !== '0';
}

module.exports = { fetchUrl, assertPublicHttpsUrl, htmlToText, isPrivateAddress, enabled, OUTPUT_CAP };

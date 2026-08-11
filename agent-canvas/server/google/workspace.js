'use strict';
// Google Workspace integration — the agents' hands, with the guardrails as code.
//
// Design contract (owner-set, 2026-08-11):
//   READ broadly. WRITE reasonably. DESTROY never.
//
// How that is enforced, in layers:
//   1. Identity: agents act AS THE PERSON WHO DIRECTED THE RUN, via that
//      user's own OAuth grant (per-user refresh token, encrypted at rest).
//      There is no service-account key and no domain-wide delegation; an
//      agent can never see or touch anything its human couldn't.
//   2. Scopes: only the six scopes in SCOPES are ever requested. There is no
//      gmail.send, no drive (full), no admin scope. A compromised prompt
//      cannot use a permission the token does not carry.
//   3. Surface: this module exposes ONLY named, non-destructive operations.
//      There is no generic "call Google API" passthrough, no delete function,
//      no update-in-place of mail or events, and no send. What is absent
//      cannot be invoked.
//   4. Audit: every call lands in the hash-chained audit log with the acting
//      user, the operation, and the target.
//
// The CAPABILITIES table below is the single source of truth for both the
// tool layer and the UI capability matrix — what users see is what the code
// enforces, generated from the same object.

const crypto = require('node:crypto');
const { db, nowIso } = require('../db');
const { audit } = require('../audit');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',      // read files & docs
  'https://www.googleapis.com/auth/drive.file',          // create/manage only files the app creates
  'https://www.googleapis.com/auth/spreadsheets',        // read + edit sheet cells
  'https://www.googleapis.com/auth/gmail.readonly',      // read mail
  'https://www.googleapis.com/auth/gmail.compose',       // create DRAFTS — sending is not granted
  'https://www.googleapis.com/auth/calendar.events',     // read + create events (module never updates/deletes)
];

// What the workspace can and cannot do — rendered verbatim in the UI.
const CAPABILITIES = [
  {
    surface: 'Gmail', icon: 'mail',
    can: [
      { id: 'gmail_search', label: 'Search and read mail', detail: 'Full-text search of the connected user\'s mailbox; reads message bodies for context.' },
      { id: 'gmail_draft', label: 'Write drafts', detail: 'Drafts land in the user\'s Drafts folder for review. A human always presses Send.' },
    ],
    cannot: [
      { label: 'Send email', detail: 'The send permission is never requested from Google. Not disabled — absent.' },
      { label: 'Delete or archive mail', detail: 'No delete operation exists in the integration.' },
    ],
  },
  {
    surface: 'Drive & Docs', icon: 'folder',
    can: [
      { id: 'drive_search', label: 'Search Drive', detail: 'Find files by name/content the connected user can see.' },
      { id: 'drive_read', label: 'Read documents', detail: 'Reads Docs, text files and CSVs (size-capped) for context.' },
      { id: 'docs_create', label: 'Create new documents', detail: 'Can create fresh Docs (briefs, summaries). Cannot modify existing files it did not create.' },
    ],
    cannot: [
      { label: 'Delete, move or share files', detail: 'No delete/move/share operation exists in the integration.' },
      { label: 'Edit existing documents', detail: 'Existing files are read-only to agents; corrections go through change sets a human reviews.' },
    ],
  },
  {
    surface: 'Sheets', icon: 'grid',
    can: [
      { id: 'sheets_read', label: 'Read spreadsheets', detail: 'Reads cell ranges from any sheet the connected user can open.' },
      { id: 'sheets_append', label: 'Append rows', detail: 'Adds new rows at the bottom — never overwrites existing data.' },
      { id: 'sheets_update', label: 'Update cells', detail: 'Writes specific values to specific cells. Blank-out/clear operations are rejected server-side.' },
    ],
    cannot: [
      { label: 'Delete rows, sheets or files', detail: 'No delete operation exists in the integration.' },
      { label: 'Clear ranges', detail: 'Writes that would blank existing cells are refused.' },
    ],
  },
  {
    surface: 'Calendar', icon: 'calendar',
    can: [
      { id: 'calendar_list', label: 'Read calendars', detail: 'Sees the connected user\'s events for scheduling context.' },
      { id: 'calendar_create', label: 'Create events', detail: 'Can propose and create new events with attendees.' },
    ],
    cannot: [
      { label: 'Modify or cancel existing events', detail: 'No update/delete operation exists in the integration.' },
    ],
  },
  {
    surface: 'Everything else', icon: 'shield',
    can: [],
    cannot: [
      { label: 'Make calls, send texts, or contact anyone directly', detail: 'Agents produce drafts and plans for humans to act on. They never speak for you.' },
      { label: 'Spend money or sign anything', detail: 'No payment, procurement or e-signature surface is connected.' },
      { label: 'Act as anyone but you', detail: 'Every action uses the directing user\'s own Google permissions — an agent can never see more than its human can.' },
      { label: 'Exceed the run budget', detail: 'Step limits, wall clocks, and the daily spend cap apply to every workspace action like any other.' },
    ],
  },
];

// ---------- token storage (AES-256-GCM, key derived from JWT_SECRET) ----------
function encKey() {
  const secret = process.env.JWT_SECRET || db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get()?.value || '';
  if (!secret) throw new Error('no secret material available for token encryption');
  return crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), Buffer.from('google-token-enc-v1'), 32);
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}
function decrypt(blob) {
  const [iv, tag, ct] = String(blob).split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

function oauthReady() { return Boolean(CLIENT_ID && CLIENT_SECRET); }
function isConnected(email) {
  return Boolean(db.prepare('SELECT 1 FROM google_tokens WHERE user_email = ?').get(String(email || '').toLowerCase()));
}

function buildAuthUrl({ state, redirectUri }) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `openid email ${SCOPES.join(' ')}`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function exchangeCode({ code, redirectUri, email }) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.refresh_token) {
    throw new Error(`Google token exchange failed: ${data.error_description || data.error || res.status}`);
  }
  const ts = nowIso();
  db.prepare(`INSERT INTO google_tokens (user_email, refresh_token_enc, scopes, connected_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(user_email) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc,
                scopes = excluded.scopes, updated_at = excluded.updated_at`)
    .run(email, encrypt(data.refresh_token), data.scope || SCOPES.join(' '), ts, ts);
  audit('user', email, 'workspace.connect', { scopes: (data.scope || '').split(' ').length });
  return { ok: true };
}

function disconnect(email) {
  db.prepare('DELETE FROM google_tokens WHERE user_email = ?').run(email);
  audit('user', email, 'workspace.disconnect', {});
}

const accessCache = new Map(); // email -> { token, expiresAt }
async function accessTokenFor(email) {
  const key = String(email || '').toLowerCase();
  const cached = accessCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const row = db.prepare('SELECT refresh_token_enc FROM google_tokens WHERE user_email = ?').get(key);
  if (!row) {
    const err = new Error(`Google Workspace is not connected for ${key}. They can connect it from the Capabilities panel (top bar).`);
    err.notConnected = true;
    throw err;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: decrypt(row.refresh_token_enc),
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant') db.prepare('DELETE FROM google_tokens WHERE user_email = ?').run(key);
    throw new Error(`Google token refresh failed for ${key}: ${data.error_description || data.error || res.status}`);
  }
  accessCache.set(key, { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

// ---------- REST helpers ----------
const TEXT_CAP = 60_000; // chars of document/mail body handed to a model

async function gcall(email, url, { method = 'GET', body, headers = {} } = {}) {
  const token = await accessTokenFor(email);
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    throw new Error(`Google API error: ${msg}`);
  }
  return data;
}

// --- Sheets ---
async function sheetsRead({ email, spreadsheetId, range }) {
  const d = await gcall(email, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
  audit('user', email, 'workspace.sheets_read', { spreadsheetId, range });
  return { range: d.range, values: d.values || [] };
}
async function sheetsAppend({ email, spreadsheetId, range, values }) {
  assertValues(values);
  const d = await gcall(email,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: { values } });
  audit('user', email, 'workspace.sheets_append', { spreadsheetId, range, rows: values.length });
  return { updatedRange: d.updates?.updatedRange, updatedRows: d.updates?.updatedRows };
}
async function sheetsUpdate({ email, spreadsheetId, range, values }) {
  assertValues(values);
  const d = await gcall(email,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: { values } });
  audit('user', email, 'workspace.sheets_update', { spreadsheetId, range, cells: d.updatedCells || 0 });
  return { updatedRange: d.updatedRange, updatedCells: d.updatedCells };
}
function assertValues(values) {
  // DESTROY never: a write whose payload is entirely empty strings/nulls is a
  // disguised clear. Refuse it here, below the tool layer, so no prompt can
  // reach a blanking write.
  if (!Array.isArray(values) || values.length === 0) throw new Error('values must be a non-empty 2D array');
  const flat = values.flat();
  if (flat.length === 0 || flat.every((v) => v === null || v === undefined || String(v).trim() === '')) {
    throw new Error('refused: this write would only blank cells (destructive writes are not permitted)');
  }
}

// --- Drive / Docs ---
// Drive query strings escape with backslash, so backslashes must be escaped
// FIRST, then quotes — quote-only escaping lets an input ending in \ turn the
// added escape into a literal and break out of the string (CodeQL js/incomplete-sanitization).
function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
async function driveSearch({ email, query, limit = 10 }) {
  const escaped = escapeDriveQuery(query);
  const q = `fullText contains '${escaped}' or name contains '${escaped}'`;
  const d = await gcall(email, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q + ' and trashed = false')}&pageSize=${Math.min(limit, 25)}&fields=files(id,name,mimeType,modifiedTime,owners(displayName),webViewLink)`);
  audit('user', email, 'workspace.drive_search', { query });
  return (d.files || []).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, modified: f.modifiedTime, link: f.webViewLink }));
}
async function driveReadText({ email, fileId }) {
  const meta = await gcall(email, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`);
  const token = await accessTokenFor(email);
  let url;
  if (meta.mimeType === 'application/vnd.google-apps.document') url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`;
  else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/csv`;
  else if ((meta.mimeType || '').startsWith('text/') || meta.mimeType === 'application/json' || meta.mimeType === 'text/csv') url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  else throw new Error(`unsupported file type for text read: ${meta.mimeType}`);
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google API error: HTTP ${res.status}`);
  const text = (await res.text()).slice(0, TEXT_CAP);
  audit('user', email, 'workspace.drive_read', { fileId, name: meta.name });
  return { id: meta.id, name: meta.name, mimeType: meta.mimeType, text };
}
async function docsCreate({ email, title, text }) {
  const boundary = 'ac' + crypto.randomBytes(8).toString('hex');
  const token = await accessTokenFor(email);
  const body = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '',
    JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.document' }),
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', '',
    String(text || ''), `--${boundary}--`, '',
  ].join('\r\n');
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google API error: ${data.error?.message || res.status}`);
  audit('user', email, 'workspace.docs_create', { title, fileId: data.id });
  return { id: data.id, name: data.name, link: data.webViewLink };
}

// --- Gmail ---
async function gmailSearch({ email, query, limit = 10 }) {
  const d = await gcall(email, `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(limit, 20)}`);
  const out = [];
  for (const m of d.messages || []) {
    const msg = await gcall(email, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
    const h = Object.fromEntries((msg.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
    out.push({ id: m.id, subject: h.subject || '', from: h.from || '', date: h.date || '', snippet: msg.snippet || '' });
  }
  audit('user', email, 'workspace.gmail_search', { query, results: out.length });
  return out;
}
function decodeB64Url(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
function extractBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeB64Url(payload.body.data);
  for (const part of payload.parts || []) { const t = extractBody(part); if (t) return t; }
  if (payload.body?.data) return decodeB64Url(payload.body.data);
  return '';
}
async function gmailRead({ email, messageId }) {
  const msg = await gcall(email, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`);
  const h = Object.fromEntries((msg.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
  audit('user', email, 'workspace.gmail_read', { messageId });
  return { id: msg.id, subject: h.subject || '', from: h.from || '', to: h.to || '', date: h.date || '', body: extractBody(msg.payload).slice(0, TEXT_CAP) };
}
async function gmailCreateDraft({ email, to, subject, body }) {
  // DRAFT ONLY. There is deliberately no function in this module that calls
  // messages.send or drafts.send — a human presses Send from their own inbox.
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const d = await gcall(email, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', { method: 'POST', body: { message: { raw } } });
  audit('user', email, 'workspace.gmail_draft', { to, subject, draftId: d.id });
  return { draftId: d.id, note: 'Draft created in the user\'s Drafts folder — a human reviews and sends it.' };
}

// --- Calendar ---
async function calendarList({ email, timeMin, timeMax, limit = 15 }) {
  const p = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: String(Math.min(limit, 30)) });
  if (timeMin) p.set('timeMin', timeMin);
  if (timeMax) p.set('timeMax', timeMax);
  const d = await gcall(email, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`);
  audit('user', email, 'workspace.calendar_list', {});
  return (d.items || []).map((e) => ({ id: e.id, summary: e.summary, start: e.start, end: e.end, attendees: (e.attendees || []).map((a) => a.email), link: e.htmlLink }));
}
async function calendarCreate({ email, summary, description, startIso, endIso, attendees = [] }) {
  const d = await gcall(email, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    body: {
      summary, description,
      start: { dateTime: startIso }, end: { dateTime: endIso },
      attendees: attendees.map((a) => ({ email: a })),
    },
  });
  audit('user', email, 'workspace.calendar_create', { summary, eventId: d.id });
  return { id: d.id, link: d.htmlLink, note: 'Event created. Agents cannot modify or cancel events — changes are up to humans.' };
}

// Cheap, read-only liveness probes per surface — used by the systems board.
// Each hits the lightest authenticated endpoint the surface offers.
const PROBES = {
  gmail: (email) => gcall(email, 'https://gmail.googleapis.com/gmail/v1/users/me/profile'),
  drive: (email) => gcall(email, 'https://www.googleapis.com/drive/v3/about?fields=user'),
  calendar: (email) => gcall(email, 'https://www.googleapis.com/calendar/v3/users/me/calendarList/primary'),
  // Sheets has no ping endpoint; the Drive probe exercises the same token path.
  sheets: (email) => gcall(email, 'https://www.googleapis.com/drive/v3/about?fields=user'),
};
async function probeSurface(email, surface) {
  // Own-property lookup only: a bare PROBES[surface] with a user-controlled
  // key resolves inherited members too — surface="constructor" yields Object,
  // passes a truthiness check, and dispatches Object(email)
  // (CodeQL js/unvalidated-dynamic-method-call).
  const probe = Object.hasOwn(PROBES, surface) ? PROBES[surface] : null;
  if (!probe) throw Object.assign(new Error(`no probe for surface ${String(surface).slice(0, 40)}`), { status: 404 });
  const t0 = Date.now();
  await probe(email);
  const ms = Date.now() - t0;
  audit('user', email, 'workspace.probe', { surface, ms });
  return { ok: true, ms };
}

module.exports = {
  SCOPES, CAPABILITIES, oauthReady, isConnected, buildAuthUrl, exchangeCode, disconnect,
  probeSurface,
  sheetsRead, sheetsAppend, sheetsUpdate, driveSearch, driveReadText, docsCreate,
  gmailSearch, gmailRead, gmailCreateDraft, calendarList, calendarCreate,
  _internal: { encrypt, decrypt, assertValues, accessTokenFor },
};

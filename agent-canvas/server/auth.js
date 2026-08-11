'use strict';
// Google sign-in restricted to the cloudtechgurus.com Workspace domain, plus a
// server-side allowlist the owner edits in the app. Both checks run on every
// sign-in AND on every request (the allowlist is re-checked per request, so
// removing someone locks them out immediately, not at token expiry).
//
// DEV_AUTH=1 enables a development-only sign-in path used for local
// verification and browser tests. It never runs unless the env var is set,
// it still enforces the allowlist, and the Dockerfile does not set it.

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { db, nowIso, getSetting, setSetting } = require('./db');
const { audit } = require('./audit');

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'cloudtechgurus.com';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DEV_AUTH = process.env.DEV_AUTH === '1';
const COOKIE_NAME = 'ac_session';
const SESSION_TTL = '7d';

// JWT secret: env-provided in production; generated and persisted otherwise so
// dev restarts don't invalidate sessions.
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = getSetting('jwt_secret');
  if (!JWT_SECRET) {
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    setSetting('jwt_secret', JWT_SECRET);
  }
}

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function allowlistEntry(email) {
  return db.prepare('SELECT * FROM allowlist WHERE email = ?').get(String(email || '').toLowerCase());
}

function upsertUser({ email, name, picture, role }) {
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ts = nowIso();
  if (existing) {
    db.prepare('UPDATE users SET name = COALESCE(?, name), picture = COALESCE(?, picture), role = ?, last_login_at = ? WHERE id = ?')
      .run(name || null, picture || null, role, ts, existing.id);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, email, name, picture, role, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, email, name || '', picture || '', role, ts, ts);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function issueSession(res, user) {
  const token = jwt.sign({ uid: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: SESSION_TTL });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax${secure}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function tokenFromReq(req) {
  return parseCookies(req)[COOKIE_NAME] || null;
}

// Verifies a Google ID token: signature against Google's JWKS (via
// google-auth-library), audience = our OAuth client, email verified, hosted
// domain = cloudtechgurus.com, and email present on the allowlist.
async function signInWithGoogle(credential) {
  if (!googleClient) throw httpError(503, 'Google sign-in is not configured on this deployment (GOOGLE_CLIENT_ID unset)');
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch (err) {
    audit('system', 'auth', 'auth.google_verify_failed', { error: String(err.message || err) });
    throw httpError(401, 'Google token verification failed');
  }
  const email = String(payload.email || '').toLowerCase();
  if (!payload.email_verified) throw denied(email, 'email not verified');
  if (payload.hd !== ALLOWED_DOMAIN) throw denied(email, `not a ${ALLOWED_DOMAIN} account`);
  const entry = allowlistEntry(email);
  if (!entry) throw denied(email, 'not on the workspace allowlist');
  const user = upsertUser({ email, name: payload.name, picture: payload.picture, role: entry.role });
  audit('user', email, 'auth.sign_in', { method: 'google' });
  return user;
}

function signInDev(email) {
  if (!DEV_AUTH) throw httpError(403, 'dev auth is disabled');
  const normalized = String(email || '').toLowerCase();
  const entry = allowlistEntry(normalized);
  if (!entry) throw denied(normalized, 'not on the workspace allowlist');
  const user = upsertUser({ email: normalized, name: entry.display_name || normalized.split('@')[0], role: entry.role });
  audit('user', normalized, 'auth.sign_in', { method: 'dev' });
  return user;
}

function denied(email, reason) {
  audit('system', 'auth', 'auth.denied', { email, reason });
  return httpError(403, `Access denied: ${reason}`);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function verifySessionToken(token) {
  const claims = jwt.verify(token, JWT_SECRET); // throws on bad/expired token
  const entry = allowlistEntry(claims.email);
  if (!entry) throw httpError(403, 'no longer on the workspace allowlist');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(claims.uid);
  if (!user) throw httpError(401, 'unknown session user');
  return { ...user, role: entry.role }; // role always reflects the current allowlist
}

function requireAuth(req, res, next) {
  const token = tokenFromReq(req);
  if (!token) return res.status(401).json({ error: 'not signed in' });
  try {
    req.user = verifySessionToken(token);
    next();
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message || 'invalid session' });
  }
}

function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ error: 'owner only' });
  next();
}

// Server-side per-canvas access check (never trusts the client).
function canAccessCanvas(user, canvasId) {
  const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
  if (!canvas) return { ok: false, status: 404, error: 'canvas not found' };
  if (user.role === 'owner') return { ok: true, canvas };
  if (canvas.access_mode === 'workspace') return { ok: true, canvas };
  const member = db.prepare('SELECT * FROM canvas_members WHERE canvas_id = ? AND user_email = ?').get(canvasId, user.email);
  if (!member) return { ok: false, status: 403, error: 'no access to this canvas' };
  return { ok: true, canvas, access: member.access };
}

function requireCanvas(req, res, next) {
  const check = canAccessCanvas(req.user, req.params.canvasId);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  req.canvas = check.canvas;
  next();
}

module.exports = {
  ALLOWED_DOMAIN, GOOGLE_CLIENT_ID, DEV_AUTH,
  signInWithGoogle, signInDev, issueSession, clearSession, tokenFromReq, verifySessionToken,
  requireAuth, requireOwner, requireCanvas, canAccessCanvas, allowlistEntry, httpError,
};

'use strict';
// Deterministic content-policy gate for the content lane. Pure — no I/O, no
// spend, no egress. Ports the three sibling gates that independently converged
// on the same design: ctg-content-engine's content_linter/policy_gate (banned
// vocabulary), and gtm-briefs' messaging.py (retired stats, dash rule). A
// model's own "no banned vocab" is an unverifiable green lamp; this check is
// mechanical, and its output is workspace-owned data, not external content.
//
// The registry's claim_patterns are prose descriptions of prohibited claim
// SHAPES (for Quill and reviewers to read), not mechanically matchable — the
// gate enforces only the four mechanical families below.
//
// Committed asset — a missing or corrupt registry fails the boot loudly, the
// same posture as roster.js's ICP require.
const POLICY = require('../config/content-policy-v1.json');

const rule = (id) => {
  const row = POLICY.rules.find((r) => r.id === id);
  if (!row) throw new Error(`content-policy-v1.json is missing required rule "${id}"`);
  return row.value;
};

const BANNED = rule('banned-terms');
const RETIRED = rule('retired-stats').map((r) => ({ ...r, re: new RegExp(r.pattern, r.flags || 'i') }));
const WATCHLIST = rule('neutrality-watchlist');
const DASH = rule('dash-rule');

// Literal terms and names become word-boundary matchers; escape everything so
// a registry row can never inject regex syntax.
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BANNED_RES = BANNED.terms.map((term) => ({ term, re: new RegExp(`\\b${escapeRe(term)}\\b`, 'i') }));
const NAME_RES = [
  ...WATCHLIST.vendors.map((name) => ({ name, kind: 'vendor' })),
  ...WATCHLIST.peer_tsds.map((name) => ({ name, kind: 'peer_tsd' })),
].map((row) => ({ ...row, re: new RegExp(`\\b${escapeRe(row.name)}\\b`, 'i') }));
const DASH_RE = /[—–]/;

const excerpt = (text, index) => {
  const start = Math.max(0, index - 30);
  return `${start > 0 ? '…' : ''}${text.slice(start, index + 30)}${index + 30 < text.length ? '…' : ''}`;
};

// -> { clean, surface, violations: [{ rule, id, excerpt, note? }] }
function contentGateCheck(text, surface = 'other') {
  const body = String(text || '');
  const where = ['linkedin', 'article', 'email', 'other'].includes(surface) ? surface : 'other';
  const violations = [];

  for (const { term, re } of BANNED_RES) {
    const hit = re.exec(body);
    if (hit) violations.push({ rule: 'banned_term', id: term, excerpt: excerpt(body, hit.index) });
  }
  for (const { re, rationale, canonical } of RETIRED) {
    const hit = re.exec(body);
    if (hit) violations.push({ rule: 'retired_stat', id: rationale, excerpt: excerpt(body, hit.index), note: `canonical figure: ${canonical}` });
  }
  for (const { name, kind, re } of NAME_RES) {
    const hit = re.exec(body);
    if (hit) {
      violations.push({
        rule: 'never_name', id: name, excerpt: excerpt(body, hit.index),
        note: kind === 'peer_tsd'
          ? 'peer TSDs are never named in outbound content'
          : 'presence detected, endorsement is not — a constraint-statement use may be legitimate; a human or the review agent judges it',
      });
    }
  }
  if (!DASH.allowed_surfaces.includes(where)) {
    const hit = DASH_RE.exec(body);
    if (hit) violations.push({ rule: 'dash', id: 'em/en dash', excerpt: excerpt(body, hit.index), note: DASH.replacement });
  }

  return { clean: violations.length === 0, surface: where, violations };
}

module.exports = { contentGateCheck };

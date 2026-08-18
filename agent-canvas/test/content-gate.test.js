'use strict';
// The deterministic content gate: four mechanical families ported from the
// three sibling gates that independently converged on this design
// (content_linter/policy_gate in the content engine, messaging.py in
// gtm-briefs). Model self-review is not a gate; this is.

const test = require('node:test');
const assert = require('node:assert');

const { contentGateCheck } = require('../server/orchestrator/content-gate');
const POLICY = require('../server/config/content-policy-v1.json');
// The hard-excluded names live in data, never in a test literal — same rule
// registries.test.js follows.
const { EXCLUDED_VENDORS } = require('../scripts/build-registries')._internal;
const EXCLUDED_RE = new RegExp(`\\b(${EXCLUDED_VENDORS.join('|')})\\b`, 'i');

const value = (id) => POLICY.rules.find((r) => r.id === id).value;

test('required rule rows exist with the shapes the gate compiles', () => {
  const banned = value('banned-terms');
  assert.ok(Array.isArray(banned.terms) && banned.terms.length >= 30, 'banned terms populated');
  const retired = value('retired-stats');
  assert.equal(retired.length, 3, 'exactly the three messaging.py patterns');
  for (const row of retired) new RegExp(row.pattern, row.flags); // must compile as JS regexes
  const watchlist = value('neutrality-watchlist');
  assert.ok(watchlist.vendors.length >= 40, 'vendor watchlist populated');
  assert.deepEqual(watchlist.peer_tsds, ['Telarus', 'Avant', 'Intelisys']);
  assert.ok(watchlist.vendors.some((v) => EXCLUDED_RE.test(v)),
    'the hard-excluded names ride as blocklist data — presence here is the fence, not a leak');
});

test('clean copy passes on every surface', () => {
  const text = 'Your queue already tells the story. Ask the team what changed this quarter, then decide.';
  for (const surface of ['linkedin', 'article', 'email', 'other']) {
    const out = contentGateCheck(text, surface);
    assert.equal(out.clean, true, `${surface}: ${JSON.stringify(out.violations)}`);
    assert.deepEqual(out.violations, []);
  }
});

test('banned terms hit case-insensitively with excerpts', () => {
  const term = value('banned-terms').terms[0];
  const out = contentGateCheck(`This is ${term.toUpperCase()} in action.`, 'article');
  assert.equal(out.clean, false);
  const hit = out.violations.find((v) => v.rule === 'banned_term');
  assert.equal(hit.id, term);
  assert.ok(hit.excerpt.length > 0, 'violation carries an excerpt');
});

test('retired stats block; nearby real numbers never false-positive', () => {
  // The messaging.py edge cases, ported with the lookbehind intact.
  for (const bad of [
    'We spent 3,000+ hours evaluating.',
    'Over 3000 hours of research.',
    'our 125 Gurus network',
    'across 50 solution categories',
    'across 50 categories',
  ]) {
    const out = contentGateCheck(bad, 'linkedin');
    assert.equal(out.clean, false, bad);
    assert.equal(out.violations[0].rule, 'retired_stat', bad);
  }
  for (const fine of [
    '150 categories of spend',
    '1,125 gurus attended',
    '4,000+ hours of evaluation',
    'the 120+ Gurus network',
  ]) {
    assert.equal(contentGateCheck(fine, 'linkedin').clean, true, fine);
  }
});

test('em/en dashes: violation for article and email, permitted on LinkedIn', () => {
  const text = 'The queue is the tell — ask it first.';
  assert.equal(contentGateCheck(text, 'linkedin').clean, true, 'LinkedIn allows the dash');
  for (const surface of ['article', 'email', 'other']) {
    const out = contentGateCheck(text, surface);
    assert.equal(out.clean, false, surface);
    const hit = out.violations.find((v) => v.rule === 'dash');
    assert.ok(hit, `${surface} flags the dash`);
    assert.match(hit.note, /commas/);
  }
});

test('watchlist vendors and peer TSDs flag with judgment notes, not silent deletion orders', () => {
  const vendor = value('neutrality-watchlist').vendors.find((v) => !EXCLUDED_RE.test(v));
  const out = contentGateCheck(`We recommend ${vendor} for this migration.`, 'article');
  const hit = out.violations.find((v) => v.rule === 'never_name');
  assert.ok(hit, 'vendor name detected');
  assert.equal(hit.id, vendor);
  assert.match(hit.note, /constraint-statement|judges/i, 'presence is detectable; endorsement is judged');

  const peers = contentGateCheck('Unlike Telarus, we disclose the economics.', 'linkedin');
  const peerHit = peers.violations.find((v) => v.rule === 'never_name');
  assert.ok(peerHit, 'peer TSD detected');
  assert.equal(peerHit.id, 'Telarus');
  assert.match(peerHit.note, /never named/i);
});

test('empty and unknown-surface input degrade safely', () => {
  assert.deepEqual(contentGateCheck('', 'linkedin'), { clean: true, surface: 'linkedin', violations: [] });
  const out = contentGateCheck('Plain clean text.', 'carrier-pigeon');
  assert.equal(out.surface, 'other', 'unknown surface falls back to the conservative default');
});

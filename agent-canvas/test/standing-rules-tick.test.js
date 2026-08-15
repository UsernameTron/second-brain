'use strict';
// P5 T3: the tick — OIDC/owner auth surface on the pre-auth route, flag gate,
// claim/lease, dispatch (ask mode, system trigger, initiatedBy = grantor),
// finalize (MATCHED parsing, evidence refs), duplicate-occurrence no-op,
// authorization enforcement at dispatch, lease-expiry retry → max attempts →
// failed + alert, and the workspace-disconnected skip.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-srtick-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test';
delete process.env.TICK_AUDIENCE;
delete process.env.TICK_INVOKER_SA;

const { server } = require('../server/index');
const { db, nowIso, setSetting } = require('../server/db');
const runner = require('../server/orchestrator/runner');
const control = require('../server/orchestrator/control');
const { toolsForRole, MUTATING_TOOLS } = require('../server/orchestrator/tools');
const standingRules = require('../server/standing-rules');

// Scheduled runs go through the real run loop — stub its model.
runner._internal.setCallModel(async () => ({
  content: [{ type: 'text', text: 'Checked everything the rule watches. Two items need attention. MATCHED: 2' }],
  stop_reason: 'end_turn', usage: {},
}));

const OWNER = 'pete@cloudtechgurus.com';
const MEMBER = 'darren@cloudtechgurus.com';
const TICK_SA = 'standing-rules-tick@proj.iam.gserviceaccount.com';

let base;
let ownerCookie;
let memberCookie;
let canvasId;
let agentId;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

async function tickHttp({ cookie, bearer } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${base}/api/standing-rules/tick`, { method: 'POST', headers });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function waitForRun(runId, tries = 100) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
      if (run && !['queued', 'running'].includes(run.status)) return resolve(run);
      if (--tries <= 0) return reject(new Error('run never finished'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

const PAST = () => new Date(Date.now() - 3_600_000).toISOString();
const FUTURE = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

// An active, due rule with a live authorization — the tick's normal input.
function mkActiveRule({ sources = ['hubspot', 'memory'], outputType = 'alert', authorizedBy = OWNER, due = PAST(), expiresAt = FUTURE() } = {}) {
  const interp = standingRules.validateInterpretation({
    summary: 'Watch things and alert.', sources, scope: 'the watched things',
    category: 'watch', output_type: outputType, cadence: 'daily', cadence_hour: 8,
    agent_id: agentId, step_budget: 8, wall_ms_budget: 120000, expires_days: 30,
    can: ['read'], cannot: ['write'],
  }, { agents: [{ id: agentId }] });
  const draft = standingRules.upsertDraft({ canvasId, instruction: 'watch the things', interp, actor: OWNER });
  db.prepare("UPDATE standing_rules SET state = 'active', expires_at = ?, next_run_at = ? WHERE id = ?")
    .run(expiresAt, due, draft.id);
  const rule = standingRules.getRule(draft.id);
  const authz = standingRules.createAuthorization({ rule, authorizedBy, expiresAt });
  return { rule, authz };
}

function ruleRuns(ruleId) {
  return db.prepare('SELECT * FROM standing_rule_runs WHERE rule_id = ? ORDER BY created_at').all(ruleId);
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ownerCookie = await signIn(OWNER);
  const created = await fetch(`${base}/api/canvases`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ownerCookie }, body: JSON.stringify({ name: 'Tick T3' }),
  });
  canvasId = (await created.json()).canvas.id;
  agentId = 'agent-srtick-1';
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)")
    .run(agentId, canvasId, nowIso());
  await fetch(`${base}/api/allowlist`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ownerCookie }, body: JSON.stringify({ email: MEMBER, role: 'member' }),
  });
  memberCookie = await signIn(MEMBER);
});

test.after(() => new Promise((resolve) => server.close(resolve)));

// ---------- tick route auth surface ----------

// NOTE: the tick route shares the scarce 'auth' rate bucket (10/min) with
// dev sign-in — keep the HTTP tick calls in this file to the auth-surface
// minimum and drive behavior tests through the service directly.
test('OIDC lane disabled (503) while TICK env vars are unset; sessions still gate', async () => {
  assert.equal((await tickHttp()).status, 503);
  // A signed-in member is refused, never falls through to the OIDC lane.
  assert.equal((await tickHttp({ cookie: memberCookie })).status, 403);
});

test('OIDC lane: missing token 401, bad token 401, wrong SA 403, unverified email 403, right SA 200', async () => {
  process.env.TICK_AUDIENCE = `${base}/api/standing-rules/tick`;
  process.env.TICK_INVOKER_SA = TICK_SA;

  assert.equal((await tickHttp()).status, 401, 'no bearer token');

  let restore = standingRules._internal.setTickVerifier(async () => { throw new Error('invalid signature'); });
  try { assert.equal((await tickHttp({ bearer: 'garbage' })).status, 401); } finally { restore(); }

  restore = standingRules._internal.setTickVerifier(async () => ({ email: 'evil@attacker.com', email_verified: true }));
  try { assert.equal((await tickHttp({ bearer: 'signed-but-wrong-sa' })).status, 403); } finally { restore(); }

  restore = standingRules._internal.setTickVerifier(async () => ({ email: TICK_SA, email_verified: false }));
  try { assert.equal((await tickHttp({ bearer: 'unverified' })).status, 403); } finally { restore(); }

  restore = standingRules._internal.setTickVerifier(async (idToken, audience) => {
    assert.equal(audience, process.env.TICK_AUDIENCE, 'verifies against TICK_AUDIENCE');
    return { email: TICK_SA, email_verified: true };
  });
  try {
    const ok = await tickHttp({ bearer: 'valid-oidc' });
    assert.equal(ok.status, 200);
    assert.ok('due' in ok.data || 'skipped' in ok.data);
  } finally { restore(); }
});

test('owner session tick works with no OIDC token', async () => {
  const res = await tickHttp({ cookie: ownerCookie });
  assert.equal(res.status, 200);
});

// ---------- flag gate ----------

test('flag off: the tick no-ops before touching any rule', () => {
  const { rule } = mkActiveRule();
  setSetting('standing_rules', '0');
  try {
    const res = standingRules.tick({ source: 'owner', actor: OWNER });
    assert.equal(res.skipped, 'flag off');
    assert.equal(ruleRuns(rule.id).length, 0, 'no occurrence claimed while the flag is off');
  } finally {
    setSetting('standing_rules', '1');
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// ---------- execution ----------

test('a due rule dispatches ONE ask-mode system run as the grantor; finalize captures MATCHED + alert', async () => {
  const { rule } = mkActiveRule();
  const result = standingRules.tick({ source: 'owner', actor: OWNER });
  assert.equal(result.claimed, 1);

  const [rr] = ruleRuns(rule.id);
  assert.equal(rr.state, 'running');
  assert.equal(rr.attempt, 1);
  assert.ok(rr.lease_until > nowIso(), 'lease held');
  assert.equal(rr.occurrence_key, String(rule.next_run_at).slice(0, 10), 'occurrence key from the due time');

  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(rr.run_id);
  assert.equal(run.mode, 'ask', 'tick hard-codes ask mode');
  assert.equal(run.trigger_kind, 'system');
  assert.equal(run.initiated_by, OWNER, 'run acts as the authorizing human');
  assert.equal(run.step_budget, 8, 'rule budget clamps the dispatch');
  assert.match(run.instruction, /MATCHED/);

  // A scheduled run is never OFFERED a mutating tool.
  const offered = toolsForRole('research', { mode: run.mode }).map((t) => t.name);
  for (const name of MUTATING_TOOLS) assert.ok(!offered.includes(name), `${name} must not be offered on a scheduled run`);

  const updatedRule = standingRules.getRule(rule.id);
  assert.ok(updatedRule.next_run_at > nowIso(), 'schedule advanced');
  assert.ok(updatedRule.last_run_at, 'last_run_at stamped');

  await waitForRun(rr.run_id);
  const finalized = standingRules.finalizeRuleRuns();
  assert.ok(finalized >= 1);
  const done = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
  assert.equal(done.state, 'completed');
  assert.equal(done.matched_count, 2, 'MATCHED: 2 parsed from the run summary');
  assert.equal(done.needs_attention, 1, 'matched alert demands attention');
  assert.match(done.result_summary, /MATCHED: 2/);
  assert.deepEqual(JSON.parse(done.output_refs_json), []);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'standing_rule_run.dispatch'").get().n >= 1);

  // Duplicate scheduler delivery of the SAME occurrence: no second run, ever.
  db.prepare('UPDATE standing_rules SET next_run_at = ? WHERE id = ?').run(rule.next_run_at, rule.id);
  const again = standingRules.tick({ source: 'owner', actor: OWNER });
  assert.equal(again.claimed, 0);
  assert.equal(again.skipped[0].reason, 'duplicate occurrence');
  assert.equal(ruleRuns(rule.id).length, 1, 'one occurrence, one row, one run');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs WHERE instruction LIKE ?").get(`%${rule.id}%`).n, 1);
  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
});

test('no execution without a valid standing authorization', async () => {
  // No authorization at all.
  const bare = mkActiveRule().rule;
  db.prepare('DELETE FROM standing_authorizations WHERE rule_id = ?').run(bare.id);
  // Revoked authorization.
  const revoked = mkActiveRule().rule;
  standingRules.revokeAuthorization(revoked.id, OWNER);
  // Grantor no longer allowlisted.
  const ghost = mkActiveRule({ authorizedBy: 'ghost@cloudtechgurus.com' }).rule;

  const result = standingRules.tick({ source: 'owner', actor: OWNER });
  for (const rule of [bare, revoked, ghost]) {
    const runs = ruleRuns(rule.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].state, 'skipped', `rule ${rule.id} must skip`);
    assert.equal(runs[0].run_id, null, 'nothing dispatched');
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
  assert.equal(result.claimed, 0);
});

test('revoked/paused/expired rules and a global pause never execute', async () => {
  const paused = mkActiveRule().rule;
  db.prepare("UPDATE standing_rules SET state = 'paused' WHERE id = ?").run(paused.id);
  const revoked = mkActiveRule().rule;
  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(revoked.id);
  const expired = mkActiveRule({ expiresAt: PAST() }).rule;

  // Global pause parks the whole tick (after finalize, before any claim).
  const active = mkActiveRule().rule;
  control.setPaused(true, OWNER);
  try {
    const res = standingRules.tick({ source: 'owner', actor: OWNER });
    assert.equal(res.skipped, 'workspace paused');
    assert.equal(ruleRuns(active.id).length, 0);
  } finally {
    control.setPaused(false, OWNER);
  }

  const result = standingRules.tick({ source: 'owner', actor: OWNER });
  assert.equal(ruleRuns(paused.id).length, 0, 'paused rule untouched');
  assert.equal(ruleRuns(revoked.id).length, 0, 'revoked rule untouched');
  assert.equal(ruleRuns(expired.id).length, 0, 'expired rule claims nothing');
  assert.equal(standingRules.getRule(expired.id).state, 'expired', 'past expiry flips the state');
  assert.equal(ruleRuns(active.id).length, 1, 'the live rule still ran');
  assert.equal(result.claimed, 1);
  await waitForRun(ruleRuns(active.id)[0].run_id);
  standingRules.finalizeRuleRuns();
  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(active.id);
});

test('lease expiry → retry (same occurrence, fresh run) → max attempts → failed + alert card', async () => {
  const { rule } = mkActiveRule();
  standingRules.tick({ source: 'owner', actor: OWNER });
  let [rr] = ruleRuns(rule.id);
  const firstRunId = rr.run_id;
  await waitForRun(firstRunId);

  // Simulate a stuck first attempt: run never terminal, lease gone.
  db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(firstRunId);
  db.prepare('UPDATE standing_rule_runs SET lease_until = ? WHERE id = ?').run(PAST(), rr.id);
  standingRules.finalizeRuleRuns();

  rr = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
  assert.equal(rr.state, 'running', 'retry keeps the same occurrence row');
  assert.equal(rr.attempt, 2);
  assert.notEqual(rr.run_id, firstRunId, 'retry dispatched a fresh run');
  assert.deepEqual(JSON.parse(rr.retry_run_ids_json), [firstRunId], 'prior run preserved');
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'standing_rule_run.retry'").get().n >= 1);

  // Second attempt gets stuck too → attempts exhausted → failed + alert.
  await waitForRun(rr.run_id);
  db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(rr.run_id);
  db.prepare('UPDATE standing_rule_runs SET lease_until = ? WHERE id = ?').run(PAST(), rr.id);
  standingRules.finalizeRuleRuns();

  rr = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
  assert.equal(rr.state, 'failed');
  assert.equal(rr.needs_attention, 1);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'standing_rule_run.fail'").get().n >= 1);

  const attn = await fetch(`${base}/api/attention?canvas_id=${canvasId}`, { headers: { Cookie: ownerCookie } });
  const cards = (await attn.json()).attention;
  assert.ok(cards.some((c) => c.type === 'rule_alert' && c.sourceRef.id === rr.id), 'failed run raises a NEEDS YOU alert');
  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
});

test('a failed dispatched run is retried, then completes on the fresh run', async () => {
  const { rule } = mkActiveRule();
  standingRules.tick({ source: 'owner', actor: OWNER });
  let [rr] = ruleRuns(rule.id);
  await waitForRun(rr.run_id);
  db.prepare("UPDATE runs SET status = 'failed', error = 'model exploded' WHERE id = ?").run(rr.run_id);
  standingRules.finalizeRuleRuns(); // failed terminal run → immediate retry
  rr = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
  assert.equal(rr.attempt, 2);
  await waitForRun(rr.run_id);
  standingRules.finalizeRuleRuns();
  rr = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
  assert.equal(rr.state, 'completed');
  assert.equal(rr.matched_count, 2);
  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
});

test('workspace-touching rule with a disconnected grantor skips with an alert, never fails silently', async () => {
  const { rule } = mkActiveRule({ sources: ['gmail', 'memory'] }); // no google_tokens row exists → disconnected
  const result = standingRules.tick({ source: 'owner', actor: OWNER });
  const [rr] = ruleRuns(rule.id);
  assert.equal(rr.state, 'skipped');
  assert.equal(rr.skip_reason, 'workspace_disconnected');
  assert.equal(rr.needs_attention, 1);
  assert.equal(rr.run_id, null, 'nothing dispatched');
  assert.equal(result.claimed, 0);

  const attn = await fetch(`${base}/api/attention?canvas_id=${canvasId}`, { headers: { Cookie: ownerCookie } });
  const cards = (await attn.json()).attention;
  assert.ok(cards.some((c) => c.type === 'rule_alert' && c.sourceRef.id === rr.id), 'disconnected skip raises a NEEDS YOU alert');
  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
});

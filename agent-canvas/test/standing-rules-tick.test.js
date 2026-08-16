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
const bus = require('../server/bus');
const runner = require('../server/orchestrator/runner');
const control = require('../server/orchestrator/control');
const { toolsForRole, executeTool, parseAuthority, intersectAuthority, MUTATING_TOOLS } = require('../server/orchestrator/tools');
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

// ---------- authority snapshot (Codex P1) ----------

test('widening the agent after the grant never widens the rule; narrowing it still does', async () => {
  // Both granted tools must sit inside the rule's declared sources — the grant
  // is source-scoped too, and 'drive' would make the rule workspace-touching.
  const GRANTED = ['hs_search', 'hs_get'];
  db.prepare('UPDATE agents SET tools_json = ? WHERE id = ?').run(JSON.stringify(GRANTED), agentId);
  const { rule } = mkActiveRule(); // authorization snapshots tools_json as it is NOW
  try {
    // The owner widens the agent AFTER the standing authorization was granted.
    db.prepare('UPDATE agents SET tools_json = ? WHERE id = ?').run(JSON.stringify([...GRANTED, 'hs_list']), agentId);
    assert.equal(standingRules.tick({ source: 'owner', actor: OWNER }).claimed, 1);
    const [rr] = ruleRuns(rule.id);
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(rr.run_id);
    assert.deepEqual(JSON.parse(run.authority_json), GRANTED, 'the dispatch carries the grant-time snapshot');

    const canvas = { id: canvasId };
    const live = () => db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    const widened = await executeTool('hs_list', { object_type: 'deals' }, { run, agent: live(), canvas });
    assert.ok(widened.isError, 'a tool added after the grant must not execute on the rule run');
    assert.match(widened.content, /authority map/);

    // A later NARROWING still takes effect — the snapshot is a ceiling, not a floor.
    db.prepare('UPDATE agents SET tools_json = ? WHERE id = ?').run(JSON.stringify(['hs_search']), agentId);
    const narrowed = await executeTool('hs_get', { object_type: 'deals', id: '1' }, { run, agent: live(), canvas });
    assert.ok(narrowed.isError, 'a tool removed after the grant must stop executing');
    assert.match(narrowed.content, /authority map/);

    // The offer side agrees: only what BOTH allow is on the tool list.
    const effective = intersectAuthority(parseAuthority(run.authority_json), parseAuthority(live().tools_json));
    assert.deepEqual(effective, ['hs_search']);
    const offered = toolsForRole('research', { mode: 'ask', authority: effective }).map((t) => t.name);
    assert.ok(offered.includes('hs_search'));
    assert.ok(!offered.includes('hs_get'));
    assert.ok(!offered.includes('hs_list'));

    await waitForRun(rr.run_id);
    standingRules.finalizeRuleRuns();
  } finally {
    db.prepare('UPDATE agents SET tools_json = NULL WHERE id = ?').run(agentId);
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// ---------- lease vs wall budget (Codex P1) ----------

test('the occurrence lease outlives the run it guards — no double dispatch', async () => {
  assert.equal(standingRules.leaseMs({ wall_ms_budget: 60_000 }), standingRules.LEASE_FLOOR_MS, 'short runs keep the floor');
  assert.ok(standingRules.leaseMs({ wall_ms_budget: 1_800_000 }) > 1_800_000,
    'the maximum wall budget must never outlive its own lease');

  const { rule } = mkActiveRule();
  db.prepare('UPDATE standing_rules SET wall_ms_budget = 1800000 WHERE id = ?').run(rule.id);
  try {
    standingRules.tick({ source: 'owner', actor: OWNER });
    const [rr] = ruleRuns(rule.id);
    assert.ok(new Date(rr.lease_until).getTime() - Date.now() > 1_800_000,
      'a still-running 30-minute run is never called expired and retried alongside itself');
    await waitForRun(rr.run_id);
    standingRules.finalizeRuleRuns();
  } finally {
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// ---------- revoke / pause halt in-flight work (Codex P1) ----------

async function inFlightRule() {
  const { rule } = mkActiveRule();
  standingRules.tick({ source: 'owner', actor: OWNER });
  const [rr] = ruleRuns(rule.id);
  await waitForRun(rr.run_id);
  // Put the occurrence back in flight, the way a saturated queue leaves it.
  db.prepare("UPDATE runs SET status = 'running', ended_at = NULL WHERE id = ?").run(rr.run_id);
  const controller = new AbortController();
  control.registerAbort(rr.run_id, controller);
  return { rule, rr, controller };
}

test('revoking a rule halts the occurrence already in flight', async () => {
  const { rule, rr, controller } = await inFlightRule();
  try {
    const res = await fetch(`${base}/api/standing-rules/${rule.id}/revoke`, { method: 'POST', headers: { Cookie: ownerCookie } });
    assert.equal(res.status, 200);
    assert.ok(controller.signal.aborted, 'the in-flight model call is aborted');
    assert.equal(db.prepare('SELECT status FROM runs WHERE id = ?').get(rr.run_id).status, 'failed', 'the run is closed out');
    const halted = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
    assert.equal(halted.state, 'skipped');
    assert.match(halted.skip_reason, /revoked/);

    // Whatever the run was mid-way through is refused too — no read, no write.
    const out = await executeTool('memory_search', { query: 'anything' }, {
      run: db.prepare('SELECT * FROM runs WHERE id = ?').get(rr.run_id),
      agent: db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId),
      canvas: { id: canvasId }, signal: controller.signal,
    });
    assert.ok(out.isError);
    assert.match(out.content, /cancelled/);

    // And the finalizer never resurrects it as a retry.
    standingRules.finalizeRuleRuns();
    assert.equal(db.prepare('SELECT state FROM standing_rule_runs WHERE id = ?').get(rr.id).state, 'skipped');

    // A deliberate halt is a control action, not a failure: no "retry this
    // run" card for work the owner just stopped.
    const attn = await fetch(`${base}/api/attention?canvas_id=${canvasId}`, { headers: { Cookie: ownerCookie } });
    const cards = (await attn.json()).attention;
    assert.ok(!cards.some((c) => c.type === 'failed_run' && c.sourceRef.id === rr.run_id),
      'a revoked rule’s halted run must not offer a retry card');
  } finally {
    control.unregisterAbort(rr.run_id);
  }
});

test('pausing a rule halts the occurrence already in flight', async () => {
  const { rule, rr, controller } = await inFlightRule();
  try {
    const res = await fetch(`${base}/api/standing-rules/${rule.id}/pause`, { method: 'POST', headers: { Cookie: ownerCookie } });
    assert.equal(res.status, 200);
    assert.ok(controller.signal.aborted, 'pause stops work already running under the rule');
    assert.equal(db.prepare('SELECT state FROM standing_rule_runs WHERE id = ?').get(rr.id).state, 'skipped');
  } finally {
    control.unregisterAbort(rr.run_id);
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// ---------- pause must not consume retries (Codex P1) ----------

test('a paused workspace never consumes a retry attempt or expires an occurrence', async () => {
  const { rule } = mkActiveRule();
  try {
    standingRules.tick({ source: 'owner', actor: OWNER });
    let [rr] = ruleRuns(rule.id);
    await waitForRun(rr.run_id);
    // Pause aborted the scheduled run — exactly what control.setPaused does.
    db.prepare("UPDATE runs SET status = 'halted_paused', error = 'global pause' WHERE id = ?").run(rr.run_id);

    control.setPaused(true, OWNER);
    try {
      standingRules.tick({ source: 'owner', actor: OWNER }); // finalize runs BEFORE the pause gate
      rr = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
      assert.equal(rr.attempt, 1, 'a paused tick must not queue attempt two');
      assert.equal(rr.state, 'running', 'the occurrence stays open for the resume');
      // Even with the lease long gone, a paused sweep must not expire it.
      db.prepare('UPDATE standing_rule_runs SET lease_until = ? WHERE id = ?').run(PAST(), rr.id);
      standingRules.finalizeRuleRuns();
      rr = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
      assert.equal(rr.attempt, 1);
      assert.notEqual(rr.state, 'failed', 'an operator pause must never exhaust the occurrence');
    } finally {
      control.setPaused(false, OWNER);
    }

    // Resumed, the retry happens normally.
    standingRules.finalizeRuleRuns();
    rr = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
    assert.equal(rr.attempt, 2, 'the retry lands once the workspace is back');
    await waitForRun(rr.run_id);
    standingRules.finalizeRuleRuns();
  } finally {
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// ---------- finalization announces itself (Codex P1) ----------

test('finalizing a rule run emits a canvas event so a connected client refetches attention', async () => {
  const { rule } = mkActiveRule();
  try {
    standingRules.tick({ source: 'owner', actor: OWNER });
    const [rr] = ruleRuns(rule.id);
    await waitForRun(rr.run_id);
    const seen = [];
    const listener = (ev) => seen.push(ev);
    bus.on('event', listener);
    try { standingRules.finalizeRuleRuns(); } finally { bus.off('event', listener); }
    assert.equal(db.prepare('SELECT needs_attention FROM standing_rule_runs WHERE id = ?').get(rr.id).needs_attention, 1);
    assert.ok(seen.some((e) => e.type === 'canvas_structure' && e.canvasId === canvasId),
      'the moment a run gains needs_attention must reach connected clients');
  } finally {
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// ---------- unknown MATCHED count (Codex P2) ----------

test('a completed watch with no parseable MATCHED line surfaces instead of going quiet', async () => {
  const restoreModel = runner._internal.setCallModel(async () => ({
    content: [{ type: 'text', text: 'Three contracts are past their renewal date and need review today.' }],
    stop_reason: 'end_turn', usage: {},
  }));
  const { rule } = mkActiveRule();
  try {
    standingRules.tick({ source: 'owner', actor: OWNER });
    const [rr] = ruleRuns(rule.id);
    await waitForRun(rr.run_id);
    standingRules.finalizeRuleRuns();
    const done = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
    assert.equal(done.state, 'completed');
    assert.equal(done.matched_count, null, 'the count is unknown, not zero');
    assert.equal(done.needs_attention, 1, 'an unknown count must be reviewed, never silently suppressed');
  } finally {
    restoreModel();
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// ---------- Codex round 2 ----------

async function attentionCards(cookie = ownerCookie) {
  const res = await fetch(`${base}/api/attention?canvas_id=${canvasId}`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  return (await res.json()).attention;
}

// R2-1: a pre-P4 agent has tools_json NULL, and NULL is the identity element of
// intersectAuthority — so a NULL grant-time snapshot is no ceiling at all.
test('a legacy agent with no authority map still gets a CONCRETE grant-time ceiling', async () => {
  db.prepare('UPDATE agents SET tools_json = NULL WHERE id = ?').run(agentId);
  const { rule } = mkActiveRule();
  try {
    assert.equal(standingRules.tick({ source: 'owner', actor: OWNER }).claimed, 1);
    const [rr] = ruleRuns(rule.id);
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(rr.run_id);
    assert.notEqual(run.authority_json, null, 'a NULL snapshot means unrestricted forever');
    const granted = JSON.parse(run.authority_json);
    assert.ok(granted.includes('hs_search'), 'the reviewed sources resolve to real tools');

    // The owner now publishes an authority map naming a tool this rule never
    // reviewed. Against a NULL snapshot the intersection would hand it over.
    db.prepare('UPDATE agents SET tools_json = ? WHERE id = ?').run(JSON.stringify(['hs_search', 'ws_drive_search']), agentId);
    const live = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    const out = await executeTool('ws_drive_search', { query: 'anything' }, { run, agent: live, canvas: { id: canvasId } });
    assert.ok(out.isError, 'a tool published after the grant must not execute on the rule run');
    assert.match(out.content, /authority map/);

    await waitForRun(rr.run_id);
    standingRules.finalizeRuleRuns();
  } finally {
    db.prepare('UPDATE agents SET tools_json = NULL WHERE id = ?').run(agentId);
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// R2-7: the reviewed source list is the consent card's whole promise.
test('the grant is scoped to the reviewed sources, and the run is told them', () => {
  db.prepare('UPDATE agents SET tools_json = NULL WHERE id = ?').run(agentId);
  const { rule, authz } = mkActiveRule();
  const granted = JSON.parse(authz.allowed_tools_json);
  assert.ok(granted.length > 0, 'a hubspot rule can reach hubspot');
  assert.ok(granted.every((n) => n.startsWith('hs_')),
    `only the reviewed sources' tools are granted, got ${granted.join(', ')}`);
  assert.ok(!granted.includes('web_search'), 'an undeclared source grants nothing');

  // A memory-only rule reaches no external surface at all.
  const memOnly = mkActiveRule({ sources: ['memory'] });
  assert.deepEqual(JSON.parse(memOnly.authz.allowed_tools_json), []);

  assert.match(standingRules.ruleInstruction(standingRules.getRule(rule.id)), /Sources: read hubspot, memory/);
  for (const r of [rule, memOnly.rule]) db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(r.id);
});

// R2-2: the in-memory queue is unbounded, so a saturated workspace can park a
// run past its whole lease. Retrying alongside it double-spends the occurrence.
test('a lease-expiry retry terminates the prior attempt before dispatching', async () => {
  const { rule } = mkActiveRule();
  try {
    standingRules.tick({ source: 'owner', actor: OWNER });
    let [rr] = ruleRuns(rule.id);
    const first = rr.run_id;
    await waitForRun(first);

    // The shape a saturated queue leaves: still queued/running, lease gone.
    db.prepare("UPDATE runs SET status = 'queued', ended_at = NULL WHERE id = ?").run(first);
    db.prepare('UPDATE standing_rule_runs SET lease_until = ? WHERE id = ?').run(PAST(), rr.id);
    const controller = new AbortController();
    control.registerAbort(first, controller);
    try { standingRules.finalizeRuleRuns(); } finally { control.unregisterAbort(first); }

    rr = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
    assert.equal(rr.attempt, 2);
    assert.notEqual(rr.run_id, first);
    const prior = db.prepare('SELECT * FROM runs WHERE id = ?').get(first);
    assert.equal(prior.status, 'failed', 'the prior attempt must not still be waiting to execute');
    assert.match(prior.error, /superseded by standing-rule retry/);
    assert.ok(controller.signal.aborted, 'its in-flight work is cancelled, not left to race the retry');
    assert.equal(db.prepare('SELECT parent_run_id FROM runs WHERE id = ?').get(rr.run_id).parent_run_id, first);

    // And the superseded attempt never becomes a generic Retry card.
    assert.ok(!(await attentionCards()).some((c) => c.type === 'failed_run' && c.sourceRef.id === first));

    await waitForRun(rr.run_id);
    standingRules.finalizeRuleRuns();
  } finally {
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// R2-3: an earlier attempt lives only in retry_run_ids_json — halting rr.run_id
// alone leaves it reading and writing memory after the grant is revoked.
test('revoking halts EVERY attempt of the occurrence, not just the current one', async () => {
  const { rule } = mkActiveRule();
  let first;
  let rr;
  try {
    standingRules.tick({ source: 'owner', actor: OWNER });
    [rr] = ruleRuns(rule.id);
    first = rr.run_id;
    await waitForRun(first);
    db.prepare("UPDATE runs SET status = 'running', ended_at = NULL WHERE id = ?").run(first);
    db.prepare('UPDATE standing_rule_runs SET lease_until = ? WHERE id = ?').run(PAST(), rr.id);
    standingRules.finalizeRuleRuns();
    rr = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
    assert.deepEqual(JSON.parse(rr.retry_run_ids_json), [first], 'the prior id lives only here');
    await waitForRun(rr.run_id);

    // Both attempts live (defense in depth: whatever leaves an older attempt
    // running, revoke must still reach it).
    db.prepare("UPDATE runs SET status = 'running', ended_at = NULL, error = NULL WHERE id IN (?, ?)").run(first, rr.run_id);
    const c1 = new AbortController();
    const c2 = new AbortController();
    control.registerAbort(first, c1);
    control.registerAbort(rr.run_id, c2);
    try {
      const res = await fetch(`${base}/api/standing-rules/${rule.id}/revoke`, { method: 'POST', headers: { Cookie: ownerCookie } });
      assert.equal(res.status, 200);
    } finally {
      control.unregisterAbort(first);
      control.unregisterAbort(rr.run_id);
    }
    assert.ok(c1.signal.aborted, 'the earlier attempt is aborted too');
    assert.ok(c2.signal.aborted);
    for (const id of [first, rr.run_id]) {
      assert.equal(db.prepare('SELECT status FROM runs WHERE id = ?').get(id).status, 'failed', `run ${id} still open`);
    }
  } finally {
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// R2-4: editing flips the rule to draft, and draft rules emit no cards — so an
// unhalted occurrence keeps running the old instruction, invisibly.
test('editing an active rule halts the occurrence already in flight', async () => {
  const { rule, rr, controller } = await inFlightRule();
  try {
    const res = await fetch(`${base}/api/standing-rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ instruction: 'watch something else entirely' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).rule.state, 'draft');
    assert.ok(controller.signal.aborted, 'the old approved instruction must stop running');
    assert.equal(db.prepare('SELECT status FROM runs WHERE id = ?').get(rr.run_id).status, 'failed');
    const halted = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
    assert.equal(halted.state, 'skipped');
    assert.match(halted.skip_reason, /edited/);
  } finally {
    control.unregisterAbort(rr.run_id);
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// R2-5: rule history is canvas-readable; a scheduled read of a private Drive
// file must not hand its id and URI to every member.
test('rule history and detail redact private evidence refs for anyone but the directing user', async () => {
  const { rule } = mkActiveRule();
  try {
    standingRules.tick({ source: 'owner', actor: OWNER });
    const [rr] = ruleRuns(rule.id);
    await waitForRun(rr.run_id);
    standingRules.finalizeRuleRuns();
    const ref = {
      id: 'ref-private-1', runId: rr.run_id, sourceKind: 'drive', sourceId: 'FILE_SECRET_ID',
      title: 'Q3 comp plan', uri: 'https://drive.google.com/open?id=FILE_SECRET_ID',
      directedBy: OWNER, retrievedAt: nowIso(), visibility: 'canvas', meta: {},
    };
    db.prepare('UPDATE standing_rule_runs SET output_refs_json = ? WHERE id = ?').run(JSON.stringify([ref]), rr.id);

    for (const path of [`/api/standing-rules/${rule.id}/runs`, `/api/standing-rules/${rule.id}`]) {
      const res = await fetch(`${base}${path}`, { headers: { Cookie: memberCookie } });
      assert.equal(res.status, 200, `${path} readable by a member`);
      const body = await res.json();
      const row = body.runs.find((r) => r.id === rr.id);
      assert.ok(row, `${path} returns the occurrence`);
      assert.equal(row.output_refs_json, undefined, 'the raw column must not ride along unredacted');
      const [got] = row.output_refs;
      assert.equal(got.uri, '', `${path} leaked the private URI`);
      assert.equal(got.sourceId, '');
      assert.equal(got.redacted, true);
      assert.equal(got.title, 'Q3 comp plan', 'the receipt stays honest — kind and title survive');
    }

    // The grantor, whose Google identity the read acted as, still sees it.
    const own = await fetch(`${base}/api/standing-rules/${rule.id}/runs`, { headers: { Cookie: ownerCookie } });
    const mine = (await own.json()).runs.find((r) => r.id === rr.id).output_refs[0];
    assert.equal(mine.uri, ref.uri);
    assert.equal(mine.sourceId, 'FILE_SECRET_ID');
  } finally {
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
});

// R2-6: lamps never fake green. A rule whose grant is gone must not keep
// displaying as active while it silently skips every occurrence forever.
test('a rule whose authorization is gone stops monitoring LOUDLY, not silently', async () => {
  const { rule } = mkActiveRule({ authorizedBy: 'ghost@cloudtechgurus.com' });
  standingRules.tick({ source: 'owner', actor: OWNER });

  const after = standingRules.getRule(rule.id);
  assert.notEqual(after.state, 'active', 'an unrunnable rule must not display as active');
  assert.equal(after.state, 'paused');
  assert.equal(after.next_run_at, null, 'a silently advanced schedule is the fake-green');

  const [rr] = ruleRuns(rule.id);
  assert.equal(rr.state, 'skipped');
  assert.equal(rr.needs_attention, 1, 'someone is relying on monitoring that stopped');
  assert.ok((await attentionCards()).some((c) => c.type === 'rule_alert' && c.sourceRef.id === rr.id),
    'the owner learns the rule is broken');
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'standing_rule.invalidated'").get().n >= 1);

  // Resume refuses until the grant is redone — no accidental revival.
  const res = await fetch(`${base}/api/standing-rules/${rule.id}/resume`, { method: 'POST', headers: { Cookie: ownerCookie } });
  assert.equal(res.status, 409);
  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
});

// R2-8: between a scheduled run going terminal and the next finalizer tick, the
// generic projection would offer Retry — and a click would dispatch a second
// run for the same occurrence the finalizer is about to retry itself.
test('a standing run that fails before the finalizer ticks offers no generic Retry card', async () => {
  const { rule } = mkActiveRule();
  try {
    standingRules.tick({ source: 'owner', actor: OWNER });
    let [rr] = ruleRuns(rule.id);
    await waitForRun(rr.run_id);
    db.prepare("UPDATE runs SET status = 'failed', error = 'model exploded' WHERE id = ?").run(rr.run_id);
    assert.equal(db.prepare('SELECT state FROM standing_rule_runs WHERE id = ?').get(rr.id).state, 'running',
      'the finalizer has not swept yet — this is the window');

    assert.ok(!(await attentionCards()).some((c) => c.type === 'failed_run' && c.sourceRef.id === rr.run_id),
      'the standing-rule lifecycle owns this run; a generic Retry would double-dispatch it');

    // And the lifecycle does own it — the finalizer dispatches the retry.
    standingRules.finalizeRuleRuns();
    rr = db.prepare('SELECT * FROM standing_rule_runs WHERE id = ?').get(rr.id);
    assert.equal(rr.attempt, 2);
    await waitForRun(rr.run_id);
    standingRules.finalizeRuleRuns();
  } finally {
    db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id);
  }
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

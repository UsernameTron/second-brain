'use strict';
// P5 T1+T2+T5: standing rules — occurrence-key/next-run math, the
// authorization verify matrix, parse → review → rehearse → activate ceremony
// (activate 409s without a completed rehearsal; any edit resets the gate),
// owner/editor split, cross-canvas 403s, and the NEEDS YOU cards
// (rule_alert / brief_ready) with acknowledge resolution.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-srules-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test';

const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const anthropic = require('../server/orchestrator/anthropic');
const runner = require('../server/orchestrator/runner');
const { blockedInMode, toolsForRole, executeTool } = require('../server/orchestrator/tools');
const standingRules = require('../server/standing-rules');

// Rehearsal runs go through the real run loop — stub its model.
runner._internal.setCallModel(async () => ({
  content: [{ type: 'text', text: 'Rehearsal: two deals would have matched in the last 7 days. MATCHED: 2' }],
  stop_reason: 'end_turn', usage: {},
}));

const OWNER = 'pete@cloudtechgurus.com';
const MEMBER = 'darren@cloudtechgurus.com';
const OUTSIDER = 'jess@cloudtechgurus.com';

const INTERP = (agentId, overrides = {}) => ({
  summary: 'Watch new HubSpot deals and alert on anything above $50k.',
  sources: ['hubspot', 'memory'],
  scope: 'New deals above $50k in the practice portal',
  category: 'watch',
  output_type: 'alert',
  cadence: 'daily',
  cadence_hour: 8,
  cadence_day: null,
  agent_id: agentId,
  step_budget: 8,
  wall_ms_budget: 120000,
  expires_days: 30,
  can: ['read the CRM', 'raise an alert'],
  cannot: ['send anything', 'change any record'],
  ...overrides,
});

const realCallModel = anthropic.callModel;
function stubParse(obj) {
  anthropic.callModel = async () => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], usage: {} });
  return () => { anthropic.callModel = realCallModel; };
}

let base;
let ownerCookie;
let memberCookie;
let outsiderCookie;
let canvasId;
let agentId;
let ruleId;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(cookie, method, apiPath, body) {
  const res = await fetch(`${base}${apiPath}`, {
    method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

// workspace.isConnected is exactly "does this user have a google_tokens row".
function connectGoogle(email) {
  db.prepare('INSERT OR REPLACE INTO google_tokens (user_email, refresh_token_enc, scopes, connected_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(email, 'enc', 'scopes', nowIso(), nowIso());
}
function disconnectGoogle(email) {
  db.prepare('DELETE FROM google_tokens WHERE user_email = ?').run(email);
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

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ownerCookie = await signIn(OWNER);
  assert.equal((await call(ownerCookie, 'POST', '/api/allowlist', { email: MEMBER, role: 'member' })).status, 200);
  assert.equal((await call(ownerCookie, 'POST', '/api/allowlist', { email: OUTSIDER, role: 'member' })).status, 200);
  memberCookie = await signIn(MEMBER);
  outsiderCookie = await signIn(OUTSIDER);
  const created = await call(ownerCookie, 'POST', '/api/canvases', { name: 'Rules T1' });
  canvasId = created.data.canvas.id;
  // Restricted canvas: MEMBER holds edit, OUTSIDER has no access at all —
  // scoping must not cross canvas permissions.
  assert.equal((await call(ownerCookie, 'PATCH', `/api/canvases/${canvasId}`, { access_mode: 'restricted' })).status, 200);
  assert.equal((await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/members`, { email: MEMBER, access: 'edit' })).status, 200);
  agentId = 'agent-srules-1';
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Scout', 'research', ?)")
    .run(agentId, canvasId, nowIso());
});

test.after(() => new Promise((resolve) => server.close(resolve)));

// ---------- T1: occurrence-key + next_run_at math ----------

test('occurrence keys derive deterministically from the due time per cadence', () => {
  assert.equal(standingRules.occurrenceKey({ cadence: 'hourly' }, '2026-08-15T14:05:00.000Z'), '2026-08-15T14');
  assert.equal(standingRules.occurrenceKey({ cadence: 'daily' }, '2026-08-15T08:00:00.000Z'), '2026-08-15');
  assert.equal(standingRules.occurrenceKey({ cadence: 'weekly' }, '2026-08-15T08:00:00.000Z'), '2026-W33');
  // Sunday belongs to the SAME ISO week as the preceding Monday.
  assert.equal(standingRules.occurrenceKey({ cadence: 'weekly' }, '2026-08-16T08:00:00.000Z'), '2026-W33');
  // Year boundary: 2027-01-01 falls in ISO week 2026-W53.
  assert.equal(standingRules.occurrenceKey({ cadence: 'weekly' }, '2027-01-01T08:00:00.000Z'), '2026-W53');
});

test('next_run_at math: hourly tops of hours, daily/weekly UTC slots', () => {
  assert.equal(standingRules.nextRunAt({ cadence: 'hourly' }, new Date('2026-08-15T14:30:00Z')), '2026-08-15T15:00:00.000Z');
  assert.equal(standingRules.nextRunAt({ cadence: 'daily', cadence_hour: 8 }, new Date('2026-08-15T07:00:00Z')), '2026-08-15T08:00:00.000Z');
  // Exactly at the slot → the NEXT occurrence, never the same instant twice.
  assert.equal(standingRules.nextRunAt({ cadence: 'daily', cadence_hour: 8 }, new Date('2026-08-15T08:00:00Z')), '2026-08-16T08:00:00.000Z');
  assert.equal(standingRules.nextRunAt({ cadence: 'weekly', cadence_day: 1, cadence_hour: 9 }, new Date('2026-08-15T10:00:00Z')), '2026-08-17T09:00:00.000Z');
  assert.equal(standingRules.nextRunAt({ cadence: 'weekly', cadence_day: 1, cadence_hour: 9 }, new Date('2026-08-17T09:00:00Z')), '2026-08-24T09:00:00.000Z');
});

test('matched_count parses from the summary contract line', () => {
  assert.equal(standingRules.parseMatchedCount('Found things.\nMATCHED: 3'), 3);
  assert.equal(standingRules.parseMatchedCount('All quiet. NOTHING MATCHED'), 0);
  assert.equal(standingRules.parseMatchedCount('no contract line at all'), null);
  assert.equal(standingRules.parseMatchedCount(null), null);
});

// Codex P2: an unanchored search takes the FIRST "MATCHED:" anywhere in the
// text — quoted source records and the agent's own prose produce that pattern
// naturally — recording zero and suppressing the alert while the real count is
// two. The contract line is the final nonblank line and nothing else.
test('matched_count reads the final contract line, not the first MATCHED in the prose', () => {
  assert.equal(
    standingRules.parseMatchedCount('Source reported MATCHED: 0 yesterday, but two are new today.\nMATCHED: 2'),
    2, 'prose earlier in the summary must not win over the contract line',
  );
  assert.equal(
    standingRules.parseMatchedCount('The digest said NOTHING MATCHED last week.\n\nMATCHED: 4\n  \n'),
    4, 'trailing blank lines do not hide the contract line',
  );
  assert.equal(
    standingRules.parseMatchedCount('Recap: MATCHED: 0 last run.\nNOTHING MATCHED'),
    0, 'a NOTHING MATCHED contract line still parses as a real zero',
  );
  // Conflicting contract statements on the one line the contract owns: the
  // count is UNKNOWN, never one of them. null surfaces the card for review.
  assert.equal(standingRules.parseMatchedCount('MATCHED: 0 but really MATCHED: 3'), null);
  assert.equal(standingRules.parseMatchedCount('NOTHING MATCHED — well, MATCHED: 1'), null);
  // No contract line at the end at all is unknown too, not the earlier number.
  assert.equal(standingRules.parseMatchedCount('MATCHED: 7\nThanks for reading!'), null);
});

// ---------- T1: authorization verify matrix ----------

test('authorization verify matrix: missing/revoked/expired/off-allowlist/no-access all refuse', () => {
  const interp = standingRules.validateInterpretation(INTERP(agentId), { agents: [{ id: agentId }] });
  const draft = standingRules.upsertDraft({ canvasId, instruction: 'watch deals', interp, actor: OWNER });
  const future = new Date(Date.now() + 30 * 86400000).toISOString();
  db.prepare("UPDATE standing_rules SET state = 'active', expires_at = ? WHERE id = ?").run(future, draft.id);
  const rule = standingRules.getRule(draft.id);

  // no authorization at all
  assert.equal(standingRules.verifyAuthorization(rule, null).ok, false);

  const authz = standingRules.createAuthorization({ rule, authorizedBy: MEMBER, expiresAt: future });
  assert.equal(standingRules.verifyAuthorization(rule, authz).ok, true);

  // revoked
  assert.equal(standingRules.verifyAuthorization(rule, { ...authz, revoked_at: nowIso() }).ok, false);
  // expired
  assert.equal(standingRules.verifyAuthorization(rule, { ...authz, expires_at: '2020-01-01T00:00:00.000Z' }).ok, false);
  // grantor off the allowlist
  assert.equal(standingRules.verifyAuthorization(rule, { ...authz, authorized_by: 'ghost@cloudtechgurus.com' }).ok, false);
  // grantor lost canvas access (restricted canvas, membership removed)
  db.prepare('DELETE FROM canvas_members WHERE canvas_id = ? AND user_email = ?').run(canvasId, MEMBER);
  assert.equal(standingRules.verifyAuthorization(rule, authz).ok, false);
  db.prepare("INSERT INTO canvas_members (canvas_id, user_email, access) VALUES (?, ?, 'edit')").run(canvasId, MEMBER);
  assert.equal(standingRules.verifyAuthorization(rule, authz).ok, true);
  // rule not active
  assert.equal(standingRules.verifyAuthorization({ ...rule, state: 'paused' }, authz).ok, false);
  // rule expired
  assert.equal(standingRules.verifyAuthorization({ ...rule, expires_at: '2020-01-01T00:00:00.000Z' }, authz).ok, false);

  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(rule.id); // park the fixture
});

// A rule fixture that needs no HTTP ceremony — the instruction templates read
// nothing but these fields.
const INSTRUCTION_FIXTURE = {
  id: 'rule-instruction-fixture', cadence: 'daily', instruction: 'watch the deals',
  output_type: 'alert', source_scope_json: JSON.stringify({ scope: 'deals above $50k' }),
};

test('a rehearsal can never write to shared memory — the gate, not just the prompt', async () => {
  // The gate. A rehearsal's findings are hypothetical; persisting them as
  // records before the owner approves the rule is the whole bug.
  assert.equal(blockedInMode('memory_write', 'rehearse'), true);
  assert.equal(blockedInMode('memory_correct', 'rehearse'), true);
  assert.equal(blockedInMode('memory_write', 'ask'), false, 'ask findings are real — receipts still need memory');
  const offered = toolsForRole('research', { mode: 'rehearse' }).map((t) => t.name);
  assert.ok(!offered.includes('memory_write'), 'memory_write must not be offered in rehearse mode');
  assert.ok(!offered.includes('memory_correct'));
  assert.ok(offered.includes('memory_search'), 'a rehearsal still reads memory');

  const before = db.prepare('SELECT COUNT(*) AS n FROM memory_entries WHERE canvas_id = ?').get(canvasId).n;
  const refused = await executeTool('memory_write', { content: 'two deals would have matched', epistemic: 'inference' }, {
    run: { id: 'run-rehearse-mem', canvas_id: canvasId, agent_id: agentId, mode: 'rehearse' },
    agent: { id: agentId, name: 'Scout', role: 'research' },
    canvas: { id: canvasId },
  });
  assert.ok(refused.isError, 'a forced memory_write in a rehearsal is refused server-side');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_entries WHERE canvas_id = ?').get(canvasId).n, before,
    'nothing hypothetical reached shared memory');

  // The prompt must stop ordering the write it would only be refused for.
  assert.match(standingRules.ruleInstruction(INSTRUCTION_FIXTURE), /Record selected conclusions as memory entries/);
  const rehearsal = standingRules.rehearsalInstruction(INSTRUCTION_FIXTURE);
  assert.doesNotMatch(rehearsal, /Record selected conclusions as memory entries/,
    'the rehearsal prompt must not embed the memory-write directive');
  assert.match(rehearsal, /Memory is read-only in a rehearsal/);
  assert.doesNotMatch(standingRules.rehearsalInstruction({ ...INSTRUCTION_FIXTURE, output_type: 'brief' }),
    /Record selected conclusions as memory entries/, 'brief rehearsals too');
});

test('MCP is not an offerable rule source — a scheduled ask run could never read it', () => {
  assert.ok(!standingRules.SOURCES.includes('mcp'), 'mcp must not be a reviewable source');
  assert.ok(!standingRules.PARSE_SYSTEM([{ id: agentId, name: 'Scout', role: 'research' }]).includes('"mcp"'),
    'the parse prompt must not offer mcp');
  // Why: rules dispatch in ask mode, where every mcp_* tool is blocked.
  assert.equal(blockedInMode('mcp_soi_org_knowledge_search', 'ask'), true);
  const interp = standingRules.validateInterpretation(INTERP(agentId, { sources: ['mcp', 'memory'] }), { agents: [{ id: agentId }] });
  assert.deepEqual(interp.sources, ['memory'], 'a hallucinated mcp source never persists onto the card');
});

// ---------- T2: parse → rehearse → activate ceremony ----------

test('config exposes the standing_rules flag', async () => {
  const res = await fetch(`${base}/api/config`);
  assert.equal((await res.json()).standingRules, true);
});

test('parse: instruction → validated interpretation as a draft rule', async () => {
  const restore = stubParse(INTERP(agentId));
  try {
    const bad = await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, {});
    assert.equal(bad.status, 400); // instruction required

    const parsed = await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, {
      instruction: 'Watch new HubSpot deals and alert me about anything above $50k',
    });
    assert.equal(parsed.status, 200);
    ruleId = parsed.data.rule.id;
    assert.equal(parsed.data.rule.state, 'draft');
    assert.equal(parsed.data.rule.version, 1);
    assert.equal(parsed.data.rule.agent_id, agentId);
    assert.equal(parsed.data.rule.output_type, 'alert');
    assert.equal(parsed.data.rule.cadence, 'daily');
    assert.deepEqual(parsed.data.rule.source_scope.sources, ['hubspot', 'memory']);
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'standing_rule.create'").get().n >= 1);
  } finally { restore(); }
});

test('parse failure is a clean 502, never a half-rule', async () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM standing_rules').get().n;
  let restore = stubParse('no json here');
  try {
    assert.equal((await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'anything' })).status, 502);
  } finally { restore(); }
  // Valid JSON but invalid interpretation (hallucinated agent) is ALSO 502.
  restore = stubParse(INTERP('not-a-real-agent'));
  try {
    assert.equal((await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'anything' })).status, 502);
  } finally { restore(); }
  restore = stubParse(INTERP(agentId, { cadence: 'fortnightly' }));
  try {
    assert.equal((await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'anything' })).status, 502);
  } finally { restore(); }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM standing_rules').get().n, before);
});

test('activate before rehearsal is refused — the rehearsal is the review', async () => {
  const res = await call(ownerCookie, 'POST', `/api/standing-rules/${ruleId}/activate`);
  assert.equal(res.status, 409);
  assert.match(res.data.error, /rehearse/i);
});

test('rehearse: rehearse-mode run on the rule agent; editor may rehearse', async () => {
  const rehearsed = await call(memberCookie, 'POST', `/api/standing-rules/${ruleId}/rehearse`, {});
  assert.equal(rehearsed.status, 200);
  assert.equal(rehearsed.data.run.mode, 'rehearse');
  assert.equal(rehearsed.data.rule.state, 'rehearsed');
  const run = await waitForRun(rehearsed.data.run.id);
  assert.equal(run.status, 'completed');
  assert.equal(run.step_budget, 8, 'rule budget became the dispatch budget');
  assert.match(run.instruction, /REHEARSAL against recent data/);
  assert.match(run.instruction, /change nothing/);
  assert.match(run.instruction, /MATCHED/);
});

test('a second rehearsal is refused while the first run is still in flight', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const restore = runner._internal.setCallModel(async () => {
    await gate;
    return { content: [{ type: 'text', text: 'Rehearsal: nothing would have matched. MATCHED: 0' }], stop_reason: 'end_turn', usage: {} };
  });
  try {
    const first = await call(memberCookie, 'POST', `/api/standing-rules/${ruleId}/rehearse`, {});
    assert.equal(first.status, 200);

    const second = await call(memberCookie, 'POST', `/api/standing-rules/${ruleId}/rehearse`, {});
    assert.equal(second.status, 409, 'concurrent rehearsal must be refused');
    assert.match(second.data.error, /already (queued|running)/);
    // The rule still points at the first run — nothing was overwritten, and no
    // second run was dispatched to burn duplicate budget.
    assert.equal(standingRules.getRule(ruleId).rehearsal_run_id, first.data.run.id);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND mode = 'rehearse' AND status IN ('queued','running')").get(agentId).n, 1);
  } finally {
    release();
    restore();
  }
  await waitForRun(db.prepare('SELECT rehearsal_run_id AS id FROM standing_rules WHERE id = ?').get(ruleId).id);
});

test('editing resets the rehearsal gate: state→draft, version++, activate 409s again', async () => {
  const patched = await call(memberCookie, 'PATCH', `/api/standing-rules/${ruleId}`, { instruction: 'Watch deals above $75k instead' });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.rule.state, 'draft');
  assert.equal(patched.data.rule.version, 2);
  assert.equal(patched.data.rule.rehearsal_run_id, null);
  assert.equal((await call(ownerCookie, 'POST', `/api/standing-rules/${ruleId}/activate`)).status, 409);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'standing_rule.edit'").get().n >= 1);
  // Re-rehearse for activation — as the OWNER, who is the one who will grant.
  // A rehearsal by anyone else read a different identity's data (see the
  // activation-identity test below).
  const re = await call(ownerCookie, 'POST', `/api/standing-rules/${ruleId}/rehearse`, {});
  assert.equal(re.status, 200);
  await waitForRun(re.data.run.id);
});

// The rehearsal IS the review, and every scheduled run is dispatched with
// initiatedBy = the activator — tools.js resolves Gmail/Drive/CRM calls from
// run.initiated_by, and grantedTools resolves the menu from the grantor's
// workspace role. A member rehearsing against HIS mailbox and the owner
// activating means the owner approved a clean result produced from data the
// rule will never read. Identity is the half of "what activates must be what
// rehearsed" that version alone never covered.
test('activation refuses a rehearsal that ran as somebody else', async () => {
  const restore = stubParse(INTERP(agentId));
  let id;
  try {
    // The member writes the rule (creator), so rehearsing it is theirs to do.
    id = (await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'member rule, owner activation' })).data.rule.id;
  } finally { restore(); }
  const memberRehearsal = await call(memberCookie, 'POST', `/api/standing-rules/${id}/rehearse`, {});
  assert.equal(memberRehearsal.status, 200, 'a member may still rehearse — against their own access');
  await waitForRun(memberRehearsal.data.run.id);

  const refused = await call(ownerCookie, 'POST', `/api/standing-rules/${id}/activate`);
  assert.equal(refused.status, 409, 'the owner must not grant on someone else’s rehearsal');
  assert.match(refused.data.error, new RegExp(MEMBER), 'the error names whose access actually did the reading');
  assert.equal(standingRules.currentAuthorization(id), undefined, 'no grant was minted');

  // The owner rehearsing it themselves is the whole remedy.
  const ownRehearsal = await call(ownerCookie, 'POST', `/api/standing-rules/${id}/rehearse`, {});
  assert.equal(ownRehearsal.status, 200);
  await waitForRun(ownRehearsal.data.run.id);
  const activated = await call(ownerCookie, 'POST', `/api/standing-rules/${id}/activate`);
  assert.equal(activated.status, 200);
  assert.equal(activated.data.authorization.authorized_by, OWNER);
  // And the acting identity is on the payload the consent card renders.
  const detail = await call(ownerCookie, 'GET', `/api/standing-rules/${id}`);
  assert.equal(detail.data.rehearsalRun.initiated_by, OWNER, 'the card can state who the rule reads as');
  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(id);
});

// A rehearsal that could not reach a single source is not a review: every
// ws_* call returns isError, the model writes prose over nothing, the run
// completes, and Activate lights up. The rehearse route applies the same
// reachability checks verifyAuthorization applies per dispatch.
test('rehearsing a Workspace rule with no Google connection is refused, not silently empty', async () => {
  const restore = stubParse(INTERP(agentId, { sources: ['gmail', 'memory'] }));
  let id;
  try {
    id = (await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'watch my inbox' })).data.rule.id;
  } finally { restore(); }
  const refused = await call(ownerCookie, 'POST', `/api/standing-rules/${id}/rehearse`, {});
  assert.equal(refused.status, 409, 'no Google connection → the rehearsal would read nothing');
  assert.match(refused.data.error, /not connected/i);
  assert.equal(standingRules.getRule(id).state, 'draft', 'the gate never opened');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs WHERE canvas_id = ? AND mode = 'rehearse' AND instruction LIKE '%watch my inbox%'").get(canvasId).n, 0,
    'and no run was dispatched to burn budget reading nothing');

  connectGoogle(OWNER);
  try {
    const ok = await call(ownerCookie, 'POST', `/api/standing-rules/${id}/rehearse`, {});
    assert.equal(ok.status, 200, 'connected, the same rehearsal proceeds');
    await waitForRun(ok.data.run.id);
  } finally { disconnectGoogle(OWNER); }
  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(id);
});

test('activate: owner-only; creates the ask-mode authorization snapshot and schedules', async () => {
  assert.equal((await call(memberCookie, 'POST', `/api/standing-rules/${ruleId}/activate`)).status, 403);

  const activated = await call(ownerCookie, 'POST', `/api/standing-rules/${ruleId}/activate`);
  assert.equal(activated.status, 200);
  assert.equal(activated.data.rule.state, 'active');
  assert.ok(activated.data.rule.next_run_at > nowIso(), 'next_run_at scheduled in the future');
  assert.ok(activated.data.rule.expires_at > nowIso(), 'expiry defaulted from interpretation');
  const authz = activated.data.authorization;
  assert.equal(authz.authorized_by, OWNER);
  assert.equal(authz.mode, 'ask');
  assert.equal(authz.workspace_role_at_grant, 'owner');
  assert.equal(authz.revoked_at, null);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'standing_rule.activate'").get().n >= 1);
});

test('pause/resume/revoke are owner-only ceremonies with audit rows', async () => {
  for (const verb of ['pause', 'resume', 'revoke']) {
    assert.equal((await call(memberCookie, 'POST', `/api/standing-rules/${ruleId}/${verb}`)).status, 403, `${verb} must be owner-only`);
  }
  assert.equal((await call(ownerCookie, 'POST', `/api/standing-rules/${ruleId}/pause`)).data.rule.state, 'paused');
  assert.equal((await call(ownerCookie, 'POST', `/api/standing-rules/${ruleId}/resume`)).data.rule.state, 'active');
  const revoked = await call(ownerCookie, 'POST', `/api/standing-rules/${ruleId}/revoke`);
  assert.equal(revoked.data.rule.state, 'revoked');
  assert.ok(db.prepare('SELECT revoked_at FROM standing_authorizations WHERE rule_id = ? ORDER BY granted_at DESC LIMIT 1').get(ruleId).revoked_at,
    'authorization revoked with the rule');
  // A revoked rule stays revoked: no resume, no rehearse, no edit.
  assert.equal((await call(ownerCookie, 'POST', `/api/standing-rules/${ruleId}/resume`)).status, 409);
  assert.equal((await call(memberCookie, 'POST', `/api/standing-rules/${ruleId}/rehearse`, {})).status, 409);
  assert.equal((await call(memberCookie, 'PATCH', `/api/standing-rules/${ruleId}`, { instruction: 'zombie' })).status, 409);
  for (const action of ['standing_rule.pause', 'standing_rule.resume', 'standing_rule.revoke']) {
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n >= 1, `missing audit ${action}`);
  }
});

test('a member cannot mutate another creator’s rule', async () => {
  const restore = stubParse(INTERP(agentId));
  let id;
  try {
    id = (await call(ownerCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'owner rule' })).data.rule.id;
  } finally { restore(); }
  assert.equal((await call(memberCookie, 'PATCH', `/api/standing-rules/${id}`, { instruction: 'hijack' })).status, 403);
  assert.equal((await call(memberCookie, 'POST', `/api/standing-rules/${id}/rehearse`, {})).status, 403);
});

test('scoping cannot cross canvas permissions: every route 403s for a non-member', async () => {
  const restore = stubParse(INTERP(agentId));
  let id;
  try {
    id = (await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'member rule' })).data.rule.id;
  } finally { restore(); }
  assert.equal((await call(outsiderCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'x' })).status, 403);
  assert.equal((await call(outsiderCookie, 'GET', `/api/canvases/${canvasId}/standing-rules`)).status, 403);
  assert.equal((await call(outsiderCookie, 'GET', `/api/standing-rules/${id}`)).status, 403);
  assert.equal((await call(outsiderCookie, 'PATCH', `/api/standing-rules/${id}`, { instruction: 'x' })).status, 403);
  assert.equal((await call(outsiderCookie, 'POST', `/api/standing-rules/${id}/rehearse`, {})).status, 403);
  assert.equal((await call(outsiderCookie, 'GET', `/api/standing-rules/${id}/runs`)).status, 403);

  // Rule-run acknowledge is also canvas-scoped.
  db.prepare(`INSERT INTO standing_rule_runs (id, rule_id, rule_version, authorization_id, occurrence_key, state, needs_attention, created_at)
    VALUES ('rr-cross-1', ?, 1, '', '2026-08-15', 'completed', 1, ?)`).run(id, nowIso());
  assert.equal((await call(outsiderCookie, 'POST', '/api/standing-rule-runs/rr-cross-1/acknowledge')).status, 403);
  db.prepare("DELETE FROM standing_rule_runs WHERE id = 'rr-cross-1'").run();
});

// ---------- T5: NEEDS YOU cards ----------

function insertRuleRun(id, ruleIdArg, fields = {}) {
  db.prepare(`INSERT INTO standing_rule_runs (id, rule_id, rule_version, authorization_id, occurrence_key, state, matched_count, needs_attention, result_summary, created_at)
    VALUES (?, ?, 1, '', ?, ?, ?, ?, ?, ?)`)
    .run(id, ruleIdArg, fields.occurrenceKey || id, fields.state || 'completed', fields.matched ?? null,
      fields.needsAttention ?? 1, fields.summary || '', nowIso());
}

test('rule_alert card appears in NEEDS YOU and clears on acknowledge', async () => {
  const restore = stubParse(INTERP(agentId));
  let alertRuleId;
  try {
    alertRuleId = (await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'alert rule' })).data.rule.id;
  } finally { restore(); }
  db.prepare("UPDATE standing_rules SET state = 'active' WHERE id = ?").run(alertRuleId);
  insertRuleRun('rr-alert-1', alertRuleId, { matched: 2, summary: 'Two deals crossed $50k. MATCHED: 2' });

  let attn = await call(ownerCookie, 'GET', `/api/attention?canvas_id=${canvasId}`);
  const alertCard = attn.data.attention.find((c) => c.type === 'rule_alert' && c.sourceRef.id === 'rr-alert-1');
  assert.ok(alertCard, 'rule_alert card missing');
  assert.match(alertCard.decision, /matched 2/i);
  assert.deepEqual(alertCard.actions, ['acknowledge', 'open_rule']);

  const ack = await call(memberCookie, 'POST', '/api/standing-rule-runs/rr-alert-1/acknowledge');
  assert.equal(ack.status, 200);
  assert.equal(ack.data.run.acknowledged_by, MEMBER);
  attn = await call(ownerCookie, 'GET', `/api/attention?canvas_id=${canvasId}`);
  assert.ok(!attn.data.attention.some((c) => c.sourceRef.id === 'rr-alert-1'), 'acknowledged card must disappear');
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'standing_rule_run.acknowledge'").get().n >= 1);
  // Acknowledge is idempotent.
  assert.equal((await call(memberCookie, 'POST', '/api/standing-rule-runs/rr-alert-1/acknowledge')).status, 200);
});

test('a completed brief surfaces once as brief_ready with the markdown as result', async () => {
  const restore = stubParse(INTERP(agentId, { output_type: 'brief', cadence: 'weekly', cadence_day: 1, category: 'report' }));
  let briefRuleId;
  try {
    briefRuleId = (await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'weekly operating brief' })).data.rule.id;
  } finally { restore(); }
  db.prepare("UPDATE standing_rules SET state = 'active' WHERE id = ?").run(briefRuleId);
  insertRuleRun('rr-brief-1', briefRuleId, { matched: 0, summary: '# Weekly brief\n\nAll steady. NOTHING MATCHED' });

  const attn = await call(ownerCookie, 'GET', `/api/attention?canvas_id=${canvasId}`);
  const briefCard = attn.data.attention.find((c) => c.type === 'brief_ready' && c.sourceRef.id === 'rr-brief-1');
  assert.ok(briefCard, 'brief_ready card missing');
  assert.match(briefCard.context, /Weekly brief/);
  const runs = await call(memberCookie, 'GET', `/api/standing-rules/${briefRuleId}/runs`);
  assert.equal(runs.status, 200);
  assert.match(runs.data.runs[0].result_summary, /# Weekly brief/);
});

test('draft rules never emit cards', async () => {
  const restore = stubParse(INTERP(agentId));
  let draftRuleId;
  try {
    draftRuleId = (await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'still a draft' })).data.rule.id;
  } finally { restore(); }
  insertRuleRun('rr-draft-1', draftRuleId, { matched: 5, summary: 'MATCHED: 5' });
  const attn = await call(ownerCookie, 'GET', `/api/attention?canvas_id=${canvasId}`);
  assert.ok(!attn.data.attention.some((c) => c.sourceRef.id === 'rr-draft-1'), 'draft rule must not surface cards');
});

// ---------- Codex P1: rehearsal authority + activation source viability ----------

// A rehearsal that offers the agent's FULL live authority reads sources the
// owner never reviewed, and stops demonstrating what the restricted scheduled
// run will do — which is the whole point of a rehearse gate. It must carry the
// identical source-limited grant activation computes.
test('a rehearsal runs under the rule’s source-limited authority, not the agent’s full surface', async () => {
  db.prepare('UPDATE agents SET tools_json = NULL WHERE id = ?').run(agentId); // agent itself unrestricted
  const restore = stubParse(INTERP(agentId, { sources: ['hubspot', 'memory'] }));
  let scopedRuleId;
  try {
    const parsed = await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'watch hubspot only' });
    assert.equal(parsed.status, 200);
    scopedRuleId = parsed.data.rule.id;
  } finally { restore(); }

  const rehearsed = await call(memberCookie, 'POST', `/api/standing-rules/${scopedRuleId}/rehearse`, {});
  assert.equal(rehearsed.status, 200);
  await waitForRun(rehearsed.data.run.id);

  const snapshot = db.prepare('SELECT authority_json FROM runs WHERE id = ?').get(rehearsed.data.run.id).authority_json;
  assert.notEqual(snapshot, null, 'a null snapshot is UNRESTRICTED to intersectAuthority — the ceiling would be missing');
  const granted = JSON.parse(snapshot);
  assert.ok(granted.length > 0 && granted.every((n) => n.startsWith('hs_')),
    `the reviewed hubspot source and nothing else, got ${granted.join(', ') || '(empty)'}`);
  assert.ok(!granted.some((n) => n.startsWith('ws_') || n === 'web_search'),
    'unreviewed Workspace/web surfaces must not be reachable in a rehearsal');
  // Exactly what activation would snapshot — one resolution, reused.
  const agentRow = db.prepare('SELECT id, role, tools_json FROM agents WHERE id = ?').get(agentId);
  assert.deepEqual(granted, standingRules.grantedTools(standingRules.getRule(scopedRuleId), agentRow, MEMBER));

  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(scopedRuleId);
});

// A reviewed source that resolves to no readable tool is a lamp faking green:
// the card says the rule watches Gmail, the run cannot look, and it finalizes
// NOTHING MATCHED forever with no alert. Activation must refuse instead.
test('activation refuses a rule whose reviewed source grants no readable tool', async () => {
  db.prepare('UPDATE agents SET tools_json = NULL WHERE id = ?').run(agentId);
  const restore = stubParse(INTERP(agentId, { sources: ['gmail', 'memory'] }));
  let gmailRuleId;
  try {
    const parsed = await call(memberCookie, 'POST', `/api/canvases/${canvasId}/standing-rules/parse`, { instruction: 'watch my inbox' });
    assert.equal(parsed.status, 200);
    gmailRuleId = parsed.data.rule.id;
  } finally { restore(); }
  // The OWNER rehearses: activation now requires the rehearsal to have run as
  // the identity the grant will be spent as, and a Workspace rule requires
  // that identity to actually be connected.
  connectGoogle(OWNER);
  const rehearsed = await call(ownerCookie, 'POST', `/api/standing-rules/${gmailRuleId}/rehearse`, {});
  assert.equal(rehearsed.status, 200);
  await waitForRun(rehearsed.data.run.id);

  const prevScopes = process.env.GOOGLE_WORKSPACE_SCOPES;
  try {
    // Standard scopes drop every Gmail tool from the menu, so the grant for a
    // Gmail rule resolves empty — the exact case Codex reported.
    process.env.GOOGLE_WORKSPACE_SCOPES = 'standard';
    const agentRow = db.prepare('SELECT id, role, tools_json FROM agents WHERE id = ?').get(agentId);
    const rule = standingRules.getRule(gmailRuleId);
    assert.deepEqual(standingRules.grantedTools(rule, agentRow, OWNER), [], 'precondition: the grant really is empty');
    assert.deepEqual(standingRules.unreadableSources(rule, []), ['gmail'], 'memory is ungoverned and never counted');

    const refused = await call(ownerCookie, 'POST', `/api/standing-rules/${gmailRuleId}/activate`);
    assert.equal(refused.status, 409, 'a rule that could never look must not activate');
    assert.match(refused.data.error, /gmail/i, 'the error names the offending source');
    const stillRehearsed = standingRules.getRule(gmailRuleId);
    assert.equal(stillRehearsed.state, 'rehearsed', 'refusal leaves the rule where it was');
    assert.equal(standingRules.currentAuthorization(gmailRuleId), undefined, 'no grant was minted');
  } finally {
    if (prevScopes === undefined) delete process.env.GOOGLE_WORKSPACE_SCOPES;
    else process.env.GOOGLE_WORKSPACE_SCOPES = prevScopes;
  }

  // Same rule, deployment that can actually honour Gmail: activation proceeds.
  const activated = await call(ownerCookie, 'POST', `/api/standing-rules/${gmailRuleId}/activate`);
  assert.equal(activated.status, 200, 'the guard is about an empty grant, not about Gmail');
  assert.ok(JSON.parse(activated.data.authorization.allowed_tools_json).some((n) => n.startsWith('ws_gmail_')));
  db.prepare("UPDATE standing_rules SET state = 'revoked' WHERE id = ?").run(gmailRuleId);
  disconnectGoogle(OWNER);
});

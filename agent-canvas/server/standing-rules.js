'use strict';
// P5 standing rules service. Core stance: a standing rule is a stored
// instruction + a persisted, server-verifiable authorization, and a rule run
// IS a normal ask-mode run dispatched by the tick instead of a human click.
// No new execution engine, no cron parser: cadence enum + slot, occurrence
// keys derived from the due time, and a conditional-claim lease on the
// occurrence row. Mirrors builder.js's role for P4.

const crypto = require('node:crypto');
const { db, tx, nowIso, getSetting } = require('./db');
const { audit } = require('./audit');
const auth = require('./auth');
const evidence = require('./evidence');
const workspace = require('./google/workspace');
const control = require('./orchestrator/control');
const { dispatchRun } = require('./orchestrator/queue');

const CADENCES = ['hourly', 'daily', 'weekly'];
const OUTPUT_TYPES = ['alert', 'brief'];
const CATEGORIES = ['watch', 'report', 'digest'];
const SOURCES = ['gmail', 'drive', 'sheets', 'calendar', 'hubspot', 'memory', 'web', 'mcp'];
// Sources that read through the grantor's own Google connection — a rule
// watching these skips (with an alert) when that connection is gone.
const WORKSPACE_SOURCES = new Set(['gmail', 'drive', 'sheets', 'calendar']);
const STEP_BUDGET_RANGE = [1, 64];
const WALL_MS_RANGE = [30_000, 1_800_000];
const MAX_ATTEMPTS = 2;
const LEASE_MS = 10 * 60_000;

function flagOn() { return getSetting('standing_rules', '1') === '1'; }

// ---------- interpretation: parse prompt + validation ----------
// The model proposes; the server validates and clamps EVERYTHING. The model
// never grants anything — agent_id must come from the server-supplied list,
// cadence/output_type from the enums, budgets from the clamped ranges.
const PARSE_SYSTEM = (agents) => `You interpret ONE plain-language standing rule ("watch X and alert me", "brief me weekly on Y") for a shared multi-agent workspace. Return ONLY a JSON object with EXACTLY these fields:
{"summary": "<one sentence: what is watched and what happens>",
 "sources": [<zero or more of: ${SOURCES.map((s) => `"${s}"`).join(', ')}>],
 "scope": "<what exactly is watched, in plain language>",
 "category": "<one of: ${CATEGORIES.join(' | ')}>",
 "output_type": "<alert = raise only when something needs attention | brief = a written operating brief every time>",
 "cadence": "<${CADENCES.join(' | ')}>", "cadence_hour": <0-23 UTC>, "cadence_day": <0-6 Sunday=0, weekly only, else null>,
 "agent_id": "<the id of the best-suited agent, FROM THE LIST BELOW ONLY>",
 "step_budget": <integer ${STEP_BUDGET_RANGE[0]}-${STEP_BUDGET_RANGE[1]}>, "wall_ms_budget": <integer ms ${WALL_MS_RANGE[0]}-${WALL_MS_RANGE[1]}>,
 "expires_days": <integer 1-365; default 90>,
 "can": ["<plain language: what running this rule may do>"],
 "cannot": ["<plain language: what it will never do>"]}
AVAILABLE AGENTS (the only valid agent_id values):
${agents.map((a) => `- ${a.name} (${a.role}, id ${a.id})`).join('\n')}
Rule runs execute read-only (ask mode): they can never send, write, or change anything outside the workspace — reflect that in "cannot". No prose outside the JSON.`;

function validateInterpretation(raw, { agents = [] } = {}) {
  const bad = (msg) => { const e = new Error(msg); e.status = 400; throw e; };
  if (!raw || typeof raw !== 'object') bad('interpretation must be an object');
  const p = {};
  p.summary = String(raw.summary || '').trim().slice(0, 500);
  if (!p.summary) bad('interpretation.summary required');
  p.sources = [...new Set((Array.isArray(raw.sources) ? raw.sources : []).map(String))].filter((s) => SOURCES.includes(s));
  p.scope = String(raw.scope || '').trim().slice(0, 1000);
  if (!p.scope) bad('interpretation.scope required');
  p.category = CATEGORIES.includes(raw.category) ? raw.category : 'watch';
  if (!OUTPUT_TYPES.includes(raw.output_type)) bad(`interpretation.output_type must be one of ${OUTPUT_TYPES.join(', ')}`);
  p.output_type = raw.output_type;
  if (!CADENCES.includes(raw.cadence)) bad(`interpretation.cadence must be one of ${CADENCES.join(', ')}`);
  p.cadence = raw.cadence;
  const hour = Number(raw.cadence_hour);
  p.cadence_hour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8;
  if (p.cadence === 'weekly') {
    const day = Number(raw.cadence_day);
    if (!Number.isInteger(day) || day < 0 || day > 6) bad('interpretation.cadence_day (0-6) required for weekly cadence');
    p.cadence_day = day;
  } else {
    p.cadence_day = null;
  }
  if (!agents.some((a) => a.id === raw.agent_id)) bad('interpretation.agent_id must be an active agent on this canvas');
  p.agent_id = raw.agent_id;
  const step = Number(raw.step_budget);
  p.step_budget = Number.isInteger(step) && step >= STEP_BUDGET_RANGE[0] && step <= STEP_BUDGET_RANGE[1] ? step : 12;
  const wall = Number(raw.wall_ms_budget);
  p.wall_ms_budget = Number.isInteger(wall) && wall >= WALL_MS_RANGE[0] && wall <= WALL_MS_RANGE[1] ? wall : 300_000;
  const days = Number(raw.expires_days);
  p.expires_days = Number.isInteger(days) && days >= 1 && days <= 365 ? days : 90;
  p.can = (Array.isArray(raw.can) ? raw.can : []).map((s) => String(s).slice(0, 200)).slice(0, 10);
  p.cannot = (Array.isArray(raw.cannot) ? raw.cannot : []).map((s) => String(s).slice(0, 200)).slice(0, 10);
  return p;
}

// ---------- occurrence key + next_run_at math (UTC, no cron) ----------
// ponytail: 3-value cadence enum; add cron parsing when someone actually asks
// for "every 2nd Tuesday".
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // shift to this ISO week's Thursday
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Deterministic from the DUE time (never "now"): duplicate scheduler delivery
// of the same occurrence derives the same key and hits the UNIQUE constraint.
function occurrenceKey(rule, dueIso) {
  if (rule.cadence === 'hourly') return String(dueIso).slice(0, 13); // 2026-08-15T14
  if (rule.cadence === 'daily') return String(dueIso).slice(0, 10); // 2026-08-15
  return isoWeekKey(new Date(dueIso)); // 2026-W33
}

function nextRunAt(rule, from = new Date()) {
  const t = from.getTime();
  if (rule.cadence === 'hourly') {
    return new Date(Math.floor(t / 3_600_000) * 3_600_000 + 3_600_000).toISOString();
  }
  const hour = Number.isInteger(rule.cadence_hour) ? rule.cadence_hour : 8;
  const c = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, 0, 0, 0));
  if (rule.cadence === 'daily') {
    if (c.getTime() <= t) c.setUTCDate(c.getUTCDate() + 1);
    return c.toISOString();
  }
  const day = Number.isInteger(rule.cadence_day) ? rule.cadence_day : 1;
  c.setUTCDate(c.getUTCDate() + ((day - c.getUTCDay() + 7) % 7));
  if (c.getTime() <= t) c.setUTCDate(c.getUTCDate() + 7);
  return c.toISOString();
}

// ---------- rule rows ----------
function getRule(id) {
  return db.prepare('SELECT * FROM standing_rules WHERE id = ?').get(id);
}

function ruleView(rule) {
  if (!rule) return null;
  return {
    ...rule,
    interpretation: JSON.parse(rule.interpretation_json || '{}'),
    source_scope: JSON.parse(rule.source_scope_json || '{}'),
  };
}

// Create a draft rule, or re-interpret an existing one. Any change resets the
// rehearsal gate (state→draft, rehearsal_run_id cleared) and bumps version —
// what activates must be what rehearsed.
function upsertDraft({ canvasId, ruleId = null, instruction, interp, actor }) {
  const ts = nowIso();
  const cols = {
    agent_id: interp.agent_id,
    instruction,
    interpretation_json: JSON.stringify(interp),
    category: interp.category,
    source_scope_json: JSON.stringify({ sources: interp.sources, scope: interp.scope }),
    output_type: interp.output_type,
    cadence: interp.cadence,
    cadence_hour: interp.cadence_hour,
    cadence_day: interp.cadence_day,
    step_budget: interp.step_budget,
    wall_ms_budget: interp.wall_ms_budget,
  };
  if (ruleId) {
    db.prepare(`UPDATE standing_rules SET agent_id = ?, instruction = ?, interpretation_json = ?, category = ?,
        source_scope_json = ?, output_type = ?, cadence = ?, cadence_hour = ?, cadence_day = ?,
        step_budget = ?, wall_ms_budget = ?, state = 'draft', rehearsal_run_id = NULL,
        version = version + 1, updated_at = ? WHERE id = ?`)
      .run(cols.agent_id, cols.instruction, cols.interpretation_json, cols.category, cols.source_scope_json,
        cols.output_type, cols.cadence, cols.cadence_hour, cols.cadence_day, cols.step_budget, cols.wall_ms_budget, ts, ruleId);
    return getRule(ruleId);
  }
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO standing_rules (id, canvas_id, agent_id, owner_email, instruction, interpretation_json,
      category, source_scope_json, output_type, cadence, cadence_hour, cadence_day, step_budget, wall_ms_budget,
      created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, canvasId, cols.agent_id, actor, cols.instruction, cols.interpretation_json, cols.category,
      cols.source_scope_json, cols.output_type, cols.cadence, cols.cadence_hour, cols.cadence_day,
      cols.step_budget, cols.wall_ms_budget, actor, ts, ts);
  return getRule(id);
}

// ---------- authorization lifecycle (D5) ----------
function createAuthorization({ rule, authorizedBy, expiresAt }) {
  const agent = db.prepare('SELECT tools_json FROM agents WHERE id = ?').get(rule.agent_id) || {};
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO standing_authorizations (id, rule_id, canvas_id, authorized_by, workspace_role_at_grant,
      allowed_tools_json, mode, granted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'ask', ?, ?)`)
    .run(id, rule.id, rule.canvas_id, authorizedBy, auth.workspaceRole(authorizedBy), agent.tools_json ?? null, nowIso(), expiresAt);
  return db.prepare('SELECT * FROM standing_authorizations WHERE id = ?').get(id);
}

function currentAuthorization(ruleId) {
  return db.prepare('SELECT * FROM standing_authorizations WHERE rule_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC, rowid DESC LIMIT 1').get(ruleId);
}

function revokeAuthorization(ruleId, actor) {
  db.prepare('UPDATE standing_authorizations SET revoked_at = ?, revoked_by = ? WHERE rule_id = ? AND revoked_at IS NULL')
    .run(nowIso(), actor, ruleId);
}

function touchesWorkspace(rule) {
  try {
    const scope = JSON.parse(rule.source_scope_json || '{}');
    return (Array.isArray(scope.sources) ? scope.sources : []).some((s) => WORKSPACE_SOURCES.has(s));
  } catch { return false; }
}

// Server-verified per dispatch, inside the tick tx. Scoping cannot outlive the
// grantor's access: the grantor must still be allowlisted AND still hold edit
// access to the rule's canvas. Never invents an interactive user.
function verifyAuthorization(rule, authz, now = new Date(), { checkWorkspace = true } = {}) {
  if (!authz) return { ok: false, reason: 'no standing authorization' };
  if (authz.revoked_at) return { ok: false, reason: 'authorization revoked' };
  if (authz.expires_at && authz.expires_at <= now.toISOString()) return { ok: false, reason: 'authorization expired' };
  const entry = auth.allowlistEntry(authz.authorized_by);
  if (!entry) return { ok: false, reason: 'grantor no longer on the workspace allowlist' };
  const check = auth.canEditCanvas({ role: entry.role, email: authz.authorized_by }, rule.canvas_id);
  if (!check.ok) return { ok: false, reason: 'grantor no longer has edit access to this canvas' };
  if (rule.state !== 'active') return { ok: false, reason: `rule is ${rule.state}` };
  if (rule.expires_at && rule.expires_at <= now.toISOString()) return { ok: false, reason: 'rule expired' };
  if (checkWorkspace && touchesWorkspace(rule) && !workspace.isConnected(authz.authorized_by)) {
    // Skip + alert, never a silent failure: the grantor's Google connection is
    // what the run's reads would act as.
    return { ok: false, reason: 'workspace_disconnected', alert: true };
  }
  return { ok: true };
}

// ---------- instruction templates ----------
// The MATCHED contract is the whole structured-output surface: the finalizer
// greps the final line into matched_count. ponytail: matched_count parsed from
// summary; add a completion tool if rules ever need structured match lists.
const MATCHED_CONTRACT = 'End your summary with a final line reading exactly "MATCHED: <n>" (the count of items that matched or need attention) or "NOTHING MATCHED" if nothing did.';

function ruleInstruction(rule) {
  let scope = '';
  try { scope = JSON.parse(rule.source_scope_json || '{}').scope || ''; } catch { /* keep empty */ }
  const scopeLine = scope ? `Scope: ${scope}\n` : '';
  if (rule.output_type === 'brief') {
    return `Scheduled ${rule.cadence} brief (standing rule ${rule.id}). ${rule.instruction}\n${scopeLine}Write the operating brief in markdown with source references (evidence refs) and explicit uncertainty — state plainly what you could not verify. Record selected conclusions as memory entries with evidence references; never copy whole source records. ${MATCHED_CONTRACT}`;
  }
  return `Scheduled ${rule.cadence} watch (standing rule ${rule.id}). ${rule.instruction}\n${scopeLine}Check what this rule watches and raise ONLY what genuinely needs a human's attention — "nothing to report" is a valid result. Record selected conclusions as memory entries with evidence references; never copy whole source records. ${MATCHED_CONTRACT}`;
}

function rehearsalInstruction(rule) {
  return `REHEARSAL against recent data: report exactly what WOULD have matched in the last 7 days; change nothing.\n${ruleInstruction(rule)}`;
}

function parseMatchedCount(summary) {
  if (!summary) return null;
  const m = /MATCHED:\s*(\d+)/i.exec(summary);
  if (m) return Number(m[1]);
  if (/NOTHING\s+MATCHED/i.test(summary)) return 0;
  return null;
}

// ---------- finalize + retry (D7) ----------
function leaseIso(now) { return new Date(now.getTime() + LEASE_MS).toISOString(); }

// Retry with a fresh run on the SAME occurrence row (attempt max 2), then
// failed + alert. The prior run id is preserved in retry_run_ids_json.
function retryOrFail(rr, reason, now = new Date()) {
  if (rr.attempt >= MAX_ATTEMPTS) {
    db.prepare("UPDATE standing_rule_runs SET state = 'failed', error = ?, needs_attention = 1, ended_at = ? WHERE id = ?")
      .run(String(reason).slice(0, 300), nowIso(), rr.id);
    audit('system', 'standing-rules', 'standing_rule_run.fail', { ruleId: rr.rule_id, ruleRunId: rr.id, attempts: rr.attempt, reason: String(reason).slice(0, 200) });
    return;
  }
  const rule = getRule(rr.rule_id);
  const authz = currentAuthorization(rr.rule_id);
  const check = rule ? verifyAuthorization(rule, authz, now) : { ok: false, reason: 'rule missing' };
  if (!check.ok) {
    db.prepare("UPDATE standing_rule_runs SET state = 'skipped', skip_reason = ?, needs_attention = ?, ended_at = ? WHERE id = ?")
      .run(check.reason, check.alert ? 1 : 0, nowIso(), rr.id);
    return;
  }
  tx(() => {
    const run = dispatchRun({
      agentId: rule.agent_id, canvasId: rule.canvas_id, instruction: ruleInstruction(rule),
      triggerKind: 'system', mode: 'ask', initiatedBy: authz.authorized_by, actor: 'standing-rules',
      stepBudget: rule.step_budget || undefined, wallMs: rule.wall_ms_budget || undefined,
    });
    const prior = JSON.parse(rr.retry_run_ids_json || '[]');
    if (rr.run_id) prior.push(rr.run_id);
    db.prepare('UPDATE standing_rule_runs SET run_id = ?, retry_run_ids_json = ?, attempt = attempt + 1, lease_until = ? WHERE id = ?')
      .run(run.id, JSON.stringify(prior), leaseIso(now), rr.id);
    audit('system', 'standing-rules', 'standing_rule_run.retry', { ruleId: rr.rule_id, ruleRunId: rr.id, runId: run.id, attempt: rr.attempt + 1, reason: String(reason).slice(0, 200) });
  });
}

// Sweep every claimed occurrence whose run reached a terminal state (or whose
// lease expired while non-terminal) and copy the run's own outputs — summary,
// evidence refs, cost — onto the rule-run row. The run IS the result (D3).
function finalizeRuleRuns(now = new Date()) {
  let finalized = 0;
  const open = db.prepare(`SELECT rr.*, r.output_type FROM standing_rule_runs rr
    JOIN standing_rules r ON r.id = rr.rule_id WHERE rr.state = 'running'`).all();
  for (const rr of open) {
    try {
      const run = rr.run_id ? db.prepare('SELECT * FROM runs WHERE id = ?').get(rr.run_id) : null;
      if (run && run.status === 'completed') {
        const matched = parseMatchedCount(run.summary);
        const needsAttention = rr.output_type === 'brief' ? 1 : (matched > 0 ? 1 : 0);
        db.prepare(`UPDATE standing_rule_runs SET state = 'completed', result_summary = ?, matched_count = ?,
            output_refs_json = ?, cost_usd = ?, needs_attention = ?, ended_at = ? WHERE id = ?`)
          .run(run.summary || '', matched, JSON.stringify(evidence.refsForRun(run.id)), run.cost_usd || 0,
            needsAttention, run.ended_at || nowIso(), rr.id);
        finalized += 1;
      } else if (run && !['queued', 'running'].includes(run.status)) {
        retryOrFail(rr, `run ${run.status}${run.error ? `: ${run.error}` : ''}`, now);
        finalized += 1;
      } else if (rr.lease_until && rr.lease_until <= now.toISOString()) {
        retryOrFail(rr, run ? `lease expired while run ${run.status}` : 'lease expired with no run', now);
        finalized += 1;
      }
    } catch (err) {
      // One bad occurrence must not kill the sweep — record and continue.
      audit('system', 'standing-rules', 'standing_rule_run.fail', { ruleRunId: rr.id, error: String(err.message || err).slice(0, 200) });
    }
  }
  return finalized;
}

// ---------- the tick (D1/D2/D5/D7) ----------
// Claim + dispatch one due rule. The occurrence insert IS the claim: BEGIN
// IMMEDIATE serializes writers, and a duplicate delivery of the same
// occurrence hits UNIQUE(rule_id, occurrence_key) and no-ops.
function claimAndDispatch(rule, now) {
  const dueIso = rule.next_run_at;
  const key = occurrenceKey(rule, dueIso);
  const nextIso = nextRunAt(rule, now);
  const authz = currentAuthorization(rule.id);
  let outcome = null;
  tx(() => {
    const id = crypto.randomUUID();
    const ins = db.prepare(`INSERT OR IGNORE INTO standing_rule_runs (id, rule_id, rule_version, authorization_id, occurrence_key, state, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
      .run(id, rule.id, rule.version, authz ? authz.id : '', key, nowIso());
    if (ins.changes === 0) {
      // Duplicate delivery — the occurrence is already claimed. Advance the
      // schedule and move on: one occurrence, one run, ever.
      db.prepare('UPDATE standing_rules SET next_run_at = ? WHERE id = ?').run(nextIso, rule.id);
      outcome = { claimed: false, reason: 'duplicate occurrence' };
      return;
    }
    const check = verifyAuthorization(rule, authz, now);
    if (!check.ok) {
      db.prepare("UPDATE standing_rule_runs SET state = 'skipped', skip_reason = ?, needs_attention = ?, ended_at = ? WHERE id = ?")
        .run(check.reason, check.alert ? 1 : 0, nowIso(), id);
      db.prepare('UPDATE standing_rules SET next_run_at = ? WHERE id = ?').run(nextIso, rule.id);
      outcome = { claimed: false, reason: check.reason };
      return;
    }
    // Byte-for-byte the room-refresh dispatch template: a normal run, ask
    // mode hard-coded (no parameter to escalate), system trigger, acting as
    // the human who authorized the rule — never an invented identity.
    const run = dispatchRun({
      agentId: rule.agent_id, canvasId: rule.canvas_id, instruction: ruleInstruction(rule),
      triggerKind: 'system', mode: 'ask', initiatedBy: authz.authorized_by, actor: 'standing-rules',
      stepBudget: rule.step_budget || undefined, wallMs: rule.wall_ms_budget || undefined,
    });
    db.prepare("UPDATE standing_rule_runs SET state = 'running', run_id = ?, attempt = 1, lease_until = ? WHERE id = ?")
      .run(run.id, leaseIso(now), id);
    db.prepare('UPDATE standing_rules SET next_run_at = ?, last_run_at = ? WHERE id = ?').run(nextIso, nowIso(), rule.id);
    audit('system', 'standing-rules', 'standing_rule_run.dispatch', {
      ruleId: rule.id, ruleRunId: id, runId: run.id, occurrenceKey: key, initiatedBy: authz.authorized_by,
    });
    outcome = { claimed: true, runId: run.id };
  });
  return outcome;
}

function tick({ source = 'owner', actor = 'system' } = {}) {
  // Flag gate FIRST: setSetting('standing_rules','0') stops scheduled
  // execution before a single rule row is read — the no-deploy rollback.
  if (!flagOn()) return { skipped: 'flag off' };
  const finalized = finalizeRuleRuns();
  if (control.isPaused()) {
    audit(source === 'scheduler' ? 'system' : 'user', actor, 'standing_rule.tick', { source, skipped: 'workspace paused', finalized });
    return { skipped: 'workspace paused', finalized };
  }
  const now = new Date();
  const due = db.prepare("SELECT * FROM standing_rules WHERE state = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?")
    .all(now.toISOString());
  let claimed = 0;
  const skipped = [];
  for (const rule of due) {
    if (rule.expires_at && rule.expires_at <= now.toISOString()) {
      db.prepare("UPDATE standing_rules SET state = 'expired', updated_at = ? WHERE id = ?").run(nowIso(), rule.id);
      audit('system', actor, 'standing_rule.expire', { ruleId: rule.id });
      skipped.push({ ruleId: rule.id, reason: 'rule expired' });
      continue;
    }
    try {
      const result = claimAndDispatch(rule, now);
      if (result && result.claimed) claimed += 1;
      else skipped.push({ ruleId: rule.id, reason: result ? result.reason : 'unclaimed' });
    } catch (err) {
      // Budget 429 etc: the tx rolled back, next_run_at unchanged — the next
      // tick retries the same occurrence. Never silent.
      skipped.push({ ruleId: rule.id, reason: String(err.message || err).slice(0, 200) });
    }
  }
  audit(source === 'scheduler' ? 'system' : 'user', actor, 'standing_rule.tick', { source, due: due.length, claimed, skipped: skipped.length, finalized });
  return { due: due.length, claimed, skipped, finalized };
}

// ---------- tick OIDC verification (D1) ----------
// Reuses the exact sign-in machinery: Google-signed ID token verified against
// TICK_AUDIENCE; the caller must be the configured invoker SA. Seam is
// test-only; production always verifies for real.
const { OAuth2Client } = require('google-auth-library');
let tickClient = null;
let tickVerifier = async (idToken, audience) => {
  if (!tickClient) tickClient = new OAuth2Client();
  const ticket = await tickClient.verifyIdToken({ idToken, audience });
  return ticket.getPayload();
};
function verifyTickOidc(idToken, audience) { return tickVerifier(idToken, audience); }

module.exports = {
  CADENCES, OUTPUT_TYPES, CATEGORIES, SOURCES, MAX_ATTEMPTS, LEASE_MS,
  PARSE_SYSTEM, validateInterpretation,
  occurrenceKey, nextRunAt, isoWeekKey,
  getRule, ruleView, upsertDraft,
  createAuthorization, currentAuthorization, revokeAuthorization, verifyAuthorization, touchesWorkspace,
  ruleInstruction, rehearsalInstruction, parseMatchedCount,
  finalizeRuleRuns, tick, verifyTickOidc,
  _internal: {
    claimAndDispatch, retryOrFail,
    setTickVerifier(fn) { const prev = tickVerifier; tickVerifier = fn; return () => { tickVerifier = prev; }; },
  },
};

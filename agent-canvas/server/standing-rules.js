'use strict';
// P5 standing rules service. Core stance: a standing rule is a stored
// instruction + a persisted, server-verifiable authorization, and a rule run
// IS a normal ask-mode run dispatched by the tick instead of a human click.
// No new execution engine, no cron parser: cadence enum + slot, occurrence
// keys derived from the due time, and a conditional-claim lease on the
// occurrence row. Mirrors builder.js's role for P4.

const crypto = require('node:crypto');
const { db, tx, nowIso, getSetting, setSetting } = require('./db');
const { audit } = require('./audit');
const auth = require('./auth');
const bus = require('./bus');
const evidence = require('./evidence');
const workspace = require('./google/workspace');
const control = require('./orchestrator/control');
const { dispatchRun } = require('./orchestrator/queue');

const CADENCES = ['hourly', 'daily', 'weekly'];
const OUTPUT_TYPES = ['alert', 'brief'];
const CATEGORIES = ['watch', 'report', 'digest'];
// No 'mcp': rule runs are ask-mode, and every mcp_* tool is blocked outside act
// mode (orchestrator/tools.js blockedInMode). Offering it would let a card tell
// the owner it is watching a source the run can never read.
// 'enrichment' IS offered: it reaches the deployment's own enrichment lane
// through the same review-then-grant path as every other source, and it is
// disabled-by-absence rather than blocked-by-mode — see unreadableNow below,
// which covers it the same way it covers every other source.
const SOURCES = ['gmail', 'drive', 'sheets', 'calendar', 'hubspot', 'enrichment', 'memory', 'web'];
// Sources that read through the grantor's own Google connection — a rule
// watching these skips (with an alert) when that connection is gone.
const WORKSPACE_SOURCES = new Set(['gmail', 'drive', 'sheets', 'calendar']);
const STEP_BUDGET_RANGE = [1, 64];
const WALL_MS_RANGE = [30_000, 1_800_000];
const MAX_ATTEMPTS = 2;
// The lease must outlive the run it guards. A flat 10 minutes over a wall
// budget of up to 30 expires while the run is legitimately still working, and
// the finalizer then dispatches a SECOND attempt alongside the first: two runs
// spending the same occurrence's budget and writing conflicting memory.
const LEASE_FLOOR_MS = 10 * 60_000;
const LEASE_SLACK_MS = 5 * 60_000; // queue wait + finalize latency

function flagOn() { return getSetting('standing_rules', '1') === '1'; }

// The systems-board lamp for the scheduling lane earns green from EVIDENCE —
// an OIDC-verified call that actually arrived — never from env presence, which
// proves only that two strings are set and nothing about whether a Cloud
// Scheduler job exists. Stamped durably (a restart must not forget: min-
// instances 0 means the container is usually cold between hourly ticks, and an
// in-process record would read amber forever).
const LAST_SCHEDULER_TICK = 'standing_rules_last_scheduler_tick';
function lastSchedulerTick() { return getSetting(LAST_SCHEDULER_TICK, '') || null; }

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
    tx(() => {
      // Editing an ACTIVE rule flips it to draft, and a draft rule emits no
      // attention cards — so an occurrence left running would finish the OLD
      // approved instruction, write memory under the old authorization, and
      // its card would be invisible to the person who just edited it. Same
      // stop as pause/revoke. Covers PATCH and re-parse: both land here.
      haltRuleRuns(ruleId, 'rule edited');
      db.prepare(`UPDATE standing_rules SET agent_id = ?, instruction = ?, interpretation_json = ?, category = ?,
          source_scope_json = ?, output_type = ?, cadence = ?, cadence_hour = ?, cadence_day = ?,
          step_budget = ?, wall_ms_budget = ?, state = 'draft', rehearsal_run_id = NULL, next_run_at = NULL,
          version = version + 1, updated_at = ? WHERE id = ?`)
        .run(cols.agent_id, cols.instruction, cols.interpretation_json, cols.category, cols.source_scope_json,
          cols.output_type, cols.cadence, cols.cadence_hour, cols.cadence_day, cols.step_budget, cols.wall_ms_budget, ts, ruleId);
    });
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
// The governed tools each reviewed source actually needs. A source the owner
// read on the consent card is the ONLY reason a rule may reach that surface —
// otherwise the card describes a constraint that does not exist.
const SOURCE_TOOLS = {
  gmail: (n) => n.startsWith('ws_gmail_'),
  drive: (n) => n.startsWith('ws_drive_') || n.startsWith('ws_docs_'),
  sheets: (n) => n.startsWith('ws_sheets_'),
  calendar: (n) => n.startsWith('ws_calendar_'),
  hubspot: (n) => n.startsWith('hs_'),
  // Mirrors the enrichment clause of tools.js governedTool — one lane, one
  // definition of what belongs to it.
  enrichment: (n) => n.startsWith('enrich_') || n === 'verify_email' || n === 'get_enriched_contact',
  web: (n) => n === 'web_search',
  memory: () => false, // memory/notes/escalate are never governed tools
};

function ruleSources(rule) {
  try {
    const s = JSON.parse(rule.source_scope_json || '{}').sources;
    return (Array.isArray(s) ? s : []).filter((x) => SOURCES.includes(x));
  } catch { return []; }
}

// The CONCRETE governed surface a rule run may ever touch, resolved at GRANT
// time: this deployment's menu for the agent's role, intersected with the
// agent's own authority map, intersected with the tools the reviewed sources
// need. Never null. A null snapshot is "unrestricted" to intersectAuthority,
// so a legacy agent (tools_json NULL) would leave the ceiling floating with
// the deployment — every connector enabled or authority published afterwards
// silently widening a rule nobody re-consented to.
function grantedTools(rule, agent, grantor) {
  const { authorityMenu, parseAuthority } = require('./orchestrator/tools');
  const menu = authorityMenu(agent.role || 'research', { userRole: auth.workspaceRole(grantor) }).map((m) => m.name);
  const agentAuthority = parseAuthority(agent.tools_json);
  const sources = ruleSources(rule);
  const bySource = (n) => sources.some((s) => (SOURCE_TOOLS[s] || (() => false))(n));
  return menu.filter((n) => bySource(n) && (!agentAuthority || agentAuthority.includes(n)));
}

// The reviewed EXTERNAL sources that `granted` cannot actually read. THE one
// definition of "this source contributes no readable tool", used at both
// moments it matters: activation refuses to mint such a grant (routes
// activate), and the tick refuses to spend one (unreadableNow). Two subtly
// different answers to this question is exactly how a green lamp survives.
// 'memory' is excluded by construction: memory/notes/escalate are ungoverned,
// always present, and SOURCE_TOOLS.memory returns false for every name.
function unreadableSources(rule, granted) {
  const list = (Array.isArray(granted) ? granted : []).map(String);
  return ruleSources(rule).filter((s) => s !== 'memory'
    && !list.some((n) => (SOURCE_TOOLS[s] || (() => false))(n)));
}

// Is this run one of a standing rule's attempts? The current attempt lives on
// run_id; superseded ones survive only in retry_run_ids_json, and those are
// terminal — exactly what the generic retry endpoint accepts.
// ponytail: instr() over the JSON array text rather than a join table; ids are
// UUIDs, so a quoted substring hit is the id and nothing else.
function isStandingRuleRun(runId) {
  if (!runId) return false;
  return !!db.prepare(`SELECT 1 FROM standing_rule_runs
      WHERE run_id = ? OR instr(COALESCE(retry_run_ids_json, ''), ?) > 0 LIMIT 1`)
    .get(String(runId), JSON.stringify(String(runId)));
}

function createAuthorization({ rule, authorizedBy, expiresAt }) {
  const agent = db.prepare('SELECT role, tools_json FROM agents WHERE id = ?').get(rule.agent_id) || {};
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO standing_authorizations (id, rule_id, canvas_id, authorized_by, workspace_role_at_grant,
      allowed_tools_json, mode, granted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'ask', ?, ?)`)
    .run(id, rule.id, rule.canvas_id, authorizedBy, auth.workspaceRole(authorizedBy),
      JSON.stringify(grantedTools(rule, agent, authorizedBy)), nowIso(), expiresAt);
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

// The reviewed sources this rule can no longer read, re-resolved per tick.
// Activation can only see the deployment as it was that day; every source is
// disabled-by-absence at runtime, so any of them can go dark afterwards —
// GOOGLE_WORKSPACE_SCOPES flipped to standard drops every ws_gmail_* tool,
// ED_DISPATCH_URL unset drops the enrichment lane, ENABLE_WEB_SEARCH=0 drops
// web_search, the agent's role or authority narrowing drops whatever it named.
// Without this the rule keeps running, keeps finalizing NOTHING MATCHED, and
// keeps displaying as a healthy active watch over a source it cannot read.
//
// The frozen grant INTERSECTED with what this deployment and the agent's live
// authority would grant today. An intersection only ever narrows, which is the
// whole point: a deploy that lights a lane back up can never widen a snapshot
// nobody re-consented to (a grant frozen empty stays empty and stays skipped),
// while one that goes dark is caught on the very next tick. Re-activation
// remains the only thing that re-resolves a grant.
function unreadableNow(rule, authz) {
  let granted = [];
  try { granted = JSON.parse((authz && authz.allowed_tools_json) || '[]'); } catch { /* treat as empty */ }
  // Same lookup createAuthorization used to mint the grant, so both sides of
  // the comparison are resolved the same way.
  const agent = db.prepare('SELECT role, tools_json FROM agents WHERE id = ?').get(rule.agent_id) || {};
  const live = grantedTools(rule, agent, authz && authz.authorized_by);
  return unreadableSources(rule, granted.filter((n) => live.includes(n)));
}

// Server-verified per dispatch, inside the tick tx. Scoping cannot outlive the
// grantor's access: the grantor must still be allowlisted AND still hold edit
// access to the rule's canvas. Never invents an interactive user.
function verifyAuthorization(rule, authz, now = new Date(), { checkWorkspace = true } = {}) {
  // fatal = the grant is gone for good; no later tick can fix it. These must
  // never be a quiet skip that advances the schedule — the rule would keep
  // displaying as active while monitoring nobody re-consented to has stopped.
  const dead = (reason) => ({ ok: false, reason, alert: true, fatal: true });
  if (!authz) return dead('no standing authorization');
  if (authz.revoked_at) return dead('authorization revoked');
  if (authz.expires_at && authz.expires_at <= now.toISOString()) return dead('authorization expired');
  const entry = auth.allowlistEntry(authz.authorized_by);
  if (!entry) return dead('grantor no longer on the workspace allowlist');
  const check = auth.canEditCanvas({ role: entry.role, email: authz.authorized_by }, rule.canvas_id);
  if (!check.ok) return dead('grantor no longer has edit access to this canvas');
  if (rule.state !== 'active') return { ok: false, reason: `rule is ${rule.state}` };
  if (rule.expires_at && rule.expires_at <= now.toISOString()) return { ok: false, reason: 'rule expired' };
  if (checkWorkspace && touchesWorkspace(rule) && !workspace.isConnected(authz.authorized_by)) {
    // Skip + alert, never a silent failure: the grantor's Google connection is
    // what the run's reads would act as.
    return { ok: false, reason: 'workspace_disconnected', alert: true };
  }
  // Same class, same shape, same flag as the disconnected workspace above: a
  // live-reachability check the run's reads depend on. Running anyway would
  // report "nothing matched" over a source nobody is watching — a lamp faking
  // green. Reachability, NOT a dead grant: the scopes/connector can be turned
  // back on and the rule resumes on its own, so skip this occurrence, alert,
  // and reschedule rather than pausing the rule.
  if (checkWorkspace) {
    const dark = unreadableNow(rule, authz);
    // Naming the source is the whole value of the alert: "restore Gmail" and
    // "re-activate the rule" are different fixes and the owner picks.
    if (dark.length) {
      return {
        ok: false,
        alert: true,
        reason: `source_unreadable: ${dark.join(', ')} — nothing is being watched there. This rule can no longer read ${dark.length > 1 ? 'those sources' : 'that source'} on this deployment; restore the connector, scopes, or the agent's authority to resume, or re-activate the rule to grant it again.`,
      };
    }
  }
  return { ok: true };
}

// ---------- instruction templates ----------
// The MATCHED contract is the whole structured-output surface: the finalizer
// greps the final line into matched_count. ponytail: matched_count parsed from
// summary; add a completion tool if rules ever need structured match lists.
const MATCHED_CONTRACT = 'End your summary with a final line reading exactly "MATCHED: <n>" (the count of items that matched or need attention) or "NOTHING MATCHED" if nothing did.';

// A rehearsal must not carry the memory directive: telling the agent to record
// conclusions is the more specific instruction, so a model following it writes
// hypothetical "would have matched" data into shared memory before the owner
// has approved the rule. The tool layer refuses those writes in rehearse mode
// (tools.js REHEARSAL_BLOCKED_TOOLS) — this keeps the prompt from asking for a
// refusal it will only burn steps on.
const MEMORY_DIRECTIVE = 'Record selected conclusions as memory entries with evidence references; never copy whole source records.';
const REHEARSAL_MEMORY_LINE = 'Memory is read-only in a rehearsal (the server refuses writes) — put everything you found in your summary instead.';

function ruleInstruction(rule, { rehearsal = false } = {}) {
  let scope = '';
  try { scope = JSON.parse(rule.source_scope_json || '{}').scope || ''; } catch { /* keep empty */ }
  const scopeLine = scope ? `Scope: ${scope}\n` : '';
  // The reviewed source list is a constraint, not decoration. The grant-time
  // tool snapshot enforces it (grantedTools), but the run must also be TOLD —
  // otherwise it can skip an approved source or wander at a refused one.
  const sources = ruleSources(rule);
  const sourceLine = sources.length ? `Sources: read ${sources.join(', ')} — and nothing else.\n` : '';
  const memoryLine = rehearsal ? REHEARSAL_MEMORY_LINE : MEMORY_DIRECTIVE;
  if (rule.output_type === 'brief') {
    return `Scheduled ${rule.cadence} brief (standing rule ${rule.id}). ${rule.instruction}\n${sourceLine}${scopeLine}Write the operating brief in markdown with source references (evidence refs) and explicit uncertainty — state plainly what you could not verify. ${memoryLine} ${MATCHED_CONTRACT}`;
  }
  return `Scheduled ${rule.cadence} watch (standing rule ${rule.id}). ${rule.instruction}\n${sourceLine}${scopeLine}Check what this rule watches and raise ONLY what genuinely needs a human's attention — "nothing to report" is a valid result. ${memoryLine} ${MATCHED_CONTRACT}`;
}

function rehearsalInstruction(rule) {
  return `REHEARSAL against recent data: report exactly what WOULD have matched in the last 7 days; change nothing.\n${ruleInstruction(rule, { rehearsal: true })}`;
}

// The contract line is the FINAL nonblank line, never the first match anywhere
// in the text. Quoted source records and the agent's own prose produce
// "MATCHED: 0" naturally ("the source reported MATCHED: 0 yesterday"), and an
// unanchored search reads that as the answer — recording zero and suppressing
// the alert while the agent's actual final count is two.
// Two contract statements on that one line contradict each other, so the count
// is UNKNOWN rather than either of them. Unknown surfaces the card for review
// (finalizeRuleRuns treats null as needs_attention); zero suppresses it, and
// wrongly suppressing is the one failure an alert rule cannot have.
function parseMatchedCount(summary) {
  const lines = String(summary || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  const counts = last.match(/MATCHED:\s*\d+/gi) || [];
  const nothing = /NOTHING\s+MATCHED/i.test(last);
  if (counts.length + (nothing ? 1 : 0) !== 1) return null;
  return counts.length ? Number(/\d+/.exec(counts[0])[0]) : 0;
}

// ---------- finalize + retry (D7) ----------
function leaseMs(rule) {
  return Math.max(LEASE_FLOOR_MS, (Number(rule && rule.wall_ms_budget) || 0) + LEASE_SLACK_MS);
}
function leaseIso(now, rule) { return new Date(now.getTime() + leaseMs(rule)).toISOString(); }

// Finalization is the moment a rule run gains needs_attention, and no other
// producer fires then: the orchestrator's run_status event already made the
// client refetch attention BEFORE this row was written, and later scheduler
// ticks emit nothing at all. Without this, a connected user sees a new alert
// or brief only after a reload. canvas_structure is the client's existing
// "this canvas changed — refetch" signal.
function notifyCanvas(canvasId) {
  if (canvasId) bus.emit('event', { type: 'canvas_structure', canvasId });
}

// Terminate ONE attempt: kill the in-flight model call and close the row. A
// run that never started has no controller to abort — closing the row is what
// stops it, because executeRun no-ops on a non-queued run.
function closeRun(runId, reason) {
  if (!runId) return;
  control.abortRun(runId, reason);
  db.prepare("UPDATE runs SET status = 'failed', error = ?, ended_at = ? WHERE id = ? AND status IN ('queued', 'running')")
    .run(String(reason).slice(0, 300), nowIso(), runId);
}

// Every attempt this occurrence has ever dispatched. The current one lives on
// run_id; earlier ones survive only in retry_run_ids_json, and a lease-expiry
// retry can leave one of them genuinely live.
function attemptRunIds(rr) {
  let prior = [];
  try { const p = JSON.parse(rr.retry_run_ids_json || '[]'); prior = Array.isArray(p) ? p : []; } catch { prior = []; }
  return [...new Set([rr.run_id, ...prior].filter(Boolean))];
}

// Retry with a fresh run on the SAME occurrence row (attempt max 2), then
// failed + alert. The prior run id is preserved in retry_run_ids_json.
function retryOrFail(rr, reason, now = new Date()) {
  if (rr.attempt >= MAX_ATTEMPTS) {
    // The last attempt may still be alive (this branch is reached on lease
    // expiry, not only on a terminal run). Closing the occurrence while its
    // run keeps reading and writing memory is the same leak as a retry.
    for (const runId of attemptRunIds(rr)) closeRun(runId, 'standing rule attempts exhausted');
    db.prepare("UPDATE standing_rule_runs SET state = 'failed', error = ?, needs_attention = 1, ended_at = ? WHERE id = ?")
      .run(String(reason).slice(0, 300), nowIso(), rr.id);
    audit('system', 'standing-rules', 'standing_rule_run.fail', { ruleId: rr.rule_id, ruleRunId: rr.id, attempts: rr.attempt, reason: String(reason).slice(0, 200) });
    return;
  }
  const rule = getRule(rr.rule_id);
  const authz = currentAuthorization(rr.rule_id);
  const check = rule ? verifyAuthorization(rule, authz, now) : { ok: false, reason: 'rule missing' };
  if (!check.ok) {
    for (const runId of attemptRunIds(rr)) closeRun(runId, `standing rule skipped: ${check.reason}`);
    db.prepare("UPDATE standing_rule_runs SET state = 'skipped', skip_reason = ?, needs_attention = ?, ended_at = ? WHERE id = ?")
      .run(check.reason, check.alert ? 1 : 0, nowIso(), rr.id);
    return;
  }
  tx(() => {
    // Terminate BEFORE dispatching the replacement. The lease can expire while
    // the run is still legitimately queued — the in-memory queue is unbounded,
    // so a saturated workspace parks a 30-minute run past its whole lease —
    // and a retry alongside it means two runs spending one occurrence's budget
    // and writing conflicting memory. parentRunId makes the superseded attempt
    // a child of nothing generic: the retry card projection skips it.
    const priorRunId = rr.run_id || null;
    for (const runId of attemptRunIds(rr)) closeRun(runId, `superseded by standing-rule retry (${String(reason).slice(0, 120)})`);
    const run = dispatchRun({
      agentId: rule.agent_id, canvasId: rule.canvas_id, instruction: ruleInstruction(rule),
      triggerKind: 'system', mode: 'ask', initiatedBy: authz.authorized_by, actor: 'standing-rules',
      stepBudget: rule.step_budget || undefined, wallMs: rule.wall_ms_budget || undefined,
      authorityJson: authz.allowed_tools_json, parentRunId: priorRunId,
    });
    const prior = JSON.parse(rr.retry_run_ids_json || '[]');
    if (rr.run_id) prior.push(rr.run_id);
    db.prepare('UPDATE standing_rule_runs SET run_id = ?, retry_run_ids_json = ?, attempt = attempt + 1, lease_until = ? WHERE id = ?')
      .run(run.id, JSON.stringify(prior), leaseIso(now, rule), rr.id);
    audit('system', 'standing-rules', 'standing_rule_run.retry', { ruleId: rr.rule_id, ruleRunId: rr.id, runId: run.id, attempt: rr.attempt + 1, reason: String(reason).slice(0, 200) });
  });
}

// Copy a terminally SUCCESSFUL run's own outputs — summary, matched count,
// evidence refs, cost — onto the occurrence row. THE one definition, shared by
// the finalizer and by haltRuleRuns: a run that completed before the owner
// paused already read production data and wrote shared memory, so its card is
// owed whichever sweep reaches the row first. Writing 'skipped' over it instead
// destroys the result and the alert with it.
function completeFromRun(rr, run) {
  const matched = parseMatchedCount(run.summary);
  // An unparseable MATCHED line means the count is UNKNOWN, not zero.
  // Model adherence to a prompt-only output contract is not guaranteed,
  // and silently suppressing the card on a summary that may be reporting
  // urgent matches is the one failure an alert rule cannot have.
  const needsAttention = rr.output_type === 'brief' || matched === null || matched > 0 ? 1 : 0;
  db.prepare(`UPDATE standing_rule_runs SET state = 'completed', result_summary = ?, matched_count = ?,
      output_refs_json = ?, cost_usd = ?, needs_attention = ?, ended_at = ? WHERE id = ?`)
    .run(run.summary || '', matched, JSON.stringify(evidence.refsForRun(run.id)), run.cost_usd || 0,
      needsAttention, run.ended_at || nowIso(), rr.id);
}

// Sweep every claimed occurrence whose run reached a terminal state (or whose
// lease expired while non-terminal) and copy the run's own outputs — summary,
// evidence refs, cost — onto the rule-run row. The run IS the result (D3).
function finalizeRuleRuns(now = new Date()) {
  let finalized = 0;
  // A global pause — or the standing_rules rollback flag — must never consume
  // the occurrence's retries. Pausing aborts the scheduled run; a paused sweep
  // would read that as a failure, queue attempt two, then expire it —
  // exhausting the occurrence purely because an operator hit pause. The flag is
  // the same kind of halt, so it holds dispatch the same way. Terminal
  // successes still copy through both: bookkeeping is never what a halt stops.
  const holdDispatch = control.isPaused() || !flagOn();
  const touched = new Set();
  const open = db.prepare(`SELECT rr.*, r.output_type, r.canvas_id FROM standing_rule_runs rr
    JOIN standing_rules r ON r.id = rr.rule_id WHERE rr.state = 'running'`).all();
  for (const rr of open) {
    try {
      const run = rr.run_id ? db.prepare('SELECT * FROM runs WHERE id = ?').get(rr.run_id) : null;
      if (run && run.status === 'completed') {
        completeFromRun(rr, run);
        finalized += 1;
        touched.add(rr.canvas_id);
      } else if (holdDispatch) {
        continue; // no dispatch, no attempt consumed, until the halt lifts
      } else if (run && !['queued', 'running'].includes(run.status)) {
        retryOrFail(rr, `run ${run.status}${run.error ? `: ${run.error}` : ''}`, now);
        finalized += 1;
        touched.add(rr.canvas_id);
      } else if (rr.lease_until && rr.lease_until <= now.toISOString()) {
        retryOrFail(rr, run ? `lease expired while run ${run.status}` : 'lease expired with no run', now);
        finalized += 1;
        touched.add(rr.canvas_id);
      }
    } catch (err) {
      // One bad occurrence must not kill the sweep — record and continue.
      audit('system', 'standing-rules', 'standing_rule_run.fail', { ruleRunId: rr.id, error: String(err.message || err).slice(0, 200) });
    }
  }
  for (const canvasId of touched) notifyCanvas(canvasId);
  return finalized;
}

// Revoke and pause must stop work already in flight. Updating the rule and
// authorization rows alone leaves a queued or running occurrence to finish its
// reads and memory writes under an authorization that no longer exists — most
// reproducible when concurrency is saturated or the workspace is paused.
function haltRuleRuns(ruleId, reason) {
  const open = db.prepare(`SELECT rr.*, r.output_type FROM standing_rule_runs rr
    JOIN standing_rules r ON r.id = rr.rule_id
    WHERE rr.rule_id = ? AND rr.state IN ('pending', 'running')`).all(ruleId);
  for (const rr of open) {
    // EVERY attempt, not just the current one: an older attempt that a
    // lease-expiry retry left live would keep reading and writing memory
    // under an authorization the owner just revoked. Terminal runs no-op.
    const ids = attemptRunIds(rr);
    for (const runId of ids) closeRun(runId, reason);
    // finalizeRuleRuns only runs inside tick(), so an occurrence whose run
    // COMPLETED at 09:05 is still 'running' when the owner pauses at 09:30.
    // Writing 'skipped' over it would throw away a summary, matched count,
    // cost and evidence refs produced from real reads, and bury the alert the
    // owner is entitled to — for work that already happened. Halting stops
    // FUTURE work; it never un-does finished work. Same ordering the finalizer
    // uses deliberately: the completed branch sits ahead of the halt guard.
    const run = rr.run_id ? db.prepare('SELECT * FROM runs WHERE id = ?').get(rr.run_id) : null;
    if (run && run.status === 'completed') {
      completeFromRun(rr, run);
      audit('system', 'standing-rules', 'standing_rule_run.halt', { ruleId, ruleRunId: rr.id, runIds: ids, reason, completed: true });
      continue;
    }
    db.prepare("UPDATE standing_rule_runs SET state = 'skipped', skip_reason = ?, ended_at = ? WHERE id = ?")
      .run(reason, nowIso(), rr.id);
    audit('system', 'standing-rules', 'standing_rule_run.halt', { ruleId, ruleRunId: rr.id, runIds: ids, reason });
  }
  return open.length;
}

// A standing-rule run can escalate (a step/timeout/budget halt, or the escalate
// tool), and resolving that escalation dispatches a CHILD run which inherits the
// occurrence's frozen grant (queue.js) and keeps reading and writing memory.
// haltRuleRuns only ever closes runs the occurrence row knows about, so without
// this the child is invisible to pause/revoke/edit: revoking the rule kills
// every tracked attempt while that one keeps executing. Recording it as another
// attempt of the same occurrence puts it under the same stop path, the same
// lease, and the same generic-retry refusal (isStandingRuleRun).
function adoptChildRun(parentRunId, childRunId) {
  if (!parentRunId || !childRunId) return false;
  const rr = db.prepare(`SELECT * FROM standing_rule_runs
      WHERE run_id = ? OR instr(COALESCE(retry_run_ids_json, ''), ?) > 0 LIMIT 1`)
    .get(String(parentRunId), JSON.stringify(String(parentRunId)));
  if (!rr) return false;
  const prior = [...new Set([...attemptRunIds(rr).filter((id) => id !== rr.run_id), String(childRunId)])];
  db.prepare('UPDATE standing_rule_runs SET retry_run_ids_json = ? WHERE id = ?').run(JSON.stringify(prior), rr.id);
  audit('system', 'standing-rules', 'standing_rule_run.adopt_child', { ruleId: rr.rule_id, ruleRunId: rr.id, parentRunId, childRunId });
  return true;
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
      if (check.fatal) {
        // Lamps never fake green. The grant is gone for good, so advancing
        // next_run_at would leave the rule reading as active and monitoring
        // forever silently. 'paused' is the existing not-running-but-visible
        // state, and resume re-verifies — it refuses until the grant is redone.
        db.prepare("UPDATE standing_rules SET state = 'paused', next_run_at = NULL, updated_at = ? WHERE id = ?")
          .run(nowIso(), rule.id);
        audit('system', 'standing-rules', 'standing_rule.invalidated', { ruleId: rule.id, canvasId: rule.canvas_id, reason: check.reason });
      } else {
        db.prepare('UPDATE standing_rules SET next_run_at = ? WHERE id = ?').run(nextIso, rule.id);
      }
      outcome = { claimed: false, reason: check.reason, alert: !!check.alert };
      return;
    }
    // Byte-for-byte the room-refresh dispatch template: a normal run, ask
    // mode hard-coded (no parameter to escalate), system trigger, acting as
    // the human who authorized the rule — never an invented identity.
    // The authorization's tool snapshot rides with the dispatch: the run's
    // surface is that snapshot INTERSECTED with the agent's live authority, so
    // widening the agent after the grant never widens this rule.
    const run = dispatchRun({
      agentId: rule.agent_id, canvasId: rule.canvas_id, instruction: ruleInstruction(rule),
      triggerKind: 'system', mode: 'ask', initiatedBy: authz.authorized_by, actor: 'standing-rules',
      stepBudget: rule.step_budget || undefined, wallMs: rule.wall_ms_budget || undefined,
      authorityJson: authz.allowed_tools_json,
    });
    db.prepare("UPDATE standing_rule_runs SET state = 'running', run_id = ?, attempt = 1, lease_until = ? WHERE id = ?")
      .run(run.id, leaseIso(now, rule), id);
    db.prepare('UPDATE standing_rules SET next_run_at = ?, last_run_at = ? WHERE id = ?').run(nextIso, nowIso(), rule.id);
    audit('system', 'standing-rules', 'standing_rule_run.dispatch', {
      ruleId: rule.id, ruleRunId: id, runId: run.id, occurrenceKey: key, initiatedBy: authz.authorized_by,
    });
    outcome = { claimed: true, runId: run.id };
  });
  // A skip that raises an alert is a new NEEDS YOU card with no other producer
  // behind it — tell the connected clients to refetch (emitted after the tx so
  // a rollback cannot announce a card that was never written).
  if (outcome && outcome.alert) notifyCanvas(rule.canvas_id);
  return outcome;
}

function tick({ source = 'owner', actor = 'system' } = {}) {
  // Evidence first, before any gate: the caller was OIDC-verified as the
  // invoker SA to get here, so this IS the proof the scheduled lane works —
  // and it is true whether or not the flag then stops the sweep.
  if (source === 'scheduler') setSetting(LAST_SCHEDULER_TICK, nowIso());
  // Finalize BEFORE the flag gate, exactly as it sits before the pause gate
  // three lines down and for the same reason. setSetting('standing_rules','0')
  // is the no-deploy rollback, but the orchestrator knows nothing about it: a
  // run dispatched before the flip still completes, writes memory, and
  // terminates. Gating bookkeeping on the flag strands that occurrence
  // 'running' with no card, forever — and attention.js excludes it from the
  // generic failed-run projection too, so nothing else would ever surface it.
  // finalizeRuleRuns holds DISPATCH under the same flag, so the rollback still
  // starts nothing new and consumes no attempt.
  const finalized = finalizeRuleRuns();
  if (!flagOn()) return { skipped: 'flag off', finalized };
  if (control.isPaused()) {
    audit(source === 'scheduler' ? 'system' : 'user', actor, 'standing_rule.tick', { source, skipped: 'workspace paused', finalized });
    return { skipped: 'workspace paused', finalized };
  }
  const now = new Date();
  // Archiving a canvas closes it: its cards are filtered out of every tray
  // (routes.js builds the default tray from archived = 0) and the frontend can
  // only ever fetch a canvas from that filtered list, so a rule still running
  // under an archived canvas cannot be reached, paused or revoked without
  // un-archiving — while it keeps reading the grantor's mailbox and spending
  // the workspace budget for up to 90 days. DERIVED from canvases.archived, the
  // P3 Rooms precedent (db.js: "no second flag to desync"): un-archiving
  // restores the schedule on its own, with no rule state to migrate back.
  const due = db.prepare(`SELECT r.* FROM standing_rules r JOIN canvases c ON c.id = r.canvas_id
    WHERE r.state = 'active' AND r.next_run_at IS NOT NULL AND r.next_run_at <= ? AND c.archived = 0`)
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
  CADENCES, OUTPUT_TYPES, CATEGORIES, SOURCES, MAX_ATTEMPTS, LEASE_FLOOR_MS, leaseMs,
  PARSE_SYSTEM, validateInterpretation,
  occurrenceKey, nextRunAt, isoWeekKey,
  getRule, ruleView, upsertDraft,
  createAuthorization, currentAuthorization, revokeAuthorization, verifyAuthorization, touchesWorkspace,
  grantedTools, ruleSources, SOURCE_TOOLS, unreadableSources, unreadableNow, isStandingRuleRun,
  flagOn, lastSchedulerTick,
  ruleInstruction, rehearsalInstruction, parseMatchedCount,
  finalizeRuleRuns, haltRuleRuns, adoptChildRun, tick, verifyTickOidc,
  _internal: {
    claimAndDispatch, retryOrFail,
    setTickVerifier(fn) { const prev = tickVerifier; tickVerifier = fn; return () => { tickVerifier = prev; }; },
  },
};

'use strict';
// P4 agent builder substrate: version history for agents. Append-only, like
// everything else — a version row is a config that WAS active (or the
// baseline snapshot of a pre-P4 agent taken before its first tracked change).
// Draft/propose/rehearse/publish logic joins this module in later slices.

const crypto = require('node:crypto');
const { db, nowIso } = require('./db');

function recordVersion(agent, { source, actor, draftId = null, restoredFrom = null }) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO agent_versions (id, agent_id, canvas_id, name, role, model_tier, system_prompt, tools_json, step_budget, wall_ms_budget, source, draft_id, restored_from, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, agent.id, agent.canvas_id, agent.name, agent.role, agent.model_tier, agent.system_prompt,
    agent.tools_json ?? null, agent.step_budget ?? null, agent.wall_ms_budget ?? null,
    source, draftId, restoredFrom, actor, nowIso());
  return id;
}

// A pre-P4 agent has no history: snapshot its CURRENT config as 'baseline'
// before the first tracked mutation, so rollback always has a floor.
function ensureBaseline(agent, actor) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM agent_versions WHERE agent_id = ?').get(agent.id).n;
  if (existing === 0) recordVersion(agent, { source: 'baseline', actor });
}

function listVersions(agentId) {
  return db.prepare('SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY created_at DESC, rowid DESC').all(agentId);
}

function getVersion(versionId) {
  return db.prepare('SELECT * FROM agent_versions WHERE id = ?').get(versionId);
}

// The publish/rollback diff: exactly what becomes active, field by field.
function diffConfigs(from, to, fields = ['name', 'role', 'model_tier', 'system_prompt', 'tools_json', 'step_budget', 'wall_ms_budget']) {
  const diff = {};
  for (const f of fields) {
    const a = from ? from[f] ?? null : null;
    const b = to[f] ?? null;
    if (String(a) !== String(b)) diff[f] = { from: a, to: b };
  }
  return diff;
}

// ---------- drafts: propose → rehearse → publish ----------
const { authorityMenu } = require('./orchestrator/tools');

// Roles the builder may assign. Free-text roles silently fall back to a bare
// toolset — the builder never produces that surprise.
const BUILDER_ROLES = ['research', 'coding', 'review', 'strategic', 'commercial', 'operational', 'workspace', 'crm', 'targeting'];
const STEP_BUDGET_RANGE = [1, 64];
const WALL_MS_RANGE = [30_000, 1_800_000];

function draftRow(id) {
  return db.prepare('SELECT * FROM agent_drafts WHERE id = ?').get(id);
}

// The full governed menu across builder roles — what the generator may pick
// from. Per-role intersection happens in validateProposal.
function unionMenu(userRole) {
  const seen = new Map();
  for (const role of BUILDER_ROLES) {
    for (const item of authorityMenu(role, { userRole })) {
      if (!seen.has(item.name)) seen.set(item.name, item);
    }
  }
  return [...seen.values()];
}

// Field-by-field validation of the 9-part proposal. Unknown/unhonorable
// authority is DROPPED (never an error the user has to debug, never a grant
// the deployment can't honor). Returns { proposal, dropped } or throws with
// a 400-shaped message.
function validateProposal(raw, { userRole = 'member' } = {}) {
  const bad = (msg) => { const e = new Error(msg); e.status = 400; throw e; };
  if (!raw || typeof raw !== 'object') bad('proposal must be an object');
  const p = {};
  p.name = String(raw.name || '').trim().slice(0, 60);
  if (!p.name) bad('proposal.name required');
  p.role = String(raw.role || '').trim();
  if (!BUILDER_ROLES.includes(p.role)) bad(`proposal.role must be one of ${BUILDER_ROLES.join(', ')}`);
  p.color = /^#[0-9a-fA-F]{6}$/.test(raw.color || '') ? raw.color : '#7dd3fc';
  p.model_tier = ['fast', 'strong'].includes(raw.model_tier) ? raw.model_tier : 'strong';
  for (const f of ['business_purpose', 'operating_instructions', 'escalation_conditions']) {
    p[f] = String(raw[f] || '').trim().slice(0, 4000);
    if (!p[f]) bad(`proposal.${f} required`);
  }
  p.inputs = String((raw.inputs_outputs && raw.inputs_outputs.inputs) || raw.inputs || '').trim().slice(0, 1000);
  p.outputs = String((raw.inputs_outputs && raw.inputs_outputs.outputs) || raw.outputs || '').trim().slice(0, 1000);
  if (!p.inputs || !p.outputs) bad('proposal inputs and outputs required');
  const step = Number(raw.step_budget);
  p.step_budget = Number.isInteger(step) && step >= STEP_BUDGET_RANGE[0] && step <= STEP_BUDGET_RANGE[1] ? step : 12;
  const wall = Number(raw.wall_ms_budget);
  p.wall_ms_budget = Number.isInteger(wall) && wall >= WALL_MS_RANGE[0] && wall <= WALL_MS_RANGE[1] ? wall : 300_000;
  const menuNames = new Set(authorityMenu(p.role, { userRole }).map((m) => m.name));
  const requested = Array.isArray(raw.authority) ? raw.authority.map(String) : [];
  p.authority = [...new Set(requested)].filter((n) => menuNames.has(n));
  const dropped = [...new Set(requested)].filter((n) => !menuNames.has(n));
  return { proposal: p, dropped };
}

// Pre-publish lint (tool-surface review finding #2): generated prompt text
// lands verbatim in a trusted system prompt, and the only reader is a human.
// Flag phrases that textually undercut the runner's data/instruction
// boundary so the owner's attention is pointed at them — a reviewer aid,
// never an automatic block.
const PROMPT_LINT_PATTERNS = [
  [/treat\s+(retrieved|external|fetched)\s+.{0,30}(content|data|text)\s+.{0,20}as\s+instructions/i, 'tells the agent to treat external content as instructions'],
  [/ignore\s+(previous|prior|the system|any system)\s+(instructions|prompt|rules)/i, 'tells the agent to ignore its system rules'],
  [/follow\s+(any|all)\s+instructions\s+(found|embedded|contained)/i, 'tells the agent to follow embedded instructions'],
  [/disregard\s+.{0,25}(guardrails|safety|rules|contract|boundary)/i, 'tells the agent to disregard guardrails'],
];

function lintProposal(p) {
  const warnings = [];
  for (const field of ['operating_instructions', 'escalation_conditions', 'business_purpose']) {
    for (const [re, why] of PROMPT_LINT_PATTERNS) {
      if (re.test(p[field] || '')) warnings.push({ field, warning: why });
    }
  }
  return warnings;
}

// The system prompt a published agent runs with, assembled from the reviewed
// proposal — so what the owner read IS what the agent becomes.
function renderSystemPrompt(p) {
  return [
    p.business_purpose,
    `INPUTS: ${p.inputs}`,
    `OUTPUTS: ${p.outputs}`,
    'OPERATING INSTRUCTIONS:',
    p.operating_instructions,
    'ESCALATE (use the escalate tool) WHEN:',
    p.escalation_conditions,
  ].join('\n\n');
}

// Agent-row field values for a proposal (shadow sync + publish share it).
function agentFields(p) {
  return {
    name: p.name, role: p.role, color: p.color, model_tier: p.model_tier,
    system_prompt: renderSystemPrompt(p),
    tools_json: JSON.stringify(p.authority),
    step_budget: p.step_budget, wall_ms_budget: p.wall_ms_budget,
  };
}

// Create or update the draft's shadow agent (lifecycle 'draft') so rehearsal
// runs on EXACTLY the proposed config through the normal run machinery.
function syncShadowAgent(draft, proposal) {
  const fields = agentFields(proposal);
  if (draft.shadow_agent_id && db.prepare('SELECT id FROM agents WHERE id = ?').get(draft.shadow_agent_id)) {
    db.prepare(`UPDATE agents SET name = ?, role = ?, color = ?, model_tier = ?, system_prompt = ?, tools_json = ?, step_budget = ?, wall_ms_budget = ? WHERE id = ?`)
      .run(fields.name, fields.role, fields.color, fields.model_tier, fields.system_prompt, fields.tools_json, fields.step_budget, fields.wall_ms_budget, draft.shadow_agent_id);
    return draft.shadow_agent_id;
  }
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, tools_json, step_budget, wall_ms_budget, created_at, lifecycle)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`)
    .run(id, draft.canvas_id, fields.name, fields.role, fields.color, fields.model_tier, fields.system_prompt, fields.tools_json, fields.step_budget, fields.wall_ms_budget, nowIso());
  db.prepare('UPDATE agent_drafts SET shadow_agent_id = ?, updated_at = ? WHERE id = ?').run(id, nowIso(), draft.id);
  return id;
}

const PROPOSAL_SYSTEM = (menu) => `You design ONE agent for a shared multi-agent workspace from a plain-language job description. Return ONLY a JSON object with EXACTLY these fields:
{"name": "<short agent name>", "role": "<one of: ${BUILDER_ROLES.join(', ')}>", "color": "<hex like #22c55e>",
 "business_purpose": "<1-3 sentences: why this agent exists, in plain business language>",
 "inputs_outputs": {"inputs": "<what it consumes>", "outputs": "<what it produces>"},
 "operating_instructions": "<how it works, step by step, in plain language>",
 "authority": ["<tool names it genuinely needs, FROM THE MENU BELOW ONLY — request the minimum>"],
 "model_tier": "<fast for routing/light work, strong for judgment>",
 "step_budget": <integer 1-64>, "wall_ms_budget": <integer ms, 30000-1800000>,
 "escalation_conditions": "<when it must stop and ask a human>"}
AUTHORITY MENU (the only grantable permissions — anything else will be dropped):
${menu.map((m) => `- ${m.name}: ${m.description}`).join('\n')}
Principle of least authority: an agent that only reads should hold no write tools. No prose outside the JSON.`;

module.exports = {
  recordVersion, ensureBaseline, listVersions, getVersion, diffConfigs,
  BUILDER_ROLES, draftRow, unionMenu, validateProposal, renderSystemPrompt, agentFields, syncShadowAgent, PROPOSAL_SYSTEM, lintProposal,
};

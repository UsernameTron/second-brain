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
function diffConfigs(from, to) {
  const fields = ['name', 'model_tier', 'system_prompt', 'tools_json', 'step_budget', 'wall_ms_budget'];
  const diff = {};
  for (const f of fields) {
    const a = from ? from[f] ?? null : null;
    const b = to[f] ?? null;
    if (String(a) !== String(b)) diff[f] = { from: a, to: b };
  }
  return diff;
}

module.exports = { recordVersion, ensureBaseline, listVersions, getVersion, diffConfigs };

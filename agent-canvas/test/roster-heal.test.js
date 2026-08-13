'use strict';
// Live-workspace healing. A database seeded before the roster existed carries
// pre-roster exec prompts (Darren's ICP predates sr-icp-v5, Atlas predates the
// confidentiality guard) and a superseded target-buyer memory anchor. The heal
// migrations bring such a workspace current on boot — while refusing to touch
// anything a human has edited.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-heal-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');
const { seedIfEmpty, seedExecCanvas, OWNER_EMAIL } = require('../server/seed');
const roster = require('../server/roster');

const LEGACY = Object.fromEntries(roster.LEGACY_EXEC_PROMPTS.map((p) => [p.name, p.system_prompt]));

seedIfEmpty();
const exec = seedExecCanvas(OWNER_EMAIL);

// Rewind this database to its pre-roster state: exec agents carrying the
// prompts PR #99 shipped, and the superseded target-buyer anchor.
for (const [name, prompt] of Object.entries(LEGACY)) {
  db.prepare('UPDATE agents SET system_prompt = ?, roster_id = NULL WHERE canvas_id = ? AND name = ?')
    .run(prompt, exec.canvasId, name);
}
const staleEntry = memory.writeEntry({
  canvasId: exec.canvasId, content: roster.STALE_ICP_MEMORY, epistemic: 'verified',
  authorType: 'user', authorId: OWNER_EMAIL, authorName: 'Pete Connor (seed)',
  source: 'CTG Constants Registry (reviewed 2026-04-15), uploaded by Pete Connor 2026-08-11',
});
// An agent someone hand-edited must survive the migration untouched.
const EDITED = 'You are Darren. Custom prompt Pete wrote by hand — do not clobber this.';
const editedId = crypto.randomUUID();
db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, 'Darren', 'commercial', '#D98A14', 'strong', ?, 0, 0, ?)")
  .run(editedId, exec.canvasId, EDITED, nowIso());

roster.seedRoster();
const healResult = roster.healExecAgents();
const linkResult = roster.linkExecAgents();
const icpResult = roster.supersedeStaleIcpMemory(OWNER_EMAIL);

const agentByName = (name) => db.prepare('SELECT * FROM agents WHERE canvas_id = ? AND name = ? AND id != ?').get(exec.canvasId, name, editedId);

test('drifted seed prompts are healed to the current template', () => {
  assert.equal(healResult.healed, 2, 'exactly Darren and Atlas drifted');
  assert.deepEqual([...new Set(healResult.detail.map((h) => h.name))].sort(), ['Atlas', 'Darren']);

  const darren = agentByName('Darren');
  assert.match(darren.system_prompt, /sr-icp-v5/, 'Darren now states the current ICP');
  assert.match(darren.system_prompt, /250–10,000 seats/, 'v5 seat band');
  assert.ok(!darren.system_prompt.includes('500–10,000+ seats'), 'stale ICP line is gone');
  assert.match(darren.system_prompt, /Radar/, 'Radar delegation present');

  const atlas = agentByName('Atlas');
  assert.match(atlas.system_prompt, /CONFIDENTIALITY RULE/, 'Atlas now carries the guard');
});

test('untouched templates are left alone; hand-edited agents are never clobbered', () => {
  // Fred and Jess prompts did not change with the roster, so they need no heal.
  for (const name of ['Fred', 'Jess']) {
    assert.equal(agentByName(name).system_prompt, LEGACY[name], `${name} prompt unchanged`);
  }
  const edited = db.prepare('SELECT * FROM agents WHERE id = ?').get(editedId);
  assert.equal(edited.system_prompt, EDITED, 'a hand-written prompt survives the migration verbatim');
  assert.equal(edited.roster_id, null, 'and is not silently adopted into the roster');
});

test('every seed-descended exec agent ends up resyncable', () => {
  assert.ok(linkResult.linked >= 2, 'link stamps the agents heal did not');
  for (const name of ['Fred', 'Darren', 'Jess', 'Atlas']) {
    const agent = agentByName(name);
    assert.ok(agent.roster_id, `${name} carries roster provenance and can be resynced`);
    const entry = db.prepare('SELECT name FROM roster_agents WHERE id = ?').get(agent.roster_id);
    assert.equal(entry.name, name, `${name} points at its own roster entry`);
  }
});

test('the stale ICP memory anchor is superseded through the append-only path', () => {
  assert.equal(icpResult.superseded, 1);
  const old = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(staleEntry.id);
  assert.ok(old, 'the original entry still exists — nothing is deleted');
  assert.ok(old.superseded_by, 'and is stamped superseded');
  const correction = db.prepare('SELECT * FROM memory_entries WHERE id = ?').get(old.superseded_by);
  assert.match(correction.content, /sr-icp-v5/);
  assert.match(correction.content, /250-10,000 seats/);
  assert.ok(!/500-10,000\+|500-10000\+/.test(correction.content), 'the stale figure is gone');
  assert.equal(correction.supersede_reason, 'superseded by ICP registry sr-icp-v5');
  assert.equal(correction.epistemic, 'verified');
  assert.match(correction.source, /icp_registry\.py/, 'names the source of truth');
  const cites = db.prepare('SELECT cites_entry_id FROM citations WHERE entry_id = ?').all(correction.id);
  assert.ok(cites.some((c) => c.cites_entry_id === staleEntry.id), 'correction cites what it replaced');
});

test('all three migrations are idempotent', () => {
  assert.equal(roster.healExecAgents().healed, 0);
  assert.equal(roster.linkExecAgents().linked, 0);
  assert.equal(roster.supersedeStaleIcpMemory(OWNER_EMAIL).superseded, 0);
  const active = db.prepare('SELECT COUNT(*) AS n FROM memory_entries WHERE content = ? AND superseded_by IS NULL').get(roster.STALE_ICP_MEMORY);
  assert.equal(active.n, 0, 'no live entry still states the superseded ICP');
});

'use strict';
// Live-workspace healing remains supported for historical databases even
// though fresh workspaces no longer create demo canvases. This fixture builds
// the legacy rows explicitly, then proves migrations update only known seed
// text and never overwrite a human edit.

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
const { seedIfEmpty, EXEC_AGENTS, OWNER_EMAIL } = require('../server/seed');
const roster = require('../server/roster');

const LEGACY = Object.fromEntries(roster.LEGACY_EXEC_PROMPTS.map((p) => [p.name, p.system_prompt]));

seedIfEmpty();
const canvasId = 'legacy-exec-fixture';
db.prepare("INSERT INTO canvases (id, name, created_by, created_at) VALUES (?, 'Legacy exec fixture', ?, ?)")
  .run(canvasId, OWNER_EMAIL, nowIso());

// Build the exact pre-roster agent state rather than calling a product seed.
for (const [i, entry] of EXEC_AGENTS.entries()) {
  db.prepare('INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at, roster_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
    .run(crypto.randomUUID(), canvasId, entry.name, entry.role, entry.color, entry.model_tier,
      LEGACY[entry.name], entry.x ?? (150 + 340 * i), entry.y ?? 200, nowIso());
}
const staleEntry = memory.writeEntry({
  canvasId, content: roster.STALE_ICP_MEMORY, epistemic: 'verified',
  authorType: 'user', authorId: OWNER_EMAIL, authorName: 'Pete Connor (seed)',
  source: 'CTG Constants Registry (reviewed 2026-04-15), uploaded by Pete Connor 2026-08-11',
});
// An agent someone hand-edited must survive the migration untouched.
const EDITED = 'You are Darren. Custom prompt Pete wrote by hand — do not clobber this.';
const editedId = crypto.randomUUID();
db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, 'Darren', 'commercial', '#D98A14', 'strong', ?, 0, 0, ?)")
  .run(editedId, canvasId, EDITED, nowIso());

roster.seedRoster();
// A pristine current agent exercises the provenance-only linker separately
// from the legacy healer.
const scout = roster.ROSTER_AGENTS.find((entry) => entry.name === 'Scout');
const scoutId = crypto.randomUUID();
db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at, roster_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL)")
  .run(scoutId, canvasId, scout.name, scout.role, scout.color, scout.model_tier, scout.system_prompt, nowIso());
const healResult = roster.healExecAgents();
const linkResult = roster.linkExecAgents();
const icpResult = roster.supersedeStaleIcpMemory(OWNER_EMAIL);

const agentByName = (name) => db.prepare('SELECT * FROM agents WHERE canvas_id = ? AND name = ? AND id != ?').get(canvasId, name, editedId);

test('drifted seed prompts are healed to the current template', () => {
  assert.equal(healResult.healed, 4, 'all four known legacy templates drifted and were healed');
  assert.deepEqual([...new Set(healResult.detail.map((h) => h.name))].sort(), ['Atlas', 'Darren', 'Fred', 'Jess']);

  const darren = agentByName('Darren');
  // The template interpolates the shipped registry's own version — assert
  // against that artifact so this test never re-pins a drifting version string.
  const ICP = require('../server/config/icp-sr-icp-v6.json');
  assert.ok(darren.system_prompt.includes(`per ICP registry ${ICP.icp_version}`), 'Darren states the shipped registry version');
  assert.match(darren.system_prompt, /250–10,000 seats/, 'current seat band');
  assert.ok(!darren.system_prompt.includes('500–10,000+ seats'), 'stale ICP line is gone');
  assert.match(darren.system_prompt, /Radar/, 'Radar delegation present');

  const atlas = agentByName('Atlas');
  assert.match(atlas.system_prompt, /CONFIDENTIALITY RULE/, 'Atlas now carries the guard');
});

test('known legacy templates update while hand-edited agents are never clobbered', () => {
  for (const name of ['Fred', 'Jess']) {
    assert.equal(agentByName(name).system_prompt, roster.ROSTER_AGENTS.find((entry) => entry.name === name).system_prompt,
      `${name} adopts the current template`);
  }
  const edited = db.prepare('SELECT * FROM agents WHERE id = ?').get(editedId);
  assert.equal(edited.system_prompt, EDITED, 'a hand-written prompt survives the migration verbatim');
  assert.equal(edited.roster_id, null, 'and is not silently adopted into the roster');
});

test('every seed-descended exec agent ends up resyncable', () => {
  assert.equal(linkResult.linked, 1, 'link stamps the pristine current Scout fixture');
  assert.ok(db.prepare('SELECT roster_id FROM agents WHERE id = ?').get(scoutId).roster_id, 'Scout is linked');
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
  assert.match(correction.content, /sr-icp-v6/);
  assert.match(correction.content, /250-10,000 seats/);
  assert.ok(!/500-10,000\+|500-10000\+/.test(correction.content), 'the stale figure is gone');
  assert.equal(correction.supersede_reason, 'superseded by ICP registry sr-icp-v6');
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

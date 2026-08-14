'use strict';
// reseedRosterPrompts closes the gap that a plain prompt edit never reaches an
// already-seeded workspace: seedRoster is one-shot with no upsert. Re-seed
// propagates a changed prompt to the roster row AND live agents — but only
// where the stored text is byte-for-byte the previous template, so an owner's
// hand edit is never clobbered.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-reseed-'));

const { db, nowIso, getSetting, setSetting } = require('../server/db');
const roster = require('../server/roster');

const OLD = roster.LEGACY_ROSTER_PROMPTS.Radar;
const NEW = roster.ROSTER_AGENTS.find((a) => a.name === 'Radar').system_prompt;

test('the snapshot captured a genuinely earlier Radar prompt', () => {
  assert.ok(OLD && NEW, 'both texts exist');
  assert.notEqual(OLD, NEW, 'the prompt actually changed — otherwise re-seed has nothing to prove');
  assert.ok(!OLD.includes('min_score: 0.75'), 'the OLD text predates the hot-floor rule');
  assert.ok(NEW.includes('min_score: 0.75'), 'the NEW text carries it');
});

test('re-seed updates a pristine roster row and its pristine live agents, once', () => {
  const canvasId = 'c-reseed';
  db.prepare("INSERT INTO canvases (id, name, created_at) VALUES (?, 'Reseed', ?)").run(canvasId, nowIso());
  roster.seedRoster();

  // Simulate an already-seeded workspace whose Radar still carries the OLD text
  // (both the roster row and a live canvas agent), plus one hand-edited agent.
  db.prepare("UPDATE roster_agents SET system_prompt = ? WHERE name = 'Radar'").run(OLD);
  const pristineId = crypto.randomUUID();
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, 'Radar', 'targeting', '#6B4FBB', 'fast', ?, 0, 0, ?)")
    .run(pristineId, canvasId, OLD, nowIso());
  const EDITED = 'You are Radar. Pete rewrote this by hand — keep it.';
  const editedId = crypto.randomUUID();
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, 'Radar', 'targeting', '#6B4FBB', 'fast', ?, 0, 0, ?)")
    .run(editedId, canvasId, EDITED, nowIso());

  // The guard is set by boot in other suites sharing this module; clear it so
  // this test drives the migration itself.
  setSetting('seed_roster_prompts_v2', '');
  const res = roster.reseedRosterPrompts();

  assert.equal(res.updated, 1, 'exactly the one pristine live agent updated');
  assert.equal(db.prepare("SELECT system_prompt FROM roster_agents WHERE name = 'Radar'").get().system_prompt, NEW, 'pristine roster row adopts the new prompt');
  assert.equal(db.prepare('SELECT system_prompt FROM agents WHERE id = ?').get(pristineId).system_prompt, NEW, 'pristine live agent follows');
  assert.equal(db.prepare('SELECT system_prompt FROM agents WHERE id = ?').get(editedId).system_prompt, EDITED, 'the hand-edited agent is left verbatim');

  assert.equal(roster.reseedRosterPrompts().updated, 0, 'idempotent — the guard blocks a second run');
});

test('re-seed does NOT touch a hand-edited roster row', () => {
  const EDITED_ROW = 'You are Radar. Owner-edited roster entry.';
  db.prepare("UPDATE roster_agents SET system_prompt = ? WHERE name = 'Radar'").run(EDITED_ROW);
  setSetting('seed_roster_prompts_v2', '');
  roster.reseedRosterPrompts();
  assert.equal(db.prepare("SELECT system_prompt FROM roster_agents WHERE name = 'Radar'").get().system_prompt, EDITED_ROW,
    'a roster row that no longer matches the previous template is an owner edit — never overwritten');
});

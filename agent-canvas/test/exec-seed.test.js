'use strict';
// Executive Roundtable seed — personas, protocol, provenanced memory.
process.env.DEV_AUTH = '1';
process.env.JWT_SECRET = 'test-secret-material-32-bytes-xx';
process.env.DB_PATH = ':memory:';

const { test } = require('node:test');
const assert = require('node:assert');
const { db } = require('../server/db');
const { seedIfEmpty, seedExecCanvas, OWNER_EMAIL } = require('../server/seed');

seedIfEmpty();
const first = seedExecCanvas(OWNER_EMAIL);

test('seeds the Executive Roundtable canvas exactly once', () => {
  assert.ok(first.seeded);
  const again = seedExecCanvas(OWNER_EMAIL);
  assert.equal(again.seeded, false, 'second call must be a no-op');
  const canvases = db.prepare("SELECT id FROM canvases WHERE name = 'Executive Roundtable'").all();
  assert.equal(canvases.length, 1);
});

test('the four persona agents exist with lanes, tiers, and disclosure', () => {
  const agents = db.prepare('SELECT * FROM agents WHERE canvas_id = ?').all(first.canvasId);
  const byName = Object.fromEntries(agents.map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(byName).sort(), ['Atlas', 'Darren', 'Fred', 'Jess']);
  assert.equal(byName.Fred.role, 'strategic');
  assert.equal(byName.Darren.role, 'commercial');
  assert.equal(byName.Jess.role, 'operational');
  assert.equal(byName.Atlas.role, 'workspace');
  for (const name of ['Fred', 'Darren', 'Jess']) {
    assert.equal(byName[name].model_tier, 'strong', `${name} carries judgment — strong tier`);
    assert.match(byName[name].system_prompt, /you are not .* and you say so/i,
      `${name} must disclose it is an AI advisor, not the person`);
    assert.match(byName[name].system_prompt, /CONFIDENTIALITY RULE/,
      `${name} must carry the confidentiality guard`);
  }
  assert.equal(byName.Atlas.model_tier, 'fast');
  assert.match(byName.Atlas.system_prompt, /human always presses Send/i);
});

test('the synthesis protocol is pinned live context', () => {
  const notes = db.prepare('SELECT * FROM notes WHERE canvas_id = ?').all(first.canvasId);
  const pinned = notes.filter((n) => n.pinned);
  assert.equal(pinned.length, 1);
  assert.match(pinned[0].content, /Fred vs Darren/);
  assert.match(pinned[0].content, /does not block/);
  assert.match(pinned[0].content, /not a summary/i);
});

test('seeded memory is verified with named provenance and no confidential figures', () => {
  const entries = db.prepare('SELECT * FROM memory_entries WHERE canvas_id = ?').all(first.canvasId);
  assert.ok(entries.length >= 10, `expected >=10 anchors, got ${entries.length}`);
  for (const e of entries) {
    assert.equal(e.epistemic, 'verified');
    assert.equal(e.author_type, 'user');
    assert.match(e.source, /uploaded by Pete Connor/, 'every anchor names its source');
    assert.ok(!/1\.6\d?\s*M|1,6\d{2}|6\.1x/.test(e.content), 'confidential ARR/valuation figures must not be seeded');
  }
});

test('legacy retro agent colors are recolored in place, exactly once', () => {
  const { recolorLegacyAgents } = require('../server/seed');
  const crypto5 = require('node:crypto');
  const { nowIso } = require('../server/db');
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, 'Old', 'research', '#4cc2ab', 'fast', '', 0, 0, ?)")
    .run(crypto5.randomUUID(), first.canvasId, nowIso());
  const r = recolorLegacyAgents();
  assert.ok(r.recolored >= 1, 'legacy color updated');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agents WHERE color = '#4cc2ab'").get().n, 0);
  assert.equal(recolorLegacyAgents().recolored, 0, 'second call is a no-op');
});

test('scored memory search finds seeded facts from conceptual multi-word queries', () => {
  const memory = require('../server/memory');
  // Field-observed misses from the first live roundtable: strict-AND returned
  // [] for both of these although the answers were seeded on the canvas.
  const capacity = memory.listEntries({ canvasId: first.canvasId, query: '7-person team capacity constraint' });
  assert.ok(capacity.some((e) => /team size: 7/i.test(e.content)), 'finds the team-size anchor');
  const loa = memory.listEntries({ canvasId: first.canvasId, query: 'LOA vendor neutrality master agent' });
  assert.ok(loa.some((e) => /vendor-neutral/i.test(e.content)), 'finds the neutrality-tension anchor');
  // ranking: the best match comes first
  assert.ok(capacity[0].content.includes('7'), 'best match ranked first');
  // single-token behavior unchanged
  const single = memory.listEntries({ canvasId: first.canvasId, query: 'Telarus' });
  assert.ok(single.length >= 1);
});

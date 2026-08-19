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

// v8 changes SCOUT's prompt (web_fetch lane + process-note epistemics), so
// Scout is the fixture agent this round — the snapshot equals the previously
// shipped text for every agent, and only changed prompts heal.
const OLD = roster.LEGACY_ROSTER_PROMPTS.Scout;
const NEW = roster.ROSTER_AGENTS.find((a) => a.name === 'Scout').system_prompt;

test('the snapshot captured a genuinely earlier Scout prompt', () => {
  assert.ok(OLD && NEW, 'both texts exist');
  assert.notEqual(OLD, NEW, 'the prompt actually changed — otherwise re-seed has nothing to prove');
  // Deliberately generic: the snapshot is whatever the last release rendered,
  // so pinning its exact wording forces an edit at every RESEED_KEY bump.
  assert.ok(NEW.includes('web_fetch'), 'Scout knows the exact-URL lane');
  assert.ok(NEW.includes('never a "verified" memory entry'), 'failed fetches are process notes, not facts');
  assert.ok(NEW.includes(require('../server/config/icp-sr-icp-v7.json').icp_version), 'stamped with the loaded registry version');
});

test('re-seed updates a pristine roster row and its pristine live agents, once', () => {
  const canvasId = 'c-reseed';
  db.prepare("INSERT INTO canvases (id, name, created_at) VALUES (?, 'Reseed', ?)").run(canvasId, nowIso());
  roster.seedRoster();

  // Simulate an already-seeded workspace whose Scout still carries the OLD text
  // (both the roster row and a live canvas agent), plus one hand-edited agent.
  db.prepare("UPDATE roster_agents SET system_prompt = ? WHERE name = 'Scout'").run(OLD);
  const pristineId = crypto.randomUUID();
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, 'Scout', 'research', '#2080D0', 'strong', ?, 0, 0, ?)")
    .run(pristineId, canvasId, OLD, nowIso());
  const EDITED = 'You are Scout. Pete rewrote this by hand — keep it.';
  const editedId = crypto.randomUUID();
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, 'Scout', 'research', '#2080D0', 'strong', ?, 0, 0, ?)")
    .run(editedId, canvasId, EDITED, nowIso());

  // The guard is set by boot in other suites sharing this module; clear it so
  // this test drives the migration itself.
  setSetting('seed_roster_prompts_v8', '');
  const res = roster.reseedRosterPrompts();

  assert.equal(res.updated, 1, 'exactly the one pristine live agent updated');
  assert.equal(db.prepare("SELECT system_prompt FROM roster_agents WHERE name = 'Scout'").get().system_prompt, NEW, 'pristine roster row adopts the new prompt');
  assert.equal(db.prepare('SELECT system_prompt FROM agents WHERE id = ?').get(pristineId).system_prompt, NEW, 'pristine live agent follows');
  assert.equal(db.prepare('SELECT system_prompt FROM agents WHERE id = ?').get(editedId).system_prompt, EDITED, 'the hand-edited agent is left verbatim');

  assert.equal(roster.reseedRosterPrompts().updated, 0, 'idempotent — the guard blocks a second run');
});

test('upgrade tombstones only pristine generated companion notes, even after prompt v6 already ran', () => {
  // The retired companion notes were generated from the v6 registry; the
  // signature map (roster.js LEGACY_COMPANION_NOTE_SIGNATURES) hashes that
  // exact content. Build the fixture from the committed v6 snapshot, not
  // the live (now v7) registry.
  const icp = require('./fixtures/icp-sr-icp-v6.json');
  const title = `ICP registry — ${icp.icp_version}`;
  const generatedContent = `# ${title}
Version: ${icp.icp_version} — source of truth: ${icp.source_of_truth} (exported by scripts/export_icp.py, ctg-signal-radar). The lists below are authoritative for scoring; prompts carry only the arithmetic digest. A fresh export is a new commit of the config/icp-sr-icp-<version>.json artifact.

\`\`\`json
${JSON.stringify(icp, null, 2)}
\`\`\``;
  const synthesisContent = `# Synthesis protocol — how the three voices resolve (pinned)

Three voices, three lanes. Not a vote, not a veto.
- Fred (strategic): positioning, brand, funding posture, AI differentiation
- Darren (commercial): pipeline, deal tactics, pricing, ICP, commercial-finance (no CFO voice exists)
- Jess (operational): governance, vendor-neutrality rigor, LOA compliance, feasibility

Tension cases:
1. Fred vs Darren — Fred holds on brand/positioning; Darren holds on individual-deal tactics. Deal-tactical question → lead with Darren; brand question → lead with Fred.
2. Fred vs Jess — Fred's direction holds. Jess flags feasibility ON THE RECORD (risk, mitigation cost, failure mode) but does not block.
3. Darren vs Jess — Jess's governance holds on vendor-neutrality, LOA discipline, commission transparency. Darren wins on ICP and outreach tactics.

Roundtable chain: dispatch the question to Fred → Fred writes his strategic frame to memory, hands off to Darren → Darren adds commercial motion, hands off to Jess → Jess adds governance/feasibility, then writes the synthesis: what, who holds the call (name the case), why each voice aligns or flags. The synthesis is a decision, not a summary. Attribute any overridden voice by name.

Single-lane questions skip the chain: dispatch directly to the right voice.`;
  const signature = crypto.createHash('sha256').update([title, generatedContent, 0].join('\0')).digest('hex');
  assert.ok(roster.LEGACY_COMPANION_NOTE_SIGNATURES.has(signature), 'fixture is the exact previously shipped v6 note');
  const synthesisSignature = crypto.createHash('sha256').update(['Synthesis protocol', synthesisContent, 1].join('\0')).digest('hex');
  assert.ok(roster.LEGACY_COMPANION_NOTE_SIGNATURES.has(synthesisSignature), 'fixture is the exact pinned protocol note');

  const canvasId = 'c-companion-upgrade';
  const unrelatedCanvasId = 'c-companion-unrelated';
  db.prepare("INSERT INTO canvases (id, name, created_at) VALUES (?, 'CompanionUpgrade', ?)").run(canvasId, nowIso());
  db.prepare("INSERT INTO canvases (id, name, created_at) VALUES (?, 'CompanionUnrelated', ?)").run(unrelatedCanvasId, nowIso());
  const radar = db.prepare("SELECT id FROM roster_agents WHERE name = 'Radar'").get();
  const fred = db.prepare("SELECT id FROM roster_agents WHERE name = 'Fred'").get();
  db.prepare('UPDATE roster_agents SET companion_note_key = NULL').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roster_agents WHERE companion_note_key IS NOT NULL').get().n, 0,
    'fixture starts after the buggy v6 migration already cleared every key');
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at, roster_id) VALUES (?, ?, 'Radar', 'targeting', '#6B4FBB', 'fast', ?, 0, 0, ?, ?)")
    .run(crypto.randomUUID(), canvasId, NEW, nowIso(), radar.id);
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at, roster_id) VALUES (?, ?, 'Fred', 'strategic', '#104080', 'strong', '', 0, 0, ?, ?)")
    .run(crypto.randomUUID(), canvasId, nowIso(), fred.id);

  const pristineId = crypto.randomUUID();
  const pinnedProtocolId = crypto.randomUUID();
  const editedId = crypto.randomUUID();
  const versionedId = crypto.randomUUID();
  const unrelatedId = crypto.randomUUID();
  const insertNote = db.prepare('INSERT INTO notes (id, canvas_id, title, content, pinned, version, x, y, updated_by, updated_at) VALUES (?, ?, ?, ?, 0, ?, 0, 0, ?, ?)');
  insertNote.run(pristineId, canvasId, title, generatedContent, 1, 'roster', nowIso());
  insertNote.run(editedId, canvasId, title, `${generatedContent}\nHuman annotation`, 1, 'pete@example.com', nowIso());
  insertNote.run(versionedId, canvasId, title, generatedContent, 2, 'pete@example.com', nowIso());
  insertNote.run(unrelatedId, unrelatedCanvasId, title, generatedContent, 1, 'pete@example.com', nowIso());
  db.prepare('INSERT INTO notes (id, canvas_id, title, content, pinned, version, x, y, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, 1, 0, 0, ?, ?)')
    .run(pinnedProtocolId, canvasId, 'Synthesis protocol', synthesisContent, 'roster', nowIso());

  // Simulate an installation that already ran the original PR's prompt v6
  // migration but not this separately versioned companion cleanup.
  setSetting('seed_roster_prompts_v8', nowIso());
  setSetting(roster.COMPANION_RETIRE_KEY, '');
  const result = roster.reseedRosterPrompts();
  assert.equal(result.updated, 0, 'prompt migration remains guarded');
  assert.equal(result.retiredCompanionNotes, 2, 'the independent upgrade retires both exact generated note types');

  const pristine = db.prepare('SELECT * FROM notes WHERE id = ?').get(pristineId);
  assert.ok(pristine.deleted_at, 'generated note is hidden');
  assert.equal(pristine.deleted_by, 'seed');
  assert.equal(pristine.pinned, 0, 'retired context cannot remain injected');
  assert.equal(pristine.version, 2, 'tombstone is recorded as a versioned transition');
  assert.equal(pristine.content, generatedContent, 'historical content stays exportable');
  const pinnedProtocol = db.prepare('SELECT * FROM notes WHERE id = ?').get(pinnedProtocolId);
  assert.ok(pinnedProtocol.deleted_at, 'the generated synthesis protocol is hidden');
  assert.equal(pinnedProtocol.pinned, 0, 'the retired protocol can no longer inject into every run');
  assert.equal(pinnedProtocol.content, synthesisContent, 'protocol history is retained verbatim');
  for (const id of [editedId, versionedId, unrelatedId]) {
    assert.equal(db.prepare('SELECT deleted_at FROM notes WHERE id = ?').get(id).deleted_at, null,
      `${id} is not classified as a pristine generated companion`);
  }
  assert.equal(db.prepare('SELECT companion_note_key FROM roster_agents WHERE id = ?').get(radar.id).companion_note_key, null,
    'legacy transport metadata is cleared');

  const auditRow = db.prepare("SELECT detail FROM audit_log WHERE action = 'workspace.roster_companion_notes_retire' ORDER BY seq DESC LIMIT 1").get();
  const detail = JSON.parse(auditRow.detail);
  assert.equal(detail.count, 2);
  assert.deepEqual([...detail.noteIds].sort(), [pristineId, pinnedProtocolId].sort());
  assert.equal(detail.rosterKeysCleared, 0, 'repair did not depend on still-present companion metadata');
  assert.ok(!auditRow.detail.includes('Version:'), 'audit records ids and counts, never note content');

  const versionAfterFirstRun = pristine.version;
  assert.equal(roster.reseedRosterPrompts().retiredCompanionNotes, 0, 'separate migration guard is idempotent');
  assert.equal(db.prepare('SELECT version FROM notes WHERE id = ?').get(pristineId).version, versionAfterFirstRun,
    'rerun does not mutate history twice');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'workspace.roster_companion_notes_retire'").get().n, 1,
    'rerun emits no duplicate audit event');
});

test('SDR tools re-seed widens only byte-pristine authority maps', () => {
  const V1 = roster.SDR_TOOLS_V1;
  const NEW_TOOLS = roster.ROSTER_AGENTS.find((a) => a.name === 'SDR').tools_json;
  assert.notEqual(V1, NEW_TOOLS, 'the authority map actually changed');
  assert.ok(JSON.parse(NEW_TOOLS).includes('mcp_gtm_marts_gtm_account_lookup'),
    'the widened map carries the marts lookup, namespaced exactly as mcp/client.js publishes it');

  // Simulate an already-seeded workspace: pristine roster row, one pristine
  // live copy, one hand-narrowed copy.
  db.prepare("UPDATE roster_agents SET tools_json = ? WHERE template_key = 'sdr'").run(V1);
  const canvasId = 'c-sdr-tools';
  db.prepare("INSERT INTO canvases (id, name, created_at) VALUES (?, 'SdrTools', ?)").run(canvasId, nowIso());
  const pristineId = crypto.randomUUID();
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, tools_json, x, y, created_at) VALUES (?, ?, 'SDR', 'commercial', '#B23A67', 'strong', 'p', ?, 0, 0, ?)")
    .run(pristineId, canvasId, V1, nowIso());
  const EDITED = JSON.stringify(['hs_search']);
  const editedId = crypto.randomUUID();
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, tools_json, x, y, created_at) VALUES (?, ?, 'SDR', 'commercial', '#B23A67', 'strong', 'p', ?, 0, 0, ?)")
    .run(editedId, canvasId, EDITED, nowIso());

  setSetting(roster.SDR_TOOLS_RESEED_KEY, '');
  const res = roster.reseedSdrTools();
  assert.equal(res.updated, 2, 'the roster row and the one pristine live agent');
  assert.equal(db.prepare("SELECT tools_json FROM roster_agents WHERE template_key = 'sdr'").get().tools_json, NEW_TOOLS);
  assert.equal(db.prepare('SELECT tools_json FROM agents WHERE id = ?').get(pristineId).tools_json, NEW_TOOLS);
  assert.equal(db.prepare('SELECT tools_json FROM agents WHERE id = ?').get(editedId).tools_json, EDITED,
    'a hand-narrowed authority map is an owner decision — never overwritten');
  assert.equal(roster.reseedSdrTools().updated, 0, 'idempotent — the guard blocks a second run');
});

test('Gauge tools re-seed fills only NULL authority maps', () => {
  const GAUGE_TOOLS = roster.ROSTER_AGENTS.find((a) => a.name === 'Gauge').tools_json;
  assert.ok(JSON.parse(GAUGE_TOOLS).every((n) => n.startsWith('hs_')));

  // An already-seeded workspace: Gauge roster row with the legacy NULL map,
  // one NULL live copy, one custom map an owner set by hand via SQL.
  db.prepare("UPDATE roster_agents SET tools_json = NULL WHERE template_key = 'gauge'").run();
  const canvasId = 'c-gauge-tools';
  db.prepare("INSERT INTO canvases (id, name, created_at) VALUES (?, 'GaugeTools', ?)").run(canvasId, nowIso());
  const nullId = crypto.randomUUID();
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, 'Gauge', 'crm', '#D96A2B', 'fast', 'p', 0, 0, ?)")
    .run(nullId, canvasId, nowIso());
  const CUSTOM = JSON.stringify(['hs_search']);
  const customId = crypto.randomUUID();
  db.prepare("INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, tools_json, x, y, created_at) VALUES (?, ?, 'Gauge', 'crm', '#D96A2B', 'fast', 'p', ?, 0, 0, ?)")
    .run(customId, canvasId, CUSTOM, nowIso());

  setSetting(roster.GAUGE_TOOLS_RESEED_KEY, '');
  const res = roster.reseedGaugeTools();
  assert.equal(res.updated, 2, 'the NULL roster row and the NULL live copy');
  assert.equal(db.prepare("SELECT tools_json FROM roster_agents WHERE template_key = 'gauge'").get().tools_json, GAUGE_TOOLS);
  assert.equal(db.prepare('SELECT tools_json FROM agents WHERE id = ?').get(nullId).tools_json, GAUGE_TOOLS);
  assert.equal(db.prepare('SELECT tools_json FROM agents WHERE id = ?').get(customId).tools_json, CUSTOM, 'a set map is never replaced');
  assert.equal(roster.reseedGaugeTools().updated, 0, 'guarded second run is a no-op');
});

test('re-seed does NOT touch a hand-edited roster row', () => {
  const EDITED_ROW = 'You are Radar. Owner-edited roster entry.';
  db.prepare("UPDATE roster_agents SET system_prompt = ? WHERE name = 'Radar'").run(EDITED_ROW);
  setSetting('seed_roster_prompts_v8', '');
  roster.reseedRosterPrompts();
  assert.equal(db.prepare("SELECT system_prompt FROM roster_agents WHERE name = 'Radar'").get().system_prompt, EDITED_ROW,
    'a roster row that no longer matches the previous template is an owner edit — never overwritten');
});

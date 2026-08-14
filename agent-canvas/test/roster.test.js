'use strict';
// Agent Roster: workspace-level template library. Seeding is idempotent,
// reads are role-scoped, mutation is owner-only, instantiation copies the
// template (with provenance) and pins/places companion notes exactly once
// per canvas, and prompts carry the confidentiality guard while naming no
// excluded vendor anywhere.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-roster-'));
process.env.DEV_AUTH = '1'; // read at module load by auth.js — must precede requires
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { server } = require('../server/index'); // boots app + runs all seeds
const { db, getSetting } = require('../server/db');
const roster = require('../server/roster');
const ICP_FILE = require('../server/config/icp-sr-icp-v5.json');

let base;
let ownerCookie;
let memberCookie;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200, `dev sign-in failed for ${email}`);
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(method, apiPath, cookie, body) {
  const res = await fetch(`${base}${apiPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ownerCookie = await signIn('pete@cloudtechgurus.com');
  memberCookie = await signIn('fred@cloudtechgurus.com');
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('roster seeds exactly once with 9 entries in order', () => {
  assert.ok(getSetting('seed_roster_v1'), 'seed guard key set');
  const rows = db.prepare('SELECT * FROM roster_agents ORDER BY sort').all();
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.map((r) => r.name),
    ['Fred', 'Darren', 'Jess', 'Atlas', 'Scout', 'Forge', 'Sentinel', 'Gauge', 'Radar']);
  const again = roster.seedRoster();
  assert.equal(again.seeded, false, 'second call must be a no-op');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roster_agents').get().n, 9);
  // The proven exec set is pre-checked for new canvases; nothing else is.
  assert.deepEqual(rows.filter((r) => r.default_on).map((r) => r.name), ['Fred', 'Darren', 'Jess', 'Atlas']);
  // Gauge ships disabled until the owner turns it on.
  const gauge = rows.find((r) => r.name === 'Gauge');
  assert.equal(gauge.enabled, 0);
});

test('every roster prompt carries the guard; no excluded vendor is ever named; Radar is version-stamped', () => {
  const rows = db.prepare('SELECT name, system_prompt FROM roster_agents').all();
  for (const row of rows) {
    assert.match(row.system_prompt, /CONFIDENTIALITY RULE/, `${row.name} must carry the confidentiality guard`);
    for (const domain of ICP_FILE.excluded_vendor_domains) {
      const vendor = domain.replace(/\.(com|ai|cx)$/, '');
      assert.ok(!row.system_prompt.toLowerCase().includes(vendor.toLowerCase()),
        `${row.name} prompt must not name excluded vendor "${vendor}"`);
    }
  }
  const radar = rows.find((r) => r.name === 'Radar');
  assert.match(radar.system_prompt, /sr-icp-v5/);
  assert.match(radar.system_prompt, /industry_weight × title-tier multiplier/, 'arithmetic model stated');
  assert.match(radar.system_prompt, /SVP and every level below stay ×1\.0/, 'SVP carve-out explicit');

  // Hot-leads-only behavior (operator directive 2026-08-14).
  const hot = roster.HOT_MIN_SCORE;
  assert.equal(hot, 0.75, 'hot cutoff is the agreed 0.75');
  assert.ok(radar.system_prompt.includes(`min_score: ${hot}`), 'Radar is told to pass the hot cutoff to the search');
  assert.ok(radar.system_prompt.includes(`at or above ${hot}`), 'and to drop everything below it when reporting');
  assert.match(radar.system_prompt, /"why"[\s\S]*not optional/, 'every reported lead must carry its score breakdown');
  // Bounded polling, not a spin loop, and an honest incomplete when the async
  // job outlives the run — the two defects behind the $0.92 burn.
  assert.match(radar.system_prompt, /After TWO waits, STOP/i, 'polling is bounded');
  assert.match(radar.system_prompt, /outcome "incomplete"/, 'an unfinished search is filed incomplete, never as done');
});

test('the seeded ICP companion note round-trips to the committed registry file', () => {
  const spec = roster.ROSTER_NOTES.icp_registry;
  assert.equal(spec.pinned, false, 'ICP note must be unpinned — pinned notes enter every prompt');
  const fenced = spec.content.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(fenced, 'note carries fenced JSON');
  assert.deepEqual(JSON.parse(fenced[1]), ICP_FILE, 'note JSON deep-equals config file');
  assert.match(spec.content, /source of truth: src\/backend\/icp_registry\.py/);
});

test('GET /api/roster: members see enabled only; owner sees all', async () => {
  const asMember = await call('GET', '/api/roster', memberCookie);
  assert.equal(asMember.status, 200);
  assert.equal(asMember.data.roster.length, 8, 'disabled Gauge hidden from members');
  assert.ok(!asMember.data.roster.some((r) => r.name === 'Gauge'));
  const asOwner = await call('GET', '/api/roster', ownerCookie);
  assert.equal(asOwner.data.roster.length, 9, 'owner sees disabled entries too');
});

test('roster mutation is owner-only', async () => {
  const rows = db.prepare('SELECT id FROM roster_agents ORDER BY sort').all();
  assert.equal((await call('POST', '/api/roster', memberCookie, { name: 'Rogue' })).status, 403);
  assert.equal((await call('PATCH', `/api/roster/${rows[0].id}`, memberCookie, { system_prompt: 'hijacked' })).status, 403);
  const created = await call('POST', '/api/roster', ownerCookie, { name: 'Probe', role: 'research', model_tier: 'fast' });
  assert.equal(created.status, 200);
  const patched = await call('PATCH', `/api/roster/${created.data.entry.id}`, ownerCookie, { enabled: false, sort: 99 });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.entry.enabled, 0);
});

let canvasId;
let fredRosterId;
let radarRosterId;

test('canvas create with roster_ids staffs the canvas and places companion notes once', async () => {
  const byName = Object.fromEntries(db.prepare('SELECT id, name FROM roster_agents').all().map((r) => [r.name, r.id]));
  fredRosterId = byName.Fred;
  radarRosterId = byName.Radar;
  const created = await call('POST', '/api/canvases', memberCookie, {
    name: 'Target sprint', roster_ids: [byName.Fred, byName.Darren, byName.Jess, byName.Radar],
  });
  assert.equal(created.status, 200);
  canvasId = created.data.canvas.id;
  const agents = db.prepare('SELECT * FROM agents WHERE canvas_id = ? ORDER BY x').all(canvasId);
  assert.deepEqual(agents.map((a) => a.name), ['Fred', 'Darren', 'Jess', 'Radar']);
  for (const agent of agents) assert.ok(agent.roster_id, `${agent.name} carries roster provenance`);
  assert.deepEqual(agents.map((a) => a.x), [150, 490, 830, 1170], 'exec seed spacing');
  const notes = db.prepare('SELECT title, pinned FROM notes WHERE canvas_id = ? ORDER BY title').all(canvasId);
  assert.equal(notes.length, 2, 'protocol note once (not three times) + ICP note');
  const protocol = notes.find((n) => n.title === 'Synthesis protocol');
  const icp = notes.find((n) => n.title.startsWith('ICP registry'));
  assert.equal(protocol.pinned, 1, 'protocol is live working context');
  assert.equal(icp.pinned, 0, 'registry stays out of every prompt');
});

test('re-adding an agent does not duplicate its companion note', async () => {
  const added = await call('POST', `/api/canvases/${canvasId}/agents`, memberCookie, { roster_id: fredRosterId });
  assert.equal(added.status, 200);
  assert.equal(added.data.agent.name, 'Fred');
  const protocolNotes = db.prepare("SELECT COUNT(*) AS n FROM notes WHERE canvas_id = ? AND title = 'Synthesis protocol'").get(canvasId);
  assert.equal(protocolNotes.n, 1);
});

test('disabled roster entries cannot be instantiated; unknown ids abort canvas creation atomically', async () => {
  const gauge = db.prepare("SELECT id FROM roster_agents WHERE name = 'Gauge'").get();
  const denied = await call('POST', `/api/canvases/${canvasId}/agents`, memberCookie, { roster_id: gauge.id });
  assert.equal(denied.status, 400);
  assert.match(denied.data.error, /disabled/);
  const before = db.prepare('SELECT COUNT(*) AS n FROM canvases').get().n;
  const bad = await call('POST', '/api/canvases', memberCookie, { name: 'Ghost', roster_ids: ['nope'] });
  assert.equal(bad.status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canvases').get().n, before, 'no half-created canvas');
});

test('resync re-copies prompt and tier from the roster; owner-only; name/color untouched', async () => {
  const agent = db.prepare("SELECT * FROM agents WHERE canvas_id = ? AND name = 'Radar' LIMIT 1").get(canvasId);
  await call('PATCH', `/api/roster/${radarRosterId}`, ownerCookie, { system_prompt: 'v6 draft prompt — scored against sr-icp-v5', model_tier: 'strong' });
  assert.equal((await call('POST', `/api/canvases/${canvasId}/agents/${agent.id}/resync`, memberCookie)).status, 403);
  const stale = db.prepare('SELECT system_prompt FROM agents WHERE id = ?').get(agent.id);
  assert.notEqual(stale.system_prompt, 'v6 draft prompt — scored against sr-icp-v5', 'edit alone does not touch instantiated agents');
  const synced = await call('POST', `/api/canvases/${canvasId}/agents/${agent.id}/resync`, ownerCookie);
  assert.equal(synced.status, 200);
  assert.equal(synced.data.agent.system_prompt, 'v6 draft prompt — scored against sr-icp-v5');
  assert.equal(synced.data.agent.model_tier, 'strong');
  assert.equal(synced.data.agent.name, 'Radar', 'name preserved');
  assert.equal(synced.data.agent.color, '#6B4FBB', 'color preserved');
});

test('resync without roster provenance is a 404, not a silent no-op', async () => {
  const custom = await call('POST', `/api/canvases/${canvasId}/agents`, memberCookie, { name: 'Handmade', role: 'research' });
  assert.equal(custom.status, 200);
  assert.equal(custom.data.agent.roster_id, null);
  const res = await call('POST', `/api/canvases/${canvasId}/agents/${custom.data.agent.id}/resync`, ownerCookie);
  assert.equal(res.status, 404);
});

test('exec-canvas agents seeded before the roster are linked for resync where prompts still match', () => {
  // linkExecAgents ran at boot, after seedExecCanvas. Fred/Jess prompts are
  // unchanged from EXEC_AGENTS so their live agents link; Darren (ICP v5
  // update) and Atlas (guard added) intentionally do not retro-link here
  // because this test DB seeded them from the same updated consts — so all 4
  // actually match. Assert the linkage happened.
  const exec = db.prepare("SELECT a.name, a.roster_id FROM agents a JOIN canvases c ON c.id = a.canvas_id WHERE c.name = 'Executive Roundtable'").all();
  assert.equal(exec.length, 4);
  for (const agent of exec) assert.ok(agent.roster_id, `${agent.name} linked to roster`);
});

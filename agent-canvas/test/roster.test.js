'use strict';
// Agent Roster: workspace-level template library. Seeding is idempotent,
// reads are role-scoped, mutation is owner-only, instantiation copies the
// template with provenance but creates no product content of its own, and
// prompts carry the confidentiality guard while naming no excluded vendor.

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
const { readRegistry, governedTool } = require('../server/orchestrator/tools');
const ICP_FILE = require('../server/config/icp-sr-icp-v6.json');

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

test('roster seeds exactly once with 11 entries in order', () => {
  assert.ok(getSetting('seed_roster_v1'), 'seed guard key set');
  const rows = db.prepare('SELECT * FROM roster_agents ORDER BY sort').all();
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.map((r) => r.name),
    ['Fred', 'Darren', 'Jess', 'Atlas', 'Scout', 'Forge', 'Sentinel', 'Gauge', 'Radar', 'Enrichment', 'SDR']);
  assert.deepEqual(rows.map((r) => r.template_key),
    ['fred', 'darren', 'jess', 'atlas', 'scout', 'forge', 'sentinel', 'gauge', 'radar', 'enrichment', 'sdr']);
  const again = roster.seedRoster();
  assert.equal(again.seeded, false, 'second call must be a no-op');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roster_agents').get().n, 11);
  // The proven exec set is pre-checked for new canvases; nothing else is.
  assert.deepEqual(rows.filter((r) => r.default_on).map((r) => r.name), ['Fred', 'Darren', 'Jess', 'Atlas']);
  // Gauge ships disabled until the owner turns it on.
  const gauge = rows.find((r) => r.name === 'Gauge');
  assert.equal(gauge.enabled, 0);
});

test('built-in template identity survives a rename and ignores a duplicate display name', () => {
  const builtIn = db.prepare("SELECT id, system_prompt FROM roster_agents WHERE template_key = 'darren'").get();
  db.prepare("UPDATE roster_agents SET template_key = NULL, name = 'Commercial lead' WHERE id = ?").run(builtIn.id);
  const duplicateId = 'duplicate-commercial-name';
  db.prepare(`INSERT INTO roster_agents
    (id, name, role, color, model_tier, system_prompt, enabled, default_on, sort, created_at, updated_at)
    VALUES (?, 'Commercial lead', 'research', '#2080D0', 'fast', 'custom', 1, 0, 99, datetime('now'), datetime('now'))`).run(duplicateId);

  assert.equal(roster.backfillRosterTemplateKeys().updated, 1);
  assert.equal(db.prepare('SELECT template_key FROM roster_agents WHERE id = ?').get(builtIn.id).template_key, 'darren');
  assert.equal(db.prepare('SELECT template_key FROM roster_agents WHERE id = ?').get(duplicateId).template_key, null);

  db.prepare('DELETE FROM roster_agents WHERE id = ?').run(duplicateId);
  db.prepare("UPDATE roster_agents SET name = 'Darren' WHERE id = ?").run(builtIn.id);
});

test('the additive Enrichment seed upgrades an existing roster without overwriting user content', () => {
  db.prepare("DELETE FROM settings WHERE key = ?").run(roster.ENRICHMENT_ROSTER_KEY);
  db.prepare("DELETE FROM roster_agents WHERE name = 'Enrichment'").run();
  const result = roster.seedEnrichmentAgent();
  assert.equal(result.inserted, 1);
  const entry = db.prepare("SELECT * FROM roster_agents WHERE name = 'Enrichment'").get();
  assert.equal(entry.role, 'enrichment');
  assert.equal(entry.enabled, 1);
  assert.match(entry.system_prompt, /without deciding whether anyone is a hot lead/i);
  assert.equal(roster.seedEnrichmentAgent().inserted, 0, 'the versioned migration is idempotent');
});

test('the additive SDR seed installs a least-authority commercial agent', () => {
  db.prepare('DELETE FROM settings WHERE key = ?').run(roster.SDR_ROSTER_KEY);
  db.prepare("DELETE FROM roster_agents WHERE name = 'SDR'").run();
  const result = roster.seedSdrAgent();
  assert.equal(result.inserted, 1);
  const entry = db.prepare("SELECT * FROM roster_agents WHERE name = 'SDR'").get();
  assert.equal(entry.role, 'commercial');
  assert.equal(entry.model_tier, 'strong');
  assert.equal(entry.enabled, 1);
  assert.equal(entry.default_on, 0);
  assert.equal(entry.step_budget, 32);
  assert.equal(entry.wall_ms_budget, 480000);

  const tools = JSON.parse(entry.tools_json);
  for (const name of ['hs_preview_change', 'hs_apply_change', 'hs_preview_association', 'hs_apply_association', 'hs_activities', 'ws_gmail_draft', 'get_enriched_contact']) {
    assert.ok(tools.includes(name), `SDR authority includes ${name}`);
  }
  for (const name of ['ws_sheets_update', 'ws_docs_create', 'ws_calendar_create', 'web_search']) {
    assert.ok(!tools.includes(name), `SDR authority excludes ${name}`);
  }
  assert.ok(tools.every((name) => governedTool(name)), 'every listed tool is a real governed name');

  assert.match(entry.system_prompt, /preserve every requested record/i);
  assert.match(entry.system_prompt, /hs_preview_change per new or changed record/);
  assert.match(entry.system_prompt, /never claim an email went out/i);
  assert.equal(roster.seedSdrAgent().inserted, 0, 'the versioned migration is idempotent');

  // Collision safety: an owner-edited row named SDR is never overwritten.
  db.prepare('DELETE FROM settings WHERE key = ?').run(roster.SDR_ROSTER_KEY);
  db.prepare("UPDATE roster_agents SET system_prompt = 'custom' WHERE name = 'SDR'").run();
  assert.equal(roster.seedSdrAgent().inserted, 0);
  assert.equal(db.prepare("SELECT system_prompt FROM roster_agents WHERE name = 'SDR'").get().system_prompt, 'custom');

  // Restore the shipped row for the prompt-guard and instantiation tests below.
  db.prepare('DELETE FROM settings WHERE key = ?').run(roster.SDR_ROSTER_KEY);
  db.prepare("DELETE FROM roster_agents WHERE name = 'SDR'").run();
  assert.equal(roster.seedSdrAgent().inserted, 1, 'reseeds cleanly after removal');
});

test('fresh boot creates no demo canvas or other product content', () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canvases').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agents').get().n, 0);
});

test('every roster prompt carries the guard; Radar qualifies while Enrichment preserves every requested lead', () => {
  const rows = db.prepare('SELECT name, role, system_prompt FROM roster_agents').all();
  for (const row of rows) {
    assert.match(row.system_prompt, /CONFIDENTIALITY RULE/, `${row.name} must carry the confidentiality guard`);
    for (const domain of ICP_FILE.excluded_vendor_domains) {
      const vendor = domain.replace(/\.(com|ai|cx)$/, '');
      assert.ok(!row.system_prompt.toLowerCase().includes(vendor.toLowerCase()),
        `${row.name} prompt must not name excluded vendor "${vendor}"`);
    }
  }
  const radar = rows.find((r) => r.name === 'Radar');
  // version-agnostic (ICP-REG-01): stamped with whatever registry is loaded, not a pinned string
  const icpVersion = require('../server/config/icp-sr-icp-v6.json').icp_version;
  assert.ok(radar.system_prompt.includes(icpVersion), `Radar is stamped with the loaded registry version (${icpVersion})`);
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

  const enrichment = rows.find((r) => r.name === 'Enrichment');
  assert.equal(enrichment.role, 'enrichment');
  assert.match(enrichment.system_prompt, /preserve every requested record/i);
  assert.match(enrichment.system_prompt, /Do not classify, filter, rank, suppress, or discard/i);
  assert.match(enrichment.system_prompt, /do not qualify or sell/i);
  assert.ok(!enrichment.system_prompt.includes('HOT LEADS ONLY (what you return)'), 'Enrichment never inherits Radar\'s output gate');
});

test('the ICP source of truth is the committed read_registry surface, not a canvas note', () => {
  const result = readRegistry({ registry: 'icp', query: 'excluded_vendor_domains' });
  assert.equal(result.registry, 'icp');
  assert.equal(result.source_of_truth, ICP_FILE.source_of_truth);
  assert.equal(result.matched, 1);
  assert.deepEqual(result.results, [{ key: 'excluded_vendor_domains', value: ICP_FILE.excluded_vendor_domains }]);
});

test('GET /api/roster: members see enabled only; owner sees all', async () => {
  const asMember = await call('GET', '/api/roster', memberCookie);
  assert.equal(asMember.status, 200);
  assert.equal(asMember.data.roster.length, 10, 'disabled Gauge hidden from members');
  assert.ok(!asMember.data.roster.some((r) => r.name === 'Gauge'));
  const asOwner = await call('GET', '/api/roster', ownerCookie);
  assert.equal(asOwner.data.roster.length, 11, 'owner sees disabled entries too');
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
  const builtIn = db.prepare("SELECT id FROM roster_agents WHERE template_key = 'darren'").get();
  const renamed = await call('PATCH', `/api/roster/${builtIn.id}`, ownerCookie, { name: 'Commercial lead', template_key: 'hijacked' });
  assert.equal(renamed.data.entry.template_key, 'darren', 'the stable team-template key is not owner-editable');
  await call('PATCH', `/api/roster/${builtIn.id}`, ownerCookie, { name: 'Darren' });
});

let canvasId;
let fredRosterId;
let radarRosterId;

test('canvas create with roster_ids staffs the canvas without fabricating notes', async () => {
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
  assert.deepEqual(notes, [], 'system instructions and registries do not masquerade as user notes');
});

test('re-adding an agent still creates no companion note', async () => {
  const added = await call('POST', `/api/canvases/${canvasId}/agents`, memberCookie, { roster_id: fredRosterId });
  assert.equal(added.status, 200);
  assert.equal(added.data.agent.name, 'Fred');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes WHERE canvas_id = ?').get(canvasId).n, 0);
});

test('instantiating SDR carries its authority map and budgets onto the canvas agent', async () => {
  const sdrRoster = db.prepare("SELECT id, tools_json FROM roster_agents WHERE name = 'SDR'").get();
  const added = await call('POST', `/api/canvases/${canvasId}/agents`, memberCookie, { roster_id: sdrRoster.id });
  assert.equal(added.status, 200);
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(added.data.agent.id);
  assert.equal(agent.step_budget, 32);
  assert.equal(agent.wall_ms_budget, 480000);
  assert.deepEqual(JSON.parse(agent.tools_json), JSON.parse(sdrRoster.tools_json), 'authority map copied verbatim');
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

test('boot never recreates the removed Executive Roundtable demo', () => {
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM canvases WHERE name = 'Executive Roundtable'").get().n, 0);
});

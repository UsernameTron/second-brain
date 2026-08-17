'use strict';
// Product bootstrap and the one-time retirement of pre-product demo content.
process.env.DEV_AUTH = '1';
process.env.JWT_SECRET = 'test-secret-material-32-bytes-xx';
process.env.DB_PATH = ':memory:';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { db, nowIso, getSetting, setSetting } = require('../server/db');
const control = require('../server/orchestrator/control');
const {
  seedIfEmpty, retireLegacyArtifacts, recolorLegacyAgents, OWNER_EMAIL,
} = require('../server/seed');

const bootstrap = seedIfEmpty();

test('fresh bootstrap creates access only—no fabricated product content', () => {
  assert.equal(bootstrap.seeded, true);
  assert.equal(seedIfEmpty().seeded, false, 'access bootstrap is idempotent');
  assert.ok(db.prepare('SELECT 1 FROM allowlist WHERE email = ?').get(OWNER_EMAIL));
  for (const table of ['canvases', 'notes', 'files', 'tasks', 'sheet_rows', 'changesets', 'runs', 'memory_entries']) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, `${table} starts empty`);
  }
});

test('legacy cleanup hides only proven artifacts and preserves their ledger rows', () => {
  const ts = nowIso();
  const realCanvas = crypto.randomUUID();
  const demoCanvas = crypto.randomUUID();
  const smokeCanvas = '21f8ca30-ef46-42d5-a08c-8dd526fba663';
  const smokeLookalike = crypto.randomUUID();
  db.prepare("INSERT INTO canvases (id,name,created_by,created_at) VALUES (?, 'Client work', ?, ?)")
    .run(realCanvas, OWNER_EMAIL, ts);
  db.prepare("INSERT INTO canvases (id,name,created_by,created_at) VALUES (?, 'Conference Lead Cleanup', 'seed', ?)")
    .run(demoCanvas, ts);
  db.prepare("INSERT INTO canvases (id,name,created_by,created_at) VALUES (?, 'Smoke Test', ?, ?)")
    .run(smokeCanvas, OWNER_EMAIL, ts);
  db.prepare("INSERT INTO canvases (id,name,created_by,created_at) VALUES (?, 'Smoke Test', ?, ?)")
    .run(smokeLookalike, OWNER_EMAIL, ts);
  setSetting('demo_canvas_id', demoCanvas);

  const realNote = crypto.randomUUID();
  const protocol = crypto.randomUUID();
  const registry = crypto.randomUUID();
  db.prepare('INSERT INTO notes (id,canvas_id,title,content,pinned,x,y,updated_by,updated_at) VALUES (?,?,?,?,1,0,0,?,?)')
    .run(realNote, realCanvas, 'Client constraint', 'Keep this real context.', OWNER_EMAIL, ts);
  db.prepare('INSERT INTO notes (id,canvas_id,title,content,pinned,x,y,updated_by,updated_at) VALUES (?,?,?,?,1,0,0,?,?)')
    .run(protocol, demoCanvas, 'Synthesis protocol', 'legacy', 'seed', ts);
  db.prepare('INSERT INTO notes (id,canvas_id,title,content,pinned,x,y,updated_by,updated_at) VALUES (?,?,?,?,1,0,0,?,?)')
    .run(registry, smokeCanvas, 'DEPRICATED ICP registry — sr-icp-v5', 'legacy registry', OWNER_EMAIL, ts);
  const demoFile = crypto.randomUUID();
  db.prepare("INSERT INTO files (id,canvas_id,name,mime,size,content,x,y,uploaded_by,created_at) VALUES (?,?,'conference-leads.csv','text/csv',5,?,0,0,'seed',?)")
    .run(demoFile, demoCanvas, Buffer.from('a,b\n1'), ts);
  db.prepare("INSERT INTO tasks (id,canvas_id,title,status,x,y,created_at,updated_at) VALUES (?,?,'Clean lead batch #1','todo',0,0,?,?)")
    .run(crypto.randomUUID(), demoCanvas, ts, ts);
  db.prepare("INSERT INTO agents (id,canvas_id,name,role,color,model_tier,system_prompt,status,x,y,created_at) VALUES ('legacy-agent',?,'Legacy','research','#2080D0','fast','','running',0,0,?)")
    .run(smokeCanvas, ts);
  db.prepare("INSERT INTO standing_rules (id,canvas_id,agent_id,owner_email,instruction,output_type,cadence,state,next_run_at,created_by,created_at,updated_at) VALUES (?,?,?,?,'acceptance rule','brief','hourly','active',?,?,?,?)")
    .run('legacy-rule', smokeCanvas, 'legacy-agent', OWNER_EMAIL, '2026-08-17T09:00:00.000Z', OWNER_EMAIL, ts, ts);
  db.prepare("INSERT INTO standing_authorizations (id,rule_id,canvas_id,authorized_by,workspace_role_at_grant,allowed_tools_json,mode,granted_at,expires_at) VALUES ('legacy-auth','legacy-rule',?,?,?,'[]','ask',?,?)")
    .run(smokeCanvas, OWNER_EMAIL, 'owner', ts, '2026-11-16T09:00:00.000Z');
  db.prepare("INSERT INTO runs (id,agent_id,canvas_id,trigger_kind,instruction,status,step_budget,wall_ms_budget,created_at,mode) VALUES ('legacy-run-prior','legacy-agent',?,'system','prior attempt','running',4,30000,?,'ask')")
    .run(smokeCanvas, ts);
  db.prepare("INSERT INTO runs (id,agent_id,canvas_id,trigger_kind,instruction,status,step_budget,wall_ms_budget,created_at,mode) VALUES ('legacy-run-current','legacy-agent',?,'system','current attempt','queued',4,30000,?,'ask')")
    .run(smokeCanvas, ts);
  db.prepare("INSERT INTO standing_rule_runs (id,rule_id,rule_version,authorization_id,occurrence_key,run_id,retry_run_ids_json,state,attempt,created_at) VALUES ('legacy-occurrence','legacy-rule',1,'legacy-auth','2026-08-17T09','legacy-run-current','[\"legacy-run-prior\"]','running',2,?)")
    .run(ts);
  const priorAbort = new AbortController();
  const currentAbort = new AbortController();
  control.registerAbort('legacy-run-prior', priorAbort);
  control.registerAbort('legacy-run-current', currentAbort);

  const result = retireLegacyArtifacts('cleanup-test');
  assert.equal(priorAbort.signal.aborted, true, 'prior attempt is aborted in process');
  assert.equal(currentAbort.signal.aborted, true, 'current attempt is aborted in process');
  control.unregisterAbort('legacy-run-prior');
  control.unregisterAbort('legacy-run-current');
  assert.equal(result.retiredCanvases, 2);
  assert.equal(result.removedNotes, 2);
  assert.equal(result.removedFiles, 1);
  assert.equal(result.revokedRules, 1);
  assert.equal(db.prepare('SELECT removed_at FROM canvases WHERE id = ?').get(realCanvas).removed_at, null, 'real canvas remains');
  assert.ok(db.prepare('SELECT removed_at FROM canvases WHERE id = ?').get(demoCanvas).removed_at, 'seed demo hidden');
  assert.ok(db.prepare('SELECT removed_at FROM canvases WHERE id = ?').get(smokeCanvas).removed_at, 'known acceptance canvas hidden');
  assert.equal(db.prepare('SELECT removed_at FROM canvases WHERE id = ?').get(smokeLookalike).removed_at, null, 'same-title future canvas is preserved');
  assert.equal(db.prepare('SELECT deleted_at,pinned FROM notes WHERE id = ?').get(realNote).deleted_at, null, 'real note remains');
  assert.equal(db.prepare('SELECT pinned FROM notes WHERE id = ?').get(realNote).pinned, 1);
  assert.ok(db.prepare('SELECT deleted_at FROM notes WHERE id = ?').get(protocol).deleted_at, 'legacy note tombstoned');
  assert.equal(db.prepare('SELECT pinned FROM notes WHERE id = ?').get(protocol).pinned, 0, 'removed context cannot inject');
  assert.ok(db.prepare('SELECT deleted_at FROM files WHERE id = ?').get(demoFile).deleted_at, 'legacy sample file tombstoned');
  const retiredRule = db.prepare('SELECT state,next_run_at FROM standing_rules WHERE id = ?').get('legacy-rule');
  assert.equal(retiredRule.state, 'revoked');
  assert.equal(retiredRule.next_run_at, null, 'retired rule leaves the due index');
  const retiredAuthorization = db.prepare('SELECT revoked_at,revoked_by FROM standing_authorizations WHERE id = ?').get('legacy-auth');
  assert.ok(retiredAuthorization.revoked_at, 'active authorization is retired');
  assert.equal(retiredAuthorization.revoked_by, 'cleanup-test');
  const occurrence = db.prepare('SELECT state,skip_reason,ended_at FROM standing_rule_runs WHERE id = ?').get('legacy-occurrence');
  assert.equal(occurrence.state, 'skipped');
  assert.equal(occurrence.skip_reason, 'legacy canvas retired');
  assert.ok(occurrence.ended_at, 'halted occurrence is terminal');
  for (const runId of ['legacy-run-prior', 'legacy-run-current']) {
    const run = db.prepare('SELECT status,error,ended_at FROM runs WHERE id = ?').get(runId);
    assert.equal(run.status, 'failed', `${runId} cannot survive retirement`);
    assert.equal(run.error, 'legacy canvas retired');
    assert.ok(run.ended_at);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE canvas_id = ?').get(demoCanvas).n, 1, 'historical row retained');
  assert.strictEqual(getSetting('demo_canvas_id'), null, 'retired sample locator is removed');
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'canvas.retire_legacy'").get(), 'cleanup audited');
  const ruleAudit = db.prepare("SELECT actor_id,detail FROM audit_log WHERE action = 'standing_rule.retire_legacy'").get();
  assert.equal(ruleAudit.actor_id, 'cleanup-test');
  assert.deepEqual(JSON.parse(ruleAudit.detail), {
    ruleId: 'legacy-rule', canvasId: smokeCanvas, previousState: 'active',
    reason: 'legacy canvas retired', haltedRuns: 1,
  });
  assert.deepEqual(retireLegacyArtifacts('cleanup-test'), { retiredCanvases: 0, removedNotes: 0, removedFiles: 0, revokedRules: 0 });
});

test('legacy retro agent colors are recolored in place exactly once', () => {
  const canvasId = db.prepare("SELECT id FROM canvases WHERE name = 'Client work'").get().id;
  db.prepare("INSERT INTO agents (id,canvas_id,name,role,color,model_tier,system_prompt,x,y,created_at) VALUES (?,?,'Old','research','#4cc2ab','fast','',0,0,?)")
    .run(crypto.randomUUID(), canvasId, nowIso());
  const result = recolorLegacyAgents();
  assert.ok(result.recolored >= 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agents WHERE color = '#4cc2ab'").get().n, 0);
  assert.equal(recolorLegacyAgents().recolored, 0);
});

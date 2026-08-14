'use strict';
// Contract tests for the shared memory layer: append-only writes, provenance,
// epistemic states, supersession + conflict-on-concurrent-correction,
// downstream flagging, lineage, and the hash-chained audit log.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-test-'));
process.env.DAILY_BUDGET_USD = '5';

const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');
const { audit, verifyChain } = require('../server/audit');

const CANVAS = 'canvas-test-1';
db.prepare("INSERT INTO canvases (id, name, created_at) VALUES (?, 'Test', ?)").run(CANVAS, nowIso());

function write(content, epistemic, cites = []) {
  return memory.writeEntry({
    canvasId: CANVAS, content, epistemic,
    authorType: 'agent', authorId: 'agent-1', authorName: 'TestAgent', source: 'test', cites,
  });
}

test('writes carry provenance and epistemic state; invalid states rejected', () => {
  const entry = write('The sky is blue', 'verified');
  assert.equal(entry.epistemic, 'verified');
  assert.equal(entry.author.name, 'TestAgent');
  assert.equal(entry.source, 'test');
  assert.ok(entry.createdAt);
  assert.throws(() => write('bad', 'opinion'), /epistemic/);
  assert.throws(() => memory.writeEntry({ canvasId: CANVAS, content: '', epistemic: 'verified', authorType: 'agent', authorId: 'x' }), /content/);
});

test('citing a nonexistent entry is rejected atomically (no partial write)', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM memory_entries').get().n;
  assert.throws(() => write('depends on ghost', 'inference', ['no-such-id']), /cited memory entry not found/);
  const after = db.prepare('SELECT COUNT(*) AS n FROM memory_entries').get().n;
  assert.equal(after, before);
});

test('correction supersedes, keeps history, and flags downstream citers transitively', () => {
  const a = write('Company X has 100 employees', 'assumption');
  const b = write('Company X is mid-size', 'inference', [a.id]);
  const c = write('Recommend mid-size pricing tier for X', 'inference', [b.id]);
  const unrelated = write('Company Y is in Texas', 'verified');

  const result = memory.correctEntry({
    entryId: a.id, content: 'Company X has 12 employees (confirmed via registry)', epistemic: 'verified',
    reason: 'original was an unverified assumption; registry says 12',
    authorType: 'user', authorId: 'pete@cloudtechgurus.com',
  });
  assert.ok(!result.conflict);
  assert.equal(result.entry.supersedes, a.id);
  // downstream contamination set: b and c, not the unrelated entry
  assert.deepEqual([...result.affected].sort(), [b.id, c.id].sort());

  const oldEntry = memory.getEntry(a.id);
  assert.equal(oldEntry.supersededBy, result.entry.id); // history retained, marked superseded
  assert.equal(oldEntry.content, 'Company X has 100 employees'); // append-only: content untouched

  // default listing excludes superseded, marks tainted downstream
  const entries = memory.listEntries({ canvasId: CANVAS });
  const ids = entries.map((e) => e.id);
  assert.ok(!ids.includes(a.id));
  assert.ok(entries.find((e) => e.id === b.id).tainted);
  assert.ok(entries.find((e) => e.id === c.id).tainted);
  assert.ok(!entries.find((e) => e.id === unrelated.id).tainted);
});

test('concurrent supersession of the same entry surfaces as a conflict, never last-write-wins', () => {
  const target = write('Meeting is on Tuesday', 'assumption');
  // corrector is a different agent — self-upgrade to verified is banned
  const first = memory.correctEntry({
    entryId: target.id, content: 'Meeting is on Wednesday', epistemic: 'verified', reason: 'calendar checked',
    authorType: 'agent', authorId: 'agent-2',
  });
  assert.ok(!first.conflict);
  const second = memory.correctEntry({
    entryId: target.id, content: 'Meeting is on Thursday', epistemic: 'verified', reason: 'email says so',
    authorType: 'agent', authorId: 'agent-2',
  });
  assert.equal(second.conflict, true);
  assert.equal(second.current.id, first.entry.id); // the earlier correction still stands
  // the losing correction wrote nothing
  const stillCurrent = memory.getEntry(target.id);
  assert.equal(stillCurrent.supersededBy, first.entry.id);
});

test('lineage traces upstream and downstream with depth', () => {
  const root = write('Row 4 website is example.com', 'verified');
  const mid = write('Row 4 website field is junk', 'inference', [root.id]);
  const leaf = write('Clear row 4 website to empty', 'inference', [mid.id]);
  const trace = memory.lineage(leaf.id);
  assert.equal(trace.entry.id, leaf.id);
  const upIds = trace.upstream.map((e) => e.id);
  assert.ok(upIds.includes(mid.id) && upIds.includes(root.id));
  assert.equal(trace.upstream.find((e) => e.id === mid.id).depth, 1);
  assert.equal(trace.upstream.find((e) => e.id === root.id).depth, 2);
  const downFromRoot = memory.lineage(root.id);
  const downIds = downFromRoot.downstream.map((e) => e.id);
  assert.ok(downIds.includes(mid.id) && downIds.includes(leaf.id));
});

test('run reads feed the lineage trace', () => {
  const entry = write('context entry', 'verified');
  memory.recordRunReads('run-123', [entry.id]);
  db.prepare(`INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES ('agent-x', ?, 'X', 'research', ?)`).run(CANVAS, nowIso());
  db.prepare(`INSERT INTO runs (id, agent_id, canvas_id, instruction, status, step_budget, wall_ms_budget, created_at)
              VALUES ('run-123', 'agent-x', ?, 'test', 'completed', 10, 1000, ?)`).run(CANVAS, nowIso());
  const produced = memory.writeEntry({
    canvasId: CANVAS, content: 'produced by run', epistemic: 'inference',
    authorType: 'agent', authorId: 'agent-x', runId: 'run-123',
  });
  const trace = memory.lineage(produced.id);
  assert.equal(trace.producingRun.id, 'run-123');
  assert.equal(trace.runReads[0].id, entry.id);
});

test('audit log is hash-chained and tamper-evident', () => {
  audit('user', 'tester', 'test.action', { n: 1 });
  audit('user', 'tester', 'test.action', { n: 2 });
  assert.deepEqual(verifyChain().ok, true);
  // simulate tampering with a historical row
  db.prepare("UPDATE audit_log SET detail = '{\"n\":999}' WHERE action = 'test.action' AND detail = '{\"n\":1}'").run();
  const check = verifyChain();
  assert.equal(check.ok, false);
  assert.ok(check.brokenAt > 0);
});

test('tail verification catches tampering in the tail at O(K) cost (finding 10)', () => {
  const { verifyChainTail } = require('../server/audit');
  for (let i = 0; i < 5; i++) audit('user', 'tester', 'tail.action', { i });
  // the row tampered by the previous test sits outside a K=3 tail...
  assert.equal(verifyChainTail(3).ok, true, 'a clean tail verifies even with older damage (anchor is trusted)');
  assert.equal(verifyChainTail(3).tail, 3);
  // ...but tampering inside the tail is caught
  db.prepare("UPDATE audit_log SET detail = '{\"i\":999}' WHERE action = 'tail.action' AND detail = '{\"i\":4}'").run();
  const broken = verifyChainTail(3);
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, 'hash mismatch');
});

test('batched citation maps: listEntries returns the same cites/citedBy/taint as per-row reads (wave 0a perf)', () => {
  const a = write('perf base fact alpha-unique-token', 'verified');
  const b = write('perf derived fact beta-unique-token', 'inference', [a.id]);
  // Batched path (listEntries) must match the per-row path (getEntry) exactly.
  const listed = memory.listEntries({ canvasId: CANVAS, query: 'unique-token', limit: 50 });
  const la = listed.find((e) => e.id === a.id);
  const lb = listed.find((e) => e.id === b.id);
  assert.ok(la && lb, 'both entries found via scored search');
  assert.deepEqual(la.cites, memory.getEntry(a.id).cites);
  assert.deepEqual(la.citedBy, memory.getEntry(a.id).citedBy);
  assert.deepEqual(lb.cites, memory.getEntry(b.id).cites);
  assert.deepEqual(lb.citedBy, memory.getEntry(b.id).citedBy);
  assert.deepEqual(lb.cites, [a.id]);
  assert.deepEqual(la.citedBy.includes(b.id), true);
});

test('taint short-circuit: taint flags identical before and after the no-corrections fast path (wave 0a perf)', () => {
  // Correct the base entry so its downstream is genuinely tainted — the fast
  // path must not swallow real taint, only skip the walk when nothing is superseded.
  const a = write('taint base gamma-unique-token', 'inference');
  const c = write('taint child delta-unique-token', 'inference', [a.id]);
  const { entry: corrected } = memory.correctEntry({
    entryId: a.id, content: 'taint base corrected', epistemic: 'inference', reason: 'test',
    authorType: 'user', authorId: 'pete', authorName: 'Pete',
  });
  assert.ok(corrected);
  const listed = memory.listEntries({ canvasId: CANVAS, query: 'delta-unique-token', limit: 50 });
  const lc = listed.find((e) => e.id === c.id);
  assert.equal(lc.tainted, true, 'downstream of a correction is still flagged tainted');
});

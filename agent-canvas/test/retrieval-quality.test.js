'use strict';
// Wave 4: the retrieval-quality gate. A fixture corpus and query→expected
// cases that must pass under BOTH the scored-OR LIKE scorer and the FTS5
// bm25 path — the cutover condition the roadmap set. This file is the seed
// of the retrieval eval suite; grow it with every observed retrieval miss.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-retrieval-'));

const memory = require('../server/memory');
const { db, nowIso } = require('../server/db');

const CANVAS = 'canvas-retrieval';
db.prepare("INSERT INTO canvases (id, name, created_at) VALUES (?, 'Retrieval', ?)").run(CANVAS, nowIso());

// Fixture corpus: realistic CTG-flavored memory entries.
const CORPUS = [
  'Team size: 7 people total — feasible at 7-person scale only',
  'Acme Corporation runs a 400 seat contact center in Phoenix',
  'The daily token budget is capped at 25 USD per workspace',
  'Darren owns partner outreach; Fred owns investor updates',
  'ICP scoring v6 weights healthcare vertical 1.4x',
  'HubSpot is the CRM of record; RocketPRM is read-only legacy',
  'Playvox integration is blocked on OAuth scope approval',
  'Escalations resolve through the needs-you tray, never email',
  'Enrichment dispatch requires ED_DISPATCH_URL to be exported on deploy',
  'The workbook demo uses conference lead rows from the Vegas event',
  'Litestream replicates SQLite to GCS every write',
  'Voice commands parse through the fast model before dispatch',
];
const ids = [];
for (const content of CORPUS) {
  ids.push(memory.writeEntry({
    canvasId: CANVAS, content, epistemic: 'inference', authorType: 'user', authorId: 'pete', source: 'fixture',
  }).id);
}

// query → index (into CORPUS) that must appear in the top 3 results.
const CASES = [
  ['7-person team capacity constraint', 0],   // the original field failure
  ['acme seat count', 1],
  ['acme corporation contact center', 1],
  ['daily budget cap', 2],
  ['who owns investor updates', 3],
  ['icp healthcare weighting', 4],
  ['crm of record', 5],
  ['playvox oauth blocked', 6],
  ['how do escalations resolve', 7],
  ['enrichment deploy env var', 8],
  ['vegas conference leads', 9],
  ['sqlite replication gcs', 10],
];

function topIds(query, n = 3) {
  return memory.listEntries({ canvasId: CANVAS, query, limit: n }).map((e) => e.id);
}

test(`retrieval quality: ${CASES.length} query cases hit their entry in the top 3 (engine: ${memory.retrievalEngine ? memory.retrievalEngine() : 'scored-or'})`, () => {
  const misses = [];
  for (const [query, idx] of CASES) {
    if (!topIds(query).includes(ids[idx])) misses.push(query);
  }
  assert.deepEqual(misses, [], `queries that missed their entry: ${misses.join(' | ')}`);
});

test('empty query still returns most recent entries', () => {
  const recent = memory.listEntries({ canvasId: CANVAS, limit: 5 });
  assert.equal(recent.length, 5);
  // The whole fixture corpus shares one created_at millisecond, so ordering
  // within it is a tie — assert membership, not position.
  assert.ok(recent.every((e) => ids.includes(e.id)));
});

test('search results carry a numeric score for the retrieval log', () => {
  const hits = memory.listEntries({ canvasId: CANVAS, query: 'acme corporation contact center', limit: 3 });
  assert.ok(hits.length > 0);
  assert.equal(typeof hits[0].score, 'number');
});

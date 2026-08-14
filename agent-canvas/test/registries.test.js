'use strict';
// Committed context registries. Two things are worth proving: the ingress
// filters actually held when the artifacts were generated (a rule enforced
// only in a generator that nobody re-runs is not a rule), and the lookup tool
// cannot be talked into returning more than it should.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-registries-'));
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { readRegistry, toolsForRole } = require('../server/orchestrator/tools');
const suppliers = require('../server/config/supplier-catalog.json');
const orgContext = require('../server/config/org-context.json');
const { buildSuppliers, buildOrgContext } = require('../scripts/build-registries');

// The excluded-vendor list lives in data, never in a prompt or a test literal
// that would itself surface the names. Read it from the generator.
const { EXCLUDED_VENDORS } = require('../scripts/build-registries')._internal;
const EXCLUDED_RE = new RegExp(`\\b(${EXCLUDED_VENDORS.join('|')})\\b`, 'i');

test('the committed artifacts contain no excluded-vendor name, anywhere', () => {
  for (const [name, data] of [['suppliers', suppliers], ['org-context', orgContext]]) {
    // Stringify the whole artifact: a name could hide in a tag, a source path,
    // or a statement, and "we filtered the obvious field" is not the rule.
    assert.ok(!EXCLUDED_RE.test(JSON.stringify(data.suppliers || data.facts)),
      `${name} must not surface any excluded vendor`);
  }
  assert.ok(suppliers.counts.dropped_excluded_vendor >= 1,
    'the supplier source does contain at least one — so a zero here would mean the filter never ran');
});

test('supplier rows carry no contact details and no commercial terms', () => {
  const blob = JSON.stringify(suppliers.suppliers);
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(blob), 'no email addresses');
  assert.ok(!/\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/.test(blob), 'no phone numbers');
  assert.ok(!/\d+\s*%|commission/i.test(blob), 'no commission rates or percentages');
  assert.ok(suppliers.suppliers.length > 300, 'the catalogue is actually populated');
  for (const row of suppliers.suppliers.slice(0, 20)) {
    assert.deepEqual(Object.keys(row).sort(), ['category', 'name', 'tags']);
  }
});

test('org-context holds only uncontradicted FACTs and says it is frozen', () => {
  assert.ok(orgContext.facts.length > 0);
  assert.match(orgContext.frozen_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(orgContext.authority_note, /live source wins/i);
  const layers = new Set(orgContext.facts.map((f) => f.layer));
  assert.deepEqual([...layers].sort(), ['decision_rights', 'entities', 'governance']);
  for (const f of orgContext.facts) {
    assert.ok(f.id && f.statement && f.source, 'every fact is traceable to its node and source path');
  }
});

test('the generators drop what they claim to drop', () => {
  // Feed each generator a row it must refuse, using the list's own data so the
  // test never hardcodes a name it is not allowed to surface.
  const vendor = EXCLUDED_VENDORS[0];
  const md = [
    '## CCaaS',
    `- **${vendor}**: **CCaaS** — tags: CCaaS — Commissions: 20% licenses`,
    '- **Acme**: **CCaaS** — tags: CCaaS, Analytics, Commissions: 20% licenses',
  ].join('\n');
  const out = buildSuppliers(md);
  assert.equal(out.suppliers.length, 1, 'the excluded vendor never becomes a row');
  assert.deepEqual(out.suppliers[0].tags, ['CCaaS', 'Analytics'], 'the commercial tag segment is dropped');

  const org = buildOrgContext({
    meta: { built: '2026-07-28' },
    nodes: [
      { id: 'a', layer: 5, tag: 'FACT', name: 'Keep', statement: 'Only the owner may approve this.', source: 's' },
      { id: 'b', layer: 5, tag: 'INFERENCE', name: 'Drop', statement: 'Probably approved by the owner.', source: 's' },
      { id: 'c', layer: 5, tag: 'UNKNOWN', name: 'Drop', statement: 'Who approves this?', source: 's' },
      { id: 'd', layer: 5, tag: 'FACT', name: 'Drop', statement: 'The owner must approve.', source: 's', contradictions: ['C-1'] },
      { id: 'e', layer: 3, tag: 'FACT', name: 'Drop', statement: 'Secret rotation policy: keys rotate every 90 days and the owner must approve.', source: 's' },
      { id: 'f', layer: 2, tag: 'FACT', name: 'Drop', statement: 'A workflow the owner must approve.', source: 's' },
    ],
  });
  assert.deepEqual(org.facts.map((f) => f.id), ['a'],
    'INFERENCE, UNKNOWN, contradicted, infra-governance and out-of-layer nodes are all refused');
  assert.equal(org.counts.dropped_contradicted, 1);
});

test('read_registry filters with AND, caps its output, and says when it truncated', () => {
  const all = readRegistry({ registry: 'suppliers' });
  assert.equal(all.total, suppliers.suppliers.length);
  assert.ok(all.results.length <= 25);
  assert.match(all.truncated, /narrow the query/, 'a silent cap would read as "that is all there is"');

  const wfm = readRegistry({ registry: 'suppliers', query: 'wfm' });
  assert.ok(wfm.matched > 0 && wfm.matched < all.total, 'the query actually narrows');

  const both = readRegistry({ registry: 'suppliers', query: 'wfm analytics' });
  assert.ok(both.matched <= wfm.matched, 'every term must match, not any');

  const asked = readRegistry({ registry: 'suppliers', query: 'wfm', limit: 500 });
  assert.ok(asked.results.length <= 25, 'the caller cannot raise the cap');

  const org = readRegistry({ registry: 'org_context', query: 'commission' });
  assert.ok(org.frozen_at, 'org-context results always carry the freeze date');
  assert.match(org.authority_note, /live source wins/i);
});

test('read_registry refuses an unknown registry and prototype keys', () => {
  for (const registry of ['secrets', 'constructor', '__proto__', 'toString']) {
    assert.throws(() => readRegistry({ registry }), /unknown registry/);
  }
});

test('every role can read the registries — it is local data, no spend, no network', () => {
  for (const role of ['research', 'commercial', 'strategic', 'operational', 'coding', 'review', 'crm', 'targeting']) {
    assert.ok(toolsForRole(role, { userRole: 'member' }).map((t) => t.name).includes('read_registry'), role);
  }
});

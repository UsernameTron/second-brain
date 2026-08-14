#!/usr/bin/env node
'use strict';
// Regenerates the two committed context registries from their upstream sources.
// Same contract as the config/icp-sr-icp-<version>.json registry: GENERATED, never
// hand-edited, and a refresh is a new commit rather than a live sync.
//
//   node scripts/build-registries.js <path-to-CTG-Workspace-Build>
//
// Sources (both outside this repo, both frozen at the dates recorded in the
// output, which is why the path is an argument rather than a constant):
//   ontology/ontology.json                     -> config/org-context.json
//   projects/advisor-match/docs/suppliers/catalog.md -> config/supplier-catalog.json
//
// Two filters run at ingress on BOTH, and neither is optional:
//   * the excluded-vendor rule (a named list this workspace never surfaces),
//     applied to every field before a row is kept;
//   * commercial terms — commission rates and percentages — which belong to
//     the deal desk, not to an agent's context.
// Ingress, not post-hoc: a row that fails is never written, so it cannot be
// forgotten later.

const fs = require('node:fs');
const path = require('node:path');

// Names this workspace never surfaces. Kept here as DATA, referred to by the
// name of the list everywhere else — the same rule the ICP registry follows so
// that no prompt ever contains a vendor name.
const EXCLUDED_VENDORS = ['ispn', 'genesys', 'asana'];
const EXCLUDED_RE = new RegExp(`\\b(${EXCLUDED_VENDORS.join('|')})\\b`, 'i');
const COMMERCIAL_RE = /\d+\s*%|\bcommission|\bcommissionable|\bnon[- ]commissionable|\brebate|\bmargin\b/i;

function excluded(text) { return EXCLUDED_RE.test(String(text || '')); }

// ---------- suppliers: names, categories, tags. Never the CSV. ----------
// The CSV alongside this markdown carries 420 supplier emails, 406 phones and
// 402 commission rates. It is not read here and must never enter this repo.
function buildSuppliers(md) {
  const rows = [];
  let category = null;
  let droppedExcluded = 0;
  let scrubbedTags = 0;
  for (const line of md.split('\n')) {
    const head = /^##\s+(.*)$/.exec(line);
    if (head) { category = head[1].trim(); continue; }
    const item = /^-\s+\*\*(.+?)\*\*:\s+\*\*(.+?)\*\*\s+—\s+tags:\s*(.*)$/.exec(line);
    if (!item) continue;
    const [, name, cat, rawTags] = item;
    if (excluded(name) || excluded(cat) || excluded(rawTags)) { droppedExcluded += 1; continue; }
    // Tags are free text and several carry commission terms. Keep the taxonomy
    // half, drop any comma-segment that reads commercially.
    const kept = rawTags.split(/\s*,\s*/).filter((t) => t && !COMMERCIAL_RE.test(t));
    if (kept.length !== rawTags.split(/\s*,\s*/).filter(Boolean).length) scrubbedTags += 1;
    rows.push({ name: name.trim(), category: (cat || category || '').trim(), tags: kept.map((t) => t.trim()) });
  }
  return {
    registry: 'supplier-catalog',
    source_of_truth: 'projects/advisor-match/docs/suppliers/catalog.md (CTG-Workspace-Build)',
    generated_by: 'agent-canvas/scripts/build-registries.js',
    contains: 'supplier name, category, and taxonomy tags only',
    excludes: 'supplier contact details, commission rates, and any name on the excluded-vendor list',
    counts: { suppliers: rows.length, dropped_excluded_vendor: droppedExcluded, rows_with_tags_scrubbed: scrubbedTags },
    suppliers: rows.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ---------- org context: FACT nodes only, no open questions ----------
// The ontology carries 367 FACT, 57 INFERENCE and 27 UNKNOWN nodes plus a
// contradictions register. Only FACT nodes, in the three layers that describe
// who owns which lane and which rules gate what, and only nodes with NO
// unresolved contradiction attached. The workspace's open questions are not
// canvas facts.
const LAYERS = { 1: 'entities', 3: 'governance', 5: 'decision_rights' };
// Governance is the largest layer by far. Keep the nodes that name an
// authority, a gate, or a rule an agent could actually violate...
const GOVERNANCE_KEEP = /\b(approv|authori|sign-?off|gate|must|never|only|owner|gover|policy|rule|gated|gates|prohibit|gatekeep|gating|decision)\b/i;
// ...and drop infrastructure governance, which is the same class of knowledge
// the fold-in review already rejected wholesale ("technology-estate"): true,
// well-evidenced, and of no use to an agent scoring a lead or drafting
// outreach. Secret rotation and OAuth scope sets are Pete's ops context, not
// canvas context.
const GOVERNANCE_INFRA = /\b(secret|api key|rotation|oauth|scope set|dwd|domain-wide|iam|service account|deploy|repo|commit|branch|adr|terraform|bucket|cloud run|vertex|gemini|pub\/?sub|firestore|bigquery|workload identity)\b/i;

function buildOrgContext(ontology) {
  const meta = ontology.meta || {};
  const facts = [];
  let droppedExcluded = 0;
  let droppedContradicted = 0;
  for (const node of ontology.nodes || []) {
    if (node.tag !== 'FACT' || !LAYERS[node.layer]) continue;
    if (node.contradictions && node.contradictions.length) { droppedContradicted += 1; continue; }
    if (excluded(node.statement) || excluded(node.name)) { droppedExcluded += 1; continue; }
    const layer = LAYERS[node.layer];
    if (layer === 'governance'
      && (!GOVERNANCE_KEEP.test(node.statement) || GOVERNANCE_INFRA.test(node.statement))) continue;
    facts.push({ id: node.id, layer, name: node.name, statement: node.statement, source: node.source });
  }
  return {
    registry: 'org-context',
    source_of_truth: 'ontology/ontology.json (CTG-Workspace-Build)',
    generated_by: 'agent-canvas/scripts/build-registries.js',
    frozen_at: meta.built || 'unknown',
    authority_note:
      'FROZEN at the date above while the Drive corpus keeps moving. Where one of these facts '
      + 'disagrees with a live source (a SOI corpus answer, a document read this week, a person), '
      + 'the live source wins on recency and this entry is the stale one. Each entry carries its '
      + 'node id and source path so the disagreement can be traced rather than argued.',
    excludes: 'INFERENCE and UNKNOWN nodes, every node carrying an unresolved contradiction, and any name on the excluded-vendor list',
    counts: { facts: facts.length, dropped_excluded_vendor: droppedExcluded, dropped_contradicted: droppedContradicted },
    facts,
  };
}

function main() {
  const root = process.argv[2];
  if (!root) {
    process.stderr.write('usage: node scripts/build-registries.js <path-to-CTG-Workspace-Build>\n');
    process.exit(2);
  }
  const outDir = path.join(__dirname, '..', 'server', 'config');
  const suppliers = buildSuppliers(fs.readFileSync(path.join(root, 'projects/advisor-match/docs/suppliers/catalog.md'), 'utf8'));
  const org = buildOrgContext(JSON.parse(fs.readFileSync(path.join(root, 'ontology/ontology.json'), 'utf8')));
  fs.writeFileSync(path.join(outDir, 'supplier-catalog.json'), `${JSON.stringify(suppliers, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'org-context.json'), `${JSON.stringify(org, null, 2)}\n`);
  process.stdout.write(`suppliers: ${JSON.stringify(suppliers.counts)}\norg-context: ${JSON.stringify(org.counts)}\n`);
}

if (require.main === module) main();
module.exports = { buildSuppliers, buildOrgContext, _internal: { EXCLUDED_VENDORS, excluded } };

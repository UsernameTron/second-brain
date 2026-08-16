'use strict';

// The documentation is a claim surface, and it rotted the same way twice: a new
// file landed that nothing indexed, and a link kept pointing at a heading that
// had moved. Neither is caught by reading — both are caught by walking the tree.
// This suite is the walk. It asserts STRUCTURE only: that every document is
// classified, that every local link resolves, and that everything filed as
// history says so on its first screen. Whether a sentence is TRUE is not
// something a test can know; that is what the evidence hierarchy in
// docs/README.md is for.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const INDEX = path.join(DOCS, 'README.md');

// Scope: the documents this index governs. frontend/ carries build output and
// an asset note that belong to the app, not to the documentation contract.
const governed = [
  ...fs.readdirSync(DOCS).filter((f) => f.endsWith('.md')).map((f) => path.join('docs', f)),
  'README.md',
  'CLAUDE.md',
];

const indexText = fs.readFileSync(INDEX, 'utf8');

// Link targets, resolved relative to the file that wrote them. Skips external
// URLs, in-page anchors, and mailto:.
function localLinks(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const out = [];
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = m[1].trim();
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    out.push(href.split('#')[0]);
  }
  return out.filter(Boolean);
}

// The "Historical records" list in the index is the authority on what is
// history — so the banner check reads its membership from there rather than
// keeping a second hand-maintained list that could disagree with it.
function historicalEntries() {
  const section = indexText.split('## Historical records')[1] || '';
  return [...section.matchAll(/\[[^\]]*\]\(([^)]+\.md)\)/g)].map((m) => m[1]);
}

test('every governed document is classified in the documentation index', () => {
  const unlisted = governed.filter((f) => f !== 'docs/README.md').filter((f) => {
    // The index links siblings bare (HANDOFF.md) and parents with ../.
    const bare = path.basename(f);
    const asSibling = f.startsWith('docs/') ? bare : `../${bare}`;
    return !indexText.includes(`(${asSibling})`);
  });
  assert.deepEqual(unlisted, [],
    `add these to docs/README.md, or the next reader cannot tell what they are: ${unlisted.join(', ')}`);
});

test('the index does not list documents that no longer exist', () => {
  const missing = localLinks('docs/README.md').filter((href) => !fs.existsSync(path.resolve(DOCS, href)));
  assert.deepEqual(missing, [], `docs/README.md points at files that are not there: ${missing.join(', ')}`);
});

test('every local link in every governed document resolves on disk', () => {
  const broken = [];
  for (const file of governed) {
    const from = path.dirname(path.join(ROOT, file));
    for (const href of localLinks(file)) {
      if (!fs.existsSync(path.resolve(from, href))) broken.push(`${file} -> ${href}`);
    }
  }
  assert.deepEqual(broken, [], `broken local links:\n  ${broken.join('\n  ')}`);
});

test('every document filed as historical says so before its first section', () => {
  const entries = historicalEntries();
  assert.ok(entries.length >= 5, 'the historical list emptied out — that is a regression, not a cleanup');
  const unbannered = [];
  for (const href of entries) {
    const full = path.resolve(DOCS, href);
    // The banner must land above the fold: title, blank line, then a blockquote,
    // before any content a reader could mistake for current instruction.
    const head = fs.readFileSync(full, 'utf8').split('\n').slice(0, 12).join('\n');
    const quoted = head.split('\n').some((l) => l.startsWith('>'));
    if (!quoted || !/histor/i.test(head)) unbannered.push(href);
  }
  assert.deepEqual(unbannered, [],
    `these are indexed as history but do not announce it: ${unbannered.join(', ')}`);
});

test('the current-state handoff stays short enough to actually be read', () => {
  // It was 1666 lines with the live claim buried in the middle; the history is
  // preserved next door in HANDOFF-HISTORY.md. A hard ceiling is the only thing
  // that has ever kept this file from re-accumulating.
  const lines = fs.readFileSync(path.join(DOCS, 'HANDOFF.md'), 'utf8').split('\n').length;
  assert.ok(lines <= 200,
    `docs/HANDOFF.md is ${lines} lines — move the historical tail into HANDOFF-HISTORY.md`);
  assert.ok(fs.existsSync(path.join(DOCS, 'HANDOFF-HISTORY.md')), 'the history file must not be deleted');
});

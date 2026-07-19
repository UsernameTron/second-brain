#!/usr/bin/env node
'use strict';
// Archive-integrity validator: every entry archived as a duplicate must name a
// live superseder in memory.md. Guards the one-way door found 2026-07-19 —
// the archive is read for dedup but invisible to /recall, so an entry archived
// without a live superseder is unreachable AND blocks its own re-entry.
//
// Rules per archived entry:
//   - superseded_by:: field absent            -> FAIL
//   - value 'none' with archived:: duplicate  -> FAIL (a duplicate must point at its twin)
//   - value 'none' otherwise (e.g. seed-data) -> OK (deliberate no-superseder archive)
//   - any other value must match a content_hash:: in live memory.md, else FAIL

const fs = require('fs');
const path = require('path');

const VAULT_ROOT = () => process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');
const ARCHIVE_DIR = () => path.join(VAULT_ROOT(), 'memory-archive');
const MEMORY_FILE = () => path.join(VAULT_ROOT(), 'memory', 'memory.md');

function parseEntries(text) {
  // Entries are '### '-delimited blocks carrying field:: lines.
  return text
    .split(/^### /m)
    .filter((b) => b.trim())
    .map((block) => {
      const field = (name) => {
        const m = block.match(new RegExp(`^${name}:: *(.*)$`, 'm'));
        return m ? m[1].trim() : null;
      };
      return {
        hash: field('content_hash'),
        supersededBy: field('superseded_by'),
        archivedReason: (field('archived') || '').split('·').pop().trim(),
        heading: block.split('\n', 1)[0].trim(),
      };
    });
}

function validateArchive() {
  const dir = ARCHIVE_DIR();
  if (!fs.existsSync(dir)) return { ok: true, entries: 0, files: 0, violations: [] };

  const liveHashes = new Set(
    (fs.existsSync(MEMORY_FILE()) ? fs.readFileSync(MEMORY_FILE(), 'utf8') : '')
      .split('\n')
      .map((l) => (l.match(/^content_hash:: *(\S+)/) || [])[1])
      .filter(Boolean)
  );

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const violations = [];
  let entries = 0;

  for (const f of files) {
    for (const e of parseEntries(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      entries++;
      const id = `${e.hash || e.heading} (${f})`;
      if (e.supersededBy === null) {
        violations.push(`${id}: superseded_by:: field missing`);
      } else if (e.supersededBy === 'none') {
        if (e.archivedReason === 'duplicate') {
          violations.push(`${id}: archived as duplicate but superseded_by:: none`);
        }
      } else if (!liveHashes.has(e.supersededBy)) {
        violations.push(`${id}: superseded_by:: ${e.supersededBy} not found in live memory.md`);
      }
    }
  }
  return { ok: violations.length === 0, entries, files: files.length, violations };
}

if (require.main === module) {
  const r = validateArchive();
  if (r.ok) {
    console.log(`[validate-archive] OK: ${r.entries} entries across ${r.files} files`);
  } else {
    console.error(`[validate-archive] FAIL: ${r.violations.length} violation(s)`);
    for (const v of r.violations) console.error(`  - ${v}`);
    process.exit(1);
  }
}

module.exports = { validateArchive, parseEntries };

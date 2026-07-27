#!/usr/bin/env node
'use strict';

/**
 * verify-baseline.js — VERIFY-SENTINEL-01 (Phase 34).
 *
 * Checks that the 27 real content_hash values captured from
 * memory.md.pre-governance.20260712 (eval/baseline-sentinel-hashes.json)
 * still resolve somewhere in memory/memory.md UNION archive/memory/*.md.
 * Replaces the fabricated "3/3 sentinel hashes verified" claim with a real,
 * exit-coded check.
 *
 *   node scripts/verify-baseline.js
 *   VAULT_ROOT=/path/to/vault node scripts/verify-baseline.js
 *
 * Exit codes: 0 all 27 resolve · 1 one or more missing.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const VAULT_ROOT = () => process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');

function readMemoryText() {
  const memoryFile = path.join(VAULT_ROOT(), 'memory', 'memory.md');
  let text = '';
  try {
    text = fs.readFileSync(memoryFile, 'utf8');
  } catch (_) {
    // absent memory.md contributes nothing
  }

  const archiveDir = path.join(VAULT_ROOT(), 'archive', 'memory');
  let archiveFiles = [];
  try {
    archiveFiles = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.md'));
  } catch (_) {
    // absent archive/memory/ contributes nothing
  }
  for (const f of archiveFiles) {
    text += '\n' + fs.readFileSync(path.join(archiveDir, f), 'utf8');
  }
  return text;
}

function main() {
  const { hashes } = require(path.join(REPO, 'eval', 'baseline-sentinel-hashes.json'));
  const text = readMemoryText();

  const missing = hashes.filter((h) => !text.includes(`content_hash:: ${h}`));
  const resolved = hashes.length - missing.length;

  console.log(`${resolved}/${hashes.length} baseline hashes resolve`);
  if (missing.length > 0) {
    console.log(`Missing: ${missing.join(', ')}`);
  }
  process.exit(missing.length === 0 ? 0 : 1);
}

main();

#!/usr/bin/env node
'use strict';

/**
 * recall.js
 *
 * Standalone entry point for /recall — the cross-surface pull path
 * (v1.6 SURFACE-REACH-01, ADR-019). Runnable from any directory / any
 * Claude Code session on this machine:
 *
 *   node ~/projects/second-brain/scripts/recall.js "<query>" [flags]
 *
 * Flags (same as /recall): --category <name>, --since YYYY-MM-DD,
 * --top N, --semantic, --hybrid.
 *
 * Entry-point rule: scripts that call src/ directly must load dotenv
 * themselves. Uses the repo .env regardless of cwd.
 */

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runRecall } = require('../src/recall-command');

async function main() {
  const argv = process.argv.slice(2);
  const hasQuery = argv.some(tok => !tok.startsWith('--'));
  if (!hasQuery) {
    process.stderr.write('Usage: recall.js "<query>" [--category <name>] [--since YYYY-MM-DD] [--top N] [--semantic|--hybrid]\n');
    process.exit(1);
  }

  const result = await runRecall(argv);
  for (const line of result.lines) {
    process.stdout.write(line + '\n');
  }
}

main().catch(err => {
  process.stderr.write('recall failed: ' + ((err && err.message) || err) + '\n');
  process.exit(1);
});

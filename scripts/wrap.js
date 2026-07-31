#!/usr/bin/env node
'use strict';

/**
 * wrap.js
 *
 * Standalone entry point for /wrap — session memory extraction into
 * proposals/memory-proposals.md for human review via /promote-memories.
 *
 *   node scripts/wrap.js                      # this project's newest transcript
 *   node scripts/wrap.js --transcript <path>  # a specific transcript
 *   node scripts/wrap.js --file <vault-path>  # one vault file
 *   node scripts/wrap.js --dir <vault-dir>    # every .md in a vault dir
 *   node scripts/wrap.js --since YYYY-MM-DD   # Daily/ notes on or after
 *
 * Bare invocation defaults to the newest Claude Code transcript for this
 * project. Without that default `/wrap` staged nothing: extractMemories({})
 * returns [] immediately when given no file/dir/since, so the documented
 * no-argument usage was a silent no-op.
 *
 * Entry-point rule: scripts that call src/ must load dotenv themselves —
 * extraction classifies via Haiku and 401s without ANTHROPIC_API_KEY.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { extractMemories, extractFromTranscript } = require('../src/memory-extractor');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Newest Claude Code transcript for a project, or null if there are none.
 *
 * Claude Code stores transcripts at ~/.claude/projects/<slug>/<session-id>.jsonl
 * where the slug is the project's absolute path with '/' replaced by '-'.
 *
 * @param {string} projectRoot - absolute path to the project
 * @returns {string|null} absolute path to the newest .jsonl, or null
 */
function resolveLatestTranscript(projectRoot) {
  const root = process.env.TRANSCRIPTS_ROOT_OVERRIDE
    || path.join(os.homedir(), '.claude', 'projects');
  const dir = path.join(root, projectRoot.replace(/\//g, '-'));

  let newest = null;
  let newestMtime = -1;
  let entries;
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch (_) {
    return null; // no transcript dir for this project yet
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    try {
      const { mtimeMs } = fs.statSync(full);
      if (mtimeMs > newestMtime) {
        newestMtime = mtimeMs;
        newest = full;
      }
    } catch (_) { /* vanished mid-scan — skip */ }
  }
  return newest;
}

/**
 * A value-taking flag's argument must exist and not itself be a flag.
 * Otherwise `--file --since 2026-07-01` stores '--since' as the path AND
 * eats the real --since, so extraction runs against a vault file literally
 * named '--since', finds nothing, and reports success — the silent-success
 * shape this script exists to remove.
 */
const hasValue = (v) => typeof v === 'string' && v !== '' && !v.startsWith('--');

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file' && hasValue(argv[i + 1])) opts.file = argv[++i];
    else if (argv[i] === '--dir' && hasValue(argv[i + 1])) opts.dir = argv[++i];
    else if (argv[i] === '--since' && hasValue(argv[i + 1])) opts.since = argv[++i];
    else if (argv[i] === '--transcript' && hasValue(argv[i + 1])) opts.transcript = argv[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let results;
  let source;

  if (!opts.file && !opts.dir && !opts.since) {
    const transcript = opts.transcript || resolveLatestTranscript(PROJECT_ROOT);
    if (!transcript) {
      process.stderr.write(
        'wrap: no transcript found for this project — pass --transcript <path>, '
        + '--file <vault-path>, --dir <vault-dir>, or --since YYYY-MM-DD\n'
      );
      process.exit(1);
    }
    if (!fs.existsSync(transcript)) {
      process.stderr.write(`wrap: transcript not found: ${transcript}\n`);
      process.exit(1);
    }
    source = transcript;
    results = await extractFromTranscript(transcript, path.basename(transcript, '.jsonl'));
  } else {
    source = opts.file || opts.dir || `Daily/ since ${opts.since}`;
    results = await extractMemories(opts);
  }

  const count = Array.isArray(results) ? results.length : 0;
  const errors = (results && results.errors) || [];

  process.stdout.write(`Extracted ${count} memory candidate(s) from ${source}\n`);

  // A failed extraction used to look exactly like an empty one and exit 0, so an
  // unattended /wrap could lose a whole session's memories silently.
  if (errors.length) {
    for (const e of errors) {
      process.stderr.write(`wrap: extraction failed (${e.mode}): ${e.message}\n`);
    }
    process.stderr.write('wrap: extraction was incomplete — re-run before relying on this session\n');
    process.exit(1);
  }

  // C2: buffered candidates went to the pending JSONL, not the proposals file —
  // report them distinctly instead of letting them print as staged.
  const buffered = Array.isArray(results) ? results.filter((r) => r.buffered).length : 0;
  // Staged = actually written to proposals; written:false duplicates don't count.
  const staged = Array.isArray(results)
    ? results.filter((r) => r.written === true && !r.buffered).length
    : 0;
  if (buffered > 0) {
    process.stdout.write(
      `${staged} staged, ${buffered} buffered — run /wrap again to drain\n`
    );
  } else {
    process.stdout.write('Staged to proposals/memory-proposals.md — review with /promote-memories\n');
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write('wrap failed: ' + ((err && err.message) || err) + '\n');
    process.exit(1);
  });
}

module.exports = { main, resolveLatestTranscript, parseArgs };

#!/usr/bin/env node
'use strict';

/**
 * memory-extraction-hook.js
 *
 * Claude Code hook for memory extraction on conversation Stop.
 * Reads session metadata from stdin, extracts memory candidates
 * from the transcript, and writes proposals to the vault.
 *
 * Registration in settings.json:
 * "hooks": {
 *   "Stop": [{ "command": "node .claude/hooks/memory-extraction-hook.js" }]
 * }
 *
 * Always exits 0 — memory extraction is non-blocking enrichment (D-39).
 */

const { extractFromTranscript } = require('../../src/memory-extractor');

let inputData = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(inputData);
    const { session_id, transcript_path, hook_event_name } = input;

    // Only extract on Stop event
    if (hook_event_name !== 'Stop') {
      process.exit(0);
    }

    // Exit gracefully if transcript_path is missing
    if (!transcript_path) {
      process.exit(0);
    }

    await extractFromTranscript(transcript_path, session_id);
  } catch (_) {
    // Swallow all errors — enrichment must never block (D-39)
  }

  process.exit(0);
});

#!/usr/bin/env node
'use strict';

/**
 * today-scheduled.js
 *
 * launchd entry point for the weekday 06:45 briefing (com.secondbrain.today).
 * Replaces the plist's former inline `node -e` invocation, which never loaded
 * .env — scheduled runs lost the Haiku classifier fallback with "Could not
 * resolve authentication method" (com.secondbrain.today.err.log, 2026-07-21).
 *
 * Usage:
 *   node scripts/today-scheduled.js            # real scheduled run
 *   node scripts/today-scheduled.js --dry-run  # plumbing check, skips stats
 */

const path = require('path');

// Entry-point rule: scripts that call src/ directly must load dotenv
// (ANTHROPIC_API_KEY / VOYAGE_API_KEY / LM_API_TOKEN live in .env; launchd
// injects only PATH + VAULT_ROOT).
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const { runToday } = require('../src/today-command');

if (require.main === module) {
  const mode = process.argv.includes('--dry-run') ? 'dry-run' : 'scheduled';
  // Same output/exit contract as the old plist inline entry: runToday resolves
  // with an inline error envelope (D-19); only a rejection exits non-zero.
  runToday({ mode })
    .then((r) => {
      // B1: a resolved error envelope (no briefing) must exit non-zero so
      // launchd records the failure instead of a phantom success.
      if (!r.briefing) {
        console.error(r.error);
        process.exit(1);
      }
      console.log(r.briefing);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

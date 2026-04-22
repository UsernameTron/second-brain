#!/usr/bin/env node
'use strict';

/**
 * daily-sweep.js
 *
 * Entry point for D-21 trigger (3): scheduled daily sweep at 23:45.
 * Orchestrates memory extraction from today's Daily/ notes plus
 * lifecycle maintenance (dead-letter retry, stale proposal archive).
 *
 * Schedule via Claude Desktop scheduled task (preferred):
 *   Configure in Claude Desktop to run at 23:45 daily
 *
 * Schedule via macOS launchd (fallback):
 *   Create ~/Library/LaunchAgents/com.secondbrain.daily-sweep.plist
 *   with ProgramArguments: ["node", "/path/to/scripts/daily-sweep.js"]
 *   and StartCalendarInterval: { Hour: 23, Minute: 45 }
 *
 * Usage:
 *   node scripts/daily-sweep.js           # Run full sweep
 *   node scripts/daily-sweep.js --dry-run # Report what would run (no side effects)
 */

const { extractMemories } = require('../src/memory-extractor');
const { retryDeadLetters, archiveStaleLeftProposals } = require('../src/lifecycle');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.error(`[daily-sweep] Starting sweep for ${today}${dryRun ? ' (DRY RUN)' : ''}`);

  const results = { extraction: null, retry: null, archive: null };

  // 1. Extract memories from today's Daily/ notes
  try {
    if (dryRun) {
      console.error('[daily-sweep] Would extract memories from Daily/ for today');
      results.extraction = { dryRun: true };
    } else {
      results.extraction = await extractMemories({ dailyRange: `${today} ${today}` });
      console.error(`[daily-sweep] Extraction complete: ${Array.isArray(results.extraction) ? results.extraction.length : 0} candidates`);
    }
  } catch (err) {
    console.error(`[daily-sweep] Extraction failed: ${err.message}`);
    results.extraction = { error: err.message };
  }

  // 2. Retry eligible dead-letters
  try {
    if (dryRun) {
      console.error('[daily-sweep] Would retry eligible dead-letters');
      results.retry = { dryRun: true };
    } else {
      results.retry = await retryDeadLetters();
      console.error(`[daily-sweep] Retry complete: ${JSON.stringify(results.retry)}`);
    }
  } catch (err) {
    console.error(`[daily-sweep] Retry failed: ${err.message}`);
    results.retry = { error: err.message };
  }

  // 3. Archive stale left-proposals
  try {
    if (dryRun) {
      console.error('[daily-sweep] Would archive stale left-proposals');
      results.archive = { dryRun: true };
    } else {
      results.archive = await archiveStaleLeftProposals();
      console.error(`[daily-sweep] Archive complete: ${JSON.stringify(results.archive)}`);
    }
  } catch (err) {
    console.error(`[daily-sweep] Archive failed: ${err.message}`);
    results.archive = { error: err.message };
  }

  console.error(`[daily-sweep] Sweep complete for ${today}`);
  return results;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[daily-sweep] Fatal error: ${err.message}`);
    process.exit(1);
  });

#!/usr/bin/env node
'use strict';

/**
 * promote-scheduled.js
 *
 * launchd entry point for nightly auto-promotion (com.secondbrain.promote).
 * Runs after the 23:45 daily sweep and promotes the unreviewed candidates it
 * staged, treating "no checkbox" as accepted (--auto). Every other gate still
 * applies: content-policy exclusions, dedup against memory + archive, category
 * coercion, contradiction flagging. Explicit reject / defer checkboxes are
 * still honored, so a human can still veto before 00:45.
 *
 * Not a gate here: style lint. checkStyle() runs in vault-gateway on vault
 * writes; promotion writes memory.md directly, so promoted text is never
 * style-linted — that was true before this script and is unchanged by it.
 *
 * Decision 2026-09-01: the manual checkbox gate staged ~65 candidates a night
 * against a 10-per-batch review and accumulated 2,018 unreviewed proposals in
 * August. For a single operator the gate was a queue, not a review. Review now
 * happens after the fact: the weekly pulse (sample) and the monthly dream pass
 * (MERGE / STALE) are the correction loop.
 *
 * Usage:
 *   node scripts/promote-scheduled.js            # one batch (promotion.batchCapMax)
 *   node scripts/promote-scheduled.js --drain    # repeat until nothing promotes
 *   node scripts/promote-scheduled.js --dry-run  # plumbing check, no writes
 */

const path = require('path');

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
}

const { promoteMemories } = require('../src/promote-memories');

const MAX_DRAIN_ROUNDS = 100;

const KNOWN_FLAGS = new Set(['--drain', '--dry-run']);

async function main(argv = process.argv.slice(2)) {
  // This command promotes unchecked candidates. A mistyped safety flag
  // (`--dryrun`) must not silently fall through to a real promotion.
  const unknown = argv.filter((a) => !KNOWN_FLAGS.has(a));
  if (unknown.length) {
    console.error(`promote-scheduled: unknown argument(s): ${unknown.join(', ')}`);
    console.error(`promote-scheduled: known flags: ${[...KNOWN_FLAGS].join(', ')}`);
    process.exit(2);
  }

  const drain = argv.includes('--drain');
  const dryRun = argv.includes('--dry-run');
  const totals = { promoted: 0, duplicates: 0, rejected: 0, skipped: 0, rounds: 0 };

  for (let round = 1; round <= (drain ? MAX_DRAIN_ROUNDS : 1); round++) {
    // Only round 1 records the staged-proposals count; later rounds re-read the
    // same queue and would accumulate a duplicate daily figure.
    const r = await promoteMemories({ auto: true, dryRun, skipStats: round > 1 });
    if (r.error) {
      console.error(`promote-scheduled: round ${round} failed: ${r.error}`);
      process.exit(1);
    }
    totals.rounds = round;
    totals.promoted += r.promoted || 0;
    totals.duplicates += r.duplicates || 0;
    totals.rejected += r.rejected || 0;
    totals.skipped += r.skipped || 0;
    console.log(JSON.stringify({ round, promoted: r.promoted, deferred: r.deferred, duplicates: r.duplicates, rejected: r.rejected, skipped: r.skipped, dryRun: !!r.dryRun }));
    if (dryRun) break;
    // Stop when a round moves nothing out of the live queue. Deferred is
    // batch-cap overflow and stays live, so it is the loop's continue signal.
    if ((r.promoted || 0) === 0 && (r.duplicates || 0) === 0 && (r.rejected || 0) === 0) break;
    if (!r.deferred) break;
  }
  console.log(JSON.stringify({ done: true, ...totals }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`promote-scheduled: fatal: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}

module.exports = { main };

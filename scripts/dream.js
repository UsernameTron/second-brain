#!/usr/bin/env node
'use strict';

/**
 * scripts/dream.js
 *
 * Entry point for the monthly `/dream-propose` pass (Phase 34 Plan 06).
 * --propose runs detection (MERGE pairing + authoring, STALE flagging,
 * MISSED PATTERNS extraction) -> writes the reviewable changeset + stages
 * pattern ADDs into the existing promote gate -> updates state/dream-ledger.json.
 * Applies NOTHING to memory.md.
 *
 * --apply (HUMAN-INVOKED ONLY — never add to a plist/schedule) runs the
 * snapshot-first sequence: snapshotStore() -> acquire the proposals lock ->
 * applyOps() (MERGE/STALE ops applied in place, sources superseded not
 * deleted) -> SQLite rebuild --strict + reach export (non-fatal) ->
 * mandatory `npm run eval:recall` gate -> exit 1 auto-restores the snapshot
 * and reverts op statuses to unresolved; exit 0 stamps ops applied:: and
 * updates state/dream-ledger.json.
 *
 * Usage:
 *   node scripts/dream.js --propose   # detect, write changeset + patterns, update ledger
 *   node scripts/dream.js --dry-run   # same detection, writes nothing (changeset/ledger/ADDs)
 *   node scripts/dream.js --apply     # snapshot -> apply -> reindex -> eval:recall gate -> restore-on-fail
 *
 * Schedule via macOS launchd (monthly, --propose only — see
 * config/com.secondbrain.dream.plist and config/scheduling.json). --apply is
 * NEVER scheduled; it is a deliberate, human-invoked action only.
 */

const fs = require('fs');
const path = require('path');

// Entry-point rule: scripts that call src/ directly must load dotenv
// (ANTHROPIC_API_KEY / VOYAGE_API_KEY live in .env; without this the
// monthly launchd run 401s on every classify/embed call).
// Guarded to script execution only — tests require this module with a controlled env.
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const { readMemory } = require('../src/memory-reader');
const { readAllEmbeddings } = require('../src/semantic-index');
const { loadConfigWithOverlay } = require('../src/pipeline-infra');
const dream = require('../src/dream');

const LEDGER_PATH = process.env.DREAM_LEDGER_PATH_OVERRIDE || path.join(__dirname, '..', 'state', 'dream-ledger.json');

function loadLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  } catch (_) {
    return { lastRun: null, runs: [] };
  }
}

function saveLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
}

/**
 * Run the propose (or dry-run) detection pass. Never throws — detection
 * clients (Sonnet/Voyage) degrade gracefully on their own; a hard refusal
 * (unresolved changeset) is reported via the returned object, not a throw.
 * @param {{dryRun?: boolean}} [options={}]
 * @returns {Promise<object>} summary
 */
async function runPropose({ dryRun = false } = {}) {
  if (dream.hasUnresolvedChangeset()) {
    const msg = '[dream] refusing to run: an unresolved dream-changeset already exists in proposals/. Resolve it via /dream-apply review first.';
    process.stderr.write(msg + '\n');
    return { refused: true };
  }

  const config = loadConfigWithOverlay('pipeline', { validate: true });
  if (!config.dream || !config.dream.enabled) {
    process.stderr.write('[dream] dream.enabled is false in config/pipeline.json; nothing to do\n');
    return { skipped: true };
  }

  const entries = await readMemory();
  const embeddings = readAllEmbeddings();
  const budget = { used: 0 };

  const pairs = dream.detectMergePairs(entries, embeddings, config);
  const mergeOps = [];
  for (const pair of pairs) {
    if (budget.used >= config.dream.maxLLMCalls) break;
    budget.used++;
    // eslint-disable-next-line no-await-in-loop -- sequential authoring keeps the maxLLMCalls budget check accurate between calls
    const proposal = await dream.authorMerge(pair, config);
    if (proposal) mergeOps.push(proposal);
  }

  const staleOps = await dream.detectStale(entries, config, { budget });
  const patternAdds = await dream.detectPatterns(config, { budget, dryRun });

  const opsProposed = mergeOps.length + staleOps.length + patternAdds.length;

  let changesetResult = { written: false };
  if (!dryRun && (mergeOps.length > 0 || staleOps.length > 0)) {
    changesetResult = dream.writeChangeset(mergeOps, staleOps, { entries });
  }

  if (!dryRun) {
    const ledger = loadLedger();
    const runRecord = { date: new Date().toISOString(), opsProposed, opsAccepted: 0 };
    ledger.lastRun = runRecord.date;
    ledger.runs = [...(ledger.runs || []), runRecord];
    saveLedger(ledger);
  }

  const summary = {
    mergeOpsProposed: mergeOps.length,
    staleFlagsProposed: staleOps.length,
    patternAddsStaged: patternAdds.length,
    changesetWritten: changesetResult.written,
    changesetPath: changesetResult.path || null,
    dryRun,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

/**
 * Run the human-invoked `--apply` sequence: snapshot -> lock -> applyOps ->
 * SQLite rebuild --strict + reach export (non-fatal) -> mandatory
 * `npm run eval:recall` gate (auto-restore on exit 1) -> ledger update.
 * Never scheduled — see config/com.secondbrain.dream.plist / scheduling.json,
 * which run --propose only.
 * @returns {Promise<object>} summary
 */
async function runApply() {
  const config = loadConfigWithOverlay('pipeline', { validate: true });
  if (!config.dream || !config.dream.enabled) {
    process.stderr.write('[dream] dream.enabled is false in config/pipeline.json; nothing to apply\n');
    return { skipped: true };
  }

  const changesetPath = dream.findLatestChangesetPath();
  if (!changesetPath) {
    process.stderr.write('[dream] no dream-changeset-*.md found in proposals/ — nothing to apply\n');
    return { noChangeset: true };
  }

  const lockResult = await dream.acquireProposalsLock();
  if (!lockResult.acquired) {
    process.stderr.write('[dream] could not acquire the proposals lock (concurrent wrap/promote in progress) — try again shortly\n');
    process.exitCode = 1;
    return { lockFailed: true };
  }

  try {
    const runDate = new Date().toISOString().slice(0, 10);
    const snapshotPath = dream.snapshotStore(runDate);

    const changesetContent = fs.readFileSync(changesetPath, 'utf8');
    const applyResult = await dream.applyOps(changesetContent, config);

    if (applyResult.appliedIds.length === 0) {
      const summary = { applied: 0, reason: 'no accepted, not-yet-applied ops in the changeset' };
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      return summary;
    }

    // SQLite rebuild + reach export — non-fatal, mirrors promote-memories.js's
    // own post-write pattern; the mandatory gate below is npm run eval:recall.
    try {
      const { buildIndex } = require('./build-index');
      const indexResult = await buildIndex();
      if (indexResult.drift) {
        process.stderr.write(`[dream] index.db drift after apply: entries=${indexResult.entries} embeddings=${indexResult.embeddings}\n`);
      }
    } catch (err) {
      process.stderr.write(`[dream] index rebuild failed (non-fatal): ${err && err.message ? err.message : err}\n`);
    }
    try {
      const { runReachExport } = require('../src/reach-exporter');
      await runReachExport();
    } catch (err) {
      process.stderr.write(`[dream] reach export failed (non-fatal): ${err && err.message ? err.message : err}\n`);
    }

    // Mandatory gate over the LIVE vault: every merged entry must stay
    // retrievable (hybrid). Regression auto-restores the snapshot and reverts
    // the applied ops' accept boxes to unresolved.
    const gateResult = await dream.runEvalGate(snapshotPath, changesetPath, applyResult.appliedIds);

    const ledger = loadLedger();
    ledger.lastApply = {
      date: new Date().toISOString(),
      snapshotPath,
      opsApplied: applyResult.appliedIds.length,
      mergeCount: applyResult.mergeCount,
      staleCount: applyResult.staleCount,
      evalPassed: gateResult.passed,
    };
    if (ledger.runs && ledger.runs.length > 0) {
      ledger.runs[ledger.runs.length - 1].opsAccepted = gateResult.passed ? applyResult.appliedIds.length : 0;
    }
    saveLedger(ledger);

    const summary = {
      snapshotPath,
      opsApplied: applyResult.appliedIds.length,
      mergeCount: applyResult.mergeCount,
      staleCount: applyResult.staleCount,
      evalPassed: gateResult.passed,
      restored: !gateResult.passed,
      evalError: gateResult.error || null,
    };
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    if (!gateResult.passed) process.exitCode = 1;
    return summary;
  } finally {
    dream.releaseProposalsLock(lockResult.lockPath);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--propose')) {
    const result = await runPropose({ dryRun: false });
    if (result.refused) process.exitCode = 1;
    return;
  }
  if (args.includes('--dry-run')) {
    await runPropose({ dryRun: true });
    return;
  }
  if (args.includes('--apply')) {
    await runApply();
    return;
  }
  process.stderr.write('Usage: node scripts/dream.js --propose | --dry-run | --apply\n');
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[dream] fatal: ${err.stack || err}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runPropose, runApply };

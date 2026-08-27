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

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

// Entry-point rule: scripts that call src/ directly must load dotenv
// (LM_API_TOKEN / VOYAGE_API_KEY / ANTHROPIC_API_KEY live in .env; without
// this the nightly launchd run 401s on every classify call and stages nothing).
// Guarded to script execution only — tests require this module with a controlled env.
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const { extractMemories, extractFromTranscript } = require('../src/memory-extractor');
const { retryDeadLetters, archiveStaleLeftProposals } = require('../src/lifecycle');

const dryRun = process.argv.includes('--dry-run');

// ── Transcript sweep (D-21 trigger, HOOK-DOTENV-01 caller) ──────────────────

const TRANSCRIPTS_ROOT = process.env.TRANSCRIPTS_ROOT_OVERRIDE || path.join(os.homedir(), '.claude', 'projects');
const LEDGER_PATH = process.env.LEDGER_PATH_OVERRIDE || path.join(__dirname, '..', 'state', 'transcripts-swept.json');
const TRANSCRIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Proof-of-fire evidence (Phase 33 CAP-EVIDENCE-01): written atomically at sweep end.
// Gitignored (state/); /today's sweep-status line reads it. Override for test isolation.
const LAST_RUN_PATH = process.env.DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE || path.join(__dirname, '..', 'state', 'daily-sweep-last-run.json');

// ponytail: cheap keyword heuristic mirrors memory-extractor's HIGH_SIGNAL_PATTERNS
// intent (git/PR/decision language) — good enough to skip a stream-grep on files
// with zero signal; the real classification still happens inside extractFromTranscript.
const SIGNAL_PATTERN = /decided|learned|prefer|constraint|pattern|git diff|pull request|merged/i;

function loadLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  } catch (_) {
    return [];
  }
}

function saveLedger(entries) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

function findRecentTranscripts() {
  const cutoff = Date.now() - TRANSCRIPT_MAX_AGE_MS;
  const found = [];
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(TRANSCRIPTS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (_) {
    return found;
  }

  for (const dirName of projectDirs) {
    if (dirName.includes('worktrees')) continue; // skip worktree/subagent dirs
    const dirPath = path.join(TRANSCRIPTS_ROOT, dirName);
    let files;
    try {
      files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch (_) {
      continue;
    }
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (_) {
        continue;
      }
      if (stat.mtimeMs >= cutoff) {
        found.push({ path: filePath, mtime: stat.mtimeMs });
      }
    }
  }
  return found;
}

// Stream-grep: readline over the file, never load the whole transcript into memory.
async function hasSignal(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (SIGNAL_PATTERN.test(line)) {
      rl.close();
      return true;
    }
  }
  return false;
}

async function sweepTranscripts() {
  const ledger = loadLedger();
  const swept = new Map(ledger.map((e) => [e.path, e.mtime]));
  const candidates = findRecentTranscripts();

  const unswept = candidates.filter((c) => swept.get(c.path) !== c.mtime);

  if (dryRun) {
    return { dryRun: true, candidates: candidates.length, unswept: unswept.length };
  }

  let extracted = 0;
  const newLedgerEntries = [...ledger];
  for (const candidate of unswept) {
    let signal = false;
    try {
      signal = await hasSignal(candidate.path);
    } catch (err) {
      console.error(`[daily-sweep] Signal scan failed for ${candidate.path}: ${err.message}`);
    }
    if (signal) {
      let failed = false;
      try {
        const sessionId = path.basename(candidate.path, '.jsonl');
        // o1Shadow: opt in to the log-only O1 shadow (src/o1-shadow.js) — only this
        // caller, only under O1_SHADOW=1; /wrap and the Stop hook never pay for it.
        const results = await extractFromTranscript(candidate.path, sessionId, { o1Shadow: process.env.O1_SHADOW === '1' });
        extracted += Array.isArray(results) ? results.length : 0;
        if (results && results.errors && results.errors.length) {
          failed = true;
          for (const e of results.errors) {
            console.error(`[daily-sweep] Extraction failure (${e.mode}) for ${candidate.path}: ${e.message}`);
          }
        }
      } catch (err) {
        failed = true;
        console.error(`[daily-sweep] Transcript extraction failed for ${candidate.path}: ${err.message}`);
      }
      // Don't ledger a transcript whose extraction failed — leaving it unswept is
      // what makes the next run retry it instead of writing the session off.
      if (failed) continue;
    }
    const existingIdx = newLedgerEntries.findIndex((e) => e.path === candidate.path);
    const entry = { path: candidate.path, mtime: candidate.mtime };
    if (existingIdx >= 0) newLedgerEntries[existingIdx] = entry;
    else newLedgerEntries.push(entry);
  }

  saveLedger(newLedgerEntries);
  return { swept: unswept.length, extracted };
}

// ── Inbox ingest (RIGHT side — Cowork inbox/) ────────────────────────────────

function inboxDir() {
  const vaultRoot = process.env.VAULT_ROOT || path.join(os.homedir(), 'Claude Cowork');
  return path.join(vaultRoot, 'inbox');
}

async function sweepInbox() {
  const inbox = inboxDir();
  const archiveDir = path.join(inbox, 'archive');

  if (dryRun) {
    return { dryRun: true };
  }

  fs.mkdirSync(inbox, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  const files = fs.readdirSync(inbox).filter((f) => f.endsWith('.md'));
  const results = await extractMemories({ dir: 'inbox' });
  const errors = (results && results.errors) || [];

  // Archiving is destructive — an inbox file moved to archive/ after a failed
  // extraction is gone for good. Leave them in place so the next sweep retries.
  if (errors.length) {
    for (const e of errors) {
      console.error(`[daily-sweep] Inbox extraction failure (${e.mode}): ${e.message}`);
    }
    console.error(`[daily-sweep] Leaving ${files.length} inbox file(s) unarchived for retry`);
    return { processed: 0, extracted: Array.isArray(results) ? results.length : 0, failed: errors.length };
  }

  for (const file of files) {
    try {
      fs.renameSync(path.join(inbox, file), path.join(archiveDir, file));
    } catch (err) {
      console.error(`[daily-sweep] Failed to archive inbox file ${file}: ${err.message}`);
    }
  }

  return { processed: files.length, extracted: Array.isArray(results) ? results.length : 0 };
}

async function main() {
  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  console.error(`[daily-sweep] Starting sweep for ${today}${dryRun ? ' (DRY RUN)' : ''}`);

  const results = { extraction: null, retry: null, archive: null, transcriptSweep: null, inboxSweep: null };

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

  // 4. Sweep recent non-worktree transcripts (D-21 trigger 3)
  try {
    if (dryRun) {
      console.error('[daily-sweep] Would sweep recent transcripts');
    }
    results.transcriptSweep = await sweepTranscripts();
    console.error(`[daily-sweep] Transcript sweep complete: ${JSON.stringify(results.transcriptSweep)}`);
  } catch (err) {
    console.error(`[daily-sweep] Transcript sweep failed: ${err.message}`);
    results.transcriptSweep = { error: err.message };
  }

  // 5. Ingest Cowork inbox/
  try {
    if (dryRun) {
      console.error('[daily-sweep] Would ingest inbox/');
    }
    results.inboxSweep = await sweepInbox();
    console.error(`[daily-sweep] Inbox sweep complete: ${JSON.stringify(results.inboxSweep)}`);
  } catch (err) {
    console.error(`[daily-sweep] Inbox sweep failed: ${err.message}`);
    results.inboxSweep = { error: err.message };
  }

  // 6. Persist proof-of-fire (CAP-EVIDENCE-01). Real runs only — dry-run stays side-effect-free.
  // Fail-open: a failed evidence write must NEVER fail the sweep, whose exit code drives the
  // launchd observation. Atomic tmp+rename, mirroring voyage-health._writeHealth.
  if (!dryRun) {
    try {
      const staged =
        (Array.isArray(results.extraction) ? results.extraction.length : 0) +
        ((results.transcriptSweep && results.transcriptSweep.extracted) || 0) +
        ((results.inboxSweep && results.inboxSweep.extracted) || 0);
      let degraded = false;
      try { degraded = require('../src/utils/classifier-health').isDegraded(); } catch (_) { /* fail-open */ }
      const lastRun = { ts: new Date().toISOString(), staged, durationMs: Date.now() - startedAt, degraded };
      fs.mkdirSync(path.dirname(LAST_RUN_PATH), { recursive: true });
      const tmp = LAST_RUN_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(lastRun, null, 2), 'utf8');
      fs.renameSync(tmp, LAST_RUN_PATH);
    } catch (err) {
      console.error(`[daily-sweep] Last-run evidence write failed (non-fatal): ${err.message}`);
    }
  }

  console.error(`[daily-sweep] Sweep complete for ${today}`);
  return results;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[daily-sweep] Fatal error: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { main, sweepTranscripts, sweepInbox, findRecentTranscripts, hasSignal, loadLedger, saveLedger };

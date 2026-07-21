---
status: complete
phase: 34-promotion-integrity-lifecycle
source: [34-01-SUMMARY.md, 34-02-SUMMARY.md, 34-03-SUMMARY.md, 34-04-SUMMARY.md, 34-05-SUMMARY.md, 34-06-SUMMARY.md, 34-07-SUMMARY.md]
started: 2026-07-21T00:45:00Z
updated: 2026-07-21T02:12:10.624811+00:00
---

## Current Test

[testing complete]

## Tests

### 1. Baseline sentinel check
expected: `VAULT_ROOT="$HOME/Claude Cowork" node scripts/verify-baseline.js` prints "27/27 baseline hashes resolve", exit code 0.
result: pass

### 2. Promotion gate visibility (no silent zeros)
expected: `node -e "require('./src/promote-memories').promoteMemories({dryRun:true}).then(r=>console.log(JSON.stringify(r,null,2)))"` reports the real pending/eligible candidate counts from the live proposals file — near-miss checkbox marks (if any) are surfaced loudly, never a bare "promoted 0" with no explanation.
result: pass

### 3. Dream dry-run against the live vault
expected: `node scripts/dream.js --dry-run` exits 0, prints detection counts (merge pairs / stale flags / pattern candidates), and writes NOTHING — memory.md and proposals/memory-proposals.md mtimes unchanged, no dream-changeset file created.
result: pass

### 4. Real /dream-propose produces a reviewable changeset
expected: `node scripts/dream.js --propose` creates proposals/dream-changeset-2026-07.md with MERGE/STALE ops in the design format (accept/reject/defer boxes, sources:: hashes, similarity::, rationale with verbatim quotes, golden-hash:: stamp), stages pattern ADDs into memory-proposals.md, creates state/dream-ledger.json — and a second --propose run REFUSES while the changeset is unresolved. memory.md untouched.
result: pass

### 5. Monthly plist installs cleanly (propose-only)
expected: `cp config/com.secondbrain.dream.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.secondbrain.dream.plist` then `launchctl list | grep secondbrain` shows com.secondbrain.dream loaded. The plist runs --propose only (no --apply anywhere in it).
result: pass

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]

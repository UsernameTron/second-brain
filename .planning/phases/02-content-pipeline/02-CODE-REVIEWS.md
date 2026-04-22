---
phase: 2
reviewers: [gemini, claude-host]
reviewed_at: "2026-04-22T20:15:00Z"
artifact_reviewed: Executed code and tests (src/, test/, .claude/hooks/)
gemini_version: 0.13.0
codex_status: failed (OpenAI quota exceeded)
---

# Post-Execution Code Review — Phase 2: Content Pipeline

Review of completed Phase 2 implementation. 6 plans executed, 461 tests passing, internal gsd-verifier found zero issues. This review challenges that result.

---

## Gemini Review

Gemini (v0.13.0, model unknown) conducted a read-only review of planning documents and source code. Was blocked from reading `.claude/hooks/` due to `.gitignore` rules.

### Findings

**Finding 1 — In-batch duplicate proposals not detected**
- Severity: LOW
- Decision ID: D-33
- Plan + task: 02-05-PLAN.md Task 1
- File:line: src/promote-memories.js:332-338
- Description: `isDuplicateInMemory()` checks against memory.md and archives but not against other candidates in the same promotion batch. Two proposals with identical contentHash could both be promoted.
- Suggested fix: Track promoted contentHash values in a Set during the batch loop and skip duplicates within the same batch.

**Finding 2 — Hook file not reviewable**
- Severity: MEDIUM (downgraded to DISMISSED — see Host Session analysis)
- Decision ID: D-44/D-64
- Plan + task: 02-04-PLAN.md Task 2
- File:line: .claude/hooks/memory-extraction-hook.js
- Description: `.gitignore` blocked Gemini from reading the hook script.
- Suggested fix: N/A — file verified by host session.

**Finding 3 — Batch cap minimum rejects small values**
- Severity: LOW (downgraded to BY DESIGN)
- Decision ID: MEM-03
- Plan + task: 02-05-PLAN.md Task 1
- File:line: src/promote-memories.js:295
- Description: `--max 3` returns an error because batchCapMin is 5.
- Suggested fix: N/A — D-32 explicitly mandates 5-10 range with no downward override. Working as designed.

### Gemini Summary Line
CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 2

---

## Claude (Host Session) Review

Independent analysis with full file access (including `.claude/hooks/`).

### Focus Area 1: Validation Gap

**D-36 failure modes**: All 7 modes (`api-error`, `timeout`, `parse-error`, `confidence-floor`, `gate-rejection`, `non-interactive-ambiguous`, `exclusion-unavailable`) appear in 68 test assertions across 11 test files. `test/lifecycle.test.js` has the deepest coverage (28 occurrences) testing retryable vs non-retryable mode separation. **PASS.**

**MEM-03 batch cap boundaries**: `test/promote-memories.test.js:131-157` tests boundary values — `--max 4` (below min 5) rejected, `--max 11` (above max 10) rejected, `--max "all"` treated as error. **PASS.**

**--all rejection**: Line 160 explicitly tests `max: "all"` and expects error. **PASS.**

### Focus Area 2: Flagged-Item Resolutions

| Decision | Code Location | Behavior Match |
|----------|--------------|----------------|
| D-67 briefing sections | `src/briefing-helpers.js` | Gathers pipeline state, formats pending counts, dead-letter status. **PASS.** |
| D-21 daily sweep | `scripts/daily-sweep.js` | Triggers extraction + lifecycle tasks sequentially. **PASS.** |
| D-37 dead-letter retry | `src/lifecycle.js:101-169` | Reads `retry.delayMinutes` (default 15) and `retry.maxAttempts` (default 3) from config. Checks file age against delayMinutes, increments retryCount, freezes at maxAttempts. **PASS.** |
| D-16 left-proposal archive | `src/lifecycle.js:251-283` | Reads `leftProposal.autoArchiveDays` (default 14) from config. Calculates age threshold in ms. **PASS.** |
| D-44/D-64 /wrap hook | `.claude/hooks/memory-extraction-hook.js` | Reads stdin JSON, validates Stop event, calls `extractFromTranscript(transcript_path, session_id)`, always exits 0 on any failure. Matches D-64 "extraction failure NEVER blocks /wrap." **PASS.** |

### Focus Area 3: Self-Review Zero Count — Disproved

**Defect found**: In-batch duplicate detection gap (same as Gemini Finding 1).

`src/promote-memories.js:330-338` — The promotion loop iterates over `toPromote` and checks each candidate against `isDuplicateInMemory()`, which reads memory.md and archive files on disk. However, it does not check whether a previous candidate *in the same batch* has the same `contentHash`. If two accepted proposals have identical content (e.g., extracted from overlapping transcript windows per D-46), both will be appended to memory.md.

This is LOW severity because:
- Proposals come from different sessions (overlap requires the same insight extracted twice)
- D-27 dedup runs at extraction time, making write-time duplicates unlikely
- The memory.md format is human-reviewable, so duplicates are catchable

But it is a real defect — the internal self-review missed it, disproving the zero count.

### Focus Area 4: Wave 3 Wiring

**Producer-consumer signature match**: `_writeCandidateWithLock` (memory-proposals.js:192) writes D-56 schema fields: `session_id`, `source_ref`, `captured_at`, `source_file`, `category`, `confidence`, `content_hash`, `status`, `extraction_trigger`. `parseCandidateSections` in promote-memories.js reads these same inline fields. `briefing-helpers.js` consumes only `status` field. Signatures match. **PASS.**

**D-58 advisory lock**: Fully implemented at `memory-proposals.js:67-93`. Uses exclusive file creation (`wx` flag) with PID and timestamp. `releaseLock()` at line 94 removes the lock file. `writeCandidate` (line 301) acquires lock, writes, releases. `flushPendingBuffer` (line 324) also acquires lock. Not stubbed. **PASS.**

### Focus Area 5: Plan-to-Code Drift

No drift detected across Plans 01-06. All acceptance criteria have corresponding code and tests. The only unverifiable criterion is hook *registration* in settings.json (documented in the hook file header but not auto-configured, as noted in the script comments).

### Host Session Findings

- Severity: LOW
- Decision ID: D-33/D-27
- Plan + task: 02-05-PLAN.md Task 1
- File:line: src/promote-memories.js:330-338
- Description: In-batch duplicate contentHash not checked during promotion loop.
- Suggested fix: Add a `const promotedHashes = new Set()` before the loop. Before pushing to `promoted`, check `promotedHashes.has(candidate.contentHash)`. If duplicate, push to `duplicates` instead. Add a test case with two proposals sharing the same contentHash in a single batch.

CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 1

---

## Codex Review

Codex CLI (v0.53.0, gpt-5.4) attempted review but failed with OpenAI quota exceeded error. No findings produced.

---

## Consensus Summary

### Agreed Findings (raised by 2+ reviewers)

1. **LOW: In-batch duplicate detection gap** (Gemini + Host Session) — Both independently identified that `isDuplicateInMemory()` doesn't check for duplicate contentHash values within the same promotion batch. Fix is straightforward (Set-based dedup in the loop).

### Gemini-Only Findings (verified by Host Session)

2. **DISMISSED: Hook file not reviewable** — `.gitignore` blocked Gemini. Host session verified the file directly. Implementation matches D-44/D-64.

3. **BY DESIGN: Batch cap minimum** — `--max 3` rejection is correct per D-32's 5-10 mandate.

### Divergent Views

None. Both reviewers independently converged on the same single defect.

### Gate Recommendation

**PASS** — Phase 2 execution is sound. One LOW-severity defect (in-batch dedup) is real but non-blocking. The internal self-review's zero-issue count was technically wrong but the missed issue is minor. 461 tests across 24 suites provide strong coverage.

### Suggested Follow-Up

1. Fix in-batch dedup in `promote-memories.js` (LOW priority, can be done in any future phase)
2. Add test case: two proposals with identical contentHash in a single promotion batch

---

*Reviewed: 2026-04-22*
*Reviewers: Gemini (Google), Claude Host Session (Anthropic)*
*Codex: unavailable (OpenAI quota exceeded)*

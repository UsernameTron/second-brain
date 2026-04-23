---
phase: 06-defect-fixes-and-uat
plan: 03
subsystem: uat-testing
tags: [uat, classification, wikilinks, testing]
depends_on:
  requires: [06-01, 06-02]
  provides: [UAT-01, UAT-02]
  affects: [src/classifier.js, src/wikilink-engine.js]
tech_stack:
  added: []
  patterns: [live-api-test-harness, skip-guard, soft-assertion]
key_files:
  created:
    - test/uat/uat-classification.test.js
    - test/uat/uat-wikilinks.test.js
  modified: []
decisions:
  - UAT test harnesses call real Anthropic API — not mocked — because accuracy/relevance cannot be validated with stubs
  - Accuracy assertion on deterministic corpus only; edge cases excluded from denominator
  - Wikilink zero-link result treated as warning not failure — sparse vault is a vault-state concern, not an engine defect
  - Task 3 (UAT-03) is a human-verify checkpoint — not automated
metrics:
  duration: ~10 minutes
  completed: "2026-04-23"
  tasks_completed: 2
  tasks_pending: 1
  files_created: 2
---

# Phase 06 Plan 03: UAT Test Harnesses Summary

Automated UAT test harnesses for classification accuracy (UAT-01) and wikilink relevance (UAT-02). Both harnesses call the real Anthropic API, skip cleanly when prerequisites are absent, and log structured results for human review alongside automated assertions.

## Tasks

| # | Name | Status | Commit |
|---|------|--------|--------|
| 1 | UAT-01: Classification accuracy validation | Complete | 0771688 |
| 2 | UAT-02: Wikilink relevance validation | Complete | 98eb848 |
| 3 | UAT-03: End-to-end Obsidian UX walkthrough | **PENDING — human checkpoint** | n/a |

## What Was Built

### Task 1: Classification accuracy test (UAT-01)

`test/uat/uat-classification.test.js` — Live API harness calling `classifyInput()` against 16 synthetic inputs.

**Test corpus:**
- 12 deterministic cases: 4 LEFT (personal reflection, draft, journal, identity), 8 RIGHT (technical, meeting summary, project status, code snippet, process doc, research, briefing, external data)
- 4 edge cases: ambiguous content, excluded-term content (ISPN), very short input, near-empty input

**Key design choices:**
- `describe.skip` pattern controlled by `HAS_API_KEY` boolean — evaluates at module load time, before Jest runs
- Individual tests assert the engine returns a valid shape without crashing; accuracy is asserted in a final summary test
- Edge cases excluded from accuracy denominator — they test robustness, not correctness
- `jest.setTimeout(120000)` set at suite level — live LLM calls can take 5-15 seconds each

**Live run result:** 12/12 = 100.0% accuracy. All edge cases handled gracefully (BLOCKED for ISPN, dead-lettered for very short/empty inputs).

### Task 2: Wikilink relevance test (UAT-02)

`test/uat/uat-wikilinks.test.js` — Live API harness calling `suggestWikilinks()` against 6 memory content samples.

**Test corpus:**
- WL-01: Daily briefing workflow
- WL-02: Memory promotion pipeline mechanics
- WL-03: Left/right vault architecture
- WL-04: Claude Code hooks reference
- WL-05: Gmail connector design
- WL-06: Project milestone note

**Key design choices:**
- Skips when either `ANTHROPIC_API_KEY` is absent or `VAULT_ROOT` path doesn't exist
- Calls `buildVaultIndex()` in `beforeAll` to ensure index reflects current vault state
- Checks each returned link's target file existence via `fs.existsSync`
- Zero links treated as a soft warning, not a hard failure — consistent with plan spec: "flag as a concern but don't fail the test"

**Live run result:** 7/7 tests passed. Zero links generated — vault has only 6 indexed notes (ABOUT ME seed content). The memory/, briefings/, and other right-side directories are empty. This is expected for a fresh vault and is surfaced in the test output for human review.

## Deviations from Plan

### Auto-observed (no fix required)

**[Observation] Sparse vault produces zero wikilinks**
- Found during: Task 2 live run
- Issue: Vault has 6 indexed notes; test sample tokens don't overlap with ABOUT ME filenames
- Disposition: Not a defect. Zero-link result correctly reported as warning. This is a vault-content concern, not an engine bug. UAT-03 human walkthrough should populate some vault content first to get meaningful wikilink results.
- Logged here for visibility.

## Checkpoint: Task 3 Pending

Task 3 (UAT-03) is a `type="checkpoint:human-verify"` gate requiring hands-on Obsidian vault walkthrough. It was not automated. The following manual verification is required:

1. Open Obsidian at `~/Claude Cowork/`
2. Run `/new` with test input: "Meeting notes: decided to use Docker MCP gateway for calendar integration. Action items: verify remote trigger, update config."
3. Verify LEFT/RIGHT classification appears in terminal output
4. Check `~/Claude Cowork/proposals/memory-proposals.md` for the new proposal
5. Mark the proposal accepted (check the checkbox)
6. Run `/promote-memories`
7. Verify the promoted entry in `~/Claude Cowork/memory/memory.md`:
   - `content_hash` field present
   - At least one wikilink back-reference (e.g., `[[some-note]]`)
   - Correct category and metadata
8. Verify no duplicate entry on second promote run
9. Confirm: full flow completed without manual workarounds

## Known Stubs

None — both test files call real implementations.

## Self-Check: PASSED

- `test/uat/uat-classification.test.js` — file exists at expected path
- `test/uat/uat-wikilinks.test.js` — file exists at expected path
- Task 1 commit: `0771688` — verified in git log
- Task 2 commit: `98eb848` — verified in git log
- No stubs (TODO/FIXME/placeholder) in created files
- Task 3 correctly not attempted (checkpoint type)

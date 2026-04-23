---
phase: 06-defect-fixes-and-uat
plan: 01
status: complete
started: 2026-04-23
completed: 2026-04-23
---

# Plan 06-01 Summary: In-batch Dedup + API Key Guard

## What Was Built

### Task 1: In-batch dedup in promote-memories.js (FIX-01)
- Added `promotedHashes` Set in batch loop to prevent duplicate content hashes within a single promotion batch
- Extended `isDuplicateInMemory()` to check `PROPOSALS_FILE()` for pending proposals — prevents re-promotion of content already queued for review
- TDD: tests verify batch dedup, proposals file check, and graceful handling of missing proposals file

### Task 2: Graceful API key degradation in pipeline-infra.js (FIX-04)
- Wrapped entire LLM client initialization (requires + `new Anthropic()`) in try/catch
- Missing API key returns stub client whose `classify()` always returns `{success: false, failureMode: 'api-error'}`
- Covers `content-policy.js` module-level Anthropic instantiation (also caught by try/catch)
- TDD: 3 new tests verify createHaikuClient, createSonnetClient, and classify() all degrade gracefully

### FIX-02 (config hot-reload): DEFERRED per D-09 — no symptom, no implementation needed

## Key Files

### Created
- (none — all edits to existing files)

### Modified
- `src/promote-memories.js` — promotedHashes Set + proposals file check in isDuplicateInMemory
- `src/pipeline-infra.js` — try/catch around LLM client init
- `test/promote-memories.test.js` — dedup and proposals tests
- `test/pipeline-infra.test.js` — API key missing tests

## Verification
- `npx jest test/promote-memories.test.js` — all pass
- `npx jest test/pipeline-infra.test.js` — 27 tests pass (3 new)
- Full suite: 523 tests pass, 0 failures

## Deviations
- None

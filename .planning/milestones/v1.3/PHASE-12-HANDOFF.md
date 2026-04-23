# Phase 12 — Critical Safety Fixes — Handoff

**Paused:** 2026-04-23
**Reason:** Context size — 4 of 6 tasks complete, clean commit boundary
**Branch:** `chore/commit-planning-artifacts`
**Last commit:** `db58386` — T12.4

## Task Status

### DONE (4/6)
| Task | Commit | Description |
|------|--------|-------------|
| T12.2 | `7c3166d` | safeLoadVaultPaths — consolidated 3 duplicates into pipeline-infra.js, guarded JSON.parse |
| T12.3 | `33e6e5a` | safeLoadPipelineConfig — wrapper returning {config, error}, migrated 11+ call sites with per-site degrade |
| T12.4 | `db58386` | retryDeadLetters — split try blocks for write/move isolation, handle QUARANTINED |
| T12.6 | **IN PROGRESS** | security-scan-gate.sh — source file rewritten, test harness NOT yet written |

### IN PROGRESS
- **T12.6** — security-scan-gate.sh rewrite is DONE (source at `.claude/hooks/security-scan-gate.sh`). Changes: added prompt arg to `claude --agent`, replaced `2>/dev/null` with `2>&1`, added grep-based fallback on agent failure, fixed `2>&2` typo to `2>&1`, added audit logging to `.cache/security-scan-log.jsonl`. **Remaining:** write `test/hooks/security-scan-gate.test.sh` (4 test cases per plan), run it, commit.

### PENDING (2 tasks)
| Task | Description | Order |
|------|-------------|-------|
| T12.5 | LLM fallback — AbortController timeout, narrow catch, response shape guard | 5th |
| T12.1 | writeDeadLetter — route through vault-gateway with attemptCount:1 | 6th |

## Key Facts for Resume

1. **Pre-existing test failures:** 6 tests in `test/pipeline-infra.test.js` fail pre-T12 (createHaikuClient and local LLM routing). These are NOT regressions — they existed before Phase 12 started. All new tests pass.

2. **Linter auto-modified pipeline-infra.js:** Between T12.3 and T12.4, a linter added `headers` (Authorization bearer from LM_API_TOKEN env) and `response_format: { type: 'json_object' }` to the `classifyLocal` function. This was NOT part of our changes but is committed now. T12.5 modifies this same function — be aware of the linter additions when applying the plan.

3. **Test mock pattern:** Every module that imports `safeLoadPipelineConfig` or `safeLoadVaultPaths` needs corresponding mock entries in its test file. T12.3 updated all existing test files. If T12.5 or T12.1 change imports in source files, update the corresponding test mocks.

4. **T12.6 test cases (from plan):**
   - Non-ship command → exit 0, no log
   - Ship + clean agent JSON → exit 0, `scan-complete` log
   - Ship + agent failure → grep fallback → exit 0 (no secrets), `agent-fallback` log
   - Ship + agent failure + .env staged → exit 2

5. **After all 6 tasks complete, run verification sequence:**
   - `npx jest --forceExit` — expect 619+ tests (minus 6 pre-existing failures)
   - `bash test/hooks/security-scan-gate.test.sh` — 4 cases pass
   - `grep -rn "loadVaultPaths" src/classifier.js src/wikilink-engine.js src/promote-unrouted.js` — all point to pipeline-infra import
   - Pipeline-reviewer agent for regression check

## Next Command
```
/gsd:execute-phase 12
```
Resume instructions: Start with T12.6 test harness (source already written), then T12.5, then T12.1. Same protocol — one task at a time, test, commit, verify.

# Phase 12 — Critical Safety Fixes

**Phase:** 12
**Milestone:** v1.3 Review Remediation
**Status:** DISCUSSING
**Dependencies:** None (first phase)

## Scope

### writeDeadLetter vault-gateway bypass (B-02 / R1)
- `writeDeadLetter()` in `src/promote-memories.js` uses `fs.promises.writeFile` directly, bypassing the vault-gateway write-permission boundary
- Fix: route through vault-gateway's write API so LEFT-side protection is enforced
- Gemini-unique finding — confirmed by manual code inspection

### Config crash path guards (B-03 / B-05 / D1)
- `loadPipelineConfig()` throws on schema violation after overlay merge; no `safeLoadPipelineConfig()` wrapper exists
- Callers that catch get a raw Error, not structured result
- Implement `safeLoadPipelineConfig()` returning `{ config, error }` — callers choose fail-fast or degrade
- Guard `loadVaultPaths()` JSON.parse in `src/classifier.js` with try/catch
- Guard every `loadPipelineConfig()` call site with try/catch + degrade path

### retryDeadLetters unhandled rejection (B-09 / R4)
- `retryDeadLetters()` does not verify vault write succeeded before unlinking dead letter file
- Fix: await vaultWrite result, only unlink on success, log on failure
- Gemini-unique finding

### LLM fallback hardening (B-01 / B-04 / B-06)
- `classifyLocal()` missing fetch timeout — hung server blocks pipeline (B-01, HIGH)
- Fallback catches ALL non-parse errors — HTTP 4xx silently falls back (B-04, MEDIUM)
- Response shape not guarded — TypeError misclassified as connection error (B-06, MEDIUM)
- Config load failure swallowed silently (B-05, MEDIUM)
- Fix: add fetch timeout, narrow catch to network/timeout errors, validate response shape, log config failures

### T12.6 — security-scan-gate.sh repair (SEC-HOOK-01)
- Line 35: `claude --agent security-scanner --print` missing prompt argument — agent fails silently
- Line 47: `2>&2` typo (no-op) — should be `2>&1`
- Line 35: `2>/dev/null` swallows all diagnostic stderr from claude CLI
- Implement tri-state exit codes: 0 = clean, 1 = infra/spawn failure (non-blocking warning), 2 = blocking security finding
- Add grep-based fallback: if agent output is not valid JSON, grep staged diff for secret patterns as degraded scan
- Add audit log to `.cache/security-scan-log.jsonl` (gitignored)
- Evidence: `.planning/backlog.md` SEC-HOOK-01 section

## Backlog Items Addressed

| Backlog ID | Item |
|------------|------|
| B-01 | classifyLocal() fetch timeout |
| B-02 | writeDeadLetter vault-gateway bypass |
| B-03 | safeLoadPipelineConfig() wrapper |
| B-04 | Fallback catches all non-parse errors |
| B-05 | Config load error swallowed |
| B-06 | Response shape not guarded |
| B-09 | retryDeadLetters unhandled rejection |
| SEC-HOOK-01 | security-scan-gate.sh full repair |

## Key Files

- `src/promote-memories.js` — writeDeadLetter, retryDeadLetters
- `src/pipeline-infra.js` — loadPipelineConfig, classifyLocal, classifyAnthropic, LLM fallback
- `src/classifier.js` — loadVaultPaths call site
- `.claude/hooks/security-scan-gate.sh` — hook repair
- `src/vault-gateway.js` — write API (target for writeDeadLetter routing)

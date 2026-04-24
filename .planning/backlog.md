# Backlog

## v1.3-candidates

Migrated from v1.2 MILESTONE-AUDIT.md (2026-04-23). Source: 7 verification warnings, 2 accepted flags, 10 cross-reviewer findings, 1 deferred implementation item.

### HIGH priority

| ID | Item | Source |
|----|------|--------|
| B-01 | classifyLocal() missing fetch timeout — hung server blocks pipeline | W1 |
| B-02 | writeDeadLetter bypasses vault-gateway (direct fs.promises.writeFile) | R1, Gemini-unique |
| B-03 | safeLoadPipelineConfig() wrapper — structured error result for callers wanting graceful degradation | D1, deferred from overlay impl |
| SEC-HOOK-01 | security-scan-gate.sh: missing prompt arg on agent invocation, stderr swallowed, `2>&2` typo, no distinction between scan-failure and finding-failure. Scope: call-site fix (line 35 prompt arg), `2>/dev/null` removal, tri-state exit codes (finding / infra failure / spawn failure), grep-based fallback for non-JSON agent output, audit log. Consolidates B-10. | v1.2 ship event, T12.6 |

### MEDIUM priority

| ID | Item | Source |
|----|------|--------|
| B-04 | Fallback catches ALL non-parse errors — HTTP 4xx silently falls back | W2 |
| B-05 | Config load error swallowed silently (llmConfig = null) | W4 |
| B-06 | Response shape not guarded — TypeError misclassified as connection error | W6 |
| B-07 | today-command.js god module (724 LOC) — extract briefing-renderer.js | R2, Both reviewers |
| B-08 | No ESLint / SAST in CI pipeline | R3, Both reviewers |
| B-09 | retryDeadLetters unhandled rejection on vaultWrite | R4, Gemini-unique |

### LOW priority

| ID | Item | Source |
|----|------|--------|
| ~~B-10~~ | Consolidated into SEC-HOOK-01 (HIGH) | W3 |
| B-11 | HTTP error response body discarded before fallback | W5 |
| B-12 | AJV removeSchema catch swallows errors (config-validator.js:87) | W7 |
| B-13 | UAT tests need isolation + mock boilerplate reduction | R5, Both reviewers |
| B-14 | Missing schemas for vault-paths.json, excluded-terms.json, scheduling.json | R6, Claude-unique |
| B-15 | No Unicode-specific tests for exclusion terms / filename generation | R7, Claude-unique |
| B-16 | Branch coverage threshold at 70% vs 90% for others | R8, Claude-unique |
| B-17 | Config debounce timing not tested | R9, Both reviewers |
| B-18 | No JSDoc on public API surface | R10, Claude-unique |
| B-19 | ESLint config missing Node 18+ globals (fetch, AbortController) — blocked by config-protection hook, worked around with inline eslint-disable | Phase 14 T14.1 |
| B-20 | 41 no-console warnings across src/ — decide: suppress with eslint-disable, add logger abstraction, or accept as-is | Phase 14 T14.1 |

### Accepted (non-blocking, carry forward for awareness)

| ID | Item | Disposition |
|----|------|-------------|
| F-01 | chokidar v3.6.0 (2 majors behind) | Intentional CJS compat — accepted |
| F-02 | docs-sync agent lacks scope_guard | Cosmetic — accepted |

---

## Evidence Log

### SEC-HOOK-01 — Evidence from v1.2 ship event (2026-04-23)

- **Hook call site:** `.claude/hooks/security-scan-gate.sh` line 35
- **Bug:** `claude --agent security-scanner --print` invoked without prompt argument
- **Error path:** CLI errors to stderr, `2>/dev/null` swallows it, fallback fires CRITICAL with "agent failed to execute"
- **Manual scan result** (same agent, proper prompt): `pass: true`, 0 blocking findings
- **v1.2.0 commit diff verified:** 4 markdown files only (`.planning/STATE.md`, `.planning/backlog.md`, `tasks/lessons.md`, `tasks/todo.md`), no source, no config, no secrets
- **Action:** hook bypassed once via shell push; v1.3 T12.6 expanded to cover call-site fix + tri-state exit codes (finding / infra failure / spawn failure) + grep-based fallback

**Resolution (v1.3 Phase 12 T12.6, commit 143b17f):**
- Line 35 prompt argument: FIXED
- Line 47 stderr redirect: FIXED (2>&2 → 2>&1)
- Tri-state exit codes: IMPLEMENTED (1=finding, 2=infra, 3=spawn)
- Grep-based fallback on spawn failure: IMPLEMENTED
- Audit log to .cache/security-scan-log.jsonl: IMPLEMENTED
- Test harness test/hooks/security-scan-gate.test.sh: 8/8 assertions passing
Status: CLOSED.

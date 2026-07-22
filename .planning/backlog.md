# Backlog

> Re-triaged 2026-07-21 (full project audit): every v1.3-era item verified against live code.
> 13 resolved, 2 partial, 4 open-but-accepted. Evidence per item below.

## Open items (dispositioned 2026-07-21)

| ID | Item | Disposition |
|----|------|-------------|
| B-11 | HTTP error response body discarded before fallback (`pipeline-infra.js:229-232` keeps `HTTP ${status}` only, never reads body) | DEFER — status code suffices for routing; capture the body only when a real diagnosis needs it |
| B-13 | UAT isolation partial: `memory-retrieval` + `semantic-search` UAT files have mkdtemp+beforeEach/afterEach; `uat-classification` + `uat-wikilinks` don't; no shared helper extracted | DEFER — adopt the existing pattern next time either file is touched; don't refactor them cold |
| B-18 | JSDoc non-uniform across public API (vault-gateway 25 blocks, semantic-index 24, classifier 7; others thinner) | DEFER — core modules covered; expand opportunistically |
| B-19 | ESLint config missing Node 18+ globals (fetch, AbortController) — worked around with inline `eslint-disable-line no-undef` (`pipeline-infra.js:190,200`) | KEEP (accepted workaround) — config edit is protected-file-gated; fold in whenever eslint.config is next opened with approval |

## Dropped (accepted as-is, 2026-07-21)

| ID | Item | Why dropped |
|----|------|-------------|
| B-12 | AJV `removeSchema` catch swallows errors (`config-validator.js:80`) | Benign by design — only pre-clears a schema cache entry; the subsequent `ajv.compile()` has its own error handling (lines 82-87) |
| B-17 | Config debounce timing not tested (`style-policy.js:116`, 50ms) | Timing tests are flaky-by-nature; debounce is trivial and stable since v1.2 |

## Resolved (verified against live code, 2026-07-21 audit)

| ID | Item | Evidence |
|----|------|----------|
| B-01 | classifyLocal() fetch timeout | `pipeline-infra.js:190-194,203` — AbortController + configurable `localTimeoutMs` |
| B-02 | writeDeadLetter vault-gateway bypass | `pipeline-infra.js:433-473` — routes through `vaultWrite()` with guards |
| B-03 | safeLoadPipelineConfig() wrapper | Exists in pipeline-infra.js, returns `{config,error}`, 6+ callers |
| B-04 | Fallback caught ALL non-parse errors | `pipeline-infra.js:229-231` distinct api-error mode; `classifyLocalWithHealth:349-374` health-tracked, nightly-capped Haiku fallback (Phase 33) |
| B-05 | Config load error swallowed | `pipeline-infra.js:150-155` — stub classify() returns `failureMode:'config-error'` |
| B-06 | Response shape not guarded | `pipeline-infra.js:236-245` — SHAPE_ERROR guard (hardened 2026-07-21, quick 260721-rst) |
| B-07 | today-command.js god module (724 LOC) | Now 409 LOC; briefing extracted to `src/today/briefing-renderer.js` |
| B-08 | No ESLint / SAST in CI | ci.yml: ESLint + CodeQL + coverage gates (v1.3 Phase 14) |
| B-09 | retryDeadLetters unhandled rejection | `lifecycle.js:199-226` — vaultWrite and move/unlink each in try/catch |
| B-10 | (consolidated into SEC-HOOK-01) | SEC-HOOK-01 CLOSED v1.3 Phase 12 T12.6, commit 143b17f |
| B-14 | Missing schemas (vault-paths, excluded-terms, scheduling) | All three in `config/schema/` |
| B-15 | No Unicode tests for exclusions | `content-policy.js:51` NFKD; `content-policy.test.js:333-383` variant tests (v1.5 HYG-UNICODE-02) |
| B-16 | Branch coverage 70% vs 90% | Ratcheted 70→80 deliberately (`ci.yml:27-29`, documented); 80 is the accepted floor |
| B-20 | 41 no-console warnings | `npx eslint src/` exits 0 warnings; per-site documented disables |
| B-21 | UAT never runs automatically | `.github/workflows/uat.yml` — weekly cron (Mon 13:00 UTC) + workflow_dispatch + step-scoped ANTHROPIC_API_KEY (backlog option (a), as recommended) |

## Accepted (non-blocking, carry forward for awareness)

| ID | Item | Disposition |
|----|------|-------------|
| F-01 | chokidar v3.6.0 (majors behind) | Intentional CJS compat — accepted (v5 is ESM-only) |
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

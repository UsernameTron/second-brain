# v1.3 Review Remediation — Roadmap

**Milestone:** v1.3
**Theme:** Close every HIGH finding from the 3-reviewer audit (Claude native, Gemini CLI, Opus 4.6) and every WARN from V1.2-VERIFICATION.md. Bring overall health score from 76/100 to 88+.

## Phases

| Phase | Name | Scope Summary | Dependencies |
|-------|------|---------------|--------------|
| 12 | Critical Safety Fixes | vault-gateway bypass, config crash paths, LLM fallback hardening, security-scan-gate hook repair | None |
| 13 | Config Schema Gaps | 3 new schemas, orphan cleanup, config centralization, overlay helper adoption | 12 (safeLoadPipelineConfig) |
| 14 | CI Hardening | ESLint, CodeQL SAST, license checker, jest config, UAT CI guard | 12 (hook fix for CI push) |
| 15 | Architecture Refactor | today-command.js decomposition, vault-gateway cleanup, memory-proposals privatization, new-command dedup | 13 (config loaders stable) |
| 16 | Test Quality | classifier mock reduction, rejection tests, config loader tests, hook tests, branch coverage lift | 15 (refactored modules testable) |

## Dependency Chain

```
12 (Critical Safety) ──┬──> 13 (Config Schemas) ──> 15 (Architecture) ──> 16 (Test Quality)
                       └──> 14 (CI Hardening)
```

Phases 13 and 14 can run in parallel after 12 completes. Phase 15 depends on 13. Phase 16 depends on 15.

## Exit Criteria

- Health score >= 88/100 via re-audit
- All HIGH findings closed in a written `REMEDIATION-VERIFICATION.md`
- CI adds 3 new gates (lint, SAST, license) and they all pass
- today-command.js <= 200 LOC
- All 6 config files have schemas OR the orphan schema is deleted
- Overlay helper honored by every config loader (no startup warning needed)

## Source Material

- `.planning/backlog.md` — 18 active items + 2 accepted flags migrated from v1.2
- `.planning/milestones/v1.2/MILESTONE-AUDIT.md` — verification warnings, cross-reviewer findings
- `tasks/lessons.md` — 6 learned rules from v1.2

# Requirements: Second Brain

**Defined:** 2026-04-26
**Core Value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.

## v1.5 Requirements

Requirements for v1.5 Internal Hardening. All promoted from v1.4 backlog — no new features.

### Hooks

- [ ] **HOOK-SCHEMA-01**: Pre-commit AJV validation catches malformed `daily-stats.md` frontmatter and out-of-bounds `config/pipeline.json` values before they land on master
- [ ] **HOOK-VAULT-01**: Pre-commit git-level path check prevents committing files to the wrong vault side, making the LEFT/RIGHT boundary structural at the git layer
- [ ] **HOOK-DOCSYNC-01**: Post-merge hook compares `CLAUDE.md`/`README.md` stats (test count, coverage, phase count) against live `jest --coverage` output and flags mismatches as non-blocking warnings
- [ ] **HOOK-DOTENV-01**: `dotenv.config()` calls move from library modules to entry-points only; `src/pipeline-infra.js:23` is the known root cause

### Agents

- [ ] **AGENT-DOCSYNC-01**: Post-ship agent compares living-doc stats and narrative against `jest --coverage` and `git log` reality; blocks phase closure if drift exceeds threshold; pairs with HOOK-DOCSYNC-01
- [ ] **AGENT-VERIFY-01**: Requirement-level auto-verification expands `test-verifier` to spawn parallel sub-checks per REQ-ID at phase-close time, covering full requirements surface
- [ ] **AGENT-MEMORY-01**: Memory health monitor reads `daily-stats.md` counters and surfaces anomaly alerts (zero promotions 3+ days, backlog growth, recall usage drop, vault plateau) in `/today` briefing

### Test / Hygiene

- [ ] **UAT-REFRESH-01**: Rebaseline UAT classification corpus against current classifier behavior so that `test/uat/uat-classification.test.js` produces a meaningful accuracy score locally
- [ ] **HYG-UNICODE-02**: Replace ASCII-only `.toLowerCase().includes()` at `src/content-policy.js:160,201` with NFKD-normalized matching; backfill 45 `test.todo()` blocks from Plan 21-01; full UAT sweep after matcher semantics change

### Audit Carry-Forward

- [ ] **UAT-SMOKE-01**: Run `gh workflow run uat.yml` and confirm the scheduled UAT workflow fires, executes, and produces an artifact — the Phase 17 carry-forward smoke test

## Future Requirements

None — v1.5 is a hardening milestone consuming the full v1.4 backlog. New feature work deferred to v1.6+.

## Out of Scope

| Feature | Reason |
|---------|--------|
| New vault commands | v1.5 is infrastructure-only — no user-facing command additions |
| Connector changes | Gmail/Calendar/GitHub connectors stable since v1.1 |
| Memory pipeline changes | Pipeline logic frozen — only monitoring (AGENT-MEMORY-01) added |
| Config hot-reload (FIX-02) | Deferred permanently in v1.1 — restart workaround sufficient |
| Automatic memory promotion | Out of scope since v1.0 — human review gate preserved |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| HOOK-SCHEMA-01 | Phase 22 | Pending |
| HOOK-VAULT-01 | Phase 22 | Pending |
| HOOK-DOTENV-01 | Phase 22 | Pending |
| HOOK-DOCSYNC-01 | Phase 23 | Pending |
| AGENT-DOCSYNC-01 | Phase 23 | Pending |
| AGENT-VERIFY-01 | Phase 24 | Pending |
| AGENT-MEMORY-01 | Phase 24 | Pending |
| UAT-REFRESH-01 | Phase 25 | Pending |
| HYG-UNICODE-02 | Phase 25 | Pending |
| UAT-SMOKE-01 | Phase 25 | Pending |

**Coverage:**
- v1.5 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0

---
*Requirements defined: 2026-04-26*
*Last updated: 2026-04-26 after roadmap creation*

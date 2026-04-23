# Phase 7: Hardening - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

GitHub Actions CI pipeline that runs the full test suite (502+ tests) on every push to master and every PR, with visible pass/fail status and branch protection to prevent broken merges.

</domain>

<decisions>
## Implementation Decisions

### Node Version Strategy
- **D-01:** Matrix test against Node 20 and 22 LTS versions. Catches backward compatibility issues without over-testing.
- **D-02:** Create `.nvmrc` pinned to 22 for local development consistency.

### Workflow Triggers
- **D-03:** Trigger on push to master and on pull requests only. No feature branch pushes, no scheduled cron runs.

### Badge and Branch Protection
- **D-04:** Add CI status badge at top of README.md (green/red pass/fail).
- **D-05:** Enable branch protection on master requiring CI to pass before merging PRs. Hard gate — cannot merge broken code.

### Claude's Discretion
- Workflow file naming and structure (standard conventions)
- Cache strategy for node_modules (speed optimization)
- Specific GitHub Actions versions for checkout/setup-node

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — CI-01 requirement definition and success criteria
- `.planning/ROADMAP.md` §Phase 7 — Goal, dependencies, success criteria (3 items)

### Project Context
- `.planning/PROJECT.md` — Runtime environment, test infrastructure, package.json scripts
- `package.json` — Test script (`jest --verbose`), dependencies, Node.js project structure

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `package.json` scripts.test: `jest --verbose` — test runner already configured
- Jest 30 as devDependency — no jest.config.js needed (defaults work)

### Established Patterns
- All tests use stubs/mocks — no API keys or secrets needed in CI
- Tests validated at 502+ passing in Phase 6 UAT

### Integration Points
- README.md — badge insertion point (top of file)
- GitHub repo settings — branch protection rules (manual or via gh CLI)
- `.github/workflows/` — new directory for workflow file

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard GitHub Actions CI pipeline following well-established patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-hardening*
*Context gathered: 2026-04-23*

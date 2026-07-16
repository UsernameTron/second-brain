# Phase 7: Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 07-hardening
**Areas discussed:** Node version strategy, Workflow triggers, Badge and status

---

## Node Version Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| 22 LTS only | Single version, matches local dev. Creates .nvmrc pinned to 22. Simple, fast CI runs. | |
| Matrix: 20 + 22 | Test against current and previous LTS. Catches compatibility issues. Slower CI. | ✓ |
| Matrix: 20 + 22 + 24 | Broadest coverage including next LTS. Most CI minutes, unlikely to matter for personal project. | |

**User's choice:** Matrix: 20 + 22
**Notes:** Covers backward compatibility without over-testing.

---

## Workflow Triggers

| Option | Description | Selected |
|--------|-------------|----------|
| Push to master + PRs | Matches success criteria exactly. No unnecessary runs on feature branches. | ✓ |
| All pushes + PRs | Also runs on feature branch pushes. Uses more CI minutes. | |
| Push + PRs + weekly cron | Adds weekly scheduled run to catch dependency drift or flaky tests. | |

**User's choice:** Push to master + PRs (Recommended)
**Notes:** None — clean match to success criteria.

---

## Badge and Status

| Option | Description | Selected |
|--------|-------------|----------|
| Badge on README only | Green/red CI badge at top of README.md. No branch protection changes. | |
| Badge + branch protection | Badge on README plus require CI to pass before merging PRs. Hard gate. | ✓ |
| Badge + protection + status checks | All above plus require up-to-date branches. Strictest but may slow solo workflow. | |

**User's choice:** Badge + branch protection
**Notes:** Hard gate prevents accidental broken merges.

---

## Claude's Discretion

- Workflow file naming and structure
- Cache strategy for node_modules
- Specific GitHub Actions versions

## Deferred Ideas

None — discussion stayed within phase scope.

# Full project audit & close-out — fixes, doc sync, planning hygiene

**Branch:** `chore/full-audit-close-2026-07-21` → `master`
**Type:** audit remediation — one behavior fix (scheduled /today env), everything else docs/planning/artifacts

## Why it matters

The 2026-07-21 full-pass audit found the scheduled morning briefing running with no API key, planning state three phases behind reality, and 21 doc-drift findings. All safely-fixable items are fixed and re-verified in this branch; nothing is left as "logged only" except items that are Pete-gated (branch protection, protected schema file, dependency majors).

## The one behavior fix

- **fix(automation): dotenv-gated launchd entry for scheduled `/today`** — the plist's inline `node -e` never loaded `.env`, so scheduled runs lost LLM augmentation and the Haiku fallback ("Could not resolve authentication method", `com.secondbrain.today.err.log` 2026-07-21 06:45). New `scripts/today-scheduled.js` (same dotenv-gate pattern as `daily-sweep.js`/`dream.js`), plist now versioned in `config/` like the other two jobs. Verified: `plutil -lint` OK; scrubbed-env dry-run renders the briefing with zero auth errors; job re-bootstrapped and loaded (`launchctl print` shows the new program arguments).

## Everything else

- **GSD health DEGRADED → HEALTHY** (18 warnings → 0): ROADMAP checkboxes synced to merged PRs #86/#87/#88/#89, archived-phase detail blocks replaced with a pointer, empty `999.1` placeholder dir removed, STATE.md position/frontmatter/next-action corrected.
- **REQUIREMENTS.md reconstructed for v1.8** — was still the v1.7 doc (already archived); now carries the 14 v1.8 REQ-IDs from phase-plan frontmatter with full traceability (14/14 complete; Phase 36 decision-gated).
- **21 doc-drift findings fixed** across CLAUDE.md, README.md, PROJECT.md, STATE.md, DEVOPS-HANDOFF.md — phase status, phantom `memory-pipeline.js`, wrong file/agent/hook/test counts, three contradictory test totals, stale scheduling story, missing dream/verify command docs. Test-count + coverage stats were verified accurate against a live `CI=true` coverage run and deliberately untouched.
- **Backlog re-triaged against live code** — 13 of the v1.3-era items verified RESOLVED (evidence per item), 2 dropped as accepted-by-design, 4 kept with explicit dispositions.
- **Stale v1.2-era artifacts quarantined** (moved, never deleted) to `.planning/milestones/v1.2/`: root VERIFICATION-REPORT.md, REVIEWS.md, ecosystem report, stale `.continue-here.md`, superseded local-LLM spec.
- **New artifacts:** `docs/codebase-map.md` + 7 deep mapper docs in `.planning/codebase/`, `docs/second-brain-purpose.drawio(.png)` one-page purpose infographic.

## Verification

- Full Jest suite green (CI=true run: 80 suites; totals match the documented 1508/1470/38) — see audit session evidence
- `npx eslint src/` — 0 warnings
- GSD health: 0 errors / 0 warnings
- Security review of the diff: no findings (docs + one env-gated launchd entry; no new attack surface)
- npm audit: 0 vulnerabilities (all severities)

## Deliberately NOT in this branch (Pete-gated)

1. **Branch protection restore on master** (`gh api .../branches/master/protection` → 404) — repo-settings change, recommended: `required_pull_request_reviews` (0 approvals) + `test (20)`/`test (22)` required checks.
2. **`config/schema/daily-stats-frontmatter.schema.json`** one-liner (`"type": "string"` → `"type": "integer"`) — blocked by the protected-file guard, as designed.
3. **Dependency majors** — @anthropic-ai/sdk 0.91.1→0.111 (no open advisory; staleness only), voyageai 0.2.1→0.4.x (deliberate pin), chokidar stays 3.6 (ESM decision). npm audit is clean today.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MuhgwmZ7GECGReNtBiXfny

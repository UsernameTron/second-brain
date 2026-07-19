# Session handoff (auto-written by Stop hook)

- When: 2026-07-19 13:00 CDT
- Branch: chore/claude-md-development-section
- Dirty at stop: 1 files
- Recent commits:
  - d3bb91b docs(claude): add Development section — npm scripts, single-test invocations, repo-managed git hooks
  - 1c6efcf chore(deps): lockfile bumps — js-yaml 3.15.0, brace-expansion 5.0.7, @babel/core 7.29.7 (GHSA-h67p-54hq-rp68, GHSA-jxxr-4gwj-5jf2, GHSA-4x5r-pxfx-6jf8); npm audit 0 vulnerabilities, suite 1259 passed
  - 1b3920a docs: sync test count 1287 -> 1288 (PROMOTE-REJECT-01 regression test)
  - 92c61cb notes: 2026-07-18 session harvest lessons
  - c0b3c70 fix(promote): give rejects a terminal status (PROMOTE-REJECT-01) — reject-marked candidates stayed status:: pending, so every later run re-counted them into total_processed (observed drift 2026-07-19: same two rejects counted on consecutive runs) and they never archived; replacements now maps them to 'rejected' (excluded from LIVE_STATUSES). Strengthened the misnamed status-flip test + added a second-run no-re-count regression; suite 1259 passed

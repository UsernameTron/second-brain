# Plan 33-04 Summary — proof-of-fire evidence + /today sweep line

**Status:** Complete
**Requirement:** CAP-EVIDENCE-01

## What shipped
- **`scripts/daily-sweep.js`** — writes `state/daily-sweep-last-run.json` atomically (tmp+rename) at the end of a real (non-dry-run) `main()`. Payload: `{ ts, staged, durationMs, degraded }`. `staged` = Daily extraction candidates + transcriptSweep.extracted + inboxSweep.extracted. `degraded` sourced from `classifier-health.isDegraded()`. Path override `DAILY_SWEEP_LAST_RUN_PATH_OVERRIDE` for test isolation. Write is fail-open (try/catch → stderr) — a failed evidence write NEVER fails the sweep, whose exit code drives the launchd observation. Dry-run writes nothing.
- **`src/today/sweep-status.js`** — new `computeSweepLine(now=new Date())`: reads the last-run file and returns `sweep ran HH:MM, staged N` (≤26h), `sweep STALE (last ran YYYY-MM-DD)` (>26h, `STALE_MS = 26*60*60*1000` constant), or `sweep NEVER RAN` (missing/corrupt/no-ts). Never throws.
- **`src/today-command.js`** — computes `sweepLine` (fail-open to NEVER RAN) and passes `sweep:` to `renderBriefing`.
- **`src/today/briefing-renderer.js`** — the `## Compounding` section now renders when EITHER the trend body OR the sweep line is present; since `computeSweepLine` always returns a non-empty string, the section (with the sweep line) now appears every day, even when the <7-row trend is suppressed.
- **Tests:** `test/daily-sweep-last-run.test.js` (4: write shape/atomicity, staged sum, degraded flag, dry-run no-write, fail-open on unwritable path), `test/today/sweep-status.test.js` (7 line-state cases incl. the 26h boundary + fail-open), plus renderer + today-command assertions updated for the always-on section.

## Verification
- Full suite green: 1465 passed / 29 skipped, 0 failures.
- `npm run lint` clean.
- Line states, STALE boundary, and fail-open all covered; `--dry-run` proven side-effect-free.

## Behavior change worth noting
The `## Compounding` section now ALWAYS renders in `/today` (previously omitted when the trend had <7 rows). Intended: capture status must be visible every day. Two prior tests that asserted the section's absence were updated to assert the section-present-with-sweep-line behavior.

## Human-verify (Phase 33 gate — deferred, non-blocking)
Tonight's scheduled **23:45** launchd fire should now (with 33-04 on the branch, once it reaches the running code path) exit 0, write `state/daily-sweep-last-run.json`, and make tomorrow's `/today` show `sweep ran 23:45, staged N`. Note: the plist/code must be on the path launchd runs (main tree) for the 23:45 fire to exercise the new write — verify tomorrow via `cat state/daily-sweep-last-run.json` + a dry `/today`.

## Deviations
- Executed inline; auto-commit-hook sweep as noted in 33-03 (all committed, marker-verified).

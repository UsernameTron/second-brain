# Agent Canvas finalization — 2026-09-14

## Scope and authority

Pete authorized cleanup, a pull request and merge after green checks, then
explicitly authorized deployment. The PR contains only Agent Canvas changes.
The 27 original implementation commits remain separate; unrelated memory-runtime
and shared-repository test changes stay on the original local branch.

Agent Canvas uses [SIMPLIFICATION.md](../SIMPLIFICATION.md) and its
[completion audit](2026-09-14-simplification-audit.md). It has no local GSD
milestone/state files. No parent-vault milestone was resumed or rewritten.

## Fresh verification

- Full verification: 433 backend and 299 frontend tests passed, frontend build
  and deployment preflight passed; no skipped tests.
- Both installed production dependency audits: zero vulnerabilities.
- All 15 local Chromium groups passed again, with disposable databases and
  external boundaries stubbed. [Browser evidence](../screenshots/ui-test-summary.json).
- The original 63 test/support files remain. Backend source and the application
  README are unchanged from the base revision, 1308fec.
- The illustrated HTML guide retains 30 steps, embeds nine preview screenshots,
  works without remote assets, and has a verified two-page print view. Checklist
  persistence, reset/undo, image enlargement, keyboard focus and 390/768/1280px
  layouts were checked. The supplied original remains unchanged.
- Credential-pattern scan of the proposed changed files found no matching keys;
  private recovery data and release archives remain outside Git.

## Release boundary

PR [#254](https://github.com/UsernameTron/second-brain/pull/254) merged at 20:20:33 UTC as `cd6cdf8dc53416108b59ea3452182b56ff14a5c6`. All final CI, Claude review, CodeQL and secret checks passed. Both Codex findings were fixed and their review threads resolved.

The existing [release procedure](2026-09-14-ui.md) was followed with the corrected image below. Work and Scheduler paused; the old revision shut down at 20:22:18 UTC and Monitoring confirmed zero active/idle instances at 20:23 UTC. The fresh private replica restored offline through WAL index 814, passing integrity and required-table checks. No recovery data was published.

Revision `agent-canvas-ui-20260914-review2` serves 100% of traffic. The image-only update preserved environment/secret references, Gemini settings, service account, runtime limits and replica destination. Existing data restored, with no fabricated content or orphaned runs recovered, and replication resumed. Health returned 200, development sign-in remained disabled, and the deployed frontend matches the tested build.

Signed in as Pete, Home retained existing inquiries; Sources and details showed recorded external references; View work opened the requested run. The global Needs you queue showed items from other accessible spaces, and Review memory opened its specific entry and lineage without changing the selected space. Connections showed an unverified service until its actual answer-service probe passed. No real decision was answered and no customer record was changed during these checks. Global pause and Scheduler were restored to their original operating states. The first resumed scheduled tick completed with HTTP 200 at 20:30:09 UTC.

Google OAuth from a fresh signed-out session, unaided teammate acceptance, physical microphone and complete live integration journeys remain unverified by this release. The local fixture suite does not claim those results. The separate earlier live HubSpot read check remains documented in HANDOFF.

## PR review follow-up

Codex review found two UI issues before merge: humanized labels had replaced CSS status keys, and accepted custom-agent drafts were retained. Both are fixed with seven regressions. All 732 tests and all 15 browser groups pass after the fixes. A mobile layout check now reads both rectangles in the same frame after resize, preserving its original assertion. The earlier 69cf8d9 candidate will not be deployed.

The revised production container passed isolated startup, fresh-empty database, disabled development sign-in and private-route protection checks with networking disabled. All 46 backend/frontend/startup files match the verified source and frontend build. The image is published privately at `ui-20260914-review2`, index `sha256:5d80f91078ed82a74632003ac29c300028dbb717a651fc18c3467dd7441aaaa5`, Linux manifest `sha256:66ba03df9223f55c19082116f0a1cafe4927a1577345a20a9fbe4a853b044a56`. The rollout uses the same shutdown/recovery procedure with this digest and revision suffix `ui-20260914-review2`.

The guides now describe the deployed UI while identifying screenshots as practice examples. The updated Word/PDF guide renders cleanly as two pages; the illustrated HTML retains its verified interactions and embedded assets, with only the edition note updated. Documentation contracts pass 5/5 and HANDOFF remains within 200 lines.

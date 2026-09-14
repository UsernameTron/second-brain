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

The existing [release review](2026-09-14-ui.md) identifies the tested image,
rollback revision and database shutdown/restore procedure. The three archived
package checksums passed again. The fresh live read-only inspection still shows
revision agent-canvas-00071-p26, generation 71, Gemini, and an enabled scheduler.
The prepared image is being restored from its verified local archive.

At this commit, PR checks, merge and deployment have not yet completed.
Record their actual outcomes in HANDOFF and this report after verification.
Google OAuth and unaided teammate acceptance remain separate from fixture tests.

## PR review follow-up

Codex review found two UI issues before merge: humanized labels had replaced CSS status keys, and accepted custom-agent drafts were retained. Both are fixed with seven regressions. All 732 tests and all 15 browser groups pass after the fixes. A mobile layout check now reads both rectangles in the same frame after resize, preserving its original assertion. The earlier 69cf8d9 candidate will not be deployed.

The revised production container passed isolated startup, fresh-empty database, disabled development sign-in and private-route protection checks with networking disabled. All 46 backend/frontend/startup files match the verified source and frontend build. The image is published privately at `ui-20260914-review2`, index `sha256:5d80f91078ed82a74632003ac29c300028dbb717a651fc18c3467dd7441aaaa5`, Linux manifest `sha256:66ba03df9223f55c19082116f0a1cafe4927a1577345a20a9fbe4a853b044a56`. The rollout uses the same shutdown/recovery procedure with this digest and revision suffix `ui-20260914-review2`.

# Deferred Items — Phase 31 (Trend & Report)

Out-of-scope discoveries logged per executor scope boundary rules. Not fixed as part of plan execution.

## `scripts/**/*.js` has no ESLint file-specific block

`eslint.config.js` defines Node globals (`require`, `process`, `__dirname`, etc.) only for `files: ['src/**/*.js']` and `files: ['test/**/*.js']`. Files under `scripts/` fall back to bare `js.configs.recommended` with no Node globals declared, so `npx eslint scripts/*.js` reports `no-undef` on every Node global.

**Pre-existing, not introduced by 31-03**: `scripts/recall.js` (shipped v1.6, SURFACE-REACH-01) has the identical 10 errors. `scripts/compounding-report.js` (31-03) mirrors that same pattern and inherits the same 11 errors.

**Fix (future phase):** add a `files: ['scripts/**/*.js']` block to `eslint.config.js` mirroring the `src/**/*.js` Node-globals block.

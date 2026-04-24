# UAT-01 Classification Accuracy — RESOLVED

Status: RESOLVED — UAT tests skip cleanly in CI, runnable locally via `npm run test:uat`.

## Resolution

- **T14.5**: Added `process.env.CI` skip guard to both UAT test files
- UAT tests now use `describe.skip` when `CI=true` or API key is missing
- Added `test:uat` script to package.json: `CI= npx jest --forceExit test/uat/`
- CI runs: 0 UAT failures (skipped, not failed)
- Local runs: `npm run test:uat` runs UAT tests with live LLM

## Original Baseline

Root cause: requires live LLM (UAT tests hit real Anthropic API or local LM Studio endpoint).
Baseline captured on commit: 0eff2cebaa7d883ead5f458c73d638fbb4371f5f

The test failure was pre-existing (not a regression from any phase). CI environments
cannot reach the LLM endpoint, so tests must skip rather than fail.

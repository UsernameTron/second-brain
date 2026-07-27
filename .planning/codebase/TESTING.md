# Testing Patterns

**Analysis Date:** 2026-07-26

## Test Framework

**Runner:** Jest 30.3.0 (`package.json` devDependencies). Config lives inline in `package.json` (`"jest": { "testPathIgnorePatterns": ["/node_modules/", ".claude/worktrees"] }`) — there is no separate `jest.config.js`. The `.claude/worktrees` exclusion exists because GSD executor worktrees under that path can't run this repo's Jest (a known blind spot — see `feedback_gsd_executor_worktree_jest_blind` in project memory).

**Assertion library:** Jest's built-in `expect`. No Chai/Sinon.

**Run commands:**
```bash
npm test                                          # full suite, --verbose
npx jest test/promote-memories.test.js            # single file
npx jest -t "promotes accepted candidates"        # single test by name
npm run lint                                      # ESLint over src/ + test/
npm run test:uat                                  # UAT suite, CI= unsets CI so skip-logic runs them
npm run test:uat:ci                               # UAT suite as CI would (mostly skipped)
npm run test:integration:voyage                   # live Voyage API UAT; no-ops without VOYAGE_API_KEY
npm run eval:recall                               # retrieval quality eval vs frozen baseline
```

**Coverage thresholds** are NOT in `package.json`'s jest block — they're injected at CI time only, via `.github/workflows/ci.yml:29`:
```bash
npx jest --verbose --coverage --coverageThreshold='{"global":{"branches":80,"functions":90,"lines":90,"statements":90}}'
```
Branches is intentionally lower (80) than functions/lines/statements (90) — a comment in `ci.yml:27-28` notes this was ratcheted up from 70 and a further lift to 90 is a future milestone gate, current gaps are low-churn utility paths. To run the same gate locally: `npx jest --coverage --coverageThreshold='{"global":{"branches":80,"functions":90,"lines":90,"statements":90}}'`.

## Test File Organization

**Location:** fully separate `test/` tree, not co-located with `src/`. One-to-one filename mirror: `src/daily-stats.js` → `test/daily-stats.test.js`. Subdirectories under `test/` group by concern rather than mirroring `src/` subdirectories exactly:
- `test/unit/`, `test/integration/` — split by test type for a few modules
- `test/uat/` — end-to-end acceptance tests (see UAT section below)
- `test/connectors/`, `test/today/`, `test/agents/`, `test/utils/`, `test/hooks/` — mirror `src/connectors/`, `src/today/`, `src/utils/` and the repo's `hooks/`/`.claude/hooks/` directories
- `test/today-command.gateway.test.js` — routing/gateway logic for the `/today` briefing, split out from `test/today-command.test.js`'s orchestration tests (post-PR #90-93 split)
- `test/memory-dashboard.test.js` — dashboard/reporting view over memory state, distinct from the memory-pipeline tests (`memory-extractor`, `memory-proposals`, `promote-memories`)
- `test/fixtures/` — shared static test data (`memory-sample.md`)

**Naming:** `{module-name}.test.js` for unit tests, `{module-name}-coverage.test.js` when a second file targets specific uncovered branches of an already-tested module (`memory-extractor-coverage.test.js`, `config-validator-coverage.test.js`, `note-formatter-coverage.test.js`), `{feature}.uat.test.js` or `uat-{feature}.test.js` for UAT.

## Test Structure

Uses `describe(...)` blocks grouping `test(...)` cases — **`test()`, not `it()`**, is the convention throughout (`test/classifier.test.js` uses `test()` 16 times, `it()` zero times; same ratio in `test/config-validator.test.js`). Nested `describe` blocks group by capability, not by function name, e.g.:

```javascript
describe('classifier-health — failure tracking & degraded mode', () => {
  test('readHealth() on a missing file returns defaults and does not throw', () => { ... });
});
describe('classifier-health — per-night Haiku cap', () => { ... });
describe('classifier-health — atomic persistence', () => { ... });
```
(`test/utils/classifier-health.test.js:31,70,101`)

**Setup/teardown pattern** — save-restore-mkdtemp, used almost everywhere a module reads an env-controlled path:
```javascript
let tmpCacheDir, originalCacheDir;
beforeEach(() => {
  originalCacheDir = process.env.CACHE_DIR_OVERRIDE;
  tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classifier-health-'));
  process.env.CACHE_DIR_OVERRIDE = tmpCacheDir;
});
afterEach(() => {
  if (originalCacheDir === undefined) delete process.env.CACHE_DIR_OVERRIDE;
  else process.env.CACHE_DIR_OVERRIDE = originalCacheDir;
  fs.rmSync(tmpCacheDir, { recursive: true, force: true });
});
```
(`test/utils/classifier-health.test.js:16-29`, mirrored in `test/semantic-index.test.js:67-108` and `test/uat/semantic-search.uat.test.js:34-103`). Always restore to `undefined` via `delete`, never assume a default string — this preserves "was unset before the test" state exactly.

**Counter-pollution guards:** `src/daily-stats.js` resolves its cache dir with explicit precedence — `CACHE_DIR_OVERRIDE` > jest temp dir keyed by `JEST_WORKER_ID` > `~/.cache/second-brain` (`src/daily-stats.js:288-295`). This means parallel Jest workers never collide on the same counter file even without an explicit override, and `test/daily-stats.test.js:63-73` asserts the `JEST_WORKER_ID` fallback path directly. `src/promote-memories.js:297` uses `JEST_WORKER_ID` as a bare test-environment detector to skip related-links enrichment unless `RELATED_LINKS_UNDER_TEST` is explicitly set — a pattern for "only run this expensive/networked branch when a test opts in."

## Mocking

No Sinon, no `nock` in active use (it's a devDependency but no test file currently `require`s it) — **all mocking is hand-rolled `jest.mock()` with factory functions delegating to shared `jest.fn()` instances**, reset per-test:

```javascript
const mockEmbed = jest.fn();
jest.mock('voyageai', () => ({
  VoyageAIClient: jest.fn().mockImplementation(() => ({
    embed: (...args) => mockEmbed(...args),
  })),
}));
jest.mock('../src/content-policy', () => ({
  checkContent: (...args) => mockCheckContent(...args),
}));

beforeEach(() => {
  jest.resetModules();
  mockEmbed.mockReset();
  mockCheckContent.mockReset();
  mockCheckContent.mockResolvedValue({ decision: 'PASS' });
});
```
(`test/semantic-index.test.js:23-49,77-96`)

This indirection (module-level `mockFn` closed over by the `jest.mock` factory) exists so each test can call `.mockReset()`/`.mockReturnValue()`/`.mockResolvedValue()` on the same reference the mocked module calls — a plain `jest.fn()` inline in the factory can't be reached from test bodies after the module is required.

**What to mock:** external SDKs (`voyageai`), other `src/` modules when testing integration/orchestration logic one layer up (`integration-pipeline.test.js` mocks `../src/classifier` and `../src/vault-gateway` wholesale to test the `/new` pipeline's orchestration, not classifier internals — `test/integration-pipeline.test.js:63-70`).

**What NOT to mock:** filesystem operations on temp dirs (real `fs` + `mkdtempSync`, not a memory-fs mock) — pure Node modules get exercised for real inside an isolated temp directory rather than mocked.

## Fixtures and Factories

Static test data lives in `test/fixtures/` (e.g. `memory-sample.md`) for the handful of tests that need a real file on disk to parse.

For structured mock return values, tests define local factory functions above the `describe` block rather than repeating literal object shapes inline — each factory takes the few fields that vary and fills in the rest:
```javascript
function successRight(directory = 'research', confidence = 0.9) {
  return {
    correlationId: 'integration-corr-id',
    blocked: false,
    side: 'RIGHT',
    directory,
    confidence,
    sonnetEscalated: false,
    stage1: { side: 'RIGHT', confidence: 0.9 },
    stage2: { directory, confidence, sonnetEscalated: false },
  };
}
```
(`test/integration-pipeline.test.js:17-28`, with sibling factories `successLeft`, `blocked`, `deadLettered` at lines 30-59). Use this pattern — a named factory per outcome shape — when a mock's return value has more than 2-3 fields and appears in multiple tests, instead of copy-pasting the object literal.

## Live-API Integration Tests

`test:integration:voyage` runs `test/uat/semantic-search.uat.test.js` against the real Voyage AI embeddings API. Guarded by a `describe.skip` ternary at file scope, not a per-test `if`:
```javascript
const describeMaybe = (process.env.CI === 'true' || !process.env.VOYAGE_API_KEY)
  ? describe.skip
  : describe;
describeMaybe('UAT-19: Semantic Memory Search (real Voyage AI)', () => { ... });
```
(`test/uat/semantic-search.uat.test.js:29-33`). The npm script itself no-ops before Jest even starts if the key is absent: `test:integration:voyage` runs a `node -e` guard that prints `SKIP: VOYAGE_API_KEY not set` and exits 0 (`package.json:12`). Real API tests carry an explicit long timeout as the second arg to `test(...)`, e.g. `}, 30000);` for embedding calls (`test/uat/semantic-search.uat.test.js:126,146,194,206`).

Other UAT files use two related but distinct guard idioms — check the exact one in the file before copying it: `test/uat/uat-classification.test.js:151` and `test/uat/uat-wikilinks.test.js:118` use `const skipInCI = process.env.CI === 'true';`; `test/uat/memory-retrieval.uat.test.js:29` uses `process.env.CI ? describe.skip : describe` (truthy check, not `=== 'true'`). `test/validate-archive.test.js:90` uses a third variant keyed on filesystem state rather than CI: `fs.existsSync(realArchive) ? describe : describe.skip`.

## Eval Harness (Phase 32, v1.8 Measured Memory)

`npm run eval:recall` (→ `scripts/eval-recall.js`) scores `/recall` quality over a **frozen seed vault** (`eval/seed-vault/`) against a **golden set** (`eval/golden-recall.json`), across keyword/semantic/hybrid modes, and compares against the newest `eval/baseline-*.json`. Not a Jest test — a standalone Node CLI script.

Key mechanics (`scripts/eval-recall.js:1-80`):
- **recall@5 is set-membership** (any expected `content_hash` in the top 5 = hit), never exact rank — semantic scores reorder daily via recency decay, so rank-exact would be flaky by design. MRR is reported but never gates.
- **Isolation:** `VAULT_ROOT` → `eval/seed-vault`, `CACHE_DIR_OVERRIDE` → `eval/.cache` (persistent across runs, gitignored, so entry embeddings are reused rather than re-embedded every run).
- **Live-cache isolation is asserted, not assumed:** the script fingerprints (`sha256` + `mtimeMs` + `size`) the live `~/.cache/second-brain/embeddings.jsonl` before and after the run and exits 3 if it changed — a real regression guard against the eval accidentally touching production cache.
- Env overrides are set **before** any `src/` require, with a comment explaining why: `vault-gateway` freezes `VAULT_ROOT` at module load (`scripts/eval-recall.js:35`).
- Exit codes: `0` ok, `1` recall@5 regression vs baseline, `2` preflight failure or baseline refusal, `3` live-cache isolation violation.
- `-- --baseline` flag re-anchors the baseline file instead of comparing against it.
- A `ponytail:`-tagged comment documents a deliberate pacing shortcut for Voyage's free-tier rate limit (3 RPM / 10K TPM), with the upgrade path spelled out: `Set EVAL_EMBED_PACE_MS=0 on a paid key` (`scripts/eval-recall.js:65-66`).

## Git Hooks Touching Tests/Quality

Installed via `hooks/` (repo-managed: `npm run prepare` sets `core.hooksPath=hooks`, so these are live hooks, not `.git/hooks/` templates):
- **`hooks/pre-commit`** — runs three checks in sequence: `pre-commit-schema-validate.js` (AJV validation of `config/*.json` against `config/schema/*.schema.json`, via `src/config-validator.js`), `pre-commit-vault-boundary.js` (LEFT/RIGHT boundary check), and `scripts/validate-archive.js` (archive integrity). Exits non-zero (via `set -euo pipefail`) on first failure.
- **`hooks/pre-push`** — blocks the push if the current branch was based on a now-stale local `master` (compares `git merge-base` against `origin/master`), then runs `pre-push-docsync.js` (docs-sync gate, bypass with `SKIP_DOCSYNC=1`) and `scripts/verify-baseline.js` (bypass with `SKIP_BASELINE=1`).
- **`hooks/post-merge`** — docs drift warning; non-blocking by design (never exits non-zero), so it never fails a merge.

Each of these has a matching test under `test/hooks/` (`pre-commit-schema-validate.test.js`, `pre-commit-vault-boundary.test.js`, `pre-push-docsync.test.js`, `post-merge-doc-sync.test.js`) plus `.test.sh` counterparts for the bash-only hooks (`auto-test.test.sh`, `protected-file-guard.test.sh`, `security-scan-gate.test.sh`).

**Claude Code hooks** (`.claude/hooks/`, separate from git hooks) include `auto-test.sh`: on every source-file edit, it derives the matching `test/{basename}.test.js` and runs `npx jest --testPathPatterns="test/{basename}\.test\.js" --no-coverage` if that test file exists, else no-ops (`.claude/hooks/auto-test.sh:19-37`). This is the mechanism that gives fast feedback on every file save without running the whole suite.

## Coverage

**Run with coverage:**
```bash
npx jest --coverage
```
**Enforce CI thresholds locally:**
```bash
npx jest --coverage --coverageThreshold='{"global":{"branches":80,"functions":90,"lines":90,"statements":90}}'
```
Coverage report written to `coverage/` (uploaded as a CI artifact per Node version, 14-day retention — `ci.yml:31-37`). When checking whether a number clears the gate, read `coverage/coverage-summary.json`'s `total.*.pct` fields — the "All files" text row in the HTML/terminal report is not what the CI gate reads.

**Current numbers (CI=true, `coverage-summary.json` totals):** branches 80.83%, statements 91.99%, functions 95.61%, lines 92.94% — all clear the 80/90/90/90 gate. Branches is the tightest margin, consistent with the "future milestone" note above.

## Test Types

**Unit tests:** the bulk of `test/*.test.js` — one module in isolation, dependencies mocked via `jest.mock()`.

**Integration tests:** `test/integration/`, `test/integration.test.js`, `test/integration-pipeline.test.js`, `test/classifier-integration.test.js` — exercise multiple `src/` modules together (e.g. classify → format → write → wikilink for the `/new` pipeline) while still mocking the outermost boundaries (LLM calls, vault-gateway writes).

**UAT (User Acceptance Tests):** `test/uat/` — full end-to-end scenarios against real or near-real conditions, gated out of default CI runs by the CI/API-key skip idioms described above. Run explicitly via `npm run test:uat` (forces `CI=` empty) or `npm run test:integration:voyage` for the live-API subset.

**E2E against a frozen dataset:** the eval harness (`npm run eval:recall`) is the closest thing to a full end-to-end regression suite, but it's a scored comparison against a baseline, not a pass/fail unit test — treat a regression as a signal to investigate ranking/threshold changes, not a simple red/green.

## Common Patterns

**Async testing** — `async () => { ... }` test bodies with `await` on the module under test, no `done` callbacks anywhere sampled:
```javascript
test('UAT-1: /recall --semantic "leadership" returns ≥3 results...', async () => {
  const { indexNewEntries } = require('../../src/semantic-index');
  const embedResult = await indexNewEntries(MEMORY_ENTRIES);
  expect(embedResult.embedded).toBe(10);
}, 30000);
```
(`test/uat/semantic-search.uat.test.js:107-126`)

**Error/fail-open testing** — assert both the non-throw and the resulting default state in the same test, rather than just wrapping in `expect(...).not.toThrow()`:
```javascript
test('a corrupt/garbage health file fails open to defaults (no throw)', () => {
  fs.writeFileSync(health.getHealthPath(), '{ this is not json ', 'utf8');
  expect(() => health.readHealth()).not.toThrow();
  expect(health.readHealth().consecutive_failures).toBe(0);
});
```
(`test/utils/classifier-health.test.js:62-67`)

**Spy-and-restore for negative-call assertions** — confirm a gate short-circuits before an expensive/external call, then clean up the spy:
```javascript
const embedSpy = jest.spyOn(voyageai.VoyageAIClient.prototype, 'embed');
const result = await semanticSearch('ISPN strategy');
const embedCallCount = embedSpy.mock.calls.length;
embedSpy.mockRestore();
```
(`test/uat/semantic-search.uat.test.js:152-168`)

## Current Test Counts (verified 2026-07-26, post PRs #90-93)

**1552 total tests across 82 test files.** Local run (default env): **1523 passing / 29 skipped**. CI run (`CI=true`, skip-logic active): **1514 passing / 38 skipped** — the wider CI skip count reflects UAT/live-API guards described above triggering under `CI=true`, not test loss. Lint is clean (ESLint 10 flat config, zero warnings). Quote the CI split (1514/38), not the local split (1523/29), when documenting "what CI sees."

---

*Testing analysis: 2026-07-26*

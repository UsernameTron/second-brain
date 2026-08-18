# Testing Patterns

**Analysis Date:** 2026-08-18

Two independent test stacks live in this repo: **root** (`src/`/`test/`, Jest)
and **`agent-canvas/`** (backend `node:test`, frontend Vitest, plus a build
and deploy self-test all chained under one `verify` gate). They have separate
runners, separate CI jobs, and separate gate commands — do not assume root's
`npm test` covers agent-canvas, and do not assume agent-canvas's `npm test`
covers its own frontend.

## Root: Jest

**Runner:** Jest 30.3.0 (`package.json` devDependencies). Config lives inline
in `package.json` (`"jest": { "testPathIgnorePatterns": ["/node_modules/",
".claude/worktrees", "/agent-canvas/"] }`) — no separate `jest.config.js`.
Root Jest **explicitly excludes `/agent-canvas/`** from its test path, so the
two suites never overlap or double-run. The `.claude/worktrees` exclusion
exists because GSD executor worktrees under that path can't run this repo's
Jest.

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

**Coverage thresholds** are NOT in `package.json`'s jest block — injected at
CI time only, via `.github/workflows/ci.yml`:
```bash
npx jest --verbose --coverage --coverageThreshold='{"global":{"branches":80,"functions":90,"lines":90,"statements":90}}'
```
Branches is intentionally lower (80) than functions/lines/statements (90) — a
comment in `ci.yml` notes this was ratcheted up from 70 and a further lift to
90 is a future milestone gate; current gaps are low-churn utility paths. To
run the same gate locally: `npx jest --coverage --coverageThreshold='{"global":{"branches":80,"functions":90,"lines":90,"statements":90}}'`.

### Test File Organization

**Location:** fully separate `test/` tree, not co-located with `src/`.
One-to-one filename mirror: `src/daily-stats.js` → `test/daily-stats.test.js`.
Subdirectories group by concern rather than mirroring `src/` subdirectories
exactly: `test/unit/`, `test/integration/`, `test/uat/`, `test/connectors/`,
`test/today/`, `test/agents/`, `test/utils/`, `test/hooks/`, `test/fixtures/`.

**Naming:** `{module-name}.test.js` for unit tests, `{module-name}-coverage.test.js`
when a second file targets specific uncovered branches of an already-tested
module, `{feature}.uat.test.js` or `uat-{feature}.test.js` for UAT.

### Test Structure

Uses `describe(...)` blocks grouping `test(...)` cases — **`test()`, not
`it()`**, is the convention throughout. Nested `describe` blocks group by
capability, not by function name:
```javascript
describe('classifier-health — failure tracking & degraded mode', () => {
  test('readHealth() on a missing file returns defaults and does not throw', () => { ... });
});
describe('classifier-health — per-night Haiku cap', () => { ... });
```
(`test/utils/classifier-health.test.js:31,70,101`)

**Setup/teardown pattern** — save-restore-mkdtemp, used almost everywhere a
module reads an env-controlled path:
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
(`test/utils/classifier-health.test.js:16-29`). Always restore to `undefined`
via `delete`, never assume a default string.

**Counter-pollution guards:** `src/daily-stats.js` resolves its cache dir with
explicit precedence — `CACHE_DIR_OVERRIDE` > jest temp dir keyed by
`JEST_WORKER_ID` > `~/.cache/second-brain` — so parallel Jest workers never
collide on the same counter file even without an explicit override.

### Mocking

No Sinon, no active `nock` — **all mocking is hand-rolled `jest.mock()` with
factory functions delegating to shared `jest.fn()` instances**, reset per-test:
```javascript
const mockEmbed = jest.fn();
jest.mock('voyageai', () => ({
  VoyageAIClient: jest.fn().mockImplementation(() => ({
    embed: (...args) => mockEmbed(...args),
  })),
}));
beforeEach(() => {
  jest.resetModules();
  mockEmbed.mockReset();
});
```
(`test/semantic-index.test.js:23-49,77-96`)

**What to mock:** external SDKs (`voyageai`), other `src/` modules when
testing integration/orchestration logic one layer up.

**What NOT to mock:** filesystem operations on temp dirs (real `fs` +
`mkdtempSync`, not a memory-fs mock).

### Fixtures and Factories

Static test data lives in `test/fixtures/`. For structured mock return
values, tests define local factory functions above the `describe` block
rather than repeating literal object shapes inline — one named factory per
outcome shape (`test/integration-pipeline.test.js:17-59`: `successRight`,
`successLeft`, `blocked`, `deadLettered`).

### Live-API Integration Tests

`test:integration:voyage` runs `test/uat/semantic-search.uat.test.js` against
the real Voyage AI embeddings API, guarded by a `describe.skip` ternary at
file scope:
```javascript
const describeMaybe = (process.env.CI === 'true' || !process.env.VOYAGE_API_KEY)
  ? describe.skip : describe;
```
Other UAT files use related but distinct CI-guard idioms — check the exact
one before copying: `uat-classification.test.js`/`uat-wikilinks.test.js` use
`process.env.CI === 'true'`; `memory-retrieval.uat.test.js` uses a truthy
check (`process.env.CI ? describe.skip : describe`);
`validate-archive.test.js` keys on filesystem state instead of CI.

### Eval Harness (v1.8 Measured Memory)

`npm run eval:recall` (→ `scripts/eval-recall.js`) scores `/recall` quality
over a frozen seed vault against a golden set, across keyword/semantic/hybrid
modes, compared against the newest baseline. Not a Jest test — a standalone
Node CLI. recall@5 is set-membership, never exact rank. Exit codes: `0` ok,
`1` regression, `2` preflight failure, `3` live-cache isolation violation.

### Root Coverage — Current Numbers

**1568 total tests across 82 test files.** Local run (default env): 1539
passing / 29 skipped. CI run (`CI=true`, skip-logic active): 1530 passing /
38 skipped, 80 of 82 suites executed — the wider CI skip count reflects
UAT/live-API guards triggering under `CI=true`, not test loss. Coverage
(CI=true, `coverage-summary.json` `total.*.pct`): branches 80.95%, statements
92.03%, functions 95.78%, lines 92.99% — all clear the 80/90/90/90 gate,
branches the tightest margin. When checking whether a number clears the
gate, read `coverage-summary.json`'s `total.*.pct` fields — the "All files"
text row in the terminal/HTML report is not what CI reads. Lint is clean
(zero ESLint warnings).

## Agent Canvas: node:test + Vitest, `npm run verify` is the real gate

**`npm test` alone is BACKEND ONLY and has never been the gate.** A change can
pass `npm test` while the frontend suite or the production build is red. The
actual verification command, documented in `agent-canvas/CLAUDE.md:17-21` and
mirrored in `agent-canvas/package.json`, is:
```json
"verify": "npm test && npm run test:frontend && npm run build --prefix frontend && bash -n deploy/deploy.sh && bash deploy/deploy.sh --selftest"
```
That is five checks chained with `&&` (any failure stops the chain): backend
`node:test`, frontend `vitest run`, the frontend production Vite build,
`deploy/deploy.sh` syntax check (`bash -n`), and the deploy script's own
`--selftest` self-check. `agent-canvas/CLAUDE.md` also directs adding
`npm audit --omit=dev` (root and `frontend/`) before proposing a commit —
that step is manual, not wired into the `verify` npm script itself.

### Backend: `node:test`

**Runner:** Node's built-in test runner, no Jest, no Mocha
(`agent-canvas/package.json`: `"test": "node --test \"test/*.test.js\""`).
Uses `require('node:test')` and `require('node:assert')` directly:
```javascript
const test = require('node:test');
const assert = require('node:assert');
```
(`agent-canvas/test/rooms.test.js:6-7`)

**Current count: 385 tests across 44 files** (`agent-canvas/test/*.test.js`,
verified via `node --test`). All 385 pass, 0 fail, 0 skipped as of this
analysis. Naming: kebab-case, `{feature}.test.js` — `access-control.test.js`,
`agent-authority.test.js`, `agent-builder.test.js`, `canvas-files-tool.test.js`,
`enrichment-dispatch.test.js`, `hardening.test.js`, `standing-rules` coverage
spread across several files, `docs-contract.test.js` (see below).

**Setup pattern** — real Express server on an isolated ephemeral `DATA_DIR`,
started once per test file, exercised over real HTTP via `fetch`:
```javascript
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-rooms-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test'; // placeholder, never called

const { server } = require('../server/index');
runner._internal.setCallModel(async () => ({
  content: [{ type: 'text', text: 'stubbed refresh' }], stop_reason: 'end_turn', usage: {},
}));
```
(`agent-canvas/test/rooms.test.js:11-25`). LLM calls are stubbed via an
injectable `_internal.setCallModel()` hook on the orchestrator runner rather
than mocking the Anthropic SDK module — the real HTTP/auth/DB stack runs, only
the model call is faked. Auth for test requests goes through a real dev
sign-in endpoint (`POST /api/auth/dev`) that returns a session cookie, then
every subsequent call passes that cookie — this exercises the actual
cookie-auth code path rather than bypassing it.

**Multi-role fixtures** — tests define named actors up front
(`OWNER`, `VIEWER`, `EDITOR`, and an unauthorized "outsider") and sign each
in separately, so permission-boundary tests read as "as VIEWER, expect 403"
rather than re-deriving roles per assertion.

### `docs-contract.test.js` — structural documentation validation

`agent-canvas/test/docs-contract.test.js` is a `node:test` file that validates
the *structure* of `agent-canvas/docs/` (not the truth of any claim in them —
that's what the evidence hierarchy in `docs/README.md` is for). Four checks:
1. Every governed doc (everything in `docs/*.md` plus `README.md`/`CLAUDE.md`)
   is linked from `docs/README.md` — an unlisted new file fails the suite.
2. `docs/README.md` never links a file that doesn't exist on disk.
3. Every local markdown link in every governed doc resolves to a real file
   (walks all of them, not just the index).
4. Every doc listed under "Historical records" in the index opens with a
   blockquote banner naming it historical, within its first 12 lines.
Plus a hard structural ceiling: `docs/HANDOFF.md` must be ≤200 lines (it once
grew to 1666 lines with the live claim buried mid-file); `HANDOFF-HISTORY.md`
must still exist. This is the pattern to follow for any repo where a status
doc has previously rotted or been buried — enforce shape with a test, not
just a review-time skim.

### Frontend: Vitest

**Runner:** Vitest 4.1.10 + `@testing-library/react` 16 + `@testing-library/user-event`
14 + jsdom 29 (`agent-canvas/frontend/package.json` devDependencies).
`"test": "vitest run"` (`frontend/package.json:8`). No Jest anywhere in the
frontend — do not port Jest-specific APIs (`jest.mock`, `jest.fn`) into
`frontend/test/*.test.jsx`; Vitest's `vi.mock`/`vi.fn` equivalents apply
there, `jsdom` is the test environment (not the default `node`).

**Current count: 107 tests across 10 files**
(`frontend/test/*.test.jsx`): `api-upload.test.jsx`, `builder.test.jsx`,
`dialog.test.jsx`, `format.test.jsx`, `home.test.jsx`, `light-theme.test.jsx`,
`nodes.test.jsx`, `rooms.test.jsx`, `rules.test.jsx`,
`workspace-cleanup.test.jsx`, plus a shared `setup.js`. All 107 pass.

**Run:**
```bash
npm run test:frontend          # from agent-canvas/, = npm test --prefix frontend
npm test --prefix frontend     # equivalent, direct
```

### Deploy Self-Test

The last two legs of `npm run verify` are shell, not a JS test runner:
- `bash -n deploy/deploy.sh` — syntax-only check, catches malformed bash
  before any real deploy attempt.
- `bash deploy/deploy.sh --selftest` — the script's own `--selftest` flag
  proves its internal functions against fixtures without touching Cloud Run,
  reachable at `deploy/deploy.sh:40-46`. Treat this as a real test suite for
  the deploy script, not an optional extra — it is chained into `verify` with
  `&&`, so a broken deploy script fails the whole gate the same as a failing
  unit test.

## CI Matrix

`.github/workflows/ci.yml` defines two separate jobs, both `ubuntu-latest`:

**`test` job (root):** matrix `node-version: [22]`. Steps: `npm ci` → lint →
`jest --coverage` with the injected threshold string above → upload coverage
artifact (14-day retention, per Node version) → `npm run license-check` →
`npm audit --audit-level=high --omit=dev` (production-dependency-only,
deliberately since 2026-07-27 after an unscoped audit went red on a dev-only
GHSA advisory with no code change — see `ci.yml` inline comment for the
full incident rationale).

**`agent-canvas-test` job:** separate job, own checkout, own `npm ci` scoped
to `agent-canvas/` (cache keyed off `agent-canvas/package-lock.json`), runs
`npm test` (backend `node:test`) then a second `npm ci` inside
`agent-canvas/frontend/` and `npm run test:frontend`. **CI runs backend +
frontend tests but does NOT run the full `npm run verify` chain** — the
production build, `deploy.sh` syntax check, and deploy self-test are not
CI-gated as of this analysis; they run locally as part of `verify` before a
commit is proposed, per `agent-canvas/CLAUDE.md`'s house rule, but are not
enforced by GitHub Actions. Treat local `npm run verify` as the real
pre-commit bar for agent-canvas changes; CI is a narrower backstop.

---

*Testing analysis: 2026-08-18*

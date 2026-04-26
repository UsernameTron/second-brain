# Phase 23: Doc Sync Layer — Research

**Researched:** 2026-04-26
**Domain:** Git hooks, Node.js CLI scripting, Claude Code agent authoring, documentation drift detection
**Confidence:** HIGH

---

## Summary

Phase 23 adds two complementary drift-detection surfaces: a **post-merge git hook** that warns immediately after a merge to master when living-doc stats diverge from runtime reality, and an enhanced **`docs-sync` Claude Code agent** that performs a deeper narrative comparison at phase-closure time and blocks if drift exceeds a configured threshold.

The project already has a mature hook infrastructure (`hooks/pre-commit`, `hooks/pre-commit-schema-validate.js`, `hooks/pre-commit-vault-boundary.js`) installed via `npm run prepare` → `git config core.hooksPath hooks`. The pattern is battle-tested: a bash orchestrator calls Node scripts. The same pattern supports a `post-merge` hook in the same `hooks/` directory.

The existing `docs-sync` agent (`/.claude/agents/docs-sync.md`) is a documentation *updater* today — it edits stale sections. Phase 23 needs it to gain a second mode: *auditor with pass/fail verdict* that blocks phase closure if drift exceeds threshold. This is a surgical addition to the existing agent, not a replacement.

**Primary recommendation:** Follow the established `hooks/` convention exactly. One new `post-merge` bash script calling a new `post-merge-doc-sync.js` Node module. Extend `docs-sync.md` with an explicit "Phase-Closure Audit" section and threshold config. No new dependencies required.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOOK-DOCSYNC-01 | Post-merge hook compares `CLAUDE.md`/`README.md` stats (test count, coverage, phase count) against live `jest --coverage` output and flags mismatches as non-blocking warnings | Existing hook pattern in `hooks/pre-commit` is the direct template; `jest --coverage --silent` produces parseable JSON output; exit 0 with stderr warning is the non-blocking pattern |
| AGENT-DOCSYNC-01 | Post-ship agent compares living-doc stats and narrative against `jest --coverage` and `git log` reality; blocks phase closure if drift exceeds threshold; pairs with HOOK-DOCSYNC-01 | Existing `docs-sync.md` agent is the foundation; augment with audit-mode instructions and threshold logic; blocking means returning a structured BLOCK verdict the GSD verifier chain reads |

</phase_requirements>

---

## Standard Stack

### Core (already in the project — no new dependencies needed)

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Node.js (CJS) | 22 LTS | Hook script runtime | All existing hooks use `require()` CJS modules |
| Jest 30 | `^30.3.0` | Coverage source-of-truth | In devDependencies; `--json --coverage --silent` is canonical |
| `child_process.execFileSync` | Node stdlib | Run `jest` from hook | `execFileSync` used in `pre-commit-vault-boundary.js` — avoids shell injection |
| Bash shebang orchestrator | system | `hooks/post-merge` entry point | Matches existing `hooks/pre-commit` pattern verbatim |
| `gray-matter` | `^4.0.3` | Parse YAML frontmatter (if needed) | In dependencies; already used by schema validate hook |
| AJV | `^8.18.0` | Schema for threshold config (optional) | In devDependencies; already used for schema validate hook |

### No New Dependencies

The hook only needs: regex/string parsing of jest JSON output + markdown text scanning. Both are standard Node.js. Do **not** add markdown parser libs — regex on known stat patterns is simpler, faster, and has no install surface.

**Coverage output format (verified against live run 2026-04-26):**

Running `jest --coverage` populates `coverage/coverage-summary.json`. The relevant fields:

```json
{
  "total": {
    "statements": { "pct": 94.32 },
    "branches":   { "pct": 82.36 },
    "functions":  { "pct": 96.51 },
    "lines":      { "pct": 95.14 }
  }
}
```

Running `jest --json` (or `jest --json --outputFile=<path>`) produces a JSON file with `numTotalTests` and `numPassedTests` at the top level. Recommended: use `--outputFile` to a temp file rather than capturing stdout, since jest stdout may include non-JSON lines.

**Recommended approach:** run `jest --coverage --json --outputFile=/tmp/jest-result.json --silent --forceExit` once; read both `/tmp/jest-result.json` for test counts AND `coverage/coverage-summary.json` for coverage. One jest invocation, two files, clean parsing.

**Current live stats (2026-04-26 baseline):**
- Tests: 1146 total, 1095 passing, 1 failing (uat-classification), 5 skipped, 45 todo
- Coverage: Statements 94.32%, Branches 82.36%, Functions 96.51%, Lines 95.14%

---

## Architecture Patterns

### Pattern 1: Post-Merge Hook (matches existing pre-commit pattern exactly)

**Structure:**

```
hooks/
├── pre-commit                    # existing bash orchestrator
├── pre-commit-schema-validate.js # existing Node module
├── pre-commit-vault-boundary.js  # existing Node module
├── post-merge                    # NEW: bash orchestrator (warn-only, exit 0 always)
└── post-merge-doc-sync.js        # NEW: Node module doing the comparison
```

**`hooks/post-merge` (bash) — key design constraint: ALWAYS exits 0:**

```bash
#!/usr/bin/env bash
# Post-merge hook: documentation drift warning (non-blocking).
# CRITICAL: This hook must NEVER exit non-zero. Non-zero exit can
#           abort or confuse git merge operations.
SELF="$(readlink -f "$0" 2>/dev/null \
      || python3 -c "import os; print(os.path.realpath('$0'))")"
HOOK_DIR="$(dirname "$SELF")"

echo "[post-merge] Checking documentation drift..."
node "$HOOK_DIR/post-merge-doc-sync.js" || {
  echo "[post-merge] Warning check failed (non-blocking)" >&2
}
exit 0
```

**`hooks/post-merge-doc-sync.js` (Node module) responsibilities:**

1. Read `CLAUDE.md` and `README.md` text from PROJECT_ROOT
2. Extract stat patterns from those files (test count, coverage percentages, phase count)
3. Run jest to get live truth (use `execFileSync` with array args — no shell injection)
4. Compare extracted doc stats vs live reality
5. Print warnings to stderr for any mismatch; print clean message if no drift
6. `process.exit(0)` always — the bash caller already handles non-blocking with `|| true`

**Stat patterns to extract from CLAUDE.md/README.md:**

| Stat | Regex pattern | Current example value |
|------|---------------|-----------------------|
| Total test count | `/(\d[\d,]*)\s+total(?:\s+across\|\b)/i` | `1127 total` (doc) vs 1146 (live) |
| Statement coverage | `/Statements?\s+([\d.]+)%/i` | `94.62%` (doc) vs 94.32% (live) |
| Branch coverage | `/Branch(?:es)?\s+([\d.]+)%/i` | `81.28%` (doc) vs 82.36% (live) |
| Completed phases | count of `/Phase\s+\d+\s+complete/gi` | 1 in CLAUDE.md = Phase 22 |

Note: CLAUDE.md currently shows stale stats from v1.3 (test count 1127, coverage 94.62%). The hook will warn immediately on first run — this is expected and documents the current drift.

**Configurable threshold:**

Store in `config/pipeline.json` (existing config file, already has a schema) or a new `config/docsync.json` (with matching `config/schema/docsync.schema.json`). Suggested shape:

```json
{
  "docsync": {
    "warn_threshold_pct": 1.0,
    "block_threshold_pct": 3.0
  }
}
```

`warn_threshold_pct`: coverage % difference that triggers a warning (hook always warns on any mismatch; agent warns above this).
`block_threshold_pct`: difference that causes the agent to return BLOCK verdict.

### Pattern 2: Agent Audit Mode (extend existing docs-sync agent)

The existing `docs-sync.md` agent is a *writer*. Phase 23 adds an *audit* mode. Do not create a new agent — extend the existing one with a new section.

**Extension approach:**

Add a `## Phase-Closure Audit Mode` section to `.claude/agents/docs-sync.md` that:

1. Activates when invoked with the word "audit", "DOCSYNC-CHECK", or "phase closure check"
2. Defines the audit procedure:
   - Run `npm test -- --silent 2>&1 | tail -5` to get current test count
   - Run `npx jest --coverage --json --outputFile=/tmp/jest-docsync.json --silent --forceExit` for coverage
   - Run `git log --oneline | grep -c "Phase.*complete"` for phase count cross-check
   - Read `CLAUDE.md` and `README.md` and extract stated stats
   - Compare extracted vs live; compute drift for each stat
   - If any stat diverges above block_threshold_pct: emit `DOCSYNC-AUDIT: BLOCK`
   - If clean: emit `DOCSYNC-AUDIT: PASS`
3. Structured output format the GSD verifier can parse:

```
DOCSYNC-AUDIT: PASS|BLOCK
Checked: CLAUDE.md, README.md
Stats compared: test_count, coverage_statements, coverage_branches, phase_count
Violations: none | [list]
```

**Why extend rather than create new:** the existing agent already reads all three docs and runs the relevant shell commands. Adding an audit mode avoids duplicating that knowledge and keeps agent count lean.

### Pattern 3: Test Coverage for the Hook

Following the pattern of `test/hooks/pre-commit-schema-validate.test.js` and `test/hooks/pre-commit-vault-boundary.test.js`, add `test/hooks/post-merge-doc-sync.test.js`.

The test file should:
- Export `extractDocStats(text)` and `compareStats(docStats, liveStats, threshold)` as testable functions
- Import them in tests using `require()` with `module.exports`
- Test: clean state → no violations; stale test count → violation emitted; coverage drift below threshold → no block; drift above threshold → block

### Anti-Patterns to Avoid

- **Using `execSync` with shell string interpolation** — always use `execFileSync(cmd, argsArray)` as in `pre-commit-vault-boundary.js`. This is both safer (no injection) and the project-established pattern.
- **Blocking the post-merge hook** — `process.exit(1)` in `post-merge-doc-sync.js` is wrong. The bash orchestrator handles non-blocking with `|| { ... }; exit 0`.
- **Running jest twice** — one `jest --coverage --json --outputFile=...` call produces both test count and coverage. Don't call jest separately per metric.
- **Hardcoding thresholds in hook script** — thresholds belong in `config/` so they update without hook edits.
- **Regex hunting without anchoring** — the stat extraction regexes must match the known format in CLAUDE.md/README.md, not generic number patterns. Test regex against actual doc content.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Coverage data | Parse jest CLI text output | `jest --json --outputFile` + read JSON | JSON output is stable; text format varies by jest version and terminal width |
| Markdown parsing | Custom AST parser | Regex on known stat lines | The stat format is project-controlled and consistent; full parser is overkill |
| Hook installation | Manual symlink instructions | `npm run prepare` + `git config core.hooksPath hooks` | Already the project mechanism; post-merge goes in same `hooks/` dir |
| Agent result pickup | New subprocess infrastructure | Structured text output + human/GSD read | The agent already outputs text; the contract is the DOCSYNC-AUDIT: prefix |

---

## Common Pitfalls

### Pitfall 1: Post-Merge Hook Blocks Merge on Unhandled Error

**What goes wrong:** Node script throws uncaught error and exits non-zero; if bash `set -e` is active, the merge reports an error to git.
**Why it happens:** Missing coverage file, jest spawn failure, JSON parse error.
**How to avoid:** The bash orchestrator uses `|| { ... }; exit 0` pattern. The Node script wraps all operations in `try/catch` and calls `process.exit(0)` in the catch path. There must be zero `process.exit(1)` calls in `post-merge-doc-sync.js`.
**Warning signs:** Any test for the hook that asserts `exitCode === 1` for error conditions is wrong for this specific hook.

### Pitfall 2: Jest Coverage Timeout in Post-Merge Hook

**What goes wrong:** `jest --coverage` takes 10-15 seconds on this project; the post-merge hook runs synchronously and holds the terminal.
**Why it happens:** Coverage instrumentation adds overhead.
**How to avoid:** Accept the cost — 10-15 seconds is acceptable for drift detection. Use `--silent --forceExit` to suppress output and prevent hang. Document the expected duration. Set `timeout: 60000` in the `execFileSync` call. If future test suite growth makes this too slow, the hook can be made async-friendly by running in the background and writing results to a temp file.

### Pitfall 3: Reading Stale `coverage-summary.json`

**What goes wrong:** Hook reads `coverage/coverage-summary.json` left from a previous `npm test` run instead of running fresh.
**Why it happens:** File already exists from prior dev run.
**How to avoid:** Always run jest fresh with `--outputFile` to a temp path. Do not read `coverage/coverage-summary.json` directly — use the freshly-generated temp file, then delete it.

### Pitfall 4: Pattern Drift Between Doc Format and Regex

**What goes wrong:** CLAUDE.md is manually updated to use "1,127 tests" or "tests: 1127" rather than the expected "1127 total across X test files", breaking extraction.
**Why it happens:** Docs evolve; there's no enforced format contract.
**How to avoid:** Document the canonical format for each stat in the hook's source comments. Add a test that asserts the current CLAUDE.md matches the extraction regex (a living test that fails if docs drift away from the parseable format).

### Pitfall 5: Agent Audit Verdict Is Not Picked Up

**What goes wrong:** The docs-sync agent returns "DOCSYNC-AUDIT: BLOCK" text but the phase closure proceeds anyway because no step reads the verdict.
**Why it happens:** Agent output is conversational text; GSD doesn't automatically block on arbitrary agent output.
**How to avoid:** The plan must include a verification step (a shell script or explicit check) that invokes the agent, captures the output, and `grep`s for `DOCSYNC-AUDIT: BLOCK`. This explicit pickup step is what creates the blocking behavior.

### Pitfall 6: Hook Path Confusion (hooksPath Resolution)

**What goes wrong:** `post-merge` placed in `hooks/` is not invoked by git because `core.hooksPath` actually points to `.git/hooks/`.
**Why it happens:** The `.git/config` shows `hooksPath = /Users/cpconnor/projects/second-brain/.git/hooks` (absolute path to `.git/hooks`), but the Phase 22 hooks live in `hooks/` (project-level directory). These are different directories.
**Current observed state:**
  - `hooks/` dir: has `pre-commit`, `pre-commit-schema-validate.js`, `pre-commit-vault-boundary.js`
  - `.git/hooks/`: has only `pre-push`
  - `.git/config` `hooksPath`: points to `.git/hooks` not `hooks/`
**Implication:** The Phase 22 pre-commit hooks in `hooks/` may not be active. This must be investigated and fixed before adding `post-merge`. The plan must include a task to confirm `git config core.hooksPath` returns `hooks` (relative) and that pre-commit fires correctly.
**Resolution options:** (a) run `git config core.hooksPath hooks` (relative path, without leading `.git/`) so git resolves it relative to the repo root; or (b) verify that `npm run prepare` does this and re-run it.

---

## Code Examples

### Stat Extraction from CLAUDE.md (Node.js)

```javascript
// Source: project pattern from pre-commit-schema-validate.js
// Uses known CLAUDE.md format confirmed 2026-04-26
function extractDocStats(text) {
  const stats = {};

  // Matches: "1127 total across 55 test files"
  const totalMatch = text.match(/(\d[\d,]*)\s+total(?:\s+across|\b)/i);
  if (totalMatch) stats.testCount = parseInt(totalMatch[1].replace(/,/g, ''), 10);

  // Matches: "Statements 94.62%"
  const stmtMatch = text.match(/Statements?\s+([\d.]+)%/i);
  if (stmtMatch) stats.coverageStatements = parseFloat(stmtMatch[1]);

  // Matches: "Branch 81.28%"
  const branchMatch = text.match(/Branch(?:es)?\s+([\d.]+)%/i);
  if (branchMatch) stats.coverageBranches = parseFloat(branchMatch[1]);

  return stats;
}
module.exports = { extractDocStats };
```

### Running Jest to Get Live Stats (using execFileSync — project pattern)

```javascript
// Source: pre-commit-vault-boundary.js uses execFileSync for safe subprocess calls
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function getLiveStats(projectRoot) {
  const tmpOut = path.join(os.tmpdir(), 'jest-docsync-result.json');
  try {
    // execFileSync avoids shell injection; args passed as array
    execFileSync(
      'npx',
      ['jest', '--coverage', '--json', '--outputFile=' + tmpOut, '--silent', '--forceExit'],
      { cwd: projectRoot, timeout: 60000, stdio: ['ignore', 'ignore', 'ignore'] }
    );
  } catch (_) {
    // jest exits non-zero on test failures; output file is still written
  }

  let jestResult = null;
  try {
    jestResult = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    fs.unlinkSync(tmpOut);
  } catch (_) { return null; }

  const coverageSummaryPath = path.join(projectRoot, 'coverage', 'coverage-summary.json');
  let coverageSummary = null;
  try {
    coverageSummary = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
  } catch (_) {}

  return {
    testCount: jestResult ? jestResult.numTotalTests : null,
    passingCount: jestResult ? jestResult.numPassedTests : null,
    coverageStatements: coverageSummary ? coverageSummary.total.statements.pct : null,
    coverageBranches: coverageSummary ? coverageSummary.total.branches.pct : null,
  };
}
module.exports = { getLiveStats };
```

### Drift Comparison Function

```javascript
// Source: project-specific, follows pre-commit-schema pattern of errors array
function compareStats(docStats, liveStats, warnThreshold) {
  const violations = [];
  const pairs = [
    ['testCount', 'test count', 0],          // exact match for counts
    ['coverageStatements', 'statements %', warnThreshold],
    ['coverageBranches', 'branches %', warnThreshold],
  ];

  for (const [key, label, threshold] of pairs) {
    if (docStats[key] == null || liveStats[key] == null) continue;
    const drift = Math.abs(docStats[key] - liveStats[key]);
    if (drift > threshold) {
      violations.push(
        `${label}: doc states ${docStats[key]}, actual is ${liveStats[key]}, drift=${drift.toFixed(2)}`
      );
    }
  }
  return violations;
}
module.exports = { compareStats };
```

### Agent Audit Output Contract

```
DOCSYNC-AUDIT: PASS
Checked: CLAUDE.md, README.md
Stats compared: test_count, coverage_statements, coverage_branches
Violations: none
```

```
DOCSYNC-AUDIT: BLOCK
Checked: CLAUDE.md, README.md
Stats compared: test_count, coverage_statements, coverage_branches
Violations:
  - test count: doc states 1127, actual is 1146, drift=19
  - statements %: doc states 94.62, actual is 94.32, drift=0.30%
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | post-merge hook script | Yes | 22.21.1 LTS | — |
| npx / Jest 30 | Live stat extraction | Yes | 30.3.0 | — |
| git | Hook invocation, phase count | Yes | system git | — |
| Bash | Hook orchestrator shebang | Yes | zsh/bash (macOS) | — |

**Missing dependencies with no fallback:** None.

**Hook path investigation — must confirm during planning:**

`git config core.hooksPath` on the working tree currently shows the resolved absolute path to `.git/hooks/`. The Phase 22 hooks live in `hooks/` (project-level). Whether the pre-commit hooks from Phase 22 are active needs verification. Resolution is a prerequisite for Phase 23 — `post-merge` must go in the same directory that `core.hooksPath` points to.

---

## Runtime State Inventory

Greenfield addition — not a rename or refactor. No stored data, live service config, OS-registered state, secrets, or build artifacts need migration.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Manual doc update by agent on request | `docs-sync` agent on-demand (write mode) | Agent already in place |
| No drift detection at merge time | `post-merge` hook (Phase 23 addition) | Catches drift at the merge boundary |
| No blocking drift detection at phase closure | `docs-sync` audit mode (Phase 23 addition) | Blocks phase closure on threshold breach |

---

## Open Questions

1. **Hook path resolution — is Phase 22's hooksPath wiring correct?**
   - What we know: `.git/config` shows `hooksPath = /Users/cpconnor/projects/second-brain/.git/hooks`; `hooks/` has Phase 22 pre-commit scripts; `.git/hooks/` has only `pre-push`
   - What's unclear: Are Phase 22 pre-commit hooks actually active? Is the `.git/config` entry stale from before `npm run prepare` ran?
   - Recommendation: First task in Phase 23 planning is `git config core.hooksPath` verification. If it returns `.git/hooks`, run `npm run prepare` in the worktree, verify pre-commit fires on a test commit, then add `post-merge`.

2. **Blocking pickup mechanism for the agent**
   - What we know: `docs-sync` agent returns text; DOCSYNC-AUDIT: BLOCK is the proposed contract; GSD verifier reads agent output conversationally
   - What's unclear: Whether a shell script pickup step is needed vs GSD's built-in verifier being able to act on the BLOCK verdict
   - Recommendation: Plan a dedicated shell/Node verification script that runs the agent, captures stdout, and exits non-zero if `DOCSYNC-AUDIT: BLOCK` is found. This is explicit and testable.

3. **Phase count source-of-truth**
   - What we know: CLAUDE.md contains "Phase X complete" text entries; `git log` has phase-tagged commits
   - What's unclear: Whether phase count from doc text vs git log should be the authority
   - Recommendation: Use `git log --oneline | grep -c "docs([0-9"` for the live truth; doc text extraction is supplementary. This approach doesn't depend on fragile doc formatting.

---

## Sources

### Primary (HIGH confidence)

- Direct code inspection: `hooks/pre-commit`, `hooks/pre-commit-schema-validate.js`, `hooks/pre-commit-vault-boundary.js` — established pattern confirmed by reading actual files
- `package.json` scripts section — `prepare` hook mechanism confirmed
- Live `jest --coverage` run (2026-04-26) — coverage stats confirmed: Stmts 94.32%, Branch 82.36%
- `.claude/agents/docs-sync.md` — existing agent confirmed as extension point
- `config/schema/` directory — schema pattern for threshold config confirmed

### Secondary (MEDIUM confidence)

- Node.js `child_process.execFileSync` docs (stdlib) — `execFileSync(cmd, argsArray)` pattern confirmed safe
- Git `core.hooksPath` behavior — standard git documentation; `post-merge` hook runs after successful non-fast-forward merge

### Tertiary (LOW confidence)

- Phase count extraction via regex on CLAUDE.md text — format subject to drift; marked LOW; git log approach preferred

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies present, no new installs, patterns established in codebase
- Architecture: HIGH — follows existing hook pattern exactly; agent extension is surgical
- Hook path issue: MEDIUM — open question requiring verification; documented as prerequisite
- Pitfalls: HIGH — all derived from direct code inspection of Phase 22 artifacts
- Agent blocking mechanism: MEDIUM — depends on GSD verifier pickup; recommended explicit shell script pickup

**Research date:** 2026-04-26
**Valid until:** 2026-05-26 (stable domain — jest and git hook behavior are not fast-moving)

# Phase 35: Proactive Memory - Research

**Researched:** 2026-07-21
**Domain:** Claude Code SessionStart hook injecting recalled memory into session context
**Confidence:** HIGH

## Summary

This phase wires a new `SessionStart` hook that shells to the existing `scripts/recall.js --hybrid`
CLI, gates the returned entries through the existing fail-closed `checkContent` egress loop (already
used by `src/reach-exporter.js`), caps the injected text at ~750 tokens, and prints it as hook stdout.
Every piece this phase needs already exists in the repo as a reusable building block — there is no new
subsystem to design, only a new thin hook file plus one new config block.

The one real design question is the injection mechanism: whether SessionStart hook stdout is shown to
the user only, or is actually fed into Claude's context as `additionalContext`. This determines whether
plain `process.stdout.write` (the `staleness-check.js` precedent) is sufficient or whether the hook must
emit the newer JSON hook-output contract. This is flagged as an Open Question — verify against the
current Claude Code hooks reference before implementation, since project docs favor "no fabricated
claims."

**Primary recommendation:** Clone the `staleness-check.js` file shape (pure function + `require.main`
guard, exit 0 always) and delegate all recall/gating logic to existing modules (`runRecall`,
`checkContent`, `loadExcludedTerms`, `voyage-health.isDegraded`) rather than reimplementing any of them.

## User Constraints

No CONTEXT.md exists for this phase at research time — no locked decisions to copy. Requirement IDs
are also unmapped for Phase 35 (`phase_req_ids: null` per ROADMAP traceability); the phase description
in ROADMAP.md itself is the only authoritative scope statement:

> SessionStart hook `.claude/hooks/session-memory-inject.js` (fail-open on infra, exit 0 always)
> shelling to `scripts/recall.js "<project-derived query>" --hybrid --top 5`, entries passed through
> the reach exporter's fail-closed `checkContent` egress loop; ~750-token hard cap; kill switch
> `sessionInject.enabled` + `SB_SESSION_INJECT=0`; latency gate (<1s Voyage-up, <250ms degraded).

## Project Constraints (from CLAUDE.md)

- No `console.log` in production code (`src/`) — ESLint-enforced. The hook itself lives under
  `.claude/hooks/`, which is not linted by the `src/`-scoped rule, but `process.stdout.write` (the
  `staleness-check.js` idiom) is the established convention there regardless — use it, not `console.log`.
- Config loading always validates against AJV schema (`loadConfigWithOverlay(name, {validate:true})`).
- CJS Node, no build step — the hook must be a plain `require()`-able `.js` file matching every other
  file in `.claude/hooks/`.
- Vault writes always check LEFT/RIGHT boundaries via `vault-gateway.js` — not applicable here, this
  phase only reads memory.md indirectly via `recall.js`/`runRecall`, no vault writes.
- Query text must never be persisted (content-policy exclusion precedent, STATS-OUTCOME-01) — the
  session-derived query is transient (used only to call `recall.js`), and must not be written to any
  cache/log file, matching the existing `recordRecallInvocation` discipline.
- Testing: Jest 30, CJS `require`, mirror `test/` structure — a hook test lives at
  `test/hooks/session-memory-inject.test.js` alongside the existing `test/hooks/*.test.js` /
  `test/staleness-check.test.js` pattern (pure-function tests against an exported function, not the
  CLI entry point).

## Standard Stack

### Core

No new dependencies. Every piece is first-party code already in this repo:

| Module | Purpose | Why reused, not rebuilt |
|--------|---------|--------------------------|
| `scripts/recall.js` / `src/recall-command.js` (`runRecall`) | Hybrid retrieval, hit/miss stats, degraded banners | Exact CLI contract this phase is required to shell to |
| `src/content-policy.js` (`checkContent`) | Fail-closed excluded-terms + Haiku classification gate | Same gate `reach-exporter.js` already uses at egress — phase description explicitly names it |
| `src/pipeline-infra.js` (`loadExcludedTerms`, `loadConfigWithOverlay`) | Load excluded-terms list + validated config | Standard config-loading convention across the repo |
| `src/utils/voyage-health.js` (`isDegraded`) | Detect Voyage degraded-mode window | Direct source for the "<1s Voyage-up, <250ms degraded" latency gate — no new health tracker needed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `dotenv` | already a dep | Load `.env` when invoked outside a normal session bootstrap | Only if the hook process doesn't inherit env; mirror `recall.js`'s `require('dotenv').config({ path: ... })` pattern since a SessionStart hook is a fresh child process, not guaranteed to have `.env` loaded |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shelling `recall.js` as a subprocess (per phase description) | `require('../src/recall-command').runRecall(...)` in-process | In-process avoids a second Node boot (~50-100ms) and env-loading duplication, but the phase description explicitly says "shelling to `scripts/recall.js`" — treat as a locked instruction, not a discretion area, since it's the only concrete architecture line in ROADMAP.md. Flagged in Open Questions for planner confirmation. |
| A new token-counting library (e.g. `tiktoken`) | `Math.ceil(text.length / 4)` heuristic | No tokenizer dependency exists anywhere in this repo; a chars/4 approximation is the existing-codebase-consistent choice for a "hard cap" that only needs to be roughly right, not exact (ponytail: this is an estimate, not a real tokenizer; upgrade only if truncation proves visibly wrong in practice) |

**Installation:** none — zero new packages.

## Architecture Patterns

### Recommended Project Structure

```
.claude/hooks/
├── session-memory-inject.js   # new: SessionStart hook, exports a pure function + require.main guard
└── staleness-check.js         # existing: the shape to clone exactly

src/
└── (no new src/ files needed — hook calls existing src/ modules directly)

config/
├── pipeline.json              # add `sessionInject` block (mirrors the `dream` block precedent)
└── schema/pipeline.schema.json # add matching schema entry, required + additionalProperties:false

test/hooks/
└── session-memory-inject.test.js   # new: pure-function tests, mirrors test/staleness-check.test.js
```

### Pattern 1: Pure-function-plus-CLI-guard hook shape

**What:** Export a pure/testable function; only run side effects (`process.stdout.write`,
`process.exit(0)`) inside `if (require.main === module) { ... }`.
**When to use:** Every SessionStart/PostToolUse hook in this repo already does this
(`staleness-check.js`). It lets Jest test the logic without spawning a child process.
**Example:**
```javascript
// Source: .claude/hooks/staleness-check.js (existing pattern in this repo)
if (require.main === module) {
  // ... side effects here, always process.exit(0) ...
}

module.exports = { checkStaleness }; // or buildSessionMemoryContext, etc.
```

### Pattern 2: Fail-open hook, fail-closed content gate

**What:** The hook's OWN infra failures (recall.js crash, no vault, no network) must never block
session start — always `exit 0`. But entries THAT DID come back must still separately pass the
fail-closed `checkContent` egress gate (any error/BLOCK from that gate excludes the entry, never
crashes the hook).
**When to use:** This is the exact split `reach-exporter.js` already implements: `runReachExport`
never throws to its caller (catches config/read errors and returns `{success:false, ...}`), while
each individual entry is separately gated fail-closed via `checkContent`.
**Example:**
```javascript
// Source: src/reach-exporter.js (existing fail-closed egress loop, reused as-is here)
const excludedTerms = loadExcludedTerms();
for (const entry of entries) {
  try {
    const verdict = await checkContent(`${entry.category} ${entry.content}`, excludedTerms);
    if (verdict.decision === 'PASS') digest.push(entry);
    else excluded++;
  } catch (err) {
    excluded++; // fail-closed on any throw
  }
}
```

### Pattern 3: Config kill switch with env override

**What:** A boolean config key (`sessionInject.enabled`) plus an env var override
(`SB_SESSION_INJECT=0`), checked before doing any work.
**When to use:** No exact `SB_*` env-var precedent exists yet in this repo (grepped — zero hits), so
this phase establishes the first one. Model it on the existing config-key-plus-schema convention
(the `dream.enabled` boolean in `config/pipeline.json` + `config/schema/pipeline.schema.json`), and
treat the env var as a pure short-circuit checked first (cheapest, no config load needed to disable).
**Example:**
```javascript
// New pattern for this phase — no direct repo precedent for the env half.
if (process.env.SB_SESSION_INJECT === '0') return { skipped: true, reason: 'env override' };
const config = loadConfigWithOverlay('pipeline', { validate: true });
if (!config.sessionInject || config.sessionInject.enabled === false) {
  return { skipped: true, reason: 'config disabled' };
}
```

### Anti-Patterns to Avoid

- **Reimplementing the excluded-terms gate:** don't hand-roll a second `checkContent`-alike inside
  the hook — call the existing one. Two divergent content-policy implementations is exactly the kind
  of drift ADR-019/ADR-020 already exist to prevent.
- **Blocking session start on Voyage latency:** the phase description gives explicit latency gates
  (<1s up, <250ms degraded) — treat these as a "skip injection, don't hang the session" circuit
  breaker, not a retry loop. `voyage-health.isDegraded()` already tells you which threshold applies
  before you even attempt the call.
- **Persisting the derived query:** don't log/cache the project-derived query string anywhere
  (matches the `recordRecallInvocation` STATS-OUTCOME-01 precedent of "query text is never persisted").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Excluded-terms / content-policy gating | A new regex/keyword scanner in the hook | `checkContent()` from `src/content-policy.js` | Already Unicode-normalized (NFKD, Phase 25), already Haiku-escalates ambiguous matches, already the exact gate the phase description names |
| Voyage degraded-mode detection | A new health-check ping to Voyage | `isDegraded()` from `src/utils/voyage-health.js` | Cross-invocation state already tracked in `~/.cache/second-brain/voyage-health.json`; `hybridSearch`/`semanticSearch` already set `degraded:true` on the result when this fires, so the hook can just read `res.degraded` off `runRecall`'s return value instead of querying voyage-health directly |
| Hybrid/keyword retrieval + fallback | A second search implementation | `runRecall(argv)` from `src/recall-command.js` (via `scripts/recall.js` per the phase's own architecture line) | Already handles hybrid→keyword degradation, `--top N`, category/since filters, and returns a structured `{results, degraded, blocked, ...}` envelope |
| Config validation | Ad hoc `JSON.parse` + manual checks | `loadConfigWithOverlay('pipeline', {validate:true})` | AJV schema validation, `.local.json` overlay, `CONFIG_DIR_OVERRIDE` test-isolation hatch all come for free |

**Key insight:** This phase is pure integration glue over four already-hardened modules. The only
genuinely new code is: the hook's thin orchestration logic, the project-query derivation, the
token-cap/truncation, and the new config block. Everything else is a `require()`.

## Common Pitfalls

### Pitfall 1: SessionStart hook stdout may not reach Claude's context at all

**What goes wrong:** The hook is built to "inject" memory into context, but if the current hooks
contract only surfaces SessionStart stdout as a transcript/UI message (not as `additionalContext`
fed to the model), the whole feature silently does nothing useful even though it "works."
**Why it happens:** The `staleness-check.js` precedent in this repo only ever prints a warning
message for the human to read — it was never verified against a "the model actually sees this" bar.
**How to avoid:** Before finalizing the hook's output contract, verify (fresh docs check, not
training-data assumption) whether SessionStart hooks in the currently-installed Claude Code version
support a JSON output shape (e.g. `{"hookSpecificOutput": {"additionalContext": "..."}}`) versus
plain stdout. This wasn't confirmed during this research pass — flagged as an Open Question below.
**Warning signs:** Feature ships, tests pass, but Claude never references the injected memories in
practice.

### Pitfall 2: Double-counting `/recall` stats

**What goes wrong:** `runRecall` (non-internal calls) increments `recall_hits`/`recall_count` in
daily-stats by default. A background session-start recall would inflate those counters with
automatic, not user-initiated, invocations — corrupting the STATS-OUTCOME-01 signal the same way
Memory Echo's automatic morning hit would have, if it hadn't been explicitly suppressed.
**Why it happens:** `runRecall(argv, options)` already has an `_internal: true` flag built for
exactly this case (Memory Echo uses the direct search functions instead, but the flag exists as "an
explicit gate for any future internal callers" per its own doc comment).
**How to avoid:** If this phase ends up calling `runRecall` in-process, pass `{_internal: true}`. If
it shells out to `scripts/recall.js` per the phase's literal architecture line, note that the CLI has
no flag to pass `_internal` through — this is a real gap between "shell to recall.js" and "don't
double-count stats." Flagged as an Open Question.
**Warning signs:** `recall_hits`/`recall_count` in `daily-stats.md` jump on every session start,
diluting the compounding-trend verdict from Phase 31.

### Pitfall 3: Token-cap truncation cutting mid-entry

**What goes wrong:** A naive `text.slice(0, capChars)` can cut a memory entry mid-sentence,
producing garbled/confusing injected context.
**Why it happens:** The ~750-token cap is a hard byte/char budget, but entries are discrete
markdown bullets (`- **date · category** — content`, per `reach-exporter.js`'s `renderReachFile`
digest format) — truncating mid-entry is worse than dropping the last entry outright.
**How to avoid:** Accumulate whole entries until the next one would exceed the cap, then stop (drop
the remainder), rather than slicing the final string. This mirrors `reach-exporter.js`'s own
`digestMax` (count-based cap, not char-based) — for a token-based budget, greedily add whole entries
and stop before overflow.
**Warning signs:** Injected context ends with a half-sentence or an orphaned markdown bullet.

### Pitfall 4: Project-derived query is undefined/ambiguous

**What goes wrong:** "project-derived query" isn't defined anywhere in ROADMAP.md, REQUIREMENTS.md,
or existing code — there's no existing helper that turns "current project" into a recall query
string.
**Why it happens:** No prior phase needed to derive a query from ambient session context; every
existing `/recall` invocation takes an explicit user-typed query.
**How to avoid:** The most defensible, cheapest derivation available today: `path.basename(cwd)` (or
`CLAUDE_PROJECT_DIR` basename) as the query string — e.g. `second-brain` when run from this repo.
Richer derivations (reading `.planning/STATE.md`'s "Current Position" phase name, or the git branch
name) are possible but add file-reads and parsing the hook doesn't strictly need. Flagged as an Open
Question / Claude's-discretion item for the planner, since no CONTEXT.md exists to lock this down.
**Warning signs:** Query is too generic (returns irrelevant results) or too narrow (returns nothing).

## Runtime State Inventory

Not applicable — this is a net-new hook/config addition, not a rename/refactor/migration phase.

## Code Examples

### Reading recall.js's structured result instead of parsing CLI stdout

```javascript
// Source: src/recall-command.js (runRecall return shape) — if the planner
// chooses in-process invocation over literal subprocess shelling
const { runRecall } = require('../../src/recall-command');
const result = await runRecall([query, '--hybrid', '--top', '5'], { _internal: true });
// result.results: Array<{rank, category, snippet, sourceRef, date, score, contentHash}>
// result.degraded: boolean — hybrid fell back to keyword-only
// result.blocked: boolean — the query itself was excluded-terms-blocked
```

### Fail-closed content gate reuse (exact call shape reach-exporter.js already uses)

```javascript
// Source: src/reach-exporter.js
const { checkContent } = require('../../src/content-policy');
const { loadExcludedTerms } = require('../../src/pipeline-infra');

const excludedTerms = loadExcludedTerms();
const verdict = await checkContent(`${entry.category} ${entry.content}`, excludedTerms);
if (verdict.decision !== 'PASS') { /* exclude, never throw */ }
```

### Degraded-mode check before attempting the call

```javascript
// Source: src/utils/voyage-health.js
const voyageHealth = require('../../src/utils/voyage-health');
const latencyBudgetMs = voyageHealth.isDegraded() ? 250 : 1000;
```

## State of the Art

Not applicable in the "deprecated vs current" sense — no prior version of this feature exists in the
repo. The closest structural precedent (`reach-exporter.js`'s pointer+digest cache) is itself current
(shipped v1.6, still the live mechanism).

## Open Questions

1. **Does a SessionStart hook's stdout actually reach Claude's context, or only the human-visible
   transcript?**
   - What we know: `staleness-check.js` prints to stdout and is registered in `.claude/settings.json`
     under `SessionStart`; it works as a human-visible warning today.
   - What's unclear: whether "proactive memory injection" (making Claude itself aware of the recalled
     entries) requires a different, JSON-shaped hook output than plain stdout text.
   - Recommendation: verify against current Claude Code hook documentation before finalizing the
     hook's output format — this is a training-data-staleness risk area (hook contracts evolve), not
     something to assume from precedent alone.

2. **"Shell to `scripts/recall.js`" vs. in-process `runRecall` call — which does the planner want?**
   - What we know: the ROADMAP phase description literally says "shelling to `scripts/recall.js`".
   - What's unclear: shelling out loses the ability to pass `{_internal: true}` (stats-double-count
     risk, Pitfall 2) and costs a second Node boot inside a latency-gated (<1s/<250ms) path.
   - Recommendation: surface this tension explicitly at plan time — either shell out and add a
     `--internal`-style CLI flag to `recall.js`/`runRecall`'s argv parsing to suppress stats, or get
     sign-off to call `runRecall` in-process instead (still requiring an env/`.env` load, matching
     the `recall.js` entry-point convention, since a SessionStart hook process may not inherit dotenv).

3. **What exactly is a "project-derived query"?**
   - What we know: no existing helper derives one; cwd/branch/phase-name are all plausible sources.
   - What's unclear: which source is cheapest+most relevant; whether it should combine multiple
     signals (e.g. project name + current GSD phase name from `.planning/STATE.md`).
   - Recommendation: start with `path.basename(process.env.CLAUDE_PROJECT_DIR || process.cwd())` —
     zero extra file reads, matches the "lazy version, question in the same response" bias — and
     let the planner decide if session-state-derived enrichment is worth the added complexity.

## Sources

### Primary (HIGH confidence — read directly from this repo during research)
- `.claude/hooks/staleness-check.js` — existing SessionStart hook shape (pure function + require.main guard, exit 0 always)
- `.claude/settings.json` — hook registration format (`SessionStart` → `hooks[].command`)
- `scripts/recall.js`, `src/recall-command.js` — recall.js CLI contract, `runRecall` return shape, `_internal` flag
- `src/reach-exporter.js` — `checkContent` fail-closed egress-loop usage pattern (exact precedent named in the phase description)
- `src/content-policy.js` (`checkContent`, lines 236+) — signature `checkContent(content, excludedTerms, contextChars=100)`
- `src/utils/voyage-health.js`, `src/utils/classifier-health.js` — degraded-mode / health-tracker pattern (Pattern 7 Adaptive Denial Tracking)
- `src/pipeline-infra.js` (`loadConfigWithOverlay`, `loadExcludedTerms`) — config loading + AJV validation convention
- `config/pipeline.json`, `config/schema/pipeline.schema.json` — existing `dream`/`memory`/`memoryHealth` boolean-flag config-block precedent
- `hooks/pre-commit-schema-validate.js` — confirms schema validation is generic over `config/*.json` by basename match (no hook-registration change needed for a new `sessionInject` block)
- `test/staleness-check.test.js`, `test/hooks/` — hook testing convention (pure-function assertions, no subprocess spawning)

### Secondary (MEDIUM confidence)
- None — no external/WebSearch sources were needed; every fact traces to a file read in this repo.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency is an existing, already-tested repo module; zero new packages
- Architecture: HIGH — directly cloned from two live precedents (`staleness-check.js` hook shape, `reach-exporter.js` fail-closed gate loop)
- Pitfalls: MEDIUM — Pitfall 1 (hook-output contract) is flagged LOW-confidence-until-verified since it depends on the currently-installed Claude Code hooks behavior, which this research pass did not independently verify against live docs

**Research date:** 2026-07-21
**Valid until:** 30 days (stable internal APIs); re-verify the SessionStart hook-output contract (Open Question 1) against current Claude Code docs specifically, since that is the one externally-versioned dependency in this phase

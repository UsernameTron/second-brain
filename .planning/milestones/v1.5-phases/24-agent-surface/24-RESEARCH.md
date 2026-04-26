# Phase 24: Agent Surface — Research

**Researched:** 2026-04-26
**Domain:** Claude Code agent authoring, Node.js daily-stats parsing, briefing-renderer extension
**Confidence:** HIGH

---

## Summary

Phase 24 delivers two independent capabilities that share no code between them: (1) an upgrade to the `test-verifier` agent so it reports a pass/fail verdict for each REQ-ID at phase-close time rather than a bulk test count, and (2) a memory health monitor that reads `daily-stats.md` rows and injects an anomaly alert section into the `/today` briefing when thresholds are breached.

Both capabilities extend existing surfaces rather than building new ones. The `test-verifier` agent already exists at `.claude/agents/test-verifier.md` and has a clean output contract — the only change is adding a REQ-ID sub-check protocol to its instructions. The `/today` briefing pipeline already conditionally renders optional sections (see the `_renderMemoryEchoSection` / Memory Echo pattern in `src/today/briefing-renderer.js`) — the memory health section follows exactly that pattern.

The Phase 22 hook infrastructure and Phase 23 doc-sync patterns are the direct precedents. Both show how to add a new behavioral mode to an existing agent without replacing it, and how to surface conditional content in the briefing without breaking the `briefing-is-the-product` invariant.

**Primary recommendation:** Implement AGENT-VERIFY-01 as a surgical expansion of the existing `test-verifier` agent's instruction set. Implement AGENT-MEMORY-01 as a new `src/today/memory-health.js` module + a conditional section injection at the bottom of `renderBriefing()`. No new npm dependencies needed for either requirement.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AGENT-VERIFY-01 | Requirement-level auto-verification expands `test-verifier` to spawn parallel sub-checks per REQ-ID at phase-close time, covering full requirements surface | Existing agent at `.claude/agents/test-verifier.md` is the foundation; sub-check protocol is an instruction-set addition, not a code change; PLAN.md REQ-ID list is the input source |
| AGENT-MEMORY-01 | Memory health monitor reads `daily-stats.md` counters and surfaces anomaly alerts in `/today` briefing when zero promotions 3+ days, backlog growth, recall usage drop, or vault plateau | `readDailyStats()` in `src/daily-stats.js` is the parsing API; `_renderMemoryEchoSection()` in `src/today/briefing-renderer.js` is the conditional-section precedent; `runToday()` in `src/today-command.js` is the injection point |

</phase_requirements>

---

## Standard Stack

### Core (all already in the project — no new dependencies)

| Component | Current Location | Purpose in Phase 24 |
|-----------|-----------------|---------------------|
| Claude Code agent (`.md` frontmatter) | `.claude/agents/test-verifier.md` | AGENT-VERIFY-01: extended with per-REQ-ID sub-check protocol |
| `readDailyStats()` | `src/daily-stats.js` | AGENT-MEMORY-01: parse `RIGHT/daily-stats.md` rows for anomaly detection |
| `renderBriefing()` | `src/today/briefing-renderer.js` | AGENT-MEMORY-01: inject memory health section using Memory Echo pattern |
| `runToday()` | `src/today-command.js` | AGENT-MEMORY-01: call memory health check and pass result to renderer |
| `config/pipeline.json` | project root | AGENT-MEMORY-01: store anomaly thresholds under new `memoryHealth` key |
| AJV schema | `config/pipeline.schema.json` | AGENT-MEMORY-01: add schema definition for `memoryHealth` config block |
| Jest 30 | devDependencies | Test coverage for `src/today/memory-health.js` |
| `gray-matter` | dependencies | Already used by `readDailyStats()` — no additional require |

### No New Dependencies

Both requirements are implemented using Node.js stdlib + already-present project libraries. Do not introduce new npm packages.

---

## Architecture Patterns

### Pattern 1: Agent Instruction-Set Extension (AGENT-VERIFY-01)

**What:** The `test-verifier` agent receives a new behavioral mode that triggers when invoked with a phase number or a list of REQ-IDs. In this mode it maps each REQ-ID to a test file or test name pattern, runs targeted Jest checks, and emits a per-ID verdict table.

**Precedent:** `docs-sync.md` Phase-Closure Audit Mode — same agent, two modes, mode triggered by invocation phrasing.

**Agent file change:** Add a `## Phase-Closure Verification Mode` section to `.claude/agents/test-verifier.md`. The section describes:
1. Invocation trigger: phrasing includes "phase", "REQ-ID", or "requirement verification"
2. Input: planner reads REQ-IDs from `.planning/phases/NN-name/NN-PLAN.md` files
3. Per-ID sub-check: for each REQ-ID, find the corresponding test file(s) via `grep -r "REQ-ID\|req-id\|requirement"` in `test/` and run them in isolation
4. Output: structured verdict table (one row per REQ-ID) + overall PASS/FAIL

**How the agent finds REQ-ID → test mapping:**

The agent should grep test files for the REQ-ID string. Project convention is to document the requirement being tested in a comment at the top of each test file (already present in several files, e.g., Phase 22/23 tests have headers naming the requirement). If no test file references the REQ-ID, the sub-check verdict is `UNTESTED` (not PASS), which is a meaningful signal.

```
# Agent sub-check loop (described in agent instructions, not shell code):
for each REQ_ID in phase_requirements:
  files = grep -rl "$REQ_ID" test/
  if files is empty:
    verdict[REQ_ID] = UNTESTED
  else:
    run: npx jest $files --no-coverage --silent
    verdict[REQ_ID] = PASS if exit 0 else FAIL
```

**Output format:**

```
Phase-Close Verification Report
================================
Phase: 24 — Agent Surface
REQ-IDs checked: 2

| REQ-ID          | Test File(s)                        | Verdict  |
|-----------------|-------------------------------------|----------|
| AGENT-VERIFY-01 | test/agents/test-verifier.test.js   | PASS     |
| AGENT-MEMORY-01 | test/today/memory-health.test.js    | PASS     |

Overall: PASS (2/2 requirements verified)
```

**Anti-pattern to avoid:** Do not attempt to infer requirement → test mappings from test names alone. Grep for the REQ-ID string is the reliable path.

---

### Pattern 2: Conditional Briefing Section (AGENT-MEMORY-01)

**What:** A new `src/today/memory-health.js` module computes a health verdict from `daily-stats.md` rows. `runToday()` calls it after `_getPipelineState()` and passes the result to `renderBriefing()`. The renderer conditionally includes a `## Memory Health` section — present only when at least one anomaly condition is met.

**Precedent:** Memory Echo section in `briefing-renderer.js`:

```javascript
// From src/today/briefing-renderer.js (lines 314-316)
...(memoryEchoBody !== null ? ['## Memory Echo', '', memoryEchoBody, ''] : []),
```

This is exactly the pattern to follow. When `memoryHealthBody` is `null`, the section heading is also absent. No false alerts.

**Module interface for `src/today/memory-health.js`:**

```javascript
/**
 * Compute memory health verdict from daily-stats rows.
 * Returns null when no anomaly is detected (section is suppressed).
 * Returns a markdown string body when any anomaly is met.
 *
 * @param {Array<object>} rows - parsed from readDailyStats(), ascending date order
 * @param {object} thresholds - from config.memoryHealth
 * @returns {string|null}
 */
function computeMemoryHealth(rows, thresholds) { ... }
```

**Anomaly conditions (from AGENT-MEMORY-01 spec):**

| Condition | Signal | Default Threshold | Data Source |
|-----------|--------|-------------------|-------------|
| Zero-promotion streak | `promotions` column = 0 for N consecutive days | 3 days | `daily-stats.md` rows |
| Backlog growth trend | `proposals` increasing across last N rows with no matching `promotions` increase | 3 consecutive increases | `daily-stats.md` rows |
| Recall usage drop | `recall_count` = 0 for N consecutive days | 3 days | `daily-stats.md` rows |
| Vault plateau | `total_entries` unchanged across last N rows | 3 days | `daily-stats.md` rows |

**Important edge cases:**
- Fewer than 3 rows: return `null` (not enough history to detect a trend)
- Missing column value (cell is `—` or empty): treat as `0` for numeric comparisons
- `daily-stats.md` does not exist: `readDailyStats()` already returns `{ rows: [] }` — handle gracefully by returning `null`
- Failure in `computeMemoryHealth()` must NEVER break the briefing — wrap in try/catch in `runToday()`, fallback to `null`

**Config block to add to `config/pipeline.json`:**

```json
"memoryHealth": {
  "enabled": true,
  "streakDays": 3
}
```

**AJV schema addition** (in `config/pipeline.schema.json`):

```json
"memoryHealth": {
  "type": "object",
  "properties": {
    "enabled": { "type": "boolean" },
    "streakDays": { "type": "integer", "minimum": 1, "maximum": 30 }
  },
  "additionalProperties": false
}
```

**Injection point in `runToday()`:**

After `_getPipelineState()` and before `renderBriefing()`, add:

```javascript
let memoryHealth = null;
try {
  if (config && config.memoryHealth && config.memoryHealth.enabled !== false) {
    const { computeMemoryHealth } = require('./today/memory-health');
    const { readDailyStats } = require('./daily-stats');
    const statsAbsPath = path.join(vaultRoot, config.stats.path || 'RIGHT/daily-stats.md');
    const { rows } = readDailyStats(statsAbsPath);
    memoryHealth = computeMemoryHealth(rows, config.memoryHealth);
  }
} catch (_) { /* non-fatal — briefing-is-the-product */ }
```

Pass `memoryHealth` to `renderBriefing()` and follow the Memory Echo pattern inside the renderer.

---

### Recommended Project Structure Changes

```
src/
├── today/
│   ├── memory-health.js        # NEW — anomaly detector for AGENT-MEMORY-01
│   ├── briefing-renderer.js    # MODIFIED — add conditional ## Memory Health section
│   ├── slippage-scanner.js     # unchanged
│   ├── frog-identifier.js      # unchanged
│   └── llm-augmentation.js     # unchanged
├── today-command.js            # MODIFIED — call memory-health, pass to renderer
.claude/agents/
├── test-verifier.md            # MODIFIED — add Phase-Closure Verification Mode section
config/
├── pipeline.json               # MODIFIED — add memoryHealth block
├── pipeline.schema.json        # MODIFIED — add memoryHealth schema
test/
├── today/
│   └── memory-health.test.js   # NEW — unit tests for computeMemoryHealth()
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parsing `daily-stats.md` | Custom markdown parser | `readDailyStats()` from `src/daily-stats.js` | Already handles frontmatter, GFM table parsing, missing file, parse errors |
| Test suite runner | Shell script | `npx jest <files>` (agent instruction) | Jest already handles parallelism, output parsing; agent invokes it |
| Config validation | Manual checks | AJV + existing `pipeline.schema.json` | Schema already wired into `loadConfigWithOverlay`; add new key there |
| Atomic vault write | `fs.writeFileSync` | `vaultWriteAtomic()` from `vault-gateway.js` | Pattern 11 — all vault writes go through this; LEFT/RIGHT enforcement is implicit |

**Key insight:** This phase adds behavior to existing surfaces, not new infrastructure. The Memory Echo section in the briefing renderer is the direct implementation template — copy its null-guard pattern, not a custom approach.

---

## Common Pitfalls

### Pitfall 1: Memory Health Alert on Sparse Data

**What goes wrong:** `computeMemoryHealth()` returns an alert on day 1 or 2 when the user simply hasn't run `/today` enough times yet (fewer than `streakDays` rows exist).

**Why it happens:** Checking for N consecutive zero-promotion days when the table only has 1 row always finds a streak of 1.

**How to avoid:** Gate the entire anomaly check on `rows.length >= thresholds.streakDays`. Return `null` immediately if fewer rows exist. Document this in the function's JSDoc.

**Warning signs:** Tests showing alerts after only 1 row of data in the fixture.

---

### Pitfall 2: Breaking the Briefing on Stats File Absence

**What goes wrong:** `readDailyStats()` is called before the stats file exists (first time running `/today`). An unguarded call throws ENOENT or returns unexpected shape.

**Why it happens:** `readDailyStats()` already handles ENOENT gracefully (returns `{ frontmatter: null, rows: [] }`), but callers that don't handle the empty-rows case will still misbehave.

**How to avoid:** The `computeMemoryHealth()` function must handle `rows.length === 0` by returning `null`. The `runToday()` injection point wraps the entire call in try/catch. Both guards are needed.

**Warning signs:** Tests with empty stats fixture failing differently than expected.

---

### Pitfall 3: Agent Mode-Switching via Phrasing Only

**What goes wrong:** The `test-verifier` agent's Phase-Closure Verification Mode is triggered by any prompt containing "phase" — including casual mentions like "let's check the phase 22 tests."

**Why it happens:** If the mode trigger is a single keyword, false activation is common.

**How to avoid:** In the agent instructions, require a specific invocation pattern: `"phase-close <N>"` or `"verify requirements: REQ-ID1, REQ-ID2"`. Keyword-only triggers are too loose. Document the canonical invocation in the agent's output section.

---

### Pitfall 4: REQ-ID Grep Finds False Positives in Non-Test Files

**What goes wrong:** `grep -rl "AGENT-VERIFY-01" test/` returns fixture files, snapshot files, or this RESEARCH.md — not actual test files.

**Why it happens:** REQ-IDs are strings; they appear in planning documents, snapshots, comments, and fixture JSON.

**How to avoid:** Scope the grep to `*.test.js` files only: `grep -rl "AGENT-VERIFY-01" test/ --include="*.test.js"`. Document this in the agent's sub-check instructions.

---

### Pitfall 5: Modifying `renderBriefing()` Signature

**What goes wrong:** Adding `memoryHealth` to `renderBriefing()` as a required parameter breaks the dozen existing callers in test files that call `renderBriefing()` directly.

**Why it happens:** Callers don't pass `memoryHealth` because they were written before the parameter existed.

**How to avoid:** Follow the Memory Echo precedent exactly — `memoryEcho` is passed as a property of the `data` object, and `_renderMemoryEchoSection()` guards with `if (!memoryEcho || ...)`. Add `memoryHealth` the same way: destructure from `data`, default to `null` if absent. No signature breakage.

---

## Code Examples

### Conditional Section in Renderer (verified pattern from briefing-renderer.js)

```javascript
// Source: src/today/briefing-renderer.js:314-316
...(memoryEchoBody !== null ? ['## Memory Echo', '', memoryEchoBody, ''] : []),

// Phase 24 addition — same pattern:
...(memoryHealthBody !== null ? ['## Memory Health', '', memoryHealthBody, ''] : []),
```

### readDailyStats Usage (verified from daily-stats.js)

```javascript
// Source: src/daily-stats.js:77-125
// Returns { frontmatter: null, rows: [] } when file missing — always safe to call.
const { rows } = readDailyStats(absPath);
// rows is always an array; each row: { date, proposals, promotions, total_entries, memory_kb, recall_count, ... }
```

### Non-Fatal Wrapper Pattern (verified from runToday)

```javascript
// Source: src/today-command.js:233-237
let memoryEcho;
try {
  memoryEcho = await getMemoryEcho(connectorResults, { threshold: echoThreshold });
} catch (_err) {
  memoryEcho = { entries: [], score: 0, skipped: true };
}

// Phase 24 equivalent for memory health:
let memoryHealth = null;
try {
  // ... computeMemoryHealth call
} catch (_) { /* non-fatal */ }
```

### Agent Dual-Mode Pattern (verified from docs-sync.md)

```markdown
## Phase-Closure Verification Mode

Activated when invoked with "phase-close N", "verify requirements", or a list of REQ-IDs.

In this mode:
1. For each REQ-ID: grep -rl "$REQ_ID" test/ --include="*.test.js"
2. If no files found: verdict = UNTESTED
3. If files found: run npx jest <files> --no-coverage --silent; verdict = PASS/FAIL based on exit code
4. Emit verdict table (see Output Format)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-pass full-suite verdict | Per-requirement targeted Jest sub-checks | Phase 24 (new) | Gives actionable signal per REQ-ID rather than "all tests pass" |
| Memory health: manual review of stats file | Automated anomaly detection in daily briefing | Phase 24 (new) | Surfaces data quality problems before they compound |
| `renderBriefing()` with fixed sections | Conditional optional sections (Memory Echo pattern) | Phase 18 | Phase 24 follows the same extension point |

**Relevant precedents from this project:**

- **Memory Echo (Phase 18):** Established the conditional briefing section pattern. Phase 24 is the second consumer of this pattern.
- **docs-sync Phase-Closure Audit Mode (Phase 23):** Established the agent dual-mode pattern. Phase 24 applies the same approach to `test-verifier`.
- **`readDailyStats()` (Phase 20):** The parsing API already supports multi-row history needed for trend detection.

---

## Open Questions

1. **Where does the `test-verifier` get the REQ-ID list?**
   - What we know: The planner will document REQ-IDs in PLAN.md files. The agent currently has no structured way to ingest them.
   - What's unclear: Should the planner pass REQ-IDs inline in the invocation, or should the agent read them from a PLAN.md file?
   - Recommendation: Invocation phrasing. The orchestrator (human or GSD) passes `"verify requirements: AGENT-VERIFY-01, AGENT-MEMORY-01"` — the agent parses the inline list. This keeps the agent self-contained. Document the canonical invocation format in the agent file.

2. **Memory health: what's the right `## Memory Health` section position in the briefing?**
   - What we know: Current sections are: Meetings, VIP Emails, Slippage, Frog, (Memory Echo if entries), GitHub, Pipeline.
   - Recommendation: Insert Memory Health after Pipeline (at the end) so anomaly alerts don't interrupt the decision-making flow of the briefing. The alert is housekeeping, not primary signal.

3. **Should `streakDays` be configurable per condition or global?**
   - Recommendation: Global `streakDays` applies to all four conditions. Adding per-condition thresholds adds config surface without meaningful benefit — the spec defines all four conditions with the same "3+ days" trigger.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is code/config changes only. No external CLIs, services, or databases are introduced. All dependencies (Node.js, Jest, AJV, gray-matter) are already present in the project.

---

## Sources

### Primary (HIGH confidence)

- `src/today/briefing-renderer.js` — Memory Echo conditional section pattern (lines 174-185, 314-316): confirmed implementation template
- `src/daily-stats.js` — `readDailyStats()` API and column schema (lines 77-125, 56-65): confirmed parsing substrate
- `src/today-command.js` — `runToday()` injection point and non-fatal wrapper pattern (lines 232-237, 296-334): confirmed integration site
- `.claude/agents/test-verifier.md` — existing agent contract, output format, constraint list: confirmed extension baseline
- `.claude/agents/docs-sync.md` — dual-mode agent pattern (Phase-Closure Audit Mode section): confirmed template for AGENT-VERIFY-01
- `config/pipeline.json` — existing config shape: confirmed schema extension site
- `.planning/REQUIREMENTS.md` — AGENT-VERIFY-01 and AGENT-MEMORY-01 exact specification text

### Secondary (MEDIUM confidence)

- `.planning/phases/23-doc-sync-layer/23-RESEARCH.md` — Phase 23 precedents confirmed at research time; agent extension pattern is established

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components are already present; no new dependencies
- Architecture: HIGH — both patterns (conditional section, dual-mode agent) are verified from existing code
- Pitfalls: HIGH — derived from direct code inspection of call sites and edge cases in the existing stats parser

**Research date:** 2026-04-26
**Valid until:** Stable — no external dependencies; valid until project source changes

---

## Project Constraints (from CLAUDE.md)

The following directives from `CLAUDE.md` apply to this phase:

- **No `console.log` in production code** — `memory-health.js` must use no console output; errors must be silent (wrapped in try/catch in `runToday()`)
- **All errors explicitly handled** — no unhandled promise rejections; every failure path falls back gracefully
- **Config loading always validates against AJV schema** — the new `memoryHealth` config block must have a corresponding schema entry in `pipeline.schema.json`
- **Vault writes always check LEFT/RIGHT boundaries via `vault-gateway.js`** — N/A for this phase (memory-health is read-only)
- **Single-responsibility modules in `src/today/`** — `memory-health.js` should contain only anomaly detection; rendering logic stays in `briefing-renderer.js`
- **Pattern 12: Lazy requires** — any requires inside `memory-health.js` or the `runToday()` injection site should follow the lazy-require pattern (inside function body, not top-level) to avoid side effects at require-time
- **Coverage >= 80% per module** — `test/today/memory-health.test.js` must cover the anomaly conditions and edge cases (no rows, sparse rows, all-normal rows)

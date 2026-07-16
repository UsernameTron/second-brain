---
phase: 31
reviewers: [gemini, claude]
reviewed_at: 2026-07-16T09:06:35Z
plans_reviewed: [31-01-PLAN.md, 31-02-PLAN.md, 31-03-PLAN.md]
notes: codex CLI failed locally (missing native binary, ENOENT) — excluded
---

# Cross-AI Plan Review — Phase 31

## Gemini Review

Here is a review of the implementation plans for Phase 31.

## Overall Assessment

The three plans for Phase 31 are exceptionally well-designed, clear, and technically sound. They present a logical progression from building a core, testable engine to integrating it into two distinct surfaces. The emphasis on purity, precedent, and resilience minimizes risk and ensures the final implementation will be robust and maintainable. The plans directly and completely address the phase requirements (TREND-01, TREND-02) and are ready for execution.

---

### Plan Review: `31-01-PLAN.md`

1.  **Summary**
    This plan outlines a TDD approach to create the core of the feature: two pure, I/O-free functions. `computeCompoundingTrend` will encapsulate the business logic for determining the verdict, and `renderCompoundingReport` will handle the markdown presentation. This foundational plan enables the other two plans.

2.  **Strengths**
    *   **Purity and Testability:** The strict requirement for pure functions with no I/O is a major strength. It isolates the complex business logic, making it easy to unit test with synthetic data, as mandated by the TDD approach.
    *   **Clarity of Specification:** The algorithm for calculating the verdict is specified with unambiguous, step-by-step instructions and literal threshold values, eliminating guesswork.
    *   **Consistency:** The plan wisely directs the implementation to mirror existing patterns from `memory-health.js` and `daily-stats.js`, ensuring the new code aligns with the established style of the codebase.
    *   **Comprehensive Test Cases:** The `<behavior>` section lists a thorough set of test cases, covering the primary success path, each failure condition, and important edge cases like insufficient data and malformed cell values.

3.  **Concerns**
    *   None. This plan is exemplary.

4.  **Suggestions**
    *   No improvements are necessary. The plan is robust and clear.

5.  **Risk Assessment**
    *   **LOW.** The risk is minimal. The work is contained in new files, preventing regression in existing code. The TDD approach and the purity of the functions ensure the logic can be validated completely before it is integrated elsewhere.

---

### Plan Review: `31-02-PLAN.md`

1.  **Summary**
    This plan details the integration of the trend analysis into the critical `/today` command. It focuses on safely computing the trend and conditionally displaying a new `## Compounding` section in the daily briefing, suppressing it when data is insufficient.

2.  **Strengths**
    *   **Resilience:** The plan correctly prioritizes the stability of the daily briefing. By wrapping the new logic in a non-fatal `try/catch` block, it ensures that any unforeseen errors in the trend calculation will not prevent the user from receiving their briefing.
    *   **Adherence to Precedent:** The implementation is designed to explicitly mirror the existing, proven pattern for the "Memory Health" section. This includes the lazy-require pattern, the null-suppression logic for rendering, and the overall flow, which is excellent for consistency.
    *   **Clear Separation of Concerns:** The plan maintains a clean architecture by having `today-command.js` handle data fetching and orchestration, while passing the final rendered body to `briefing-renderer.js` for simple presentation.

3.  **Concerns**
    *   **(LOW) Redundant File Read:** The plan explicitly calls for a second, independent read of `daily-stats.md`, separate from the one for "Memory Health". While this introduces a minor I/O redundancy, the performance impact is negligible for the expected file size. The benefit of implementation simplicity and total isolation of the new feature from the existing one justifies this trade-off.

4.  **Suggestions**
    *   No changes are recommended. The plan is safe, clear, and follows best practices established within the project.

5.  **Risk Assessment**
    *   **LOW.** The risk of impacting the critical `/today` command is effectively mitigated by making the new feature non-fatal and isolating its logic. The testing strategy, which verifies both the appearance and suppression of the section, provides a strong safety net.

---

### Plan Review: `31-03-PLAN.md`

1.  **Summary**
    This plan covers the creation of a standalone `scripts/compounding-report.js` CLI. This script will provide an on-demand way to view the compounding report, reusing the core logic from Plan 01 but with slightly different presentation rules suitable for a dedicated report.

2.  **Strengths**
    *   **Code Reusability:** The plan correctly leverages the `computeCompoundingTrend` and `renderCompoundingReport` functions, ensuring the verdict and presentation are consistent with the `/today` command, which is a key success criterion.
    *   **Robust Scripting Practices:** It follows the established pattern from `scripts/recall.js` for its structure, including the shebang, strict mode, and project-root-aware `dotenv` configuration. This makes the script reliable and easy to maintain.
    *   **Context-Appropriate Behavior:** The plan astutely specifies that, unlike the `/today` section, the CLI should *always* print the evidence table, even for an "insufficient-data" verdict. This is the correct choice for an analytical tool versus a summary briefing.
    *   **Test Coverage:** The inclusion of a smoke test to validate that the script executes successfully and produces the expected output is a good practice for ensuring the CLI remains functional.

3.  **Concerns**
    *   None. The plan is solid.

4.  **Suggestions**
    *   For enhanced diagnostics, consider adding a `console.warn` message to `stderr` within the `catch` block for config loading. This would make it more obvious to the user when the script is falling back to the default path for `daily-stats.md` due to a config loading issue, without making the error fatal.

5.  **Risk Assessment**
    *   **LOW.** The plan describes a new, read-only script with no side effects. It poses no risk to existing application functionality. The implementation is straightforward and follows established patterns.

---

## Claude Review (separate headless session)

Verified against the code. Findings below.

# Cross-AI Plan Review — Phase 31 Trend & Report

## 1. Summary

Three tight, well-sequenced plans that ship the trend machinery correctly. 31-01 builds a pure, I/O-free `computeCompoundingTrend` + `renderCompoundingReport` under TDD; 31-02 and 31-03 are thin surfaces (both depend only on 31-01, correctly parallelizable in wave 2) that reuse the exact same pure functions so `/today` and the CLI can never disagree. Scope is disciplined — no scope creep, no speculative abstraction, honest about the fact that the real verdict is calendar-gated (VERDICT-01) because no real rows exist yet. I verified the load-bearing assumptions (row-shape coercion, `config.stats.enabled=true`, `VAULT_ROOT` always defined, memory-health precedent); they hold. The plans achieve the phase goal. The concerns are semantic-precision and brittleness, not correctness blockers.

## 2. Strengths

- **Single source of truth for the verdict.** Both surfaces call the same pure function — success criterion 3 ("same verdict for same rows") is structurally guaranteed, not tested-into-existence.
- **Purity enforced, not just requested.** The `grep "require('fs')" → nothing` check and synthetic-row tests make I/O-freeness a gate. Correct call — this is the one module that must be trivially unit-testable.
- **Correct null-suppression asymmetry.** `/today` suppresses under 7 rows (matches Memory Echo/Health precedent); CLI always prints the table. That asymmetry is exactly right and explicitly specified.
- **Non-fatal wiring.** 31-02 wraps the block in try/catch ("briefing-is-the-product") and lazy-requires — consistent with the existing Memory Health block at `today-command.js:251`.
- **Deterministic week-split** (`Math.floor(len/2)`, extra row to week2) removes ambiguity that would otherwise surface as flaky tests.
- **Verified:** `readDailyStats` (daily-stats.js:69) keeps `—` as string and coerces real numbers — the `_num()` helper design is necessary and correct.

## 3. Concerns

- **MEDIUM — Fixed `entriesDelta >= 5` threshold means different things at 7 rows vs 14.** The verdict fires at ≥7 rows, but Pete's thresholds were accepted for "the last 14-row window." A +5-entries floor over 7 days is a materially steeper bar than over 14, biasing 7–13-row windows toward `flat`. Not wrong (flat is an honest outcome, and the binding verdict is calendar-gated at 14 rows), but the distortion is undocumented. The plan should state that 7–13-row verdicts are provisional and directional.
- **MEDIUM — `renderCompoundingReport` spec references an undestructured `kbDelta`.** The action snippet writes `memory_kb ${kbDelta >= 0 ? '+' : ''}${supply.kbDelta}` — mixing bare `kbDelta` with `supply.kbDelta`. As written that's a ReferenceError until the implementer destructures it. Spec bug; low blast radius but should be fixed in the plan text.
- **LOW — Grep-based acceptance criteria are brittle.** `grep -q ">= 5"`, `"0.40"`, `"0.60"`, `"0.10"`, `require('fs')` (single-quote only) all pass/fail on formatting, not behavior. A correct `0.4` or double-quoted `require("fs")` would fail a passing implementation (or vice versa). The jest suite is the real gate; treat greps as advisory.
- **LOW — Third redundant read of `daily-stats.md` per `/today`.** 31-02 adds an independent `readDailyStats` on top of the yesterday-summary and Memory Health reads (confirmed at `today-command.js:256`). All guarded and cheap, but it's the same file parsed three times a run.
- **LOW — `windowDays: 14` hardcoded in two call sites** (31-02, 31-03) with no shared const. Drift risk if the window ever changes.
- **LOW — 31-03 smoke test spawns a real `node` subprocess.** Slower than an in-process call and couples the test to `VAULT_ROOT` resolution. I confirmed `VAULT_ROOT` always defaults (`vault-gateway.js:45`) and `readDailyStats` returns `{rows:[]}` on ENOENT, so it's deterministic today — but a real vault with ≥7 rows would still pass only because it asserts the always-present `Verdict:` string.

## 4. Suggestions

- Add one line to 31-01's algorithm note: verdicts on 7–13 rows are provisional; the accepted thresholds are tuned for the 14-row window. Cheap honesty, matches the milestone's "prove or refute" ethos.
- Fix the `kbDelta` reference in the 31-02… (31-01) render spec — destructure `const { entriesDelta, kbDelta } = supply;` or use `supply.kbDelta` consistently.
- **Ponytail:** thread the rows already read for Memory Health into the compounding block instead of a third read — pass `rows` down once. Skipped-if: you'd rather keep the two blocks independently guarded (defensible; the reads are cheap). Add when `/today` latency instrumentation flags file I/O.
- Consider asserting behavior over grep literals where it matters (e.g. a test that `0.59` hit-rate → flat and `0.61` → passes the utility gate) — you likely already have these; if so, demote the threshold greps to comments.
- 31-03: prefer requiring the CLI's `main` in-process (or a `--json` path) over `execFileSync` if the smoke test proves slow, but not worth changing now.

## 5. Risk Assessment

**LOW.** The core module is pure, TDD-first, and independently testable; the two surfaces are thin and reuse it. Dependency ordering is correct (both wave-2 plans depend only on wave-1). I verified every external assumption the plans lean on and found no mismatches. The open items are precision/polish (threshold semantics at small N, one spec-level reference bug, brittle greps) — none threaten the phase goal or existing behavior. The only judgment call worth Pete's eye is the 7-vs-14-row threshold semantics, and even that resolves safely because the binding verdict is calendar-gated.

**Did:** Reviewed all three Phase 31 plans; verified row-coercion, `config.stats.enabled`, `VAULT_ROOT`, and the memory-health precedent against source.
**Decision:** One real fix before executing — correct the `kbDelta` reference in 31-01's render spec. Everything else is optional polish.
**Next:** `/gsd:execute-phase 31`

---

## Consensus Summary

### Agreed Strengths
- Single pure, I/O-free core (`computeCompoundingTrend` + `renderCompoundingReport`) reused by both surfaces — verdict consistency is structural, not tested-into-existence (both reviewers)
- Correct suppression asymmetry: `/today` suppresses at <7 rows, CLI always prints the evidence table (both)
- Non-fatal try/catch wiring in `/today` mirroring the Memory Health precedent — briefing-is-the-product preserved (both)
- TDD with synthetic rows and thorough edge cases; thresholds inlined verbatim (both)
- Overall risk: LOW from both reviewers

### Agreed Concerns
- **Redundant read of `daily-stats.md` in `/today`** (Gemini LOW, Claude LOW) — third parse of the same file per run; both accept the trade-off for isolation, revisit only if latency instrumentation flags it

### Divergent Views / Unique Findings
- **Claude MEDIUM — spec bug:** 31-01 render spec mixes bare `kbDelta` with `supply.kbDelta` — ReferenceError as written; destructure or qualify consistently. THE ONE FIX TO APPLY BEFORE EXECUTION.
- **Claude MEDIUM — threshold semantics at small N:** `entriesDelta >= 5` over 7 rows is a steeper bar than over the accepted 14-row window; 7–13-row verdicts should be documented as provisional/directional
- **Claude LOW:** grep-based acceptance criteria are formatting-brittle (`0.40` vs `0.4`, quote style) — jest suite is the real gate; `windowDays: 14` duplicated at two call sites; CLI smoke test spawns a real subprocess
- **Gemini (suggestion only):** add stderr warn on config-load fallback in the CLI
- Gemini found no concerns in 31-01/31-03; Claude's code-verified pass surfaced the spec bug Gemini missed — the two-reviewer spread earned its keep

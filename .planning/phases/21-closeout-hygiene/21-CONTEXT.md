# Phase 21: Closeout Hygiene - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning (lock verification complete, framing confirmed)

<domain>
## Phase Boundary

Phase 21 closes v1.4 by clearing every deferred hygiene item from the v1.3 backlog and producing the final v1.4 documentation set. Four requirements (HYG-UNICODE-01, HYG-JSDOC-01, HYG-CONSOLE-01, DOCS-FINAL-01) per `.planning/REQUIREMENTS.md`. No new features, no logic changes (Lock 5 fence preserved without exception). Last phase before milestone close.

**Builds on:** Phase 17 (UAT CI), Phase 18 (Memory Retrieval), Phase 19 (Semantic Memory), Phase 20 (Instrumentation) — all shipped to master via PRs #35–#39.

**Out of phase:** Logger abstraction (deferred to v1.5 per Lock 2). Production code refactors. Schema changes. New tests beyond Unicode coverage. Address-by-address dotenv migration (HOOK-DOTENV-01 in v1.5 backlog). UAT corpus rebaselining (UAT-CORPUS-REFRESH-01 in v1.5 backlog). Unicode-aware matcher upgrade (HYG-UNICODE-02 in v1.5 backlog).

</domain>

<lock_verification>
## Lock-by-Lock Verification

Six framing locks were proposed in the Desktop planning session. Each is stress-tested against codebase reality below. Format per lock: **Starting proposal** → **Codebase verification** → **Recommended final position** → **Rationale**.

---

### LOCK 1 — Plan sequence (4 plans, this order)

**Starting proposal:** 21-01 HYG-UNICODE-01, 21-02 HYG-JSDOC-01, 21-03 HYG-CONSOLE-01, 21-04 DOCS-FINAL-01.

**Codebase verification:**
- HYG-UNICODE-01: 15 excluded terms in `config/excluded-terms.json` × ~4 Unicode variant types (curly quotes, em-dashes, smart apostrophes, non-ASCII whitespace) = ~60 test assertions. `test/content-policy.test.js` currently has 0 Unicode tests. **Surface: SMALL-MEDIUM, risk: LOW** (additive tests). One conditional risk on the matcher itself (see Lock 5).
- HYG-JSDOC-01: 10 named modules, ~55 total exported symbols. Existing JSDoc coverage is uneven — `memory-proposals.js` (4 exports, 0 JSDoc tag lines) and `promote-memories.js` (1 export, 0 JSDoc tag lines) are zero-baseline; `semantic-index.js` (16 exports, 37 tag lines) and `vault-gateway.js` (17 exports, 37 tag lines) are nearly complete. **Surface: MEDIUM, risk: LOW** (additive comments only).
- HYG-CONSOLE-01: ESLint reports **32 no-console warnings** (not 41 as REQUIREMENTS.md / ROADMAP.md / CLAUDE.md / Lock-2 text claim — the 41 figure is stale drift). 9 source files affected, max 8 sites in any one file (`memory-extractor.js`). **Surface: SMALL, risk: LOW** (mechanical per-site disables).
- DOCS-FINAL-01: 5 docs proposed (Lock 4). Each has confirmed drift (see Lock 4 verification). **Surface: LARGEST, risk: LOW-MEDIUM** (must come last to capture final test/coverage numbers from Plans 21-01 through 21-03).

Risk ranking validated: smallest-first, docs-last sequencing is sound. Dependency: DOCS-FINAL-01 must run last because the other three plans change test count (UNICODE adds ~60 tests) and warning count (CONSOLE eliminates 32 warnings).

**Recommended final position:** **CONFIRM** the 4-plan sequence as proposed. Two amendments to roll into the plans:
- (a) Plan 21-03 internally treats the corpus as 32 sites, not 41; the "41" figure becomes a Plan 21-04 fix in DOCS-FINAL-01.
- (b) Plan 21-02 sub-tasks by module, prioritizing zero-baseline files (`memory-proposals.js`, `promote-memories.js`) since they need full JSDoc construction, not delta.

**Rationale:** Sequence holds; numerical drift in stale references is itself a Phase 21 fix and gets captured in 21-04.

---

### LOCK 2 — HYG-CONSOLE-01 strategy

**Starting proposal:** Per-site `eslint-disable-next-line` with four allowed rationale categories: `user-facing-output`, `degradation-warning`, `diagnostic`, `last-resort-error`. NO logger abstraction; deferred to v1.5.

**Codebase verification:** Sampled the 32 sites across the 9 affected files:
- `config-validator.js` (7 sites): all `console.log` printing CLI-tool validation results → **user-facing-output** ✓
- `memory-extractor.js` (8 sites): all `console.error` reporting transcript-read or Haiku-call failures → **last-resort-error** + **diagnostic** ✓
- `memory-proposals.js` (5 sites): `console.error` for write-failure paths → **last-resort-error** ✓
- `new-command.js` (3 sites): all `console.log` printing routing decisions → **user-facing-output** ✓
- `style-policy.js` (3 sites): `console.error` for style-guide-load / style-guide-watch failures → **degradation-warning** ✓
- `vault-gateway.js` (2 sites): one `console.error(JSON.stringify(audit_entry))` (always-emit audit log) → **diagnostic** ✓; one config-reload-failed warning → **degradation-warning** ✓
- `wikilink-engine.js` (2 sites): degradation paths → **degradation-warning** ✓
- `today-command.js` (1 site): `console.log(briefing)` is the user-visible briefing emit → **user-facing-output** ✓
- `content-policy.js` (1 site): degradation warning when policy can't load → **degradation-warning** ✓

All 32 sampled sites map cleanly to one of the four categories. No site requires a refactor or logger abstraction.

Per-site disable approach is well-suited at this corpus size (32 sites, scattered, 1-8 per file). Logger abstraction would pay off at ~50+ sites or higher concentration; v1.5 deferral is appropriate.

**Recommended final position:** **CONFIRM** the 4-category disable strategy. One amendment:
- (a) Plan 21-03 includes a Step 0 that produces a categorization manifest (32 lines: `file:line | method | category | rationale`) BEFORE applying any disables. Manifest gets archived into 21-03-SUMMARY.md as the audit trail. This satisfies Pattern 9 (Type Names as Governance) — every disable carries reviewer-visible attestation.

**Rationale:** Categories cover the surface; manifest-first protocol prevents speedrun-induced miscategorization and creates the artifact reviewers need to validate the disables.

---

### LOCK 3 — HYG-JSDOC-01 "public" definition (narrow)

**Starting proposal:** "Public" = every symbol attached to `module.exports`. Each gets `@param`, `@returns`, one-line description.

**Codebase verification:** All 10 named files use a single `module.exports = { ... }` object literal. No deep-require / cross-module access patterns spotted. One file (`memory-proposals.js`) has an additional `module.exports._testOnly = { ... }` surface for test-only access.

Existing JSDoc baseline by file (tag-line count):
- classifier.js: 19 (517 LOC, 4 exports) — partial
- memory-extractor.js: 32 (502 LOC, 4 exports) — strong
- memory-proposals.js: **0** (400 LOC, 4 exports + `_testOnly`) — zero baseline
- promote-memories.js: **0** (404 LOC, 1 export) — zero baseline
- memory-reader.js: 12 (377 LOC, 3 exports) — partial
- semantic-index.js: 37 (558 LOC, 16 exports) — strong
- recall-command.js: 4 (148 LOC, 2 exports) — partial
- daily-stats.js: 30 (424 LOC, 3 exports) — strong
- today-command.js: 9 (340 LOC, 1 export) — partial
- vault-gateway.js: 37 (633 LOC, 17 exports) — strong

The narrow definition is sound. The `_testOnly` namespace is technically exported but is **not** "public API" — it's a test-injection seam.

**Recommended final position:** **CONFIRM** the narrow definition with one amendment:
- (a) `_testOnly` exports are explicitly **excluded** from the JSDoc surface (rationale documented at the export site as `// Test-only seam — not public API. JSDoc not required per Phase 21 D-LOCK-3.`).

**Rationale:** Narrow scope holds; `_testOnly` carve-out preserves intent without expanding scope. memory-proposals.js and promote-memories.js need full JSDoc construction and should be sized as the largest tasks in 21-02.

---

### LOCK 4 — DOCS-FINAL-01 doc set (expanded to 5 docs)

**Starting proposal:** Expand from 3 to 5 docs: `CLAUDE.md`, `README.md`, `docs/DEVOPS-HANDOFF.md`, `.planning/PROJECT.md`, `.planning/ROADMAP.md`. Bounded by "verifiable v1.4-fact error" rule. Plus 3 sub-tasks: REQUIREMENTS.md checkbox sync, npm audit / license-check / GitGuardian green confirmation, 19-HUMAN-UAT.md disposition.

**Codebase verification — drift exists in each doc:**

| Doc | Drift evidence |
|-----|----------------|
| **CLAUDE.md** | "982 total" tests / "944 passing" (current is 1082 / 1044 in CI). "41 no-console" (current 32). |
| **README.md** | "982 total tests", "944 pass, 38 skipped" everywhere. Phase 19 listed as "complete (2026-04-24)" but Phase 20 / Phase 21 absent. |
| **docs/DEVOPS-HANDOFF.md** | "982 tests" / "944 passing" repeated 3+ times. Phase 21 backlog references Phase 19 numbers. No mention of Phase 20 daily-stats artifacts. |
| **.planning/PROJECT.md** | "982 tests across 48 suites" (current is ~1082 / ~52 suites). Phase 20 listed as "(next)" but it's shipped. Phase 21 wording matches Lock 4 scope. |
| **.planning/ROADMAP.md** | Phase 21 unchecked in v1.4 progress table (correct, in-flight). Minimal numerical drift; mostly checkbox sync at close. |

Drift is real and bounded by the "verifiable v1.4-fact error" rule. Adding `.planning/PROJECT.md` and `.planning/ROADMAP.md` is justified — both contain verifiable v1.4 facts that drifted.

**Sub-task verification:**
- (i) **REQUIREMENTS.md checkbox sync:** all four Phase 21 REQ rows are still `[ ]` Pending. After Phase 21 ships, all four flip to `[x]` Complete. Required.
- (ii) **npm audit / license-check / GitGuardian green:** standard quality gate; not yet checked this session. Phase 21 should confirm before close.
- (iii) **19-HUMAN-UAT.md disposition:** file exists at `.planning/phases/19-semantic-memory-search/19-HUMAN-UAT.md` with frontmatter `status: complete`, all 4 UAT items marked `result: pass` with detailed notes (Test 1 calibration fix 0.72→0.55 documented). **Disposition is "already complete"** — work is to cite/reference this file in the v1.4 close narrative, not to act on it.

**Recommended final position:** **CONFIRM** the 5-doc scope with one amendment:
- (a) Sub-task (iii) explicitly reframed: "Cite 19-HUMAN-UAT.md in v1.4 close documentation; confirm `status: complete` is unchanged (no work, just reference)." Saves time vs. open-ended "disposition" wording.

**Rationale:** Drift is real across all 5 docs; sub-tasks are correctly scoped except (iii) which is a no-op verify, not work.

---

### LOCK 5 — File-type fence

**Starting proposal:** Phase 21 changes only `test/*.test.js`, `src/*.js` (JSDoc + lint-disable only, no logic), the 5 named markdown docs, and `.planning/REQUIREMENTS.md` + `.planning/STATE.md` inside DOCS-FINAL-01.

**Codebase verification — conflict found in HYG-UNICODE-01:**

`src/content-policy.js:160-201` matcher uses:
```
const contentLower = content.toLowerCase();
if (contentLower.includes(term.toLowerCase())) { ... }
```

Plain ASCII `.toLowerCase().includes()`. **Cannot match Unicode variants** like:
- Full-width Latin: `Ｇｅｎｅｓｙｓ` — `toLowerCase()` doesn't fold full-width to ASCII
- Soft-hyphen-injected: `G\u00ADenesys` — `includes()` won't match
- Non-ASCII whitespace inserted between letters: `Genes\u00A0ys` — `includes()` won't match

REQUIREMENTS.md HYG-UNICODE-01 wording: "...Unicode variants ... of each excluded term, **verifying substring matching still catches them**." The phrase "still catches them" implies the matcher MUST catch them. If tests are written that expect the matcher to catch full-width / soft-hyphen / non-ASCII-whitespace variants, **they will fail** — which means matcher logic must change.

This is a real conflict with the proposed fence ("`src/*.js` JSDoc + lint-disable only, no logic").

**Recommended final position:** **MODIFY** via Path B — reframe HYG-UNICODE-01 instead of breaking the fence:
- (a) Acknowledge the matcher's ASCII-only behavior as a known v1.4 limitation. No `src/` logic changes in Phase 21.
- (b) Plan 21-01 adds Unicode-variant tests as `test.todo()` blocks in `test/content-policy.test.js`. Each excluded term gets a `test.todo()` per variant type (full-width Latin, soft-hyphen, non-ASCII whitespace). The blocks document the gap and reserve the test surface; they do not assert behavior the matcher can't deliver.
- (c) Plan 21-04 amends REQUIREMENTS.md HYG-UNICODE-01 to document the limitation explicitly: "ASCII-only substring matching is the v1.4 contract; Unicode-variant catching is deferred to v1.5 HYG-UNICODE-02."
- (d) New requirement **HYG-UNICODE-02** carries Unicode-aware matching to v1.5 (added to `tasks/todo.md` v1.5 backlog). Backfills the `test.todo()` blocks when the matcher is upgraded.
- (e) Lock 5 fence holds without exception — `src/*.js` remains JSDoc + lint-disable only.

**Rationale:** Close-out phases solidify, they don't extend. Personal-vault adversary model is near-zero, so the matcher gap is purity-not-security. Path B preserves Lock 5 discipline and matches the v1.5-deferral pattern set by the 8 backlog items captured this session (HOOK-SCHEMA-01, HOOK-VAULT-01, HOOK-DOCSYNC-01, AGENT-DOCSYNC-01, AGENT-VERIFY-01, AGENT-MEMORY-01, HOOK-DOTENV-01, UAT-CORPUS-REFRESH-01).

---

### LOCK 6 — Pre-flight redefinition

**Starting proposal:** Pre-flight CHECK 2 reads "`CI=true npm test` passes with 0 failures; documented local-only failures don't block" per LESSON-PREFLIGHT-CI-MODE-01. Already adopted; verify it's reflected in the discussion.

**Codebase verification:** LESSON-PREFLIGHT-CI-MODE-01 was committed to `tasks/lessons.md` in PR #39 (merged this session). It explicitly states: green/red signal for this project is `CI=true npm test`; local-mode UAT runs are developer-optional debugging, not pre-flight gates. This matches the user's lock wording.

UAT-CORPUS-REFRESH-01 was committed to `tasks/todo.md` in PR #39 with the explicit note: "CI-skipped via existing describeFn guard so non-blocking for v1.4 ship." UAT-01's local failure is captured as known-stale and out of v1.4 scope.

**Recommended final position:** **CONFIRM** without modification. Already binding.

**Rationale:** Captured durably in lessons.md and todo.md; no further verification required.

</lock_verification>

<decisions>
## Confirmed framing for plan-phase

Plans will be authored against these locked positions:

### Pre-Locked (REQUIREMENTS.md / Phase 19 / Phase 20 / lessons — not re-opened)

- **D-PRE-01:** Phase 21 scope is the four REQs as written: HYG-UNICODE-01, HYG-JSDOC-01, HYG-CONSOLE-01, DOCS-FINAL-01.
- **D-PRE-02:** Pre-flight green/red is `CI=true npm test` (per LESSON-PREFLIGHT-CI-MODE-01). Local-mode UAT-01 corpus drift (UAT-CORPUS-REFRESH-01) is non-blocking.
- **D-PRE-03:** Active KB v2.1 patterns from `state/pattern-context.md` carry into this phase:
  - **Pattern 9** (Type Names as Governance) — every `eslint-disable-next-line no-console` carries reviewer-visible rationale per the categorization manifest (D-LOCK-2-AMEND-A).
  - **Pattern 11** (Feature Flags as Security Perimeters) — vault and excluded-terms boundaries remain enforced; Phase 21 documents the Unicode-variant gap via `test.todo()` blocks (HYG-UNICODE-01) and reserves closure for v1.5 HYG-UNICODE-02.

### Locked in Discussion

- **D-LOCK-1:** Plan sequence is 21-01 HYG-UNICODE-01 → 21-02 HYG-JSDOC-01 → 21-03 HYG-CONSOLE-01 → 21-04 DOCS-FINAL-01. DOCS-FINAL-01 runs last to capture final test/coverage numbers.
- **D-LOCK-1-AMEND-A:** The "41 no-console" figure in REQUIREMENTS.md / ROADMAP.md / CLAUDE.md is stale; actual count is 32. Plan 21-03 uses 32; Plan 21-04 corrects all stale references.
- **D-LOCK-1-AMEND-B:** Plan 21-02 sub-tasks by module, prioritizing `memory-proposals.js` (4 exports, 0 baseline) and `promote-memories.js` (1 export, 0 baseline) as the largest construction tasks.
- **D-LOCK-2:** HYG-CONSOLE-01 strategy is per-site `eslint-disable-next-line` with four rationale categories: `user-facing-output`, `degradation-warning`, `diagnostic`, `last-resort-error`. No logger abstraction; deferred to v1.5.
- **D-LOCK-2-AMEND-A:** Plan 21-03 Step 0 produces a 32-row categorization manifest (`file:line | method | category | rationale`) before any edit; manifest archived in 21-03-SUMMARY.md as the audit trail.
- **D-LOCK-3:** HYG-JSDOC-01 "public" = every symbol attached to `module.exports` across the 10 named files. Each gets `@param`, `@returns`, one-line description.
- **D-LOCK-3-AMEND-A:** `module.exports._testOnly` exports (currently only in `memory-proposals.js`) are excluded with documented rationale: `// Test-only seam — not public API. JSDoc not required per Phase 21 D-LOCK-3.`
- **D-LOCK-4:** DOCS-FINAL-01 covers 5 docs: `CLAUDE.md`, `README.md`, `docs/DEVOPS-HANDOFF.md`, `.planning/PROJECT.md`, `.planning/ROADMAP.md`. Bound: only "verifiable v1.4-fact error" edits.
- **D-LOCK-4-SUB-i:** Sync REQUIREMENTS.md Phase 21 REQ checkboxes (`[ ]` → `[x]`).
- **D-LOCK-4-SUB-ii:** Confirm `npm audit`, `license-checker`, GitGuardian secrets scan all green before close.
- **D-LOCK-4-SUB-iii:** Cite `.planning/phases/19-semantic-memory-search/19-HUMAN-UAT.md` in v1.4 close documentation; verify `status: complete` is unchanged. No-op verification, not work.
- **D-LOCK-5:** File-type fence permits `test/*.test.js`, `src/*.js` (JSDoc + lint-disable only by default), 5 named markdown docs, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`.
- **D-LOCK-5-AMEND-A:** **Path B reframing of HYG-UNICODE-01.** Acknowledge the ASCII-only matcher as a v1.4 limitation; do not change `src/content-policy.js` in Phase 21. Plan 21-01 adds `test.todo()` Unicode-variant blocks documenting the gap. Plan 21-04 amends REQUIREMENTS.md HYG-UNICODE-01 to document the limitation explicitly. Defer Unicode-aware matching to v1.5 as new requirement **HYG-UNICODE-02** (captured in `tasks/todo.md`). Lock 5 fence preserved without exception.
- **D-LOCK-6:** Pre-flight CHECK 2 = `CI=true npm test` returns 0 failures. Local-mode failures are debugging signal, not gates. Already captured in `tasks/lessons.md` (LESSON-PREFLIGHT-CI-MODE-01).

### Implementation expectations

- 4 plans total, executed in sequence. Each plan produces a `21-NN-PLAN.md` and a `21-NN-SUMMARY.md`.
- Plan 21-01 adds `test.todo()` Unicode-variant blocks per D-LOCK-5-AMEND-A; no `src/` logic changes; matcher upgrade deferred to v1.5 HYG-UNICODE-02.
- Plan 21-03 has Step 0 categorization manifest (D-LOCK-2-AMEND-A).
- Plan 21-04 closes by updating `tasks/todo.md` (mark Phase 21 backlog items closed) and `.planning/STATE.md` to milestone-close state.
- One PR per plan, opened in sequence; merge in sequence; do not merge ahead.
- v1.4 milestone close ceremony (`/gsd:milestone-summary` or equivalent) executes after all 4 PRs land.

### Out-of-scope safeguards

- No logger abstraction in this phase. Defer to v1.5 if a real need surfaces.
- No UAT-01 corpus rebaselining. v1.5 backlog (UAT-CORPUS-REFRESH-01).
- No production code refactors.
- No new test scenarios beyond Unicode coverage.

</decisions>

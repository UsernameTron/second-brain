# Plan 21-03 SUMMARY — HYG-CONSOLE-01

**Phase:** 21-closeout-hygiene
**Plan:** 03
**Requirement:** HYG-CONSOLE-01
**Completion date:** 2026-04-25
**Branch:** phase-21-03-hyg-console-01
**Approach:** Per-site `eslint-disable-next-line no-console` with category-tagged rationale (D-LOCK-2). Logger abstraction deferred to v1.5.

---

## Outcome

| Metric | Value |
|--------|-------|
| Live ESLint no-console warnings before | 32 |
| Live ESLint no-console warnings after | **0** |
| Primary disables added (this plan's 9-file scope) | 32 |
| Corollary disables retroactively categorized (Option A scope correction) | 3 |
| Total category-tagged disables in src/ | 35 |
| Tests passing | 1044 / 1044 (38 skipped, 45 todo, 0 failed) |
| Lint exit code | 0 (9 non-no-console warnings remain — pre-existing) |
| Lock 5 fence (only comment-line changes) | Held — `git diff master -- src/` shows only `+// eslint-disable-next-line ...` insertions |

---

## Per-category counts (final)

| Category | Primary (32) | Corollary (3) | Total |
|----------|--------------|---------------|-------|
| user-facing-output | 9 | 0 | 9 |
| degradation-warning | 11 | 3 | **14** |
| diagnostic | 4 | 0 | 4 |
| last-resort-error | 8 | 0 | 8 |
| **Total** | **32** | **3** | **35** |

---

## Verification evidence (acceptance gates)

| Gate | Expected | Actual | Status |
|------|----------|--------|--------|
| A1 ESLint no-console count | 0 | 0 | PASS |
| A2 Total disable comments in src/ | 35 | 35 | PASS |
| A3 Disables without valid category | 0 | 0 | PASS |
| A4 Lock 5 fence (only comment-line changes in src/) | empty | empty | PASS |
| A5 Per-file counts (1,1,2,2,3,3,5,7,8 + 1,2 = 35) | match | match | PASS |
| A6 `CI=true npm test --forceExit` | 0 failed | 0 failed (1044 passed) | PASS |
| A7 `npm run lint` exit code | 0 | 0 | PASS |

---

## Primary corpus — 32 sites in 9 files

The live ESLint no-console corpus that Plan 21-03 was scoped to eliminate. Each site received an `eslint-disable-next-line no-console -- <category>: <rationale>` directive on the immediately preceding line. No console.* arguments, surrounding logic, or function bodies were modified.

| Site | Method | Category | Rationale |
|------|--------|----------|-----------|
| src/config-validator.js:164 | console.log | user-facing-output | CLI header line for validation results table |
| src/config-validator.js:165 | console.log | user-facing-output | CLI separator under validation results header |
| src/config-validator.js:169 | console.log | user-facing-output | CLI per-file status line in validation results |
| src/config-validator.js:170 | console.log | user-facing-output | CLI schema-path line under each file status |
| src/config-validator.js:173 | console.log | user-facing-output | CLI per-error detail line in validation results |
| src/config-validator.js:177 | console.log | user-facing-output | CLI closing separator after validation results |
| src/config-validator.js:188 | console.error | last-resort-error | Unexpected error logged before process.exit(1) in CLI entry |
| src/content-policy.js:55 | console.error | degradation-warning | Suspicious excluded-term pattern dropped; pipeline continues without it |
| src/memory-extractor.js:267 | console.error | last-resort-error | Transcript read failed; extractor returns [] |
| src/memory-extractor.js:284 | console.error | last-resort-error | Single-pass Haiku extraction failed; extractor returns [] |
| src/memory-extractor.js:304 | console.error | degradation-warning | Chunk extraction failed; loop continues to next chunk with partial results |
| src/memory-extractor.js:313 | console.error | last-resort-error | Outer extraction try/catch fired; extractor returns [] |
| src/memory-extractor.js:340 | console.error | last-resort-error | File read failed in extractFromFile; returns [] |
| src/memory-extractor.js:348 | console.error | last-resort-error | Haiku call threw in extractFromFile; returns [] |
| src/memory-extractor.js:353 | console.error | last-resort-error | Haiku response unsuccessful in extractFromFile; returns [] |
| src/memory-extractor.js:417 | console.error | last-resort-error | Directory read failed in extractFromDirectory; returns [] |
| src/memory-proposals.js:287 | console.error | degradation-warning | Pending-line flush failed for one entry; loop continues to remaining entries |
| src/memory-proposals.js:319 | console.error | diagnostic | Always-emit JSON audit log for WRITE_CANDIDATE SKIPPED duplicate decision |
| src/memory-proposals.js:329 | console.error | diagnostic | Always-emit JSON audit log for WRITE_CANDIDATE BUFFERED decision |
| src/memory-proposals.js:336 | console.error | diagnostic | Always-emit JSON audit log for WRITE_CANDIDATE WRITTEN decision |
| src/memory-proposals.js:354 | console.error | degradation-warning | Lock acquisition failed during pending-buffer flush; returns silently |
| src/new-command.js:158 | console.error | degradation-warning | Wikilinks suggestion failed; routing continues without enrichment |
| src/new-command.js:161 | console.log | user-facing-output | CLI confirmation that input was routed to target path |
| src/new-command.js:181 | console.error | user-facing-output | CLI dead-letter notification informing user where unroutable input was saved |
| src/style-policy.js:129 | console.error | degradation-warning | Style guide load failed; cache set to empty so style lint disables |
| src/style-policy.js:151 | console.error | degradation-warning | Style guide reload failed; previous cache retained |
| src/style-policy.js:159 | console.error | degradation-warning | Style guide watch failed; lint still works without hot-reload |
| src/today-command.js:280 | console.log | user-facing-output | Interactive mode emits the day briefing — the visible product of /today |
| src/vault-gateway.js:106 | console.error | diagnostic | Always-emit JSON audit log for vault-gateway write decisions per design |
| src/vault-gateway.js:216 | console.error | degradation-warning | Config reload parse failed; previous in-memory config retained |
| src/wikilink-engine.js:251 | console.error | degradation-warning | vault-index.json shape invalid; returns empty index so callers continue |
| src/wikilink-engine.js:257 | console.error | degradation-warning | vault-index.json read failed (non-ENOENT); returns empty index |

---

## Corollary corpus — 3 sites retroactively categorized (Option A)

These 3 disables predated Plan 21-03 (Phase 19 commits `cb2c9d8c` and `0826cacc`, 2026-04-24) as bare `// eslint-disable-next-line no-console` directives without category attestation. They were invisible to ESLint warnings (already suppressed) but visible to A3's global governance audit. Per Pattern 9 (Type Names as Governance), every disable in src/ should carry reviewer-visible category + rationale. Option A brought them into uniform compliance with no behavioral change.

| Site | Method | Category | Rationale |
|------|--------|----------|-----------|
| src/promote-memories.js:195 | console.error | degradation-warning | semantic indexing failed; promotion continues |
| src/semantic-index.js:101 | console.error | degradation-warning | VOYAGE_API_KEY missing; falls back to keyword search |
| src/semantic-index.js:144 | console.error | degradation-warning | 401 from Voyage; falls back to keyword search |

---

## Manifest reassignments — 5 sites where live read differed from CONTEXT Lock 2

CONTEXT.md Lock 2 was authored before recent edits and contained both line-number drift and a few category mappings that did not survive a live read of the code. Per-file site counts were unchanged (1/7/8/5/3/3/1/2/2 = 32). The following category reassignments were made during Task 0 manifest authoring:

1. **src/config-validator.js:188** — CONTEXT implied user-facing-output for the whole file; live code is `console.error('Unexpected error:', err.message)` immediately before `process.exit(1)`. Reassigned **last-resort-error**.
2. **src/memory-extractor.js:304** — CONTEXT mapped all 8 memory-extractor sites to last-resort-error; line 304 fires inside the chunked-extraction loop, does NOT return, and the loop advances to the next chunk with partial results retained. Reassigned **degradation-warning**.
3. **src/memory-proposals.js:319 / :329 / :336** — CONTEXT mapped all 5 memory-proposals sites to last-resort-error; these three lines are always-emit `console.error(JSON.stringify({...}))` audit logs for SKIPPED/BUFFERED/WRITTEN decisions, not failure paths. Reassigned **diagnostic**.
4. **src/memory-proposals.js:287 and :354** — CONTEXT mapped to last-resort-error; both are real failure paths but the program continues (loop continues / returns silently). Reassigned **degradation-warning**.
5. **src/new-command.js:181** — CONTEXT mapped to user-facing-output at the (now stale) line 326. Live line 181 is `console.error` (not `console.log`), but the message ("Dead-lettered to ...") IS the CLI's user-visible response when routing fails. Method recorded as console.error; category retained as **user-facing-output**.

---

## Option A decision record

A3 (`grep -vcE -- "-- (category):" src/`) is a global audit across src/ and surfaced 3 pre-existing bare disables in `promote-memories.js` and `semantic-index.js` — files outside Plan 21-03's per-file scope.

Three paths were considered:
- **Option A (chosen):** Bring the 3 into scope; categorize each (all unambiguously degradation-warning). Brings src/ to fully uniform Pattern 9 governance state.
- Option B: Scope-limit A3 to the 9 plan files; document the 3 as known pre-existing artifacts.
- Option C: Defer the 3 to a separate plan (e.g., 21-03b or 21-04).

Connor selected **A**. Rationale: scope correction (not expansion) — the 3 retroactive categorizations are the same Lock 5 class as the primary disables (comment-line-only edits, no behavioral change), and Pattern 9's principle ("every disable carries reviewer-visible category + rationale") is better served by completing the 35 than by leaving 3 grandfathered.

---

## Citations

- **D-LOCK-2** — Per-site `eslint-disable-next-line no-console -- <category>: <rationale>` with the 4 fixed categories (user-facing-output, degradation-warning, diagnostic, last-resort-error).
- **D-LOCK-2-AMEND-A** — Manifest-first protocol: 32-row categorization manifest produced in Task 0 BEFORE any disable lands; reviewer pause for manifest review is a hard gate.
- **Pattern 9 (Type Names as Governance)** — Each disable carries category-tagged provenance; the category is itself the governance attestation, not free-form prose.
- **Lock 5** — Only `eslint-disable-next-line` comments added; no console.* calls removed, refactored, or relocated; no surrounding logic touched.

---

## Cross-reference for Plan 21-04

Plan 21-04 will correct the stale "41 no-console" figure across docs (REQUIREMENTS.md, ROADMAP.md, CLAUDE.md, README.md, DEVOPS-HANDOFF.md) to **32** — the live pre-Plan-21-03 ESLint corpus. The "41 pre-existing lint warnings" historical observation was 32 no-console + 9 other warnings; A7 confirms the 9 non-no-console warnings remain unchanged.

The post-Plan-21-03 disable total of **35** (32 primary + 3 corollary) is internal SUMMARY framing only and is **not** a doc figure. Plan 21-04 should not surface 35 in any user-facing or governance-published document.

---

## Files changed

**Source (11 files, comment-line additions only):**
- src/config-validator.js — 7 disables added
- src/content-policy.js — 1 disable added
- src/memory-extractor.js — 8 disables added
- src/memory-proposals.js — 5 disables added
- src/new-command.js — 3 disables added
- src/style-policy.js — 3 disables added
- src/today-command.js — 1 disable added
- src/vault-gateway.js — 2 disables added
- src/wikilink-engine.js — 2 disables added
- src/promote-memories.js — 1 bare disable retroactively categorized (Option A)
- src/semantic-index.js — 2 bare disables retroactively categorized (Option A)

**Planning artifacts (2 files, new):**
- .planning/phases/21-closeout-hygiene/21-03-MANIFEST.md — 32-row primary manifest + 3-row corollary section + drift notes
- .planning/phases/21-closeout-hygiene/21-03-SUMMARY.md — this file

# Plan 21-01 SUMMARY — HYG-UNICODE-01

**Phase:** 21 — Closeout Hygiene
**Plan:** 01
**Requirement:** HYG-UNICODE-01
**Completed:** 2026-04-25
**Branch:** phase-21-01-hyg-unicode-01
**Base:** master @ f6bab59 (PR #41 merge — Phase 21 plan briefs)

## What shipped

45 `test.todo()` entries appended to `test/content-policy.test.js` documenting the Unicode-variant gap in `src/content-policy.js`'s ASCII-only matcher. The entries reserve the test surface for v1.5 HYG-UNICODE-02 (Unicode-aware matcher upgrade) without asserting behavior the current matcher cannot deliver.

**Variant inventory (Lock 5):**
- Full-width Latin (U+FF21–U+FF3A / U+FF41–U+FF5A)
- Soft-hyphen-injected (U+00AD between letters)
- Non-ASCII whitespace (U+00A0 substituted for or inserted into spaces)

**Coverage:** 15 excluded terms × 3 variants = 45 entries. Terms covered: Asana, Five9, Fiverr, Genesys, ININ, Interactive Intelligence, ISPN, Onbe, OpenDoor, PureCloud, PureConnect, Sandler, Stride Care, Totango, UKG.

## Acceptance criteria results

| ID | Check | Expected | Actual | Pass |
|----|-------|----------|--------|------|
| A1 | `grep -c "test\.todo" test/content-policy.test.js` | ≥ 45 | **49** (45 new + 4 pre-existing) | ✓ |
| A2 | `grep -c "HYG-UNICODE-01" test/content-policy.test.js` | 1 (describe header) | **1** | ✓ |
| A3 | `git diff master -- src/content-policy.js \| wc -l` | 0 (Lock 5 fence) | **0** | ✓ |
| A4 | `grep -cF "HYG-UNICODE-02" tasks/todo.md` | EXACTLY 1 (idempotent vs PR #40) | **1** | ✓ |
| A5 | `CI=true npx jest test/content-policy.test.js --forceExit` | 45 todo, 0 failed | **45 todo, 26 passed, 71 total** | ✓ |
| A6 | `CI=true npm test --forceExit` | full suite green | **38 skipped, 45 todo, 1044 passed, 1127 total — 0 failed** | ✓ |
| A7 | `npm run lint` | exit 0 | **exit 0** (0 errors, 41 pre-existing warnings) | ✓ |

## Lock 5 fence verification (D-LOCK-5-AMEND-A / Path B)

`git diff master -- src/content-policy.js` returned **0 lines** — the matcher source is unchanged. Per D-LOCK-5-AMEND-A, ASCII-only substring matching is the v1.4 contract. Unicode-variant catching is deferred to v1.5 HYG-UNICODE-02.

The matcher at `src/content-policy.js:195-204` continues to use `.toLowerCase().includes()`, which cannot match the variants documented in the 45 `test.todo()` entries. This gap is intentional and bounded by Lock 5 fence preservation.

## HYG-UNICODE-02 idempotency verification

`grep -cF "HYG-UNICODE-02" tasks/todo.md` returned **EXACTLY 1**. The entry was previously added to `tasks/todo.md` by PR #40 (the Phase 21 discuss-phase commit). Plan 21-01 Task 2 is idempotent — Step 0 verified presence, Step 1 conditional add was skipped per the plan brief's verify-then-conditionally-add structure. No duplicate created.

## Live test count baseline (post-Plan 21-01)

```
Test Suites: 4 skipped, 51 passed, 51 of 55 total
Tests:       38 skipped, 45 todo, 1044 passed, 1127 total
Snapshots:   0 total
Time:        11.001 s
```

This is the baseline that Plan 21-04 Task 1 will re-capture at execute time (numbers will shift again after Plans 21-02 and 21-03 ship).

## Framing decision

**D-LOCK-5-AMEND-A (Path B)** per `.planning/phases/21-closeout-hygiene/21-CONTEXT.md`:
> Plan 21-01 adds Unicode-variant tests as `test.todo()` blocks in `test/content-policy.test.js`. Each excluded term gets a `test.todo()` per variant type (full-width Latin, soft-hyphen, non-ASCII whitespace). The blocks document the gap and reserve the test surface; they do not assert behavior the matcher can't deliver. ... Lock 5 fence holds without exception — `src/*.js` remains JSDoc + lint-disable only.

## Files modified

| File | Change | Lines added |
|------|--------|-------------|
| `test/content-policy.test.js` | Appended `describe('HYG-UNICODE-01: ...')` block with 45 `test.todo()` entries + section comment | 78 |

`tasks/todo.md` — verified only, no modifications (HYG-UNICODE-02 entry pre-existing per PR #40).

## What this plan does NOT do

- Does NOT modify `src/content-policy.js` (Lock 5 fence)
- Does NOT introduce a new requirement (HYG-UNICODE-02 was captured by PR #40)
- Does NOT update REQUIREMENTS.md, ROADMAP.md, or any of the 5 named docs (deferred to Plan 21-04)
- Does NOT activate or assert any of the 45 `test.todo()` entries (deferred to v1.5 HYG-UNICODE-02 when matcher upgrade ships)

## Next step

Plan 21-01 awaits commit + PR per Connor's standard ship pattern (one PR per plan). After PR #41's plan briefs landed, this is the first execution PR. Plan 21-02 (HYG-JSDOC-01) is independent and may run in parallel; Plan 21-04 (DOCS-FINAL-01) waits on 21-01/02/03 per its `depends_on`.

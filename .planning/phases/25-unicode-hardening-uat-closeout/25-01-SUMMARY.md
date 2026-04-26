---
plan: 25-01
phase: 25-unicode-hardening-uat-closeout
status: complete
started: 2026-04-26T17:35:00Z
completed: 2026-04-26T17:42:00Z
tasks_completed: 1
tasks_total: 1
---

## Summary

Replaced ASCII-only `.toLowerCase().includes()` matcher in `src/content-policy.js` with NFKD-normalized `normalizeForMatch()` function. The new matcher applies NFKD decomposition (full-width Latin → ASCII), strips soft hyphens (U+00AD), combining marks (U+0300-036F), and non-ASCII whitespace (U+00A0, U+2000-200B, U+FEFF), then collapses all whitespace before lowercasing. This prevents three categories of Unicode bypass attacks against the excluded-term filter.

All 45 `test.todo()` placeholder entries from Phase 21 (HYG-UNICODE-01) were promoted to passing assertions covering 15 terms × 3 variants (full-width Latin, soft-hyphen injection, NBSP insertion). Added 4 unit tests for the `normalizeForMatch` utility itself.

## Key Files

### Created
- (none)

### Modified
- `src/content-policy.js` — Added `normalizeForMatch()` function, replaced `paragraphLower`/`contentLower` with normalized equivalents in `sanitizeContent` and `checkContent`
- `test/content-policy.test.js` — Promoted 45 test.todo to passing test assertions, added 4 normalizeForMatch utility tests (new sections 16-17)

## Metrics

- Tests added: 49 (45 Unicode variant + 4 utility)
- Tests removed: 45 (test.todo placeholders)
- Net test change: +49 passing tests (from 1127 total to 1190)
- Full suite: 1152 passing, 38 skipped, 0 failures

## Decisions

- Chose to strip ALL whitespace (not just NBSP) in `normalizeForMatch` to handle multi-word terms like "Interactive Intelligence" consistently — the normalizer collapses both the term and the content to whitespace-free form, so "interactive intelligence" matches regardless of what whitespace characters appear between words.

## Self-Check: PASSED

- [x] `src/content-policy.js` contains `normalizeForMatch` and `.normalize('NFKD')`
- [x] Zero `test.todo()` entries remain
- [x] Old variable names `paragraphLower`/`contentLower` removed
- [x] 75 tests in content-policy.test.js all passing
- [x] Full test suite passes (1152/38/0)

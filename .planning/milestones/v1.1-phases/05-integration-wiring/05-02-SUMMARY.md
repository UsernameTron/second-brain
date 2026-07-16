---
phase: 05-integration-wiring
plan: "02"
subsystem: content-policy / classifier / excluded-terms config
tags: [ingress-filter, content-policy, classifier, excluded-terms, substring-matching]
dependency_graph:
  requires: []
  provides: [expanded-excluded-terms, substring-matching, classifier-config-fix]
  affects: [src/vault-gateway.js, src/new-command.js, src/reroute.js, src/promote-unrouted.js]
tech_stack:
  added: []
  patterns: [substring-matching-with-single-tolowercase, Array.isArray-config-shape-guard]
key_files:
  created: []
  modified:
    - config/excluded-terms.json
    - src/content-policy.js
    - src/classifier.js
decisions:
  - "Substring matching replaces word-boundary regex per D-06 — catches embedded substrings like 'mygenesysproject'"
  - "Content lowercased once outside the loop (contentLower) instead of per-term for performance"
  - "Array.isArray guard in classifier.js handles bare-array JSON format AND any future {terms:[]} wrapper"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-23"
  tasks_completed: 3
  files_modified: 3
---

# Phase 05 Plan 02: Excluded Terms Expansion and Matching Fix Summary

Expanded excluded-terms blocklist from 3 to 15 entries, fixed word-boundary regex to case-insensitive substring matching (catching embedded substrings), and repaired classifier.js config-shape bug that caused silent empty exclusion through the new-command/reroute/promote-unrouted code paths.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Update content-policy.js matching and fix classifier.js config-shape bug | 2f6efc7 | src/content-policy.js, src/classifier.js |
| 2 | Collect excluded terms from user | — (checkpoint) | — |
| 3 | Expand config/excluded-terms.json with user-provided terms | a910e3b | config/excluded-terms.json |

## What Was Built

### content-policy.js — checkContent function

Replaced per-term word-boundary regex (`new RegExp('\\b' + escapeRegex(term) + '\\b', 'i')`) with:
- `const contentLower = content.toLowerCase()` — computed once before the loop
- `if (contentLower.includes(term.toLowerCase()))` — per-term substring check

Performance improvement: content is lowercased once per call, not once per term. `escapeRegex` is preserved for use by `classifyWithHaiku`.

### content-policy.js — sanitizeContent function

Same pattern applied:
- `const paragraphLower = paragraph.toLowerCase()` — per paragraph
- `excludedTerms.some(term => paragraphLower.includes(term.toLowerCase()))` — substring match

### classifier.js — runStage0 config-shape fix

Fixed the silent failure where `parsed.terms || []` evaluated to `[]` because the file is a bare JSON array (not `{terms: [...]}`). Fix:

```js
excludedTerms = Array.isArray(parsed) ? parsed : (parsed.terms || []);
```

This repair means the classifier code path (new-command.js, reroute.js, promote-unrouted.js) now correctly loads and applies all 15 excluded terms at Stage 0.

### config/excluded-terms.json — Expanded to 15 entries

```json
["Asana", "Five9", "Fiverr", "Genesys", "ININ", "Interactive Intelligence",
 "ISPN", "Onbe", "OpenDoor", "PureCloud", "PureConnect", "Sandler",
 "Stride Care", "Totango", "UKG"]
```

Sorted alphabetically, no duplicates, preserves original 3 entries.

## Decisions Made

- **Substring over word-boundary**: Per D-06, substring matching is required to catch embedded references like `mygenesysproject`. Word-boundary regex would miss these.
- **Single toLowerCase outside loop**: Performance fix per cross-AI review feedback — one call per content string, not one per term.
- **Array.isArray guard for future compatibility**: Handles both the current bare-array format and any future `{terms: [...]}` wrapper without requiring a file format migration.

## Deviations from Plan

None — plan executed exactly as written. All three changes matched the plan's specified line-level edits.

## Verification Results

- `node -e "const t = require('./config/excluded-terms.json'); console.log(t.length >= 15 && t.length <= 20)"` prints `true`
- `grep 'Array.isArray' src/classifier.js` confirms config-shape fix
- `grep 'contentLower' src/content-policy.js` confirms single toLowerCase pattern
- No word-boundary regex in `checkContent` or `sanitizeContent`
- `npx jest --passWithNoTests`: **502 tests passed, 24 suites, 0 failures**

## Known Stubs

None — all changes are fully wired. The expanded blocklist is immediately active through both code paths (vault-gateway → content-policy and classifier → content-policy).

## Self-Check: PASSED

All created/modified files confirmed present on disk. Both task commits (2f6efc7, a910e3b) confirmed in git log. 502 tests passing with no regressions.

## Requirements Satisfied

- **INTEG-03**: Excluded terms expanded to 15 entries (15-20 range). Substring + case-insensitive matching active. Former employer names (Genesys, Five9, ININ, Interactive Intelligence, PureCloud, PureConnect, UKG), project codenames, client names (Onbe, OpenDoor, Stride Care, Totango), and tools (Asana, Fiverr, Sandler, ISPN) all covered.

# HYG-CONSOLE-01 Categorization Manifest

Generated: 2026-04-25
Phase: 21-closeout-hygiene / Plan 21-03
Source: ESLint no-console warnings (32 sites total)
Categories: user-facing-output | degradation-warning | diagnostic | last-resort-error

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

## Summary
- Total sites: 32 (verified)
- user-facing-output: 9
- degradation-warning: 11
- diagnostic: 4
- last-resort-error: 8

## Notes on drift from 21-CONTEXT.md Lock 2

CONTEXT.md was authored before recent line-number shifts and a few category re-reads. Per-file site counts hold (1/7/8/5/3/3/1/2/2 = 32). The following category reassignments were made after reading the live code:

- `src/config-validator.js:188` — CONTEXT implied user-facing-output for the whole file, but line 188 is `console.error('Unexpected error:', err.message)` immediately before `process.exit(1)`. Re-categorized as last-resort-error.
- `src/memory-extractor.js:304` — CONTEXT mapped all 8 memory-extractor sites to last-resort-error. Line 304 fires inside the chunked-extraction loop and does NOT return; the loop advances to the next chunk and partial results are still returned. Re-categorized as degradation-warning.
- `src/memory-proposals.js:319/329/336` — CONTEXT mapped all 5 memory-proposals sites to last-resort-error. Lines 319/329/336 are always-emit `console.error(JSON.stringify({...}))` audit logs for WRITE_CANDIDATE decisions (SKIPPED/BUFFERED/WRITTEN), not failure paths. Re-categorized as diagnostic. Lines 287 and 354 ARE failure paths but both continue (loop continues / returns silently), so they are degradation-warning, not last-resort-error.
- `src/new-command.js:181` — CONTEXT mapped to user-facing-output at the (now stale) line 326. Live line 181 is `console.error` not `console.log`, but the message ("Dead-lettered to ...") IS the CLI's user-visible response when routing fails. Method recorded as console.error; category remains user-facing-output.
- `src/content-policy.js:55` — CONTEXT mapped line 257 (stale); live line 55 is the suspicious-excluded-term skip warning. Pipeline continues with the term dropped → degradation-warning (CONTEXT also said degradation-warning).

Per-file counts are unchanged from CONTEXT Lock 2. Live ESLint sanity reference equals 32.

## Corollary: Pre-existing bare disables retroactively categorized (Option A)

Three pre-existing eslint-disable-next-line no-console directives in files outside Plan 21-03's primary 9-file scope were suppressing no-console warnings without category-tagged rationale. They were invisible to ESLint warnings (already suppressed) but visible to A3's audit grep. Per Pattern 9 (Type Names as Governance), every disable should carry reviewer-visible attestation. These 3 were retroactively categorized to bring src/ to uniform compliance.

| Site | Method | Category | Rationale |
|------|--------|----------|-----------|
| src/promote-memories.js:195 | console.error | degradation-warning | semantic indexing failed; promotion continues |
| src/semantic-index.js:101 | console.error | degradation-warning | VOYAGE_API_KEY missing; falls back to keyword search |
| src/semantic-index.js:144 | console.error | degradation-warning | 401 from Voyage; falls back to keyword search |

These 3 are NOT part of the original 32 no-console corpus that Plan 21-03 eliminated. The "32" figure in REQUIREMENTS.md (and the "32" correction in Plan 21-04) refers to the live ESLint warnings that needed disabling. The 3 corollary corrections are governance-uniformity work, source: Phase 19 commits cb2c9d8c and 0826cacc.

Final disable count: 32 primary + 3 corollary = 35 in src/, all category-tagged.

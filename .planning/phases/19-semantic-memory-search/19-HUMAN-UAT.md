---
status: partial
phase: 19-semantic-memory-search
source: [19-VERIFICATION.md]
started: 2026-04-24T19:55:00Z
updated: 2026-04-24T19:55:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live semantic recall with real VOYAGE_API_KEY
expected: Run `/recall --semantic 'leadership'` against a seeded vault with VOYAGE_API_KEY set. Returns ≥3 results with score ≥0.72, no stderr warnings, embeddings.jsonl grows by one per new entry.
result: [pending]

### 2. Missing-key degradation UX
expected: Run `/recall --semantic` with VOYAGE_API_KEY unset or invalid. stderr warning about VOYAGE_API_KEY, keyword fallback results, banner `(semantic unavailable — using keyword only)`.
result: [pending]

### 3. RRF fusion empirical differentiation
expected: Run `/recall --hybrid 'leadership'` and compare result ordering against `/recall --semantic 'leadership'`. RRF-fused ordering differs from pure semantic ordering when docs appear in both keyword and semantic top-N.
result: [pending]

### 4. Cross-invocation degraded-mode 15-minute window
expected: Trigger 3 consecutive Voyage failures (e.g. temporarily invalidate API key), then restore and run `/recall --semantic`. After 3 failures, degraded banner appears for 15 minutes; `~/.cache/second-brain/voyage-health.json` shows `consecutive_failures=3` and `degraded_until` timestamp; first success resets counter.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

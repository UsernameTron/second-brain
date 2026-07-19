# Phase 32 Notes — Golden Set Mining Table

**Mined:** 2026-07-19, against `eval/seed-vault/memory/memory.md` (frozen 135-entry snapshot of the live vault, sha256 `2ea9c848…`). Every keyword query below was validated against the real engine (minisearch AND + prefix + fuzzy 0.2) before freezing: all 18 keyword-bucket queries hit at rank 1; both paraphrase queries miss in keyword mode by design.

## Questions

| id | bucket | query | expected hash(es) | entry (short) | rationale |
|----|--------|-------|-------------------|---------------|-----------|
| q01 | LEARNING | revive dependabot auto-rebase | 2b0a841acb92 | Dependabot disables auto-rebase after ~30 days | Real re-ask: "how do I revive that stale PR" |
| q02 | LEARNING | jest worktree zero tests | 99f9a664b51b | Jest in .claude/worktrees silently collects zero tests | Debugging re-ask after an executor stall |
| q03 | LEARNING | HubSpot required fields import bypass | 7d1c8ee6ce27 | Required-field rules only enforce at manual form creation | CRM governance re-ask |
| q04 | LEARNING | curl apps script POST redirect 405 | e9a321ce053a | curl -X POST vs 302 redirect to googleusercontent | Exact-symptom lookup |
| q05 | LEARNING | coverage gate threshold margin | bb6d27199e84 | CI gate near threshold needs ≥1% margin | Process re-ask at gate time |
| q06 | DECISION | HubSpot search after write eventual consistency | 8cadd326b9c6 | v3 API 5-10s write→search lag | Integration-design re-ask |
| q07 | DECISION | 48GB Apple Silicon model cap | 9bf293b457c4 | No 70B+ dense / 120B+ MoE locally | Hardware-cap lookup |
| q08 | DECISION | voyage threshold calibration | c18f264d8004 | 0.55 calibrated from live UAT, not spec | Tuning-relevant decision (Phase 33+ will cite this) |
| q09 | DECISION | per-repo credential pinning GitHub estate | 525de9a9b1ca, 026e6527c17b | Repo-local credential pin > account switching | Two sibling entries; either is a correct answer (multi-hash set) |
| q10 | DECISION | embed on promotion sidecar JSONL | 4fa3badbfb86 | Embed-on-promotion sidecar architecture | Core architecture re-ask |
| q11 | CONSTRAINT | org spend limit killed subagents | ce61ac86e3cb | Org spend limits kill agents mid-flight | Pre-fan-out check re-ask |
| q12 | CONSTRAINT | scheduled vault write cloud trigger | 7376862da950 | RemoteTrigger can't reach VAULT_ROOT | Scheduling-design constraint |
| q13 | CONSTRAINT | memory promotion signal over volume | 4bf2b3b0b8cb | Weak entries dilute recall forever | Promotion-gate doctrine |
| q14 | PATTERN | uploaded branch no PR killed fleet | 562054375fc4 | Killed-fleet signature: branch with no PR | Incident-recovery re-ask |
| q15 | PATTERN | draft only gmail send scope flip | d939d8d211d9 | Draft-mode day one; go-live = one scope grant | Agent-design pattern |
| q16 | keyword-stress | zsh set word split | 90829d274155 | `set -- $x` does not word-split in zsh | AND-stress: 4 terms co-occur in exactly one entry |
| q17 | keyword-stress | bimodal distribution scripted bulk grant | aa598db6f768 | ACL forensics: bimodal grant fingerprint | AND-stress: 5 distinctive terms, single entry |
| q18 | paraphrase | why is my local model suddenly so slow at labeling | f05535a2d4d3 | Qwen thinking mode: 37s vs 1.5s classification | Zero shared distinctive vocabulary path to a keyword hit ("suddenly"/"labeling" absent → AND fails); semantic-only. Keyword MISS verified |
| q19 | paraphrase | how do we keep the assistant from having more access than it needs | 3e91e155ca35, 8739924d6426, 815a2ee7071c | Zero-trust scopes / default-deny tiers / gateway choke point | Concept query with no matching tokens ("assistant" vs "agent"); semantic-only. Keyword MISS verified |
| q20 | LEARNING | memory system surfaces reinvented | aac031012fe2 | ADR-018: unknown memory layer gets reinvented | Reach-doctrine re-ask |

## Coverage tally (plan requires ≥3 DECISION, ≥3 CONSTRAINT, ≥5 LEARNING, ≥2 PATTERN, ≥2 AND-stress, ≥2 paraphrase)

| bucket | count | requirement |
|--------|-------|-------------|
| LEARNING | 6 (q01-q05, q20) | ≥5 ✓ |
| DECISION | 5 (q06-q10) | ≥3 ✓ |
| CONSTRAINT | 3 (q11-q13) | ≥3 ✓ |
| PATTERN | 2 (q14-q15) | ≥2 ✓ |
| keyword-stress (multi-word AND) | 2 (q16-q17) | ≥2 ✓ |
| paraphrase (semantic-only) | 2 (q18-q19) | ≥2 ✓ |

Multi-hash expected sets: q09 (2 hashes), q19 (3 hashes) — exercise set-membership scoring.

## Known scoring caveats

- Keyword AND-semantics is strict: most golden queries return exactly 1 result. Keyword recall@5 ≈ 18/20 (0.90) with q18/q19 as designed misses is the expected baseline shape.
- Recency decay (`_adjustedScore`) uses wall-clock `Date.now()`, so semantic/hybrid scores drift daily. A seed entry sitting near the 0.55 threshold can decay below it over weeks — if the semantic baseline gets noisy over time, that is real retrieval degradation of aging entries, not harness flakiness. Revisit tolerance only if it bites.

## Baseline (added after task 4)

_Pending first `--baseline` run._

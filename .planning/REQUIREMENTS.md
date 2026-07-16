# Requirements: Second Brain — v1.7 Prove Compounding

**Defined:** 2026-07-15
**Core Value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.

Full investigation and file-level design: approved plan at `/Users/cpconnor/.claude/plans/craete-a-plan-to-bright-cookie.md`. Verdict thresholds accepted by Pete 2026-07-15 (last 14-row window): entries +5 and kb growth; recall used ≥40% of days; hit rate ≥60%; week-2 utility ≥ week-1 − 10pts. A "refuted/flat" verdict is a successful outcome — the instrument worked.

## v1.7 Requirements

### Stats Pipeline Integrity (STATS-PIPE)

- [ ] **STATS-PIPE-01**: Daily-counter cache is never polluted by the test suite — counter writes under jest resolve to a temp dir unless `CACHE_DIR_OVERRIDE` is set, with a regression tripwire test
- [ ] **STATS-PIPE-02**: Counters from days where `/today` never ran are flushed into `daily-stats.md` rows on the next real `/today` (idempotent, via existing `recordDailyStats`), and counter files older than ~14 days are cleaned up after flush
- [ ] **STATS-PIPE-03**: A local launchd job runs `/today` scheduled mode weekday mornings (06:45 local) so a daily-stats row lands without manual action; `config/scheduling.json` documents that RemoteTrigger is vault-unreachable and stays disabled

### Retrieval Outcome Instrumentation (STATS-OUTCOME)

- [x] **STATS-OUTCOME-01**: Every `/recall` invocation records hit/miss (≥1 result and not blocked) alongside the existing count; new `recall_hits` column in daily-stats; query text is never persisted (excluded-terms content policy)
- [x] **STATS-OUTCOME-02**: Every non-dry-run `/today` records whether Memory Echo was shown and its top score; new `echo_shown` and `echo_score` columns; `readDailyStats` returns numeric cells (coercion at the root, `—` survives as string)

### Trend Computation & Report (TREND)

- [ ] **TREND-01**: Pure `computeCompoundingTrend(rows, {windowDays})` returns supply/demand/utility metrics and a `compounding | flat | insufficient-data` verdict per the accepted thresholds (insufficient below 7 rows; missed days are gaps, not zeros)
- [ ] **TREND-02**: The verdict surfaces in two places: a `## Compounding` section in `/today` (suppressed under 7 rows, Memory Echo null-suppression precedent) and a standalone `scripts/compounding-report.js` CLI printing the full evidence table + verdict as markdown

## Follow-Up (calendar-gated, not in roadmap phases)

- **VERDICT-01**: ~3 weeks post-ship (≥14 weekday rows): confirm scheduler alive (row every weekday in trailing week), observe `computeMemoryHealth` live with ≥3 rows, archive `scripts/compounding-report.js` output with the verdict to `.planning/` — honest refuted/flat accepted

## Out of Scope

| Feature | Reason |
|---------|--------|
| RemoteTrigger repair | Architecture mismatch — cloud env cannot reach local vault; local launchd replaces it |
| Backfill of the 5 existing counter days | Provably jest-contaminated dev noise; deleted before go-live (Pete approved) |
| Weekend zero-rows | Trend math windows by calendar date; gaps are honest |
| Query-text logging | daily-stats.md is a vault/exportable surface; excluded terms must never leak |
| RRF/cosine trend columns | topScores stay emit-only per D-07; readable from counter JSONs later if wanted |
| HTML dashboards / charts / sparklines | Markdown table + verdict is the cheapest honest proof |
| Echo causality / click-through tracking | "Recalled memory influenced work" evidence is a future milestone if v1.7 proves the basics |
| Per-query logs | Aggregate counts and scores suffice for the thesis |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STATS-PIPE-01 | Phase 29 | Pending |
| STATS-PIPE-02 | Phase 29 | Pending |
| STATS-PIPE-03 | Phase 29 | Pending |
| STATS-OUTCOME-01 | Phase 30 | Complete |
| STATS-OUTCOME-02 | Phase 30 | Complete |
| TREND-01 | Phase 31 | Pending |
| TREND-02 | Phase 31 | Pending |

**Coverage:**
- v1.7 requirements: 7 total
- Mapped to phases: 7
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-15*
*Last updated: 2026-07-15 after v1.7 milestone start*

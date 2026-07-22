# Requirements: Second Brain — v1.8 Measured Memory

**Defined:** 2026-07-19 (reconstructed into this file 2026-07-21 — v1.8 requirements previously lived only in ROADMAP.md phase text and per-plan `requirements:` frontmatter)
**Core Value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.

Prior milestone requirements: [milestones/v1.7-REQUIREMENTS.md](milestones/v1.7-REQUIREMENTS.md).

## v1.8 Requirements

### Retrieval Eval (EVAL)

- [x] **EVAL-BASE-01** *(retroactive ID — plan 32-01 predates per-plan requirement IDs)*: Recall quality is measurable: `npm run eval:recall` scores a 20-question golden set (`eval/golden-recall.json`) over a frozen seed vault across keyword/semantic/hybrid modes, with a committed pre-tuning baseline (`eval/baseline-2026-07-19.json`) and exit 1 on regression

### Capture Reliability (CAP)

- [x] **CAP-LAUNCHD-01**: The `com.secondbrain.daily-sweep` launchd job is fixed (node@22 PATH, WorkingDirectory, env), versioned in `config/`, and observed firing for real in launchd context
- [x] **CAP-CLASSIFIER-01**: `src/utils/classifier-health.js` (voyage-health clone) gates local-27B → `classifyAnthropic` fallback on HTTP/parse/timeout errors, with a per-night Haiku call cap (`classifier.haikuNightlyCap`)
- [x] **CAP-EVIDENCE-01**: `state/daily-sweep-last-run.json` proof-of-fire evidence + `/today` Compounding sweep line ("ran/STALE/NEVER RAN")

### Promotion Integrity & Lifecycle (PROMOTE / VERIFY / CONTRADICT / SUPERSEDED / DREAM)

- [x] **PROMOTE-PARSE-01**: Shared `parseCheckboxState` handles whitespace/near-miss checkbox forms at the promotion gate
- [x] **PROMOTE-VAULT-01**: Promotion resolves the vault root at call time, not module load
- [x] **PROMOTE-ID-01**: Collision-safe candidate IDs at promotion
- [x] **CONTRADICT-CHECK-01**: Shared `checkContradiction` helper surfaces contradictions at promotion (hybrid top-5, flag-only — never blocks, never auto-resolves)
- [x] **SUPERSEDED-CONVENTION-01**: `superseded-by::` / `stale::` entries are downranked on the read path (`memory-reader.js`)
- [x] **VERIFY-SENTINEL-01**: `scripts/verify-baseline.js` returns a real exit code over the 27 pre-governance hashes, wired into the pre-push gate
- [x] **DREAM-CONSOLIDATION-01**: Monthly snapshot-first dream consolidation — `/dream-propose` (MERGE with mechanical quote guard, STALE, MISSED PATTERNS) + human-only `/dream-apply` with `eval:recall` gate and auto-restore; monthly launchd plist (`com.secondbrain.dream`)

### Proactive Memory (INJECT)

- [x] **INJECT-HOOK-01**: SessionStart hook `.claude/hooks/session-memory-inject.js` injects hybrid top-5 recall for a project-derived query; fail-open on infra (exit 0 always); ~750-token hard cap; latency gate (<1s Voyage-up, <250ms degraded)
- [x] **INJECT-EGRESS-01**: Injected entries pass the reach exporter's fail-closed `checkContent` egress loop
- [x] **INJECT-KILL-01**: Kill switches — `sessionInject.enabled` config + `SB_SESSION_INJECT=0` env

### Ingest Breadth (Phase 36 — decision-gated, unscheduled)

- [ ] *No requirements defined.* Phase 36 (Drive connector + connector→memory seam) is gated on a real L10 RAG Phase 3 timeline. Requirements get defined if/when Pete opens the gate.

## Follow-Up (calendar-gated, not roadmap phases)

- **VERDICT-01** (carried from v1.7): ~3 weeks post-ship (≥14 weekday rows, due ~2026-08-06): confirm scheduler alive over a trailing week, observe `computeMemoryHealth` live, archive `scripts/compounding-report.js` output with the verdict to `.planning/` — honest refuted/flat accepted

## Out of Scope

| Feature | Reason |
|---------|--------|
| Semantic-threshold tuning | Gated on the Phase 32 baseline existing; separate later plan (open lead: semantic misses q10/q17 at 0.55) |
| Auto-apply for dream consolidation | Human-only by design — `/dream-apply` never runs unattended |
| Connector→memory seam before Phase 36 gate | Build once when L10 RAG timeline is real; do not fork early |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EVAL-BASE-01 | Phase 32 | Complete (PR #74, 2026-07-19) |
| CAP-LAUNCHD-01 | Phase 33 | Complete (PR #88, 2026-07-21) |
| CAP-CLASSIFIER-01 | Phase 33 | Complete (PR #88, 2026-07-21) |
| CAP-EVIDENCE-01 | Phase 33 | Complete (PR #88, 2026-07-21) |
| PROMOTE-PARSE-01 | Phase 34 | Complete (PR #86, 2026-07-21) |
| PROMOTE-VAULT-01 | Phase 34 | Complete (PR #86, 2026-07-21) |
| PROMOTE-ID-01 | Phase 34 | Complete (PR #86, 2026-07-21) |
| CONTRADICT-CHECK-01 | Phase 34 | Complete (PR #86, 2026-07-21) |
| SUPERSEDED-CONVENTION-01 | Phase 34 | Complete (PR #86, 2026-07-21) |
| VERIFY-SENTINEL-01 | Phase 34 | Complete (PR #86, 2026-07-21) |
| DREAM-CONSOLIDATION-01 | Phase 34 | Complete (PR #86; gate docs #87, 2026-07-21) |
| INJECT-HOOK-01 | Phase 35 | Complete (PR #89, 2026-07-21) |
| INJECT-EGRESS-01 | Phase 35 | Complete (PR #89, 2026-07-21) |
| INJECT-KILL-01 | Phase 35 | Complete (PR #89, 2026-07-21) |

**Coverage:**
- v1.8 requirements defined: 14 total (Phase 36 defines its own if gated open)
- Mapped to phases: 14
- Complete: 14 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-19*
*Last updated: 2026-07-21 — reconstructed from ROADMAP.md + v1.8 phase-plan `requirements:` frontmatter during full-project audit*

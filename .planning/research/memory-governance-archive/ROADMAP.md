# Harness Memory Governance — Roadmap

**Classification:** MULTI-MILESTONE

Three separable shipping units. Each ships value alone. You could stop after any one of them and still be net-ahead — which is the test for a milestone boundary rather than a phase boundary.

---

## Milestone sequence

| # | Milestone | Description | Estimated effort | Target ship |
|:---:|:---|:---|:---|:---|
| M01 | `memory-substrate-live` | One source of truth per fact, structurally enforced. Kills the CLAUDE.md ↔ `~/context/` duplication. Baseline captured. | 10–13 h | +2 weeks |
| M02 | `lifecycle-engine-live` | Knowledge stops dying. Hooks + extraction + the weekly pass. Retention/decay/promotion actually execute. | 12–16 h | +4 weeks |
| M03 | `compounding-proof` | You can prove it works. Full eval harness, the five metrics, telemetry-driven skill prune. | 8–10 h | +6 weeks |

---

## Milestone details

### M01 — memory-substrate-live

**Goal:** Every fact has exactly one home, and you have a number that says how well the harness knows you today.

**Phases:** 5
**Status:** PHASE_PLANNED (phase-01 fully planned; 02–05 stubbed)

**Acceptance criteria:**
- `~/memory` git repo exists, private, with `canon/ working/ ledger/ procedural/ _meta/`
- `_meta/AUTHORITY.md` resolves every fact-type to exactly one home; auto-memory is explicitly Tier-4
- `_meta/LIFECYCLE.md` states the retention/decay/promotion/reconciliation rules — all countable
- CLAUDE.md is a router under 100 lines and contains near-zero facts
- Duplicate-fact check script returns zero cross-file duplicates
- `gitleaks` pre-commit hook installed and passing; exclusion-term grep gate passing
- Cold-start recall **baseline** recorded for Claude Code, Desktop, and Cowork
- Cold-start recall after migration ≥ baseline (must not regress)

**Ships value alone:** Yes. Even with no automation, single-source-of-truth ends the conflict risk and makes every surface read the same canon.

---

### M02 — lifecycle-engine-live

**Goal:** Knowledge stops dying at the eviction boundary, and promotion stops depending on Pete remembering.

**Phases:** 6 (stubbed — planned when M01 ships)

- `phase-01` — Skill-usage telemetry hook (`PostToolUse` → append-only log). Cheap, and it's the data the M03 prune needs, so it must start collecting *now*, not later.
- `phase-02` — **`PreCompact` promotion hook.** The flagship. Flush-on-eviction at the exact instant knowledge would otherwise be summarized away.
- `phase-03` — `SessionStart` injection hook. Router + open loops, hard-capped at 2k tokens. Every session starts warm.
- `phase-04` — Transcript-extraction pipeline. Reads `~/.claude/projects/*.jsonl`, scrubs secrets + excluded terms, writes to `working/_inbox/` append-only.
- `phase-05` — The weekly pass. A slash command + a Cowork scheduled task. The only writer to `canon/`. ≤15 min.
- `phase-06` — First live run + `memory_user_edits` reconciliation batch against the auto-memory blob.

**Acceptance criteria:**
- All hooks fail open (delete the hook file → session still starts clean)
- A decision made mid-session survives forced compaction (eviction eval passes)
- `SessionStart` injection measured ≤ 2k tokens
- Weekly pass runs end-to-end in ≤ 15 min of attention, produces a diff Pete actually reads
- Zero secrets, zero excluded terms in the inbox after a full week of real capture

**Ships value alone:** Yes. Even without the M03 eval harness, the lifecycle engine stops the bleeding.

---

### M03 — compounding-proof

**Goal:** Replace "it feels better" with a number that moves.

**Phases:** 4 (stubbed)

- `phase-01` — Full eval harness: cold-start, decay (does it correctly *stop* asserting resolved things), conflict (does canon beat the blob), eviction.
- `phase-02` — The five metrics + a dashboard: retrieval precision, canon churn, resurrection rate, promotion latency, skill utilization.
- `phase-03` — Skill-estate prune, 39 → ≤28, driven by real invocation telemetry from M02 phase-01.
- `phase-04` — Regression regime: the eval suite runs on a cadence and a drop trips an alert.

**Acceptance criteria:**
- Cold-start recall ≥ baseline + 30pp
- Canon churn < 10%/month (high churn = promoting too eagerly)
- Resurrection rate < 15% (high = decaying too aggressively)
- Inbox discard rate ≥ 80% (low discard = promoting junk)
- Skill count ≤ 28, every survivor with a non-zero 90-day invocation count

**Ships value alone:** Yes — and it's the milestone that tells you whether M01 and M02 were worth it.

---

## Cross-milestone dependencies

- **M02 depends on M01 shipping** — specifically `_meta/AUTHORITY.md` and `_meta/LIFECYCLE.md`. The hooks enforce those rules; without them the hooks have nothing to enforce.
- **M03 phase-03 (skill prune) depends on M02 phase-01 (telemetry)** having run for ≥ 30 days. You cannot prune on zero data. **This is why telemetry is the *first* phase of M02, not a later one** — it needs a running start.
- **M03 phase-01 depends on the M01 baseline.** No baseline, no measurable improvement, no falsifiable project.
- M01 phase-04 (`memory_user_edits`) and M02 phase-06 (reconciliation batch) touch the same 30-edit budget. Sequence them; don't run both blind.

---

## Risks at program level

| Risk | Why it's program-level |
|:---|:---|
| **The weekly pass doesn't happen.** | This is the #1 killer. Every milestone's value decays to zero if the ritual dies. It is scheduled, capped at 15 min, and designed to produce something Pete *wants to read* (a "what changed / what's rotting" briefing), not a chore. If it slips two weeks running, stop and redesign the ritual before adding features. |
| **Scope creep into a memory platform.** | The gravitational pull toward embeddings, scoring engines, and agent-memory architecture is strong and it is a trap at this corpus size. The anti-build list in PROJECT.md is load-bearing. Re-read it before adding anything. |
| **Secrets or excluded terms escape into the repo.** | Spans all milestones because capture runs continuously. Gated pre-commit from M01 phase-02 onward — before a single transcript is ingested. |
| **Cold-start recall doesn't move after M01.** | If the substrate lands and the number doesn't budge, the thesis is wrong. **Stop. Do not build M02.** Re-diagnose. Better to kill it at 12 hours than 35. |
| **Vendor change (Anthropic alters memory or hook behavior).** | The substrate is plain markdown + git and survives anything. The surfaces (hooks, global instructions, CLAUDE.md) are thin adapters. If Anthropic changes the platform, rewrite adapters, keep the substrate. This is why the substrate is deliberately boring. |

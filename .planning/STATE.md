---
gsd_state_version: 1.0
milestone: v1.8
milestone_name: Measured Memory
status: in_progress
last_updated: "2026-07-31T00:00:00.000Z"
last_activity: 2026-07-31
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 13
  completed_plans: 13
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-15 after v1.7 milestone start)

**Core value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.
**Status:** v1.8 phases 32-35 shipped; Phase 36 decision-gated

## Current Position

Milestone: v1.8 Measured Memory — Phases 32-35 SHIPPED (32: PR #74 2026-07-19; 33: PR #88, 34: PR #86 + close-out #87, 35: PR #89 — all 2026-07-21). Phase dirs archived to milestones/v1.8-phases/.
Phase 36 (Ingest Breadth): decision-gated, unscheduled — gate is a real L10 RAG Phase 3 timeline. Pete's call.
Repo: master clean at `161e9f0` (audit & improvement pass, PR #96, merged 2026-07-31 — post-merge CI + CodeQL both green). Suite 1568 tests / 82 files: CI-measured 1530 passing, 38 skipped; coverage branches 80.95% / statements 92.03% / functions 95.78% / lines 92.99%; lint 0 warnings.
Memory store: 285 entries, embeddings sidecar 285 vectors (full coverage, verified).
Last activity: 2026-07-31 - Audit & improvement pass (PR #96): 13 reliability fixes on silent-failure paths, vault `maps/` MOC layer, dream cycle (4 merges applied, gate passed), buffered backlog drained (98 promoted / 405 rejected-and-archived)
Prior milestone: v1.7 Prove Compounding — SHIPPED and archived (PR #66 merged 2026-07-16); VERDICT-01 calendar-gated follow-up still open (due ~2026-08-06: ≥14 weekday daily-stats rows)

**Shipped milestones:**

- v1.0 MVP (2026-04-22) — tag v1.0
- v1.1 Go Live (2026-04-23) — tag v1.1
- v1.2 Automation & Quality (2026-04-23) — tag v1.2.0
- v1.3 Review Remediation (2026-04-24) — tag v1.3.0
- v1.4 Memory Activation & Final Closeout (2026-04-26) — tag v1.4
- v1.5 Internal Hardening (2026-04-26) — tag v1.5
- v1.6 Enforcement Integrity & Surface Completion (2026-07-15)
- v1.7 Prove Compounding (2026-07-16) — PR #66

**Current milestone:** v1.8 Measured Memory (Phases 32-36) — Phases 32-35 complete (32: 2026-07-19; 33-35: 2026-07-21); Phase 36 decision-gated. Between-phase passes: vault restructure 2026-07-26 (PR #93), audit & improvement pass 2026-07-31 (PR #96).

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions table. Per-milestone summary:

- **v1.0/v1.1:** architectural + integration decisions (vault boundary, pipeline stages, connector topology)
- **v1.2:** automation & quality decisions (hooks, agents, CI, local LLM)
- **v1.3:** remediation decisions (config overlay, architecture decomposition, test quality focus)
- **v1.4:** memory activation decisions (Voyage embeddings calibrated 0.55 threshold, schema_version model+dim only, Pattern 7 degradation 3-fail/15-min, manifest-first protocol, ASCII-only matcher Path B, America/Chicago timezone, branch protection PR-required-reviews)
- **v1.5:** test-verifier dual-mode (Phase-Closure Verification Mode); memory health anomaly detector reads daily-stats rows
- **v1.6:** promotion safety (dry-run zero-side-effects, deferred-as-live-status), reach layer (ADR-019 pointer+digest, fail-closed egress), authority hierarchy (ADR-020), fail-closed semantic exclusions
- **v1.7 (2026-07-15, Pete):** launchd scheduler (RemoteTrigger is vault-unreachable — cloud env cannot write local vault); milestone closes at code-ship, verdict is a dated follow-up; delete 5 jest-polluted daily-counter cache files; verdict thresholds accepted (14 rows: entries +5, recall days ≥40%, hit rate ≥60%, week-2 ≥ week-1 − 10pts); query text never persisted (content policy)
- [Phase 30]: recordRecallInvocation moved to after results are known so hit/miss and resultCount are captured in the same call
- [Phase 30]: recordEchoShown guarded by mode !== 'dry-run' so practice /today runs never pollute echo counters
- [Phase 31-trend-report]: Pure compute/render split for compounding-trend engine (no I/O), thresholds hardcoded as Pete-accepted literals
- [Phase 31-trend-report]: CLI always prints the evidence table, including insufficient-data verdicts at <7 rows — Deliberately unlike the /today section (31-02), which suppresses the section below 7 rows -- the CLI is the archived audit trail and must show its work even when the verdict is inconclusive

### Open Blockers

None. (Branch protection restored 2026-07-21, quick task 260721-tx7: PR required with 0 approvals, `test (22)` required + strict, force-push/deletion blocked, enforce_admins off — verified live via GET. The audit's restore list included `test (20)`, but the CI matrix is Node 22-only since the node:sqlite floor — requiring a check that never reports would block all merges, so protection tracks the live matrix.)

### Filed, not fixed

- **Audit P1/P4/P5/P6/P8 (2026-07-30)** — the five unfixed items from the audit report, now written up as candidate phases in ROADMAP.md. Nothing about them is scheduled.
- **Desktop-chat userPreferences pointer line** — manual item from v1.6, confirm Pete pasted it.
- (Resolved 2026-07-21, quick task 260721-tx7: `daily-stats-frontmatter.schema.json` `schema_version` type fixed string → integer with Pete's /gsd:do dispatch approval; test fixtures flipped to the corrected contract.)

(Resolved 2026-07-21 audit: rejected-candidates `status::` rewrite had already shipped in c0b3c70 (PROMOTE-REJECT-01) — line removed.)

### Pending Todos

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260426-mpy | Wire up missing slash commands and extract GSD knowledge into memory proposals | 2026-04-26 | 6dccf0b | [260426-mpy](./quick/260426-mpy-wire-up-missing-slash-commands-and-extra/) |
| 260719-lfn | Capture fixes: dotenv gate, embed counts, category validation, daily-sweep transcript+inbox capture, reach expansion (15 targets), launchd schedule | 2026-07-19 | 8c2a21c | [260719-lfn](./quick/260719-lfn-capture-fixes-dotenv-gate-embed-counts-c/) |
| 260719-llv | Memory reorg: 21 entries archived (archive-not-delete), 24 recategorized, auto-index, sidecar prune+heal to 135/135 parity | 2026-07-19 | 1f32e8b | [260719-llv](./quick/260719-llv-memory-reorg-archive-seed-dup-entries-re/) |
| 260721-rst | Fix local-LLM reasoning-model starvation: reasoning_effort:none disable (verified live vs qwen3.6-27b), reasoning-starved SHAPE_ERROR guard, 60s local timeout, default model → qwen3.6-27b | 2026-07-21 | 6d8c472 | [260721-rst](./quick/260721-rst-local-llm-reasoning-starvation/) |
| 260721-gyj | Memory wiki optimization: lesson→LEARNING alias + silent coercion (5 notes stripped, 0 remain), related:: wikilinks at promotion + 180-entry backfill (98.9% coverage, unique ^hash block anchors), reader field-parse root-cause fix, sidecar parity 180/180 | 2026-07-21 | df1a484 | [260721-gyj](./quick/260721-gyj-memory-wiki-optimization-category-fix-re/) |
| 260721-ljn | Session close-out batch (verified): dream-apply gate docs fixed (SKILL.md + 4 dream.js sites), scheduled dream pinned to Anthropic via LLM_PROVIDER (launchctl-live), changeset confirmed resolved 12+3-rejected (apply no-op, rejections preserved), wiki graph refreshed 178/180 (98.9%) via pinned Haiku after LM Studio wedge, phase-34 branch deleted; suite 1440 passed | 2026-07-21 | 2d26ea4 | [260721-ljn](./quick/260721-ljn-session-close-out-batch-dream-apply-skil/) |
| 260726-qcw | Vault restructure: 103 files moved into folders (root 83 → 1 loose file, top-level 109 → 26), archive constants repointed at all 7 sites in the same change-set as the moves, RIGHT/ dissolved (stats + briefings → briefings/), gateway names + quarantines vault-root writes, vault_hygiene column in daily-stats, memory/dashboard.md regenerated on every promotion; dedup proven intact on a real archived hash, verify:baseline 27/27, recall output unchanged | 2026-07-26 | 8273de2 | [260726-qcw](./quick/260726-qcw-vault-restructure-hold-path-constants-ga/) |
| 260721-tx7 | Pete-gated audit fixes: branch protection restored + verified live (PR required, test (22) strict — matrix is Node 22-only); daily-stats schema_version string→integer with test contract flip; dep majors — SDK 0.112.5 + eslint-plugin-n 18 landed (content-policy lazy-init, Unlicense allowlisted), voyageai 0.4.0 evidence-rejected; pre-existing Voyage UAT jest flake diagnosed + filed | 2026-07-21 | 62ff9e5 | [260721-tx7](./quick/260721-tx7-pete-gated-audit-fixes-branch-protection/) |
| 260827-oxq | Recall `--since` arm parity: semantic arm filtered the sidecar's local-offset `addedAt` as a raw string while keyword filtered the heading date, so the whole 200-entry 2026-08-22 batch was invisible to `--semantic` and `--hybrid` fused a full list with an empty one (reproduced: 3 hits vs `No results`); fixed at semantic-index.js:491 via `byHash`, +2 regression tests (parity + cutoff guard, parity fails on pre-fix source). Vault store: 4 missing `^anchor` lines restored on dream-merge outputs (dangling wikilinks 1→0, unresolved supersede pointers 8→0) and 7 critic-confirmed falsified entries `stale::`-flagged after verifying content_hash covers the body only. Suite 1540 passed/1578 total, verify:baseline 27/27, lint clean. eval:recall gate NOT satisfied — hangs (exit 124, zero output) on pre-fix source too, so pre-existing and unrelated; filed in the summary | 2026-08-27 | (this branch) | [260827-oxq](./quick/260827-oxq-recall-since-arm-parity-memory-md-anchor/) |

## Session Continuity — 2026-07-31 (audit & improvement pass)

**PR #96 merged to master (`161e9f0`); post-merge CI + CodeQL both green.** Current branch is `chore/docs-sync-brain-map-2607`, carrying doc-sync edits only.

- Repo: 13 reliability fixes on silent-failure paths (pid-probing `acquireLock`, min-of-timeouts in `classifyLocal`, extraction-wide deadline, SDK per-request timeout, `oversizeThresholdBytes` enforced, `today-scheduled.js` exit 1 on error envelope, per-file `extraction-error`, honest `/wrap` staged-vs-buffered counts, `LOAD_ERROR` on excluded-terms load failure). Details in MILESTONES.md.
- Vault: 8-note `maps/` MOC layer (`maps/home.md` entry point, 6 MOCs, `how-to-read-the-brain-map.md` legend), 16 files triaged (moves only), 8 empty dirs removed, quarantine manifest added, LEFT `aliases:` frontmatter added under explicit operator authorization.
- Memory: 183 → 285 entries. Dream cycle applied 4 of 15 proposed merges with the retrievability gate passing; 11 rejected with written reasons in `proposals/dream-changeset-2026-07.md`. Backlog drain resolved 503 — 98 promoted in 10 batches, 405 rejected and archived, 0 exclusion violations; 2 synthetic dedup-test fixtures left unresolved on purpose.
- Local model: `qwen/qwen3.6-27b` context 32768 → 65536 (flash attention + q8_0 K/V), persisted durably; `localTimeoutMs` 60000 → 900000. That 900s ceiling is what makes the daily-sweep deadline a real candidate item.
- **⚠️ Local classifier is degraded as of 2026-07-31 19:39Z, and the cause is structural.** `~/.cache/second-brain/classifier-health.json`: `consecutive_failures: 6`, `last_failure_code: "timeout"`, `haiku_calls: 50` — the entire `haikuNightlyCap` (50) spent in one day. LM Studio itself is healthy (`lms ps` shows the model loaded at 65536, `/v1/models` serving). The arithmetic is the problem: the Stop hook passes `timeoutMs: 50000` (`.claude/hooks/memory-extraction-hook.js:50`) and measured cold prefill is ~86 tok/s, so a 50s budget covers roughly **4,300 prompt tokens** — while a real session transcript runs into six figures. Hook-driven local extraction therefore times out by construction on every non-trivial transcript and falls back to Haiku until the cap is gone. PR #96's timeout clamp did exactly what it was designed to do (bound the call and record the failure instead of dying silently at SIGKILL); it also made visible that the local provider is unusable from the hook. Terminal `/wrap` is unaffected — it gets the full 900s. See the ROADMAP candidate for the fix options.
- Voyage: new API key with billing installed by the operator after free-tier 3 RPM 429s failed the dream gate closed once; health tracker now at 0 consecutive failures.
- `eval:recall` unchanged against `eval/baseline-2026-07-19.json` before and after (keyword 0.900, semantic 0.800, hybrid 0.900 recall@5). Reminder: that eval scores the frozen seed vault, not live `memory.md`.

## Session Continuity — 2026-07-21 (full project audit & close-out)

**Audit branch `chore/full-audit-close-2026-07-21` complete and local — push awaits Pete's go.** Full pass: orient → automation health → deps → tests → doc sync → backlog triage → readiness → ship check → finalize.

- Health DEGRADED (18 warnings) → HEALTHY (0/0). Suite 1470/38/1508 green ×2; lint 0 errors; license PASS; npm audit 0; `eval:recall` exact baseline match.
- Real fix: scheduled `/today` ran keyless (plist inline `node -e`, no dotenv — Haiku fallback auth-failed 07-21 06:45). Now `scripts/today-scheduled.js` + versioned plist, rebootstrapped, dry-run-verified. **Watch tomorrow's 06:45 fire** in `~/Library/Logs/com.secondbrain.today.err.log` — zero auth errors expected.
- Docs/planning synced (21 drift findings), v1.8 REQUIREMENTS reconstructed (14/14), backlog re-triaged (13 resolved / 2 dropped / 4 dispositioned), v1.2-era artifacts quarantined, `[gone]` phase-33 branch pruned.
- Handoff details: `tasks/SESSION_REPORT-2026-07-21-full-audit.md` + `tasks/todo.md` (fresh 2026-07-21 block). PR body: `.planning/PR-BODY-full-audit.md`.

Prior session-66 v1.7 grounding notes: archived with v1.7 (see `milestones/v1.7-*`).

## Next Action

Next session picks up, in order:
1. Land the current `chore/docs-sync-brain-map-2607` branch (doc-sync edits only) as a PR, then return to a clean master.
2. Highest-value candidate from the 2026-07-30 audit: **memory provenance backfill** — 16 of 285 entries lack both `source-ref::` and `added::`, and the dream MERGE writer still never emits them, so every future merge widens the gap. Patch the writer first, then backfill through the proposal gate. Related: 22 lines still cite the nonexistent `_audit/2026-07-18` path.
3. Then the remaining candidates in ROADMAP.md, ranked as the audit ranked them: `/today` silent-degradation closure (P5), daily-sweep deadline (P6 — now urgent because `localTimeoutMs` is 900s), OTHER-category justification gate (P4), vault hygiene follow-ups (P8: standup filename convention, quarantine disposition).

Pete decisions, in order:
1. VERDICT-01 (~2026-08-06): run `node scripts/compounding-report.js` once ≥14 weekday rows exist; archive output + verdict to `.planning/`.
2. Phase 36 gate: open (define requirements, plan, execute) or close v1.8 without it (`/gsd:complete-milestone`).
3. Whether the audit candidates become a numbered v1.9 milestone or land as between-phase passes inside v1.8.

# Milestones

## Between-Phase: Audit & Improvement Pass (2026-07-31, PR #96)

Not a milestone — a between-phase pass inside v1.8, recorded here because it moved the memory store and the vault more than most phases have. Merged to master as `161e9f0`; post-merge CI and CodeQL both green.

**13 reliability fixes — 7 from the 2026-07-30 audit, 6 from Codex review.** Every one closes a path that failed silently:

- `src/memory-proposals.js` `acquireLock` reclaims a stale-by-age lock only after probing the recorded pid with `process.kill(pid, 0)` — live and EPERM holders are never reclaimed, ESRCH-dead and corrupt/pid-less locks are. This was the silent-loss path: a SIGKILLed holder left `proposals.lock` in place forever and every later candidate was buffered while being reported as staged.
- `src/pipeline-infra.js` `classifyLocal` uses `Math.min(llmConfig.localTimeoutMs, callOptions.timeoutMs ?? Infinity)`, so the Stop hook — killed at 60s — passes 50000ms instead of inheriting the 900s config.
- `src/memory-extractor.js` treats `options.timeoutMs` as a single extraction-wide deadline: each classify gets the remaining budget and chunk processing stops with a recorded `timeout` failure below a 2s floor.
- `src/pipeline-infra.js` `classifyAnthropic` honors `callOptions.timeoutMs` as the Anthropic SDK per-request `{ timeout }`.
- `oversizeThresholdBytes` (`config/pipeline.json`, 5 MiB) is enforced instead of being dead config — chunks close on accumulated byte size too, a single over-threshold message is byte-truncated with a `[truncated: oversize message]` marker, and the message-count threshold is checked first so count-forced chunking never materializes the full high-signal-doubled corpus.
- `scripts/today-scheduled.js` exits 1 when `runToday` resolves an error envelope; it used to exit 0, so launchd recorded briefing-less mornings as success.
- `src/memory-extractor.js` `extractFromFile` wraps the candidate loop so throws are recorded via `recordFailure(results, 'extraction-error')` instead of aborting a whole directory sweep.
- `scripts/wrap.js` counts staged as `written === true && !buffered` and prints "N staged, M buffered — run /wrap again to drain".
- `src/pipeline-infra.js` `loadExcludedTerms` logs `logDecision('CONFIG', 'excluded-terms.json', 'LOAD_ERROR', ...)` instead of silently returning `[]`, which had disabled the exclusion gate outright.

**Vault graph restructure.** New 7-note `maps/` MOC layer: `maps/home.md` as the single entry point plus `projects-moc`, `second-brain-moc`, `ctg-moc` (extended to all 15 `ctg/` notes), `claude-code-ops-moc`, `standups-moc`, `briefings-moc`. Before: no home note, both pre-existing MOCs orphaned, 103 orphan notes, only ~60 wikilinks outside `memory.md`, 24% of wikilink targets broken, and 3 empty `.canvas` stubs where a canvas mind map was assumed to exist. 16 files triaged — moves only, nothing deleted — into `archive/dispatch/`, `archive/stubs/`, and `archive/non-vault/`, with 8 empty directories removed and a log at `archive/dispatch/vault-triage-log.md`. `archive/unrouted-quarantine-20260720/README.md` manifest added for the 4,560 files / ~18 MB (97% of vault file count) it holds, excluded from graph and search. Under explicit operator authorization the one LEFT-side change was frontmatter-only: `aliases:` entries on `ABOUT ME/architecture-decisions.md`, `cowork-architecture.md`, and `obsidian-design-system.md` so ~42 title-form links in `memory.md` resolve; the temporary pointer stubs were archived.

**Dream cycle (2026-07-31).** `npm run dream:propose` staged 15 MERGE ops plus 5 missed-pattern ADDs. After per-op review, 4 merges were accepted and applied by `npm run dream:apply` with the live retrievability gate passing (`evalPassed` true, no snapshot restore). 11 were rejected with written reasons in `proposals/dream-changeset-2026-07.md`: overlapping sources that would double-supersede, one golden-hash source, one malformed category, and several low-similarity concatenations of distinct facts.

**Backlog drain (2026-07-31).** The `acquireLock` fix released a 483-candidate buffered backlog. 504 pending candidates were reviewed against fixed criteria: 98 promoted through `/promote-memories` in 10 batches (the cap is 10 per batch), 405 rejected and archived — never deleted. 0 ISPN/Genesys/Asana exclusion violations found. `memory.md` went 187 → 285 entries with the embeddings sidecar at 285 vectors, verified full coverage.

**Retrieval eval.** `npm run eval:recall` ran before and after the code changes and matched `eval/baseline-2026-07-19.json` exactly — keyword recall@5 0.900 / MRR 0.900, semantic 0.800 / 0.800, hybrid 0.900 / 0.900. This eval scores the frozen seed vault (`eval/seed-vault/`), so it gates retrieval code, not live `memory.md` edits.

**Local-model retune.** `qwen/qwen3.6-27b` loaded context 32768 → 65536 with flash attention and q8_0 K/V cache quantization, persisted in `~/.lmstudio/.internal/user-concrete-model-default-config/qwen/qwen3.6-27b.json` so JIT loads inherit it; `config/pipeline.local.json` `localTimeoutMs` 60000 → 900000. Prompted by server logs showing real extraction requests of 33,315 and 62,968 tokens rejected against the then-32,768 context. Measured: two completions at 48,968 prompt tokens, cold prefill ~86 tok/s (~9.5 min uncached, ~26 s warm), generation ~6-7 tok/s, model loads at ~16.3 GiB on 48 GB unified memory.

**Stats:**

- **Test count:** 1568 across 82 test files — CI-measured 1530 passing / 38 skipped (80 of 82 suites run); local 1539 passing / 29 skipped
- **Coverage:** branches 80.95% / statements 92.03% / functions 95.78% / lines 92.99% (CI-measured, `coverage-summary.json` `total.*.pct`)
- **Lint:** `npm run lint` clean, 0 warnings

**Left unfixed — folded into ROADMAP.md as candidate phases:** memory provenance backfill (16 of 285 entries lack `source-ref::`/`added::`, and the merge writer never emits them), the five silent-degradation sections in `/today`, the daily-sweep overall deadline, OTHER-category justification enforcement at promotion time, standup filename standardization, and the quarantine disposition decision.

---

## v1.7 Prove Compounding (Shipped: 2026-07-16)

**Phases completed:** 7 phases, 16 plans, 18 tasks

**Key accomplishments:**

- test-verifier agent extended with Phase-Closure Verification Mode that emits a per-REQ-ID PASS/FAIL/UNTESTED verdict table, triggered by "phase-close N" or "verify requirements: ..." invocation phrasing
- Four-condition anomaly detector wired into /today briefing — surfaces zero promotions, backlog growth, recall drop, and vault plateau when streakDays consecutive days trigger
- JEST_WORKER_ID-guarded counter cache plus flushMissedDays() idempotent recovery, closing both the jest-pollution bug and the vault-unreachable orphan-day gap in one pass.
- macOS launchd job com.secondbrain.today loaded and scheduled weekday 06:45 local to run `/today` in scheduled mode, replacing the vault-unreachable cloud RemoteTrigger as primary scheduler.
- Extended src/daily-stats.js with a recall-hit counter, Memory Echo outcome counter, 11-column schema, and root-level numeric coercion in readDailyStats — the interface Plan 02 wires /recall and /today into.
- Wired /recall and /today to the Plan 01 daily-stats contracts — /recall now records hit/miss + resultCount after search results are known, and /today records Memory Echo shown/score plus flows recallHits/echoShown/echoScore into the 11-column daily-stats row.
- Human-verified checkpoint: a real /recall recorded a hit and a real non-dry-run /today wrote an 11-column daily-stats row to the live vault with valid values and zero query-text leakage. Operator approved 2026-07-16.
- Pure `computeCompoundingTrend`/`renderCompoundingReport` pair in `src/today/compounding-trend.js` turning daily-stats rows into a compounding\|flat\|insufficient-data verdict plus a markdown evidence report — zero I/O, 16 unit tests, shared verbatim by both the `/today` section (31-02) and the CLI (31-03).
- `/today` now computes the compounding trend from daily-stats rows and renders a `## Compounding` section (verdict, three metric bullets, evidence table), suppressed entirely when fewer than 7 rows exist — following the Memory Echo / Memory Health null-suppression precedent.
- `scripts/compounding-report.js` — a standalone CLI mirroring `scripts/recall.js`'s entry-point pattern, printing the full compounding evidence table plus verdict as markdown, unconditionally including at insufficient-data (<7 rows).

---

## v1.6 Enforcement Integrity & Surface Completion (Shipped: 2026-07-15)

**Phases completed:** 6 phases, 14 plans, 19 tasks

**Key accomplishments:**

- test-verifier agent extended with Phase-Closure Verification Mode that emits a per-REQ-ID PASS/FAIL/UNTESTED verdict table, triggered by "phase-close N" or "verify requirements: ..." invocation phrasing
- Four-condition anomaly detector wired into /today briefing — surfaces zero promotions, backlog growth, recall drop, and vault plateau when streakDays consecutive days trigger
- Warn-only SessionStart hook (`checkStaleness`) flags a CLAUDE.md `Last verified:` date older than 14 days, printing the file name and age without ever blocking a session.
- Written authority hierarchy (ADR-020) ranking ABOUT ME/ canon > memory.md > CLAUDE.md > auto-memory blob, wired into the reach-exporter pointer template and both CLAUDE.md router files.
- semanticSearch now fails closed with `{blocked:true, failClosed:true}` when `loadExcludedTerms()` returns empty/unloadable, closing the silent-ungated-Voyage-query hole that reopened the F-01 exclusion bypass.
- Closed the last unreachable command on the advertised surface — `/reroute` now wraps `src/reroute.rerouteFile`, reading `r.to`/`r.from` (never the nonexistent `r.target`).
- Added a blocking pre-push docs-drift gate reusing existing post-merge-doc-sync machinery, and replaced `hooks/pre-push`'s `git reset --hard` remedy with a non-destructive `merge-base --is-ancestor` check.
- Refreshed CLAUDE.md/README.md to a single live `jest --coverage` run: 1245 total tests (1207 passing, 38 skipped) across 64 test files, Statements 92.74% / Branches 81.15% / Functions 96.02% / Lines 93.37% (corrected to the main-tree run; the worktree capture drifted).

---

## v1.5 Internal Hardening (Shipped: 2026-04-26)

**Phases:** 4 (22-25) | **Plans:** 8 | **Commits:** 12 in v1.5 range | **Files changed:** 14 (+1,122 / -75) | **PRs merged:** #50-#53 | **Requirements:** 10/10 complete

**Goal:** Harden the development infrastructure — committed hooks at the git layer, new agent surface for documentation drift and requirement verification, memory health monitoring, and Unicode-safe matching — closing every deferred backlog item from v1.4.

**Key accomplishments:**

- **Phase 22: Committed Hooks** — Pre-commit AJV schema validation for `daily-stats.md` frontmatter and `pipeline.json` config bounds (HOOK-SCHEMA-01). Pre-commit vault-boundary enforcement prevents committing to wrong LEFT/RIGHT side (HOOK-VAULT-01). Dotenv loading moved to entry-points only; `pipeline-infra.js:23` root cause resolved (HOOK-DOTENV-01).
- **Phase 23: Doc Sync Layer** — Post-merge hook compares CLAUDE.md/README.md stats against live jest output, flags drift as non-blocking warnings (HOOK-DOCSYNC-01). Docs-sync agent extended with DOCSYNC-AUDIT mode that blocks phase closure when drift exceeds threshold (AGENT-DOCSYNC-01).
- **Phase 24: Agent Surface** — Test-verifier agent gains Phase-Closure Verification Mode: spawns parallel sub-checks per REQ-ID at phase-close time (AGENT-VERIFY-01). Memory health monitor reads daily-stats.md counters and surfaces anomaly alerts (zero promotions 3+ days, backlog growth, recall drop, vault plateau) in `/today` briefing (AGENT-MEMORY-01).
- **Phase 25: Unicode Hardening & UAT Closeout** — Replaced ASCII-only `.toLowerCase().includes()` with NFKD-normalized `normalizeForMatch()` that blocks full-width Latin, soft-hyphen, and NBSP bypass attacks (HYG-UNICODE-02). 45 test.todo entries promoted to passing assertions. UAT corpus rebaselined at 100% accuracy (UAT-REFRESH-01). GitHub Actions UAT workflow smoke run confirmed end-to-end (UAT-SMOKE-01).

**Stats:**

- **Test count:** 1190 (1152 passing, 38 skipped, 0 todo) across 56 files
- **Coverage:** 81.28% branch / 94.62% statements / 96.94% functions / 95.53% lines
- **src/ LOC:** ~9,700 (minimal growth — hardening milestone, not feature work)
- **Timeline:** 2026-04-26 (1 day — all 4 phases planned and executed same day)

**Locked decisions:**

- normalizeForMatch strips ALL whitespace (not just NBSP) for multi-word term consistency
- UAT tests require Anthropic API, not local LM Studio — pipeline.local.json routing documented as pre-existing config interaction
- test-verifier dual-mode: invocation phrasing triggers Phase-Closure Verification Mode
- Memory health anomalies surface only when threshold conditions met (no false alerts)

**Known gaps:** FIX-02 (config hot-reload) — restart workaround sufficient. All v1.4 backlog items fully resolved. No new backlog items generated.

**Tag:** v1.5

---

## v1.4 Memory Activation & Final Closeout (Shipped: 2026-04-26)

**Phases:** 5 (17-21) | **Plans:** 23 | **Commits:** ~50 in v1.4 range | **Files changed:** 114 (+21,393 / −138) | **PRs merged:** #25–#48 | **Audit:** tech_debt status (Option C — fix user-facing, absorb process drift)

**Goal:** Activate the write-only memory layer (keyword + semantic retrieval), prove memory compounds daily via instrumentation, close the UAT CI gap, and clear every deferred hygiene item from v1.3. The closing milestone of the v1.x cycle.

**Key accomplishments:**

- **Phase 17: UAT CI Infrastructure** — Weekly cron + manual `workflow_dispatch` UAT workflow with step-level secret isolation (P11 prevention). Branch protection on master enforces CI + force-push block + PR-required-reviews (BRANCH-PROT-01 corrected after admin-bypass discovery). 90-day artifact retention for UAT accuracy reports.
- **Phase 18: Memory Retrieval Foundation** — `/recall <query>` reads `memory/memory.md` via minisearch (AND semantics, quoted phrases, negation, `--category` / `--since` / `--top N` flags). `/today` adds Memory Echo section gated at 0.65 relevance threshold against today's calendar + VIP emails.
- **Phase 19: Semantic Memory Search** — Voyage AI (`voyage-4-lite`) embed-on-promotion sidecar in `~/.cache/second-brain/embeddings.jsonl`. `semanticSearch` with cosine + temporal decay; calibrated 0.55 threshold (post-UAT empirical correction from spec'd 0.72). `/recall --hybrid` performs RRF fusion. Pattern 7 graceful degradation: 3-failure threshold → 15-min window persisted to `voyage-health.json`.
- **Phase 20: Value Extraction Instrumentation** — `recordDailyStats()` writes idempotent per-day row to `RIGHT/daily-stats.md` with 8 columns (date, proposals, promotions, total_entries, memory_kb, recall_count, avg_latency_ms, avg_confidence). `/today` opens with verbatim "Yesterday: +N proposals, +M promotions, +X KB memory" summary line. Per-connector + per-operation latency captured.
- **Phase 21: Closeout Hygiene** — 0 ESLint no-console warnings (35 category-tagged disables across 4 categories per D-LOCK-2). JSDoc on 53 public exports + 2 `_testOnly` carve-outs across 10 named source files. 45 `test.todo` markers staged for v1.5 HYG-UNICODE-02 (Path B per D-LOCK-5-AMEND-A — ASCII-only contract for v1.4). All 8 living docs synced.

**Stats:**

- **Test count:** 1127 (1044 passing, 38 skipped, 45 todo) across 55 files
- **Coverage:** 81.28% branch / 94.62% statements / 96.94% functions / 95.53% lines
- **src/ LOC:** 9,617 (post-v1.4)
- **Timeline:** 2026-04-24 to 2026-04-26 (3 days)

**Locked decisions:**

- Voyage `voyage-4-lite` model + 0.55 threshold (calibrated empirically post-UAT)
- `schema_version = hash(model || dimension)` only — threshold/decay are query-time math, no re-embed needed
- `/new` behavior untouched — retrieval surfaces only via `/recall` and `/today` Memory Echo
- ASCII-only substring matching for excluded terms (Unicode-variant matching deferred to v1.5)
- America/Chicago timezone for daily-stats date boundaries

**Known gaps (carried to v1.5 backlog in `tasks/todo.md`):**

- **HYG-UNICODE-02** — Unicode-variant matcher upgrade (45 test.todo entries staged in test/content-policy.test.js)
- **HOOK-VAULT-01 / HOOK-SCHEMA-01 / HOOK-DOCSYNC-01** — Committed pre-commit/post-merge hooks for vault boundary, schema validation, doc drift detection
- **AGENT-DOCSYNC-01 / AGENT-VERIFY-01 / AGENT-MEMORY-01** — New agent surface for documentation sync, independent verification, memory health
- **UAT-CORPUS-REFRESH-01** — Rebaseline UAT classification corpus after v1.1 excluded-terms expansion shifted classifier decision boundaries
- **DOTENV-FIX-01** — Suite-level dotenv neutralization (precedent set in PR #38)
- **REQUIREMENTS.md per-phase checklist drift** (documented in audit) — Phase 18 (4 REQs) and Phase 20 (STATS-LATENCY-01, STATS-GROWTH-01) were marked `[ ]` Pending in checklist while traceability table showed Complete; fixed by archive-then-fresh in this ceremony
- **Phase 17 UAT workflow smoke run** — `gh workflow run uat.yml` deferred per Pete's 17-03 checkpoint; deferred again to v1.5 first-week
- **Phase 21 missing VERIFICATION.md** — substituted by `.planning/v1.4-MILESTONE-AUDIT.md` (now archived to milestones/v1.4-MILESTONE-AUDIT.md)

**Process lessons captured (16 total in `tasks/lessons.md`):**

- LESSON-LIVE-RECOUNT-AT-EXECUTE-01 — Re-count live numbers at Task 1 of any doc-refresh plan
- LESSON-MANIFEST-FIRST-VALIDATED-01 — Manifest-first protocol mandatory for scoped governance work
- LESSON-OPTION-A-SCOPE-CORRECTION-01 — Bring out-of-scope adjacent debt into scope when Lock-fence permits
- LESSON-PRE-EXISTING-DEBT-ABSORPTION-01 — Closeout phases default to absorbing adjacent pre-existing debt
- LESSON-RECIPE-VERIFY-01 — Recipes need Step 0 to confirm change isn't already present
- LESSON-PREFLIGHT-CI-MODE-01 — Pre-flight checks must use `CI=true npm test` (UAT skip-guard semantics)
- LESSON-UAT-CORPUS-DRIFT-01 — Classifier-side changes require UAT corpus revalidation step
- LESSON-SQUASH-CONTENT-CHECK-01 — Use `git cherry-pick --no-commit` + `git status --porcelain` to verify squash-merged branch content equivalence

**Tag:** v1.4

---

---

## v1.3 Review Remediation (Shipped: 2026-04-24)

**Phases:** 5 (12-16) | **Commits:** 11 | **Files changed:** 90 (+9168 / −1452) | **Backlog items closed:** 15/18

**Goal:** Close every HIGH finding from the 3-reviewer audit (Claude native, Gemini CLI, Opus 4.6) and every WARN from v1.2 MILESTONE-AUDIT. Bring overall health score from 76/100 to ≥ 88.

**Key accomplishments:**

- **Critical safety fixes (Phase 12)** — 7 HIGH/MEDIUM findings closed: vault-gateway bypass in writeDeadLetter, config crash paths made graceful via safeLoadPipelineConfig wrapper, classifyLocal fetch timeout, LLM fallback hardening, security-scan-gate hook repaired with tri-state exit codes and grep fallback
- **Config schema gaps closed (Phase 13)** — 3 new schemas (vault-paths, excluded-terms, scheduling) + AJV removeSchema error handling fix + every config loader now uses loadConfigWithOverlay with schema validation
- **CI hardening (Phase 14)** — ESLint, CodeQL SAST, and license-checker gates added to CI. 53 ESLint violations fixed across 24 source files in one pass. UAT tests guarded from running in CI
- **Architecture refactor (Phase 15)** — today-command.js decomposed from 727 LOC god module to 230 LOC orchestrator + 4 single-responsibility modules (slippage-scanner, frog-identifier, llm-augmentation, briefing-renderer). new-command deduplicated against classifier.classifyInput. vault-gateway re-exports removed. memory-proposals locks privatized
- **Test quality lift (Phase 16)** — 114 new tests added (662 → 776). Branch coverage lifted from 75.35% to 81.31% under CI env. CI threshold ratcheted 70% → 80%. Hook test harnesses added for auto-test.sh and protected-file-guard.sh. Classifier integration test suite proves Stage 0→1→2 wiring end-to-end

**Timeline:** 2026-04-23 to 2026-04-24 (2 days)

**Known gaps (deferred to v1.4):** B-15 Unicode-specific exclusion term tests, B-18 JSDoc on public API surface, B-20 41 no-console warnings. All non-blocking. 2 accepted flags (F-01 chokidar v3 CJS compat, F-02 docs-sync scope_guard) carry forward as accepted non-defects.

**PRs merged:** #22, #24, #26, #27, #29

---

## v1.2 Automation & Quality (Shipped: 2026-04-23)

**Phases:** 4 (08-11) | **Requirements:** 11 | **Backlog items promoted:** 12 | **Tag:** v1.2.0

**Goal:** Close quality, security, and automation gaps. No new features.

**Phases:**

- Phase 8: Hook Infrastructure — auto-test hook, protected file guard, security scan gate
- Phase 9: Security & Verification — security scanner agent, test verifier, config validator skill
- Phase 10: Agent Hardening & Skills — roster improvements, pipeline health skill, context7 MCP
- Phase 11: CI & LLM Infrastructure — CI coverage enforcement, local LLM routing

**Timeline:** 2026-04-23 (1 day)

**Known gaps:** Surfaced by v1.2 MILESTONE-AUDIT — 18 items migrated to v1.3 backlog.

---

## v1.1 Go Live (Shipped: 2026-04-23)

**Phases:** 3 (05-07) | **Plans:** 7 | **Requirements:** 11/12 satisfied, 1 deferred

**Key accomplishments:**

- Gmail OAuth wired — googleapis live calls with Keychain-backed OAuth2, replacing all stubs in gmail-mcp-pete
- Excluded terms expanded from 3 to 15 with substring matching and Array.isArray config guard
- RemoteTrigger activated — production cron for weekday `/today` execution
- In-batch dedup fixed (3 sub-bugs: self-match, missing content_hash, non-pending re-processing)
- Remote execution hardened — calendar MCP connector, env-var path resolution, Haiku API graceful degradation
- GitHub Actions CI pipeline — Node 20+22 matrix, push + PR triggers, README badge

**Timeline:** 2026-04-22 to 2026-04-23 (2 days)

**Known gaps:** FIX-02 (config hot-reload) deferred — restart workaround sufficient. Sparse vault produces zero wikilinks (observation, not defect — vault needs content to cross-reference).

---

## v1.0 MVP (Shipped: 2026-04-22)

**Phases:** 4 | **Plans:** 15 | **Tasks:** 19 | **Tests:** 502 | **Requirements:** 21/21

**Key accomplishments:**

- Write-permission vault boundary with canonical path enforcement, ingress filtering (ISPN/Genesys/Asana), and anti-AI style lint
- Two-stage LLM classifier and `/new` command for domain-based input routing with left/right write-permission enforcement
- Memory compounding pipeline: session extraction, proposals staging, human-reviewed promotion, dead-letter lifecycle
- Gmail, Google Calendar, and GitHub MCP connectors with zero-trust permissions (draft-only, read-only, repo-scoped)
- `/today` daily briefing with 6 sections, cross-project slippage scanner, Haiku frog identification, and graceful degradation
- RemoteTrigger scheduling for pre-morning automated execution

**Timeline:** 2026-04-21 to 2026-04-22 (2 days)

**Known gaps:** gmail-mcp-pete OAuth flow not yet wired (stubs only). In-batch dedup gap in promote-memories. Config hot-reload defect. Excluded terms limited to 3 seed terms (expansion tracked). No CI pipeline.

---

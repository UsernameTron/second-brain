# Milestones

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

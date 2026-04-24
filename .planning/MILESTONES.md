# Milestones

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

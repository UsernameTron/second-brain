# Milestones

## v1.2 Automation & Quality (In Progress)

**Phases:** 4 (08-11) | **Requirements:** 11 | **Backlog items promoted:** 12

**Goal:** Close quality, security, and automation gaps. No new features.

**Phases:**
- Phase 8: Hook Infrastructure — auto-test hook, protected file guard, security scan gate
- Phase 9: Security & Verification — security scanner agent, test verifier, config validator skill
- Phase 10: Agent Hardening & Skills — roster improvements, pipeline health skill, context7 MCP
- Phase 11: CI & LLM Infrastructure — CI coverage enforcement, local LLM routing

**Started:** 2026-04-23

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

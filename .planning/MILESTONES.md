# Milestones

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

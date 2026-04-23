# Second Brain

## What This Is

An Obsidian vault orchestrated into a personal operating system with compounding memory, proactive daily briefing, intelligent input routing, and external integrations. Code at ~/projects/second-brain/, vault at ~/Claude Cowork/, coupled through Obsidian MCP. Left/right write-permission architecture preserves human voice on LEFT while agent-generated content writes to RIGHT. Integrates Gmail (draft-only), Google Calendar (read-only), GitHub (UsernameTron-scoped), and cross-project GSD state into a single `/today` morning prep workflow.

## Current State

Shipped v1.0 MVP on 2026-04-22. v1.1 hardening complete 2026-04-23. 547 tests passing, 21/21 v1.0 requirements validated + 9 v1.1 requirements satisfied.

**Codebase:** ~5,000 LOC JavaScript (Node.js), 21 plans across 7 phases (2 milestones).

**What works end-to-end:**
- `/new` classifies input, enforces left/right routing, filters excluded content, suggests wikilinks
- `/today` produces 6-section daily briefing with graceful degradation
- Memory extraction, proposals, promotion pipeline with human review gate
- Gmail (OAuth wired), Calendar, GitHub connectors with zero-trust permissions
- RemoteTrigger active for pre-morning scheduling
- GitHub Actions CI pipeline (Node 20+22 matrix, push to master + PR triggers)

**Known gaps:** Config hot-reload defect (FIX-02, deferred — restart workaround sufficient). Branch protection pending repo upgrade to GitHub Pro or public.

## Core Value

Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.

## Requirements

### Validated

- ✓ Left/right vault directory structure with write-permission enforcement — v1.0
- ✓ `/new` ingress filtering: ISPN, Genesys, Asana content stripped before writing to disk — v1.0
- ✓ Wikilink cross-references between left and right sides — v1.0
- ✓ `/new` command: multi-domain input router classifying by domain and left/right write permission — v1.0
- ✓ `/new` routing rules: voice/reflections/drafts → LEFT, agent-derived/summaries → RIGHT — v1.0
- ✓ `memory-proposals.md` extraction pipeline with source attribution — v1.0
- ✓ `memory.md` promotion workflow with human review gate — v1.0
- ✓ Proposal batches capped at 5-10 items — v1.0
- ✓ Gmail MCP connector (draft-only permission, no send) with VIP filtering — v1.0
- ✓ Google Calendar MCP connector (read-only permission) — v1.0
- ✓ GitHub activity connector (UsernameTron repo scoping) — v1.0
- ✓ `/today` command: 6-section morning prep list — v1.0
- ✓ `/today` data-source health reporting — v1.0
- ✓ `/today` cross-project slippage detection — v1.0
- ✓ `/today` frog identification — v1.0
- ✓ Scheduled `/today` execution via RemoteTrigger — v1.0
- ✓ Graceful degradation when MCP sources fail — v1.0
- ✓ Anti-AI writing style enforcement in vault content — v1.0
- ✓ Centralized write-gateway function — v1.0
- ✓ Dead-letter lifecycle with auto-retry — v1.0
- ✓ Wikilink suggestion engine — v1.0

- ✓ Gmail OAuth wired (real credentials, live VIP filtering) — v1.1
- ✓ RemoteTrigger enabled on real cron schedule — v1.1
- ✓ Excluded terms expanded to production list — v1.1
- ✓ In-batch dedup bug fixed in promote-memories — v1.1
- ✓ UAT pass (LLM accuracy, wikilink relevance, promotion dedup) — v1.1
- ✓ CI pipeline (GitHub Actions, Node 20+22, push + PR triggers) — v1.1

### Active

None — v1.1 milestone complete.

## Current Milestone: v1.1 Go Live

**Goal:** Close the gap between "works in tests" and "works on my desk at 6:45 AM."

**Target features:**
- Wire gmail-mcp-pete OAuth (real credentials, not stubs)
- Enable RemoteTrigger on real cron schedule
- Expand excluded terms to 15-20 entries
- Fix in-batch dedup bug in promote-memories
- Fix config hot-reload defect
- UAT pass (LLM accuracy, wikilink relevance, Obsidian UX walkthrough)
- CI pipeline (run tests on push)

### Out of Scope

- ISPN content — hard exclusion from all memory promotion and ingress
- Genesys content — hard exclusion from all memory promotion and ingress
- Asana content — hard exclusion from all memory promotion and ingress
- Gmail send capability — zero-trust: draft-only
- Calendar write capability — zero-trust: read-only
- Mobile app — vault accessed via Obsidian desktop/sync
- Real-time sync — batch processing (cron + on-demand) is sufficient
- Autonomous email sending — one hallucination away from a career incident
- Chat interface for vault — Claude Code sessions ARE the chat interface
- Automatic memory promotion — skipping human review gate amplifies errors
- Complex taxonomy/tagging — left/right split + wikilinks is sufficient
- Notification system — pull-based (/today) only; push creates anxiety

## Context

**Vault substrate (already exists):**
- `ABOUT ME/about-me.md` — identity, work style, communication preferences
- `ABOUT ME/anti-ai-writing-style.md` — banned words/patterns, tone calibration
- `ABOUT ME/my-company.md` — Connor Advisors, CTG engagement, active projects, career strategy

**Integrations already wired:**
- Obsidian — Docker MCP gateway → Local REST API plugin (verified)
- GitHub — Docker MCP gateway → github-official (OAuth done)
- Filesystem — Claude Code direct read/write on `/Users/cpconnor/projects/`
- Claude in Chrome — paired browsing agent (not a /today source)

**Integrations built (Phase 3):**
- Gmail — src/connectors/gmail.js wrapping gmail-mcp-pete MCP server, VIP filtering, draft-only
- Google Calendar — src/connectors/calendar.js wrapping Cowork native MCP tools, working-hours filtering, read-only
- GitHub — src/connectors/github.js wrapping Docker MCP tools, UsernameTron repo scoping, Promise.allSettled

**Runtime:**
- `ccdScheduledTasksEnabled = true` in claude_desktop_config.json for cron-based /today

**Inspiration:**
- Cole Medin — memory compounding patterns, daily knowledge extraction
- Eric Michaud — structured vault architecture, proactive briefing systems

**Zero-trust posture (all integrations):**
- Gmail: draft only, never send
- Calendar: read only
- GitHub: read + issue-write on UsernameTron repos only
- Obsidian: read everywhere, write only to RIGHT side of vault
- Filesystem: read + write within `/Users/cpconnor/projects/` only

## Constraints

- **Architecture**: Left/right split is a write-permission boundary, not a content-type split. Rule: "any file whose words should sound like ME lives on the LEFT"
- **Exclusions**: ISPN, Genesys, Asana content filtered at ingress — not post-hoc
- **Security**: Every integration operates at minimum viable permission
- **Voice**: LEFT side content must never be agent-written. Agent can read LEFT, propose to RIGHT
- **Platform**: Obsidian vault, Claude Code orchestration, Docker MCP gateway for external services

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Write-permission split (not content-type) | Voice preservation is the governing principle — keeps human authenticity intact. Left = human-only writes; right = agent-writable. | ✓ Good — enforced at /new ingress and write-gateway |
| Project-alongside-vault | Separation of concerns: code changes weekly, vault changes daily; different lifecycles. | ✓ Good — project at ~/projects/second-brain/, vault at ~/Claude Cowork/ |
| Ingress filtering over post-hoc removal | Cheaper to strip excluded content at /new than chase it across files after the fact | ✓ Good — three-gate pipeline catches at capture |
| memory-proposals.md staging area | Human-in-the-loop prevents agent hallucinations from entering long-term memory | ✓ Good — promotion requires explicit /promote-memories |
| Cowork native for Calendar, custom MCP for Gmail | Calendar: Cowork MCP simpler. Gmail: needed custom server for VIP filtering and draft-only enforcement. | ✓ Good — both connectors working with zero-trust scopes |
| chokidar v3 (not v5) | v5 is ESM-only, project uses CJS | ✓ Good — avoided breaking change |
| LLM classify() never throws | Returns {success, data/error, failureMode} — callers handle gracefully | ✓ Good — enables graceful degradation in /today |
| Wikilink enrichment non-blocking | Failures logged, never block pipeline | ✓ Good — /new completes even if wikilinks fail |
| Dead-letter auto-retry: 15-min, 3-attempt cap, freeze | Prevents infinite retry loops while giving transient failures a chance | ✓ Good — bounded retry with freeze semantics |
| RemoteTrigger for scheduling (not launchd) | First-class Claude integration, no plist management | ⚠️ Revisit — trigger disabled pending activation, verify reliability |
| PR time-window filtering client-side | list_pull_requests lacks since param | ✓ Good — filter by updated_at after fetch |
| Partial GitHub MCP failure returns warnings[] | Preserves partial data for /today degraded mode | ✓ Good — matches graceful degradation design |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-23 after Phase 7 (Hardening) complete — v1.1 milestone done*

# Second Brain

## What This Is

A project that orchestrates an Obsidian vault into Pete Connor's personal operating system — compounding memory, proactive daily briefing, and intelligent input routing. The project code and GSD state live at ~/projects/second-brain/; the vault lives at ~/Claude Cowork/; they couple through the Obsidian MCP gateway. Built on a left/right write-permission architecture where human voice is preserved on one side and agent-generated content lives on the other. Integrates Gmail, Google Calendar, GitHub, and cross-project GSD state into a single morning prep workflow.

## Core Value

Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.

## Requirements

### Validated

- [x] Left/right vault directory structure with write-permission enforcement — Validated in Phase 1: Vault Foundation
- [x] `/new` ingress filtering: ISPN, Genesys, Asana content stripped before writing to disk — Validated in Phase 1: Vault Foundation (3 seed terms; expansion tracked as pre-v1 followup)
- [x] Wikilink cross-references between left and right sides — Validated in Phase 1: Vault Foundation

### Active
- [ ] `memory.md` — agent-maintained, promoted from `memory-proposals.md` with user approval
- [ ] `memory-proposals.md` — auto-extracted candidates from sessions, awaiting approval
- [x] `/today` command — morning prep list with 6 sections (meetings, VIP emails, slippage, frog, GitHub, pipeline) — Validated in Phase 4: Daily Briefing and Scheduling
- [x] `/today` data sources: Gmail (VIP-filtered, draft-only), Google Calendar (read-only), cross-project .planning/ state, GitHub activity (UsernameTron) — Validated in Phase 4: Daily Briefing and Scheduling
- [ ] `/new` command — multi-domain input router classifying by domain and left/right write permission
- [ ] `/new` routing rules: voice/reflections/drafts → LEFT, agent-derived/summaries → RIGHT
- [x] Gmail MCP connector (draft-only permission, no send) — Validated in Phase 3: External Integrations
- [x] Google Calendar MCP connector (read-only permission) — Validated in Phase 3: External Integrations
- [x] GitHub activity connector (UsernameTron repo scoping) — Validated in Phase 3: External Integrations
- [x] Scheduled `/today` execution via cron (pre-morning review) — Validated in Phase 4: RemoteTrigger config created, trigger disabled pending activation

### Out of Scope

- ISPN content — hard exclusion from all memory promotion and ingress
- Genesys content — hard exclusion from all memory promotion and ingress
- Asana content — hard exclusion from all memory promotion and ingress
- Gmail send capability — zero-trust: draft-only
- Calendar write capability — zero-trust: read-only
- Mobile app — vault accessed via Obsidian desktop/sync
- Real-time sync — batch processing (cron + on-demand) is sufficient

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
| Write-permission split (not content-type) | Voice preservation is the governing principle — keeps human authenticity intact. Left = human-only writes; right = agent-writable. Rule: "any file whose words should sound like ME lives on the LEFT." | **Resolved: write-permission boundary.** Enforced at /new ingress and via MCP write-scope configuration. |
| Vault-as-project vs project-alongside-vault | Separation of concerns: code changes weekly, vault changes daily; they have different lifecycles, audiences, and failure modes. Cole's reference implementation is project-alongside-vault by design. | Resolved: project-alongside-vault. Project at ~/projects/second-brain/, vault at ~/Claude Cowork/, coupled through Obsidian MCP. |
| Ingress filtering over post-hoc removal | Cheaper to strip excluded content at /new than chase it across files after the fact | — Pending |
| memory-proposals.md staging area | Human-in-the-loop for memory promotion prevents agent hallucinations from entering long-term memory | — Pending |
| Cowork native connectors over Docker MCP for Gmail/Calendar | Simpler auth flow, better permission scoping, avoids Docker networking for latency-sensitive morning prep | — Pending |

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
*Last updated: 2026-04-22 after Phase 1 completion*

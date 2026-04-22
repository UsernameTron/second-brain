# Project Research Summary

**Project:** Second Brain (AI-orchestrated Obsidian vault)
**Domain:** AI-orchestrated personal knowledge management
**Researched:** 2026-04-21
**Confidence:** MEDIUM-HIGH

## Executive Summary

This project is an AI-orchestrated personal knowledge management system built on Obsidian, with Claude Code as the orchestration engine and MCP as the integration layer. The dominant architectural principle is the **write-permission boundary** -- a left/right vault split where human voice lives on the left (never agent-written) and agent output lives on the right. Every design decision flows from this boundary. The recommended approach leverages the existing Docker MCP gateway for external integrations (Gmail, Calendar, GitHub) routed through the Obsidian Local REST API plugin, with two core commands (`/today` for proactive daily briefing, `/new` for frictionless input routing) as the primary user touchpoints.

The stack is largely pre-decided: Obsidian, Claude Code, Docker MCP gateway, and Node.js are already deployed. The remaining decisions are tactical -- which Google API connectors to use (Docker MCP catalog vs. custom vs. Cowork native), and how to enforce write-permission boundaries at the MCP level vs. application code. The project's unique value comes from combining voice-preserving write boundaries, human-in-the-loop memory compounding, cross-project intelligence, and zero-trust integration permissions. No existing AI-PKM product (Mem, Notion AI, Reflect, Khoj) offers this combination.

The top risks are: (1) memory contamination through rubber-stamped proposals that compound hallucinations into long-term knowledge, (2) write-permission enforcement by convention rather than mechanism, allowing a single rogue write path to compromise voice integrity, and (3) Docker MCP gateway failures causing silent gaps in morning briefings. All three are preventable with upfront architectural safeguards -- a centralized write gateway, source-attributed memory proposals capped at reviewable batch sizes, and mandatory health reporting in `/today`.

## Key Findings

### Recommended Stack

The stack is 80% deployed. Obsidian, Claude Code with GSD, Docker MCP gateway, and the filesystem MCP server are already configured and operational. The remaining 20% involves Google API connectors and scheduling configuration.

**Core technologies:**
- **Obsidian 1.7+**: Vault substrate -- local-first markdown knowledge base with plugin ecosystem
- **Claude Code + GSD**: Orchestration engine -- command dispatch, agent spawning, phase management
- **Docker MCP Gateway**: Integration router -- single entry point for all Docker-hosted MCP servers (Obsidian, GitHub, Google services)
- **Obsidian Local REST API plugin**: Bridge between Claude Code and the vault via localhost HTTP
- **Node.js 22 LTS**: Runtime for any custom MCP servers or utility scripts (fallback path only)

**Open stack decisions:**
- Gmail/Calendar connectors: Check Docker MCP catalog first, fall back to custom Node.js MCP servers, prefer Cowork native connectors if available at implementation time
- Claude Desktop scheduled task syntax: `ccdScheduledTasksEnabled` is on but recurrence configuration format needs verification

### Expected Features

**Must have (table stakes):**
- Memory compounding (`memory.md` + `memory-proposals.md` with human-in-the-loop staging)
- Daily briefing (`/today` with 6 sections: meetings, emails, frogs, job hunt, AI reality check, slippage)
- Multi-source ingestion (Gmail, Calendar, GitHub, cross-project state)
- Intelligent input routing (`/new` with left/right classification and ingress filtering)
- Write-permission boundaries (left = human voice, right = agent output)
- Content exclusion filtering (ISPN/Genesys/Asana stripped at ingress)

**Should have (differentiators):**
- Voice-preservation architecture enforced at MCP write-scope level
- Cross-project intelligence (scan `~/projects/*/.planning/STATE.md` for slippage detection)
- Zero-trust integration posture (draft-only Gmail, read-only Calendar, scoped GitHub)
- Proactive slippage detection and frog identification in `/today`
- Auto-suggested wikilinks after `/new` routing

**Defer (v2+):**
- Semantic search (Claude Code sessions already provide ad-hoc semantic retrieval)
- Configurable briefing sections (start hardcoded, make flexible when life phase changes)
- Mobile capture workflow (use Obsidian mobile natively)

### Architecture Approach

Five major components connected through MCP gateway and filesystem, governed by the write-permission boundary. The architecture follows a layered dependency model where vault structure must exist before any writes, the ingress filter must exist before routing, and memory staging must exist before extraction.

**Major components:**
1. **Claude Code Orchestrator** -- command dispatch, scheduling, skill invocation; reads everything, writes only to RIGHT vault
2. **/today Command** -- scheduled daily briefing pulling from Gmail, Calendar, GitHub, memory, and cross-project state; writes daily note to RIGHT vault
3. **/new Command** -- input router with domain classification, ingress filtering, and left/right routing; never auto-writes to LEFT
4. **Memory Pipeline** -- extract candidates from sessions, stage in `memory-proposals.md`, promote to `memory.md` after human approval
5. **Docker MCP Gateway** -- bridges Claude Code to Obsidian REST API, GitHub, Gmail, Calendar with scoped permissions

### Critical Pitfalls

1. **Memory contamination** -- Proposals must include source attribution (session ID, date, file); cap batch size at 5-10 items; add semantic exclusion filtering beyond string matching; build a memory audit command
2. **Write-permission bypass** -- Implement a single write-gateway function that ALL vault writes pass through; no direct Obsidian API calls; post-write audit hook validates target path; left-side directory list as config constant
3. **MCP gateway failure silencing** -- `/today` must report data-source health at top of every briefing; implement pre-flight health check; produce degraded briefing with warnings rather than nothing
4. **Exclusion filter gaps** -- String matching misses paraphrased references; implement session-level tagging plus semantic second pass; treat human review as security backstop, not convenience
5. **Anti-AI writing style ignored** -- Load `anti-ai-writing-style.md` into every agent prompt that generates vault content; create shared "vault writing context" bundle; test output against banned-words list programmatically

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Vault Foundation and Write-Permission Enforcement

**Rationale:** Every subsequent phase writes to the vault. The write-permission boundary must exist and be mechanically enforced before any agent writes occur. Building anything else first risks contaminating the LEFT vault.
**Delivers:** LEFT/RIGHT directory structure, centralized write-gateway function, path-based allowlist configuration, ingress filter for ISPN/Genesys/Asana content, anti-AI style guide integration into vault-writing context
**Addresses:** Write-permission boundaries, content exclusion filtering, voice preservation
**Avoids:** Write-permission bypass (Pitfall 2), exclusion filter gaps (Pitfall 4), style guide ignored (Pitfall 5)

### Phase 2: Input Router (/new Command)

**Rationale:** `/new` is the primary content entry point and depends on the write-permission boundary and ingress filter from Phase 1. It must exist before memory extraction has material to work with.
**Delivers:** `/new` skill with domain classification, left/right routing logic, ingress filtering integration, user override capability for classification errors
**Addresses:** Intelligent input routing, frictionless capture
**Avoids:** Exclusion filter bypass (Pitfall 4), agent writing to LEFT (anti-pattern)

### Phase 3: Memory System

**Rationale:** Memory compounding is the core flywheel but depends on having content in the vault (Phase 2) and the write-permission boundary (Phase 1). The staging/promotion pattern must be designed carefully to prevent contamination.
**Delivers:** `memory-proposals.md` extraction pipeline, `memory.md` promotion workflow with human gate, structured memory format (dated, categorized, source-attributed), batch-size caps, memory audit command
**Addresses:** Memory compounding, human-in-the-loop memory promotion
**Avoids:** Memory contamination (Pitfall 1), unbounded memory growth (Performance trap)

### Phase 4: External Integrations (Gmail, Calendar, GitHub MCP)

**Rationale:** `/today` requires all external data sources. These integrations are independent of each other but all depend on the Docker MCP gateway. Gmail and Calendar connectors have open stack decisions that need runtime verification.
**Delivers:** Gmail MCP connector (draft-only, VIP-filtered), Google Calendar MCP connector (read-only), GitHub MCP scoped to UsernameTron repos, OAuth scope enforcement, token refresh automation
**Addresses:** Multi-source ingestion, zero-trust integration posture
**Avoids:** Gmail scope creep (Security mistake), OAuth token expiration overnight (Pitfall 3)

### Phase 5: Daily Briefing (/today Command)

**Rationale:** `/today` is the "wow moment" but depends on all data sources (Phase 4), memory system (Phase 3), and cross-project state access. Must be designed for cold-start execution from the start.
**Delivers:** `/today` skill with 6 sections, data-source health reporting, cross-project `.planning/STATE.md` scanning, slippage detection, frog identification, cold-start compatible execution, parallel data collection
**Addresses:** Daily briefing, proactive slippage detection, frog identification, cross-project intelligence
**Avoids:** MCP gateway failure silencing (Pitfall 3), cron cold-start failure (Pitfall 6), wall-of-text UX (UX pitfall)

### Phase 6: Scheduling and Reliability

**Rationale:** Cron scheduling is the last mile -- it only works after `/today` is proven reliable in interactive mode. This phase hardens the system for unattended operation.
**Delivers:** Claude Desktop scheduled task configuration for `/today`, graceful degradation on MCP failure, execution logging, token expiry monitoring, wikilink health auditing
**Addresses:** Automation, reliability, maintainability
**Avoids:** Cron cold-start failure (Pitfall 6), wikilink decay (Pitfall 7), silent degradation

### Phase Ordering Rationale

- **Foundation first:** The write-permission boundary is a structural invariant. Violating it, even once, permanently compromises vault integrity. It cannot be retrofitted.
- **Input before memory:** The memory pipeline needs vault content to extract from. `/new` creates that content.
- **Memory before briefing:** `/today` reads `memory.md` for context-aware output. Memory must be populated first.
- **Integrations before briefing:** `/today` pulls from 4+ external sources. Connectors must work before the briefing can be assembled.
- **Manual before automated:** Prove `/today` works interactively before handing it to cron. Cold-start bugs are invisible until they fail at 5 AM.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (External Integrations):** Docker MCP catalog availability for Gmail/Calendar is unverified. Cowork native connector timeline unknown. OAuth consent screen setup for Google APIs requires step-by-step verification.
- **Phase 6 (Scheduling):** Claude Desktop `ccdScheduledTasksEnabled` recurrence syntax is undocumented. Cold-start behavior of scheduled tasks needs empirical testing.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Vault Foundation):** Directory structure, path validation, config constants -- straightforward filesystem and permission patterns.
- **Phase 2 (Input Router):** Claude Code skill authoring is well-documented. Classification logic is prompt engineering, not infrastructure.
- **Phase 3 (Memory System):** Append-to-file, structured markdown, human review workflow -- established patterns from Cole Medin reference architecture.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core stack verified locally; Google connector availability and scheduling syntax unverified. Web search unavailable during research. |
| Features | HIGH | Domain well-understood; competitive landscape clear; feature dependencies mapped from PROJECT.md requirements. |
| Architecture | HIGH | Component boundaries, data flows, and build order derived directly from PROJECT.md decisions and established MCP patterns. |
| Pitfalls | HIGH | Pitfalls grounded in specific architectural decisions; prevention strategies are concrete and testable. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Docker MCP catalog for Google services:** Run `docker mcp catalog` at Phase 4 kickoff to determine connector approach. Decision tree: catalog server > Cowork native > custom Node.js MCP.
- **Scheduled task recurrence format:** Verify `ccdScheduledTasksEnabled` configuration syntax before Phase 6 planning. Test with a trivial scheduled task first.
- **Obsidian MCP write-scope enforcement:** Determine whether the `obsidian-mcp` Docker image supports path-based write restrictions natively, or if all enforcement must live in the write-gateway function. Verify during Phase 1.
- **VIP filter definition for Gmail:** Business logic decision (which senders are VIP) must be defined before Phase 4 Gmail connector is useful. Not a technical gap but a requirements gap.
- **Anti-AI style guide integration method:** Determine whether the style guide loads as a skill context, a hook, or inline system prompt content. Resolve during Phase 1.

## Sources

### Primary (HIGH confidence)
- `/Users/cpconnor/projects/second-brain/.planning/PROJECT.md` -- project requirements, constraints, key decisions, integration status
- `/Users/cpconnor/Library/Application Support/Claude/claude_desktop_config.json` -- verified MCP gateway, scheduled tasks, filesystem server
- `/Users/cpconnor/projects/second-brain/CLAUDE.md` -- vault rules, architecture overview

### Secondary (MEDIUM confidence)
- Cole Medin / Eric Michaud reference architectures -- memory compounding, vault structure patterns (referenced in PROJECT.md)
- MCP ecosystem patterns from training data -- Docker gateway, REST API bridging, OAuth scoping
- Competitive landscape (Mem, Notion AI, Reflect, Khoj) -- product capabilities as of early 2025

### Tertiary (LOW confidence)
- Gmail/Calendar Docker MCP catalog availability -- needs runtime verification
- Claude Desktop scheduled task configuration syntax -- needs documentation check
- Cowork native connector timeline -- depends on Anthropic product roadmap
- Specific npm package versions -- verify with `npm view` before installing

---
*Research completed: 2026-04-21*
*Ready for roadmap: yes*

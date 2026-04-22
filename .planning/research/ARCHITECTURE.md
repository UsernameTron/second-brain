# Architecture Patterns

**Domain:** AI-orchestrated Obsidian second-brain with memory compounding
**Researched:** 2026-04-21
**Overall confidence:** HIGH (system design derived from PROJECT.md decisions, established MCP patterns, and Cole Medin / Eric Michaud reference architectures)

## Recommended Architecture

The system has five major components connected through two coupling mechanisms (MCP gateway and filesystem). The governing principle is the **write-permission boundary**: the LEFT vault is human-only writes; the RIGHT vault is agent-writable. Every data flow respects this boundary.

```
                         +---------------------+
                         |   Claude Code        |
                         |   (Orchestrator)     |
                         +----------+----------+
                                    |
                    +---------------+---------------+
                    |               |               |
              +-----v-----+  +-----v-----+  +------v------+
              | /today     |  | /new       |  | Memory      |
              | Command    |  | Command    |  | Pipeline    |
              +-----+------+  +-----+------+  +------+------+
                    |               |                |
          +---------+---------+     |          +-----v------+
          |         |         |     |          | memory-    |
     +----v--+ +---v---+ +---v--+  |          | proposals  |
     |Gmail  | |GCal   | |GitHub|  |          | .md        |
     |MCP    | |MCP    | |MCP   |  |          +-----+------+
     |(draft)| |(read) | |(read)|  |                |
     +-------+ +-------+ +------+  |          [human approve]
                                    |                |
                              +-----v------+   +----v------+
                              | Ingress    |   | memory.md |
                              | Filter     |   +-----------+
                              +-----+------+
                                    |
                    +---------------+---------------+
                    |                               |
              +-----v-----+                   +-----v-----+
              |  LEFT      |                   |  RIGHT     |
              |  (human    |                   |  (agent    |
              |   writes)  |                   |   writes)  |
              +------------+                   +------------+
              ~/Claude Cowork/                 ~/Claude Cowork/
              ABOUT ME/                        (agent-side dirs)
```

### Component Boundaries

| Component | Responsibility | Reads From | Writes To | Coupling |
|-----------|---------------|------------|-----------|----------|
| **Claude Code Orchestrator** | Command dispatch, skill invocation, scheduling | Everything (read-all) | RIGHT vault only, project code | Central hub |
| **/today Command** | Morning prep: 6-section briefing | Gmail, GCal, GitHub, memory.md, cross-project .planning/ | RIGHT vault (daily note) | Skill / scheduled task |
| **/new Command** | Multi-domain input router | User input, classification rules | LEFT or RIGHT (per routing rules) | Skill |
| **Ingress Filter** | Strip ISPN/Genesys/Asana content at entry | Raw input from /new | Cleaned input to vault | Pre-write gate |
| **Memory Pipeline** | Extract, stage, promote knowledge | Session transcripts, vault content | memory-proposals.md, memory.md | Async pipeline |
| **Docker MCP Gateway** | Bridge Claude Code to Obsidian REST API, GitHub | Obsidian vault (via Local REST API plugin), GitHub API | Obsidian vault (via REST API) | Docker container |
| **Gmail MCP Connector** | Email access (draft-only, no send) | Gmail API | Draft creation only | Cowork native connector |
| **Google Calendar MCP Connector** | Calendar access (read-only) | Google Calendar API | None (read-only) | Cowork native connector |
| **LEFT Vault** | Human voice, identity, reference | Agent-readable | Human-only writes | Filesystem |
| **RIGHT Vault** | Agent output, summaries, daily notes, memory | Agent-readable | Agent-writable | Filesystem + MCP |

### Data Flow

Six primary data flows move information through the system:

#### Flow 1: /today Morning Briefing (scheduled, cron-triggered)

```
cron (pre-morning)
  -> Claude Code (ccdScheduledTasksEnabled = true)
    -> /today skill invoked
      -> Gmail MCP: fetch VIP-filtered inbox, draft-only access
      -> GCal MCP: fetch today's meetings, read-only
      -> GitHub MCP: fetch UsernameTron activity
      -> Filesystem: read memory.md
      -> Filesystem: read cross-project .planning/STATE.md files
    -> Assemble 6 sections: meetings, emails, frogs, job hunt, airealitycheck, slippage
    -> Write daily note to RIGHT vault
```

**Permission envelope:** All reads. Single write to RIGHT vault daily note.

#### Flow 2: /new Input Routing (on-demand, user-triggered)

```
User provides mixed input (text, voice transcript, link, idea)
  -> /new skill invoked
    -> Classify by domain
    -> Ingress filter: strip ISPN/Genesys/Asana content
    -> Route decision:
      - Voice, reflections, drafts, personal writing -> LEFT vault (BLOCKED for agent)
      - Agent-derived summaries, extractions, analysis -> RIGHT vault
    -> For LEFT-bound content: present to user for manual placement (agent cannot write)
    -> For RIGHT-bound content: write via MCP or filesystem
```

**Key constraint:** Agent NEVER writes to LEFT. For LEFT-bound content, the agent produces the content and tells the user where to put it, or queues it as a proposal.

#### Flow 3: Memory Promotion Pipeline (async, session-driven)

```
Session ends or explicit extraction trigger
  -> Scan session transcript / recent vault changes
  -> Extract memory candidates (facts, decisions, preferences, patterns)
  -> Ingress filter: strip excluded content
  -> Append candidates to memory-proposals.md (RIGHT vault)
  -> [HUMAN GATE] User reviews proposals
  -> Approved proposals promoted to memory.md (RIGHT vault)
  -> Rejected proposals deleted from memory-proposals.md
```

**Human-in-the-loop:** memory-proposals.md is a staging area. Nothing enters long-term memory without explicit approval. This prevents hallucination contamination of the knowledge base.

#### Flow 4: Wikilink Cross-Referencing (agent-maintained)

```
Agent reads LEFT vault content (identity, reference)
  -> Produces RIGHT vault content that references LEFT via [[wikilinks]]
  -> LEFT vault content can reference RIGHT via [[wikilinks]] (human-placed)
```

**Bidirectional reading, unidirectional agent writing.** The agent reads both sides but only writes to RIGHT.

#### Flow 5: MCP Gateway Communication

```
Claude Code
  -> Docker MCP Gateway container
    -> Obsidian Local REST API plugin (localhost:27123)
      -> Read/write vault files via REST
    -> GitHub API (OAuth)
      -> Read repos, read/write issues on UsernameTron repos
```

**Docker isolation:** The MCP gateway runs in a container, providing network isolation and clean dependency management. The Obsidian REST API plugin must be running in the desktop app for the gateway to function.

#### Flow 6: Cross-Project State Aggregation

```
/today or manual query
  -> Filesystem read: ~/projects/*/. planning/STATE.md
  -> Extract: active phases, blockers, recent completions
  -> Synthesize into daily note "slippage" and "frogs" sections
```

**Read-only across project boundaries.** The second-brain never writes to other projects' .planning/ directories.

## Patterns to Follow

### Pattern 1: Write-Permission Boundary Enforcement

**What:** Every write operation is checked against the LEFT/RIGHT boundary before execution. LEFT = human-only. RIGHT = agent-writable.

**When:** Every file write, every /new routing decision, every memory promotion.

**Implementation approach:**
- Define a path-based allowlist for agent writes (RIGHT vault directories)
- /new command classifies content and routes accordingly
- MCP gateway write-scope configured to RIGHT directories only
- Agent cannot circumvent by writing to LEFT paths

**Enforcement points:**
1. /new routing logic (classification + filter)
2. MCP gateway write-scope configuration
3. Claude Code filesystem permissions (settings.json deny rules)

### Pattern 2: Staged Promotion with Human Gate

**What:** Information moves through a staging area before entering long-term storage. A human approves the promotion.

**When:** Memory candidates, identity updates, any content that becomes part of the persistent knowledge base.

**Why:** Prevents hallucination contamination. The agent proposes; the human validates. This is especially critical for memory.md, which compounds over time — a bad entry early poisons all future sessions.

**Structure:**
```
[extraction] -> memory-proposals.md (staging) -> [human review] -> memory.md (permanent)
```

### Pattern 3: Ingress Filtering (not Post-Hoc Removal)

**What:** Excluded content (ISPN, Genesys, Asana) is stripped at the point of entry, before it touches the vault.

**When:** Every /new invocation, every memory extraction, every /today data pull.

**Why:** Cheaper and safer than chasing excluded content across files after it has been written. The ingress filter is a single chokepoint.

**Implementation:** A filter function that runs on raw input text before any routing or write decision. Pattern-match on organization names, project identifiers, and domain-specific terms.

### Pattern 4: Zero-Trust Integration Permissions

**What:** Every external integration operates at minimum viable permission. No integration gets more access than it needs.

**When:** Configuring MCP connectors, setting up OAuth scopes, defining filesystem access.

**Permission matrix:**

| Integration | Read | Write | Scope Limit |
|-------------|------|-------|-------------|
| Gmail | Inbox (VIP-filtered) | Drafts only (no send) | User's inbox |
| Google Calendar | Events | None | User's calendars |
| GitHub | Repos, issues, PRs | Issues only | UsernameTron repos |
| Obsidian (via MCP) | Entire vault | RIGHT vault only | Path-scoped |
| Filesystem | ~/projects/ | ~/projects/ | Directory-scoped |

### Pattern 5: Cron-Triggered Skill Execution

**What:** Claude Code scheduled tasks execute /today before the user's morning review.

**When:** Daily, pre-morning (configured via cron + `ccdScheduledTasksEnabled`).

**Dependency:** `ccdScheduledTasksEnabled = true` in `claude_desktop_config.json`. The Claude Desktop app must be running. The Obsidian app must be running (for MCP gateway to reach the REST API plugin).

**Failure mode:** If Obsidian is not running, the MCP gateway fails silently. /today should detect this and produce a partial briefing with a warning rather than failing entirely.

### Anti-Patterns to Avoid

- **Agent writing to LEFT vault:** Violates the core architectural principle. Even "helpful" agent writes to LEFT contaminate human voice. No exceptions.
- **Post-hoc content filtering:** Letting excluded content enter the vault and cleaning it up later. Filter at ingress or not at all.
- **Direct memory promotion (skipping staging):** Bypassing memory-proposals.md puts unvalidated content into long-term memory. The human gate exists for a reason.
- **Tight coupling between vault and project code:** The vault and project have different lifecycles. The vault changes daily; code changes weekly. Coupling them (e.g., vault files that import project code, or project code that assumes vault structure) creates fragility.
- **Broad MCP write scopes:** Giving the MCP gateway write access to the entire vault defeats the write-permission boundary. Scope writes to specific RIGHT-side directories.

## Component Build Order

Dependencies between components determine the recommended phase structure:

### Layer 0: Foundation (no dependencies)

| Component | Why First | Blocks |
|-----------|-----------|--------|
| LEFT/RIGHT vault directory structure | Everything depends on the boundary existing | All write operations |
| Write-permission enforcement rules | Must exist before any agent writes | /new, memory pipeline, /today |

### Layer 1: Core Pipeline (depends on Layer 0)

| Component | Why Here | Blocks |
|-----------|----------|--------|
| Ingress filter | Must exist before /new routes content | /new command |
| memory-proposals.md + memory.md files | Must exist before memory pipeline runs | Memory promotion |
| /new command (basic routing) | Core input mechanism | Daily use |

### Layer 2: Memory System (depends on Layer 1)

| Component | Why Here | Blocks |
|-----------|----------|--------|
| Memory extraction logic | Needs ingress filter and staging files | Memory compounding |
| Memory promotion workflow (human gate) | Needs proposals file | Long-term knowledge |
| Wikilink cross-referencing | Needs content on both sides | Knowledge graph |

### Layer 3: Daily Briefing (depends on Layers 0-1, partially Layer 2)

| Component | Why Here | Blocks |
|-----------|----------|--------|
| Gmail MCP connector | /today data source | Full briefing |
| Google Calendar MCP connector | /today data source | Full briefing |
| /today command (full 6-section) | Needs all data sources | Scheduled execution |
| Cross-project state aggregation | /today data source | Slippage section |

### Layer 4: Automation (depends on Layer 3)

| Component | Why Here | Blocks |
|-----------|----------|--------|
| Cron-scheduled /today execution | Needs /today working manually first | Hands-free morning prep |
| Graceful degradation (partial briefing on MCP failure) | Needs /today working | Reliability |

**Key dependency insight:** The write-permission boundary (Layer 0) must be built and tested before anything writes to the vault. Building /today before the boundary exists risks writing to wrong locations. Building memory promotion before the ingress filter exists risks contamination.

**Suggested build order for roadmap phases:**
1. Vault structure + write-permission enforcement + ingress filter
2. /new command with routing rules
3. Memory pipeline (proposals, extraction, promotion)
4. /today with all data sources (Gmail, GCal, GitHub, memory, cross-project)
5. Cron scheduling and graceful degradation

## Scalability Considerations

| Concern | At Launch | At 6 Months | At 2 Years |
|---------|-----------|-------------|------------|
| memory.md size | Small, fast to read | Hundreds of entries — consider sectioning | May need archival/summarization layer |
| Vault file count | Manageable | Hundreds of daily notes | Obsidian handles thousands of files well; search may slow |
| /today data volume | Minutes of processing | Same (daily batch) | Same (bounded by day's events) |
| Cross-project state | 1-3 projects | 5-10 projects | May need project registry |

**Near-term:** No scalability concerns. Obsidian handles large vaults well. memory.md is the only file that grows unboundedly — plan for a summarization or archival pass when it exceeds ~500 entries.

## Sources

### Primary (HIGH confidence)
- `/Users/cpconnor/projects/second-brain/.planning/PROJECT.md` — all component definitions, constraints, key decisions, integration inventory
- `/Users/cpconnor/projects/second-brain/CLAUDE.md` — vault rules, architecture overview, tech stack

### Secondary (MEDIUM confidence)
- Cole Medin reference architecture — memory compounding patterns, project-alongside-vault separation (referenced in PROJECT.md as inspiration; specific implementation details inferred from the pattern)
- Eric Michaud reference architecture — structured vault architecture, proactive briefing systems (referenced in PROJECT.md as inspiration)
- MCP protocol patterns — Docker gateway, REST API bridging, OAuth scoping (established patterns from MCP ecosystem)

### Gaps
- Exact Obsidian Local REST API plugin capabilities and write-scoping options — needs verification during implementation
- Gmail/GCal Cowork native connector availability and configuration — listed as "preferred" in PROJECT.md but pending decision
- Specific cron configuration for `ccdScheduledTasksEnabled` — runtime detail to verify

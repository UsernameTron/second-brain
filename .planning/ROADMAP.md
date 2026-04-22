# Roadmap: Second Brain

## Overview

Transform an Obsidian vault into a personal operating system by establishing write-permission boundaries, building content capture and memory compounding pipelines, wiring external data sources, and delivering a proactive daily briefing that runs unattended. Each phase delivers a complete capability that the next phase builds on: vault structure enables content routing, content routing feeds memory, integrations supply data, and the briefing synthesizes everything into a morning prep list.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Vault Foundation** - Write-permission boundary, ingress filtering, style enforcement, and cross-reference wiring
- [ ] **Phase 2: Content Pipeline** - Input routing via /new and memory compounding via proposals/promotion workflow
- [ ] **Phase 3: External Integrations** - Gmail, Google Calendar, and GitHub MCP connectors with zero-trust permissions
- [ ] **Phase 4: Daily Briefing and Scheduling** - /today command with 6-section briefing, cron automation, and graceful degradation

## Phase Details

### Phase 1: Vault Foundation
**Goal**: The vault has a mechanically enforced write-permission boundary so every subsequent agent write lands in the correct location and excluded content never reaches disk
**Depends on**: Nothing (first phase)
**Requirements**: VAULT-01, VAULT-02, VAULT-03, VAULT-04, XREF-01
**Success Criteria** (what must be TRUE):
  1. LEFT and RIGHT vault directories exist with a documented boundary definition
  2. All vault writes route through a single write-gateway function that rejects writes to LEFT
  3. Content containing ISPN, Genesys, or Asana references is stripped before any write completes
  4. Agent-generated vault content reflects the anti-AI writing style guide (no banned words/patterns)
  5. Wikilinks resolve correctly between LEFT and RIGHT vault sides
**Plans:** 2 plans

Plans:
- [x] 01-01-PLAN.md — Project skeleton, config files, write-gateway with canonical path security, redacted quarantine, config-driven bootstrap, wikilinks
- [x] 01-02-PLAN.md — Content filter (two-stage with Haiku, sanitization, minimal context), style lint (banned words, createVaultWriter enforcement), keyword expansion

### Phase 2: Content Pipeline
**Goal**: Users can capture any input through /new with automatic domain classification and left/right routing, and memory compounds daily through a human-reviewed proposal/promotion workflow
**Depends on**: Phase 1
**Requirements**: INPUT-01, INPUT-02, INPUT-03, INPUT-04, MEM-01, MEM-02, MEM-03
**Success Criteria** (what must be TRUE):
  1. Running /new with any input classifies it by domain and writes it to the correct vault location (LEFT or RIGHT)
  2. Voice content, reflections, and drafts route to LEFT; agent-derived content and summaries route to RIGHT
  3. Excluded content (ISPN/Genesys/Asana) is blocked at /new ingress and never reaches disk
  4. After routing, /new suggests wikilinks to related existing notes
  5. Session activity produces memory candidates in memory-proposals.md with source attribution (session ID, date, source file)
  6. Approved proposals promote to memory.md after human review, with batches capped at 5-10 items
**Plans:** 6 plans

Plans:
- [ ] 02-01-PLAN.md — Config bootstrap: vault-paths expansion, pipeline.json, templates.json, schemas, hot-reload fix, shared infrastructure (Haiku client, correlation IDs, dead-letter writer)
- [ ] 02-02-PLAN.md — Two-stage classifier, note formatter, /new command orchestration (Stages 0-3, 5)
- [ ] 02-03-PLAN.md — Wikilink suggestion engine: vault index cache, hybrid search+LLM pipeline (Stage 4)
- [ ] 02-04-PLAN.md — Memory extraction: /wrap transcript extraction, /extract-memories, memory-proposals.md management with locking and dedup, /wrap Stop hook script
- [ ] 02-05-PLAN.md — Memory promotion (/promote-memories), dead-letter lifecycle (/promote-unrouted, /reroute), wikilink integration into /new
- [ ] 02-06-PLAN.md — Background lifecycle: dead-letter auto-retry, left-proposal auto-archive, /today briefing helpers, daily sweep scheduling

### Phase 3: External Integrations
**Goal**: Gmail, Google Calendar, and GitHub data are accessible to Claude Code through MCP connectors operating at minimum viable permissions
**Depends on**: Phase 1
**Requirements**: INTG-01, INTG-02, INTG-03
**Success Criteria** (what must be TRUE):
  1. Gmail connector returns VIP-filtered emails with draft-only write permission (send is impossible)
  2. Google Calendar connector returns upcoming events with read-only permission (write is impossible)
  3. GitHub connector returns activity feed scoped to UsernameTron repos
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

### Phase 4: Daily Briefing and Scheduling
**Goal**: A single /today command produces a comprehensive morning prep list from all data sources, runs unattended on a cron schedule, and degrades gracefully when sources fail
**Depends on**: Phase 2, Phase 3
**Requirements**: TODAY-01, TODAY-02, TODAY-03, TODAY-04, SCHED-01, SCHED-02
**Success Criteria** (what must be TRUE):
  1. /today produces a briefing with all 6 sections: meetings, emails, frogs, job hunt, AI reality check, slippage
  2. The top of every briefing reports which data sources succeeded and which failed
  3. /today scans cross-project .planning/STATE.md files and surfaces slippage (stalled phases, overdue plans)
  4. /today identifies the hardest or most-avoided task as the daily frog
  5. /today runs pre-morning via Claude Desktop scheduled task without manual intervention
  6. When MCP sources fail, /today produces a degraded briefing with warnings rather than producing nothing
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4
Note: Phases 2 and 3 can execute in parallel (both depend only on Phase 1).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Vault Foundation | 0/2 | Not started | - |
| 2. Content Pipeline | 0/3 | Not started | - |
| 3. External Integrations | 0/1 | Not started | - |
| 4. Daily Briefing and Scheduling | 0/2 | Not started | - |

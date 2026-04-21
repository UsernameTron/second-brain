# Requirements: Second Brain

**Defined:** 2026-04-21
**Core Value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Vault Foundation

- [ ] **VAULT-01**: Left/right vault directory structure exists with clear write-permission boundary (LEFT = human voice, RIGHT = agent output)
- [ ] **VAULT-02**: Centralized write-gateway function routes all vault writes through a single enforcement point
- [ ] **VAULT-03**: Ingress filter strips ISPN, Genesys, and Asana content at capture before any write to disk
- [ ] **VAULT-04**: Anti-AI writing style guide loaded into every agent prompt that generates vault content

### Input Routing

- [ ] **INPUT-01**: `/new` command classifies input by domain and routes to correct vault location
- [ ] **INPUT-02**: `/new` enforces left/right routing rules (voice/reflections/drafts → LEFT, agent-derived/summaries → RIGHT)
- [ ] **INPUT-03**: `/new` integrates ingress filtering — excluded content never reaches disk
- [ ] **INPUT-04**: After routing, `/new` proposes wikilinks to related existing notes

### Memory System

- [ ] **MEM-01**: `memory-proposals.md` extraction pipeline generates candidates from sessions with source attribution (session ID, date, source file)
- [ ] **MEM-02**: `memory.md` promotion workflow moves approved proposals to long-term memory after human review
- [ ] **MEM-03**: Proposal batches capped at 5-10 items to keep review manageable

### External Integrations

- [ ] **INTG-01**: Gmail MCP connector with draft-only permission (never send) and VIP sender filtering
- [ ] **INTG-02**: Google Calendar MCP connector with read-only permission
- [ ] **INTG-03**: GitHub MCP connector scoped to UsernameTron repos for activity feed

### Daily Briefing

- [ ] **TODAY-01**: `/today` command produces morning prep list with 6 sections (meetings, emails, frogs, job hunt, AI reality check, slippage)
- [ ] **TODAY-02**: `/today` reports data-source health at top of every briefing (which sources succeeded/failed)
- [ ] **TODAY-03**: `/today` scans cross-project `.planning/STATE.md` files for slippage detection
- [ ] **TODAY-04**: `/today` identifies the hardest/most-avoided task (frog identification)

### Scheduling

- [ ] **SCHED-01**: `/today` executes on cron schedule pre-morning via Claude Desktop scheduled tasks
- [ ] **SCHED-02**: When MCP sources fail, `/today` produces degraded briefing with warnings rather than nothing

### Cross-References

- [ ] **XREF-01**: Wikilink cross-references work between left and right vault sides

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Search

- **SEARCH-01**: Persistent semantic search across vault (beyond Claude Code session-scoped retrieval)

### Configuration

- **CONFIG-01**: Configurable `/today` briefing sections (swap job hunt for other life-phase priorities)

### Reliability

- **RELI-01**: Wikilink health auditing (detect broken cross-references)
- **RELI-02**: MCP write-scope enforcement at connector level (beyond application-level write-gateway)

### Memory

- **MEM-04**: Memory audit command for reviewing/cleaning entries

## Out of Scope

| Feature | Reason |
|---------|--------|
| Autonomous email sending | Zero-trust principle — one hallucination away from a career incident |
| Real-time sync | Batch processing (cron + on-demand) is sufficient; real-time adds massive complexity |
| Mobile app | Obsidian mobile handles reading/capture natively |
| Chat interface for vault | Claude Code sessions ARE the chat interface; don't build a second one |
| Automatic memory promotion | Skipping human review gate makes the compounding flywheel amplify errors |
| Complex taxonomy/tagging | Left/right split + wikilinks is the only taxonomy needed; folder hierarchies kill adoption |
| Notification system | Pull-based (/today) only; push notifications create anxiety |
| Multi-user/sharing | Personal operating system; collaboration dilutes single-user optimization |
| ISPN/Genesys/Asana content | Hard exclusion from all memory promotion and ingress |
| Gmail send capability | Zero-trust: draft-only |
| Calendar write capability | Zero-trust: read-only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| VAULT-01 | — | Pending |
| VAULT-02 | — | Pending |
| VAULT-03 | — | Pending |
| VAULT-04 | — | Pending |
| INPUT-01 | — | Pending |
| INPUT-02 | — | Pending |
| INPUT-03 | — | Pending |
| INPUT-04 | — | Pending |
| MEM-01 | — | Pending |
| MEM-02 | — | Pending |
| MEM-03 | — | Pending |
| INTG-01 | — | Pending |
| INTG-02 | — | Pending |
| INTG-03 | — | Pending |
| TODAY-01 | — | Pending |
| TODAY-02 | — | Pending |
| TODAY-03 | — | Pending |
| TODAY-04 | — | Pending |
| SCHED-01 | — | Pending |
| SCHED-02 | — | Pending |
| XREF-01 | — | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 0
- Unmapped: 21 ⚠️

---
*Requirements defined: 2026-04-21*
*Last updated: 2026-04-21 after initial definition*

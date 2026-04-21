# Feature Landscape

**Domain:** AI-orchestrated personal knowledge management / second brain
**Researched:** 2026-04-21
**Confidence:** HIGH (established domain, well-documented patterns from Cole Medin, Eric Michaud, and mature PKM ecosystem)

## Table Stakes

Features users expect from an AI-orchestrated second brain. Missing any of these and the system feels like a plain notes app with a chatbot bolted on.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Memory compounding** | The core value proposition — each session makes the next one better. Without it, the system has no flywheel. | Medium | Already scoped as `memory.md` + `memory-proposals.md`. The human-in-the-loop staging area is the right call — prevents hallucination drift into long-term memory. |
| **Daily briefing / morning prep** | Users who build second brains expect the system to tell them what matters today without asking. The "pull" model (search when you need it) is table stakes for plain PKM; "push" model (system surfaces what's relevant) is table stakes for AI-orchestrated PKM. | Medium | Already scoped as `/today` with 6 sections. Key: must be fast (< 30 seconds wall clock) or users skip it. |
| **Multi-source ingestion** | A second brain that only knows what you type into it is a journal. Must ingest from email, calendar, project state, and conversations at minimum. | High | Gmail + Calendar + GitHub + cross-project state already planned. The zero-trust permission posture (draft-only Gmail, read-only Calendar) is a differentiator disguised as a constraint. |
| **Intelligent input routing** | When capturing new information, the system must know where to put it without the user specifying a folder path. This is the "frictionless capture" promise. | Medium | Already scoped as `/new`. The left/right write-permission routing is elegant — classification based on voice ownership rather than content taxonomy. |
| **Semantic search / retrieval** | Users expect to find things by meaning, not just filename or tag. "What did I decide about X?" must return the right note even if X isn't in the title. | Medium | Not yet scoped. Obsidian's core search is keyword-based. Options: Obsidian Smart Connections plugin (local embeddings), or Claude Code's grep + context understanding as a proxy. Claude Code reading vault files and answering questions already provides a form of this — but it's session-scoped, not persistent. |
| **Cross-reference / linking** | Knowledge compounds through connections. Wikilinks between notes are the Obsidian primitive. AI should suggest links the user wouldn't think to make. | Low | Wikilink cross-references between left and right sides already scoped. Auto-suggestion of links is a differentiator (see below). |
| **Content exclusion / filtering** | Users with professional context need hard boundaries on what enters the system. Compliance, IP, and personal preference all require ingress filtering. | Low | ISPN/Genesys/Asana exclusion already scoped at ingress. This is uncommon in consumer PKM but essential for executive-context users. |
| **Write-permission boundaries** | When AI can write to your knowledge base, you need clear boundaries on what it can touch. Without this, users lose trust. | Low | Left/right split already scoped. Most AI-PKM systems lack this — they either let AI write everywhere or nowhere. |

## Differentiators

Features that set this system apart from Notion AI, Mem, Reflect, Khoj, and other AI-PKM tools. Not expected, but create competitive advantage and personal lock-in.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Voice-preservation architecture** | The left/right write-permission split ensures human voice is never diluted by agent-generated content. No other AI-PKM system structurally enforces this. Mem and Notion AI intermingle human and AI content freely, making it impossible to distinguish original thought from synthesis. | Low (already designed) | The rule "any file whose words should sound like ME lives on the LEFT" is the killer insight. Enforce at MCP write-scope level. |
| **Memory promotion with human-in-the-loop** | `memory-proposals.md` → user approval → `memory.md` prevents the "hallucination compounding" problem where an AI error in memory propagates into all future sessions. Most AI-PKM systems (Mem, Khoj) auto-write to memory with no review gate. | Medium | Key UX question: how does the user review proposals? Inline in `/today`? Separate command? Obsidian checkbox workflow? |
| **Cross-project intelligence** | `/today` pulls from multiple `.planning/` directories across the project portfolio. No consumer PKM tool does this — they're siloed to their own data. This turns a personal knowledge system into a personal operating system. | High | Requires filesystem traversal across `~/projects/*/`. Already have filesystem MCP access. Main risk: performance at scale with many projects. |
| **Zero-trust integration posture** | Every external service operates at minimum viable permission. Gmail draft-only (never send), Calendar read-only, GitHub scoped to specific repos. This is an architectural principle, not a limitation. Most AI tools request maximum permissions. | Low | Already designed. Document as a feature, not a constraint. Users who care about AI safety (Pete's audience) will value this explicitly. |
| **Proactive slippage detection** | `/today` identifies work that's falling behind by scanning cross-project state. This is project management intelligence, not just knowledge management. Moves the system from "remembers things" to "notices things." | Medium | Requires parsing `.planning/STATE.md` across projects and comparing planned vs actual timelines. |
| **Ingress-level content filtering** | Content exclusion happens at the point of capture, not after the fact. ISPN/Genesys/Asana content never touches disk. This is a compliance-grade approach that consumer PKM tools don't offer. | Low | Already scoped. The ingress filter in `/new` is the enforcement point. |
| **Frog identification** | `/today` surfaces the hardest/most-avoided task ("eat the frog"). This is behavioral psychology applied to knowledge management — no other AI-PKM system does this. | Low | Requires heuristics: tasks repeatedly deferred, tasks with no progress, tasks the user has avoided discussing. |
| **Auto-suggested wikilinks** | After writing or routing content, the system proposes wikilinks to related notes the user might not have connected. Obsidian's graph view shows existing links; this suggests missing ones. | Medium | Could run after each `/new` invocation. Compare new content against existing note titles and content. Risk: noisy suggestions degrade trust. |
| **Job hunt integration** | `/today` has a dedicated job hunt section. This is hyper-specific to Pete's current context but represents a pattern: the system adapts its briefing sections to the user's current life phase. | Low | Section structure should be configurable so it evolves as priorities change. |

## Anti-Features

Features to explicitly NOT build. Each represents a trap that would degrade the system.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Autonomous email sending** | Zero-trust principle. An AI that sends emails on your behalf is one hallucination away from a career incident. Gmail draft-only is the right boundary. | Draft emails in Obsidian or Gmail drafts. Human reviews and sends manually. |
| **Real-time sync / live updating** | Adds massive complexity (conflict resolution, notification fatigue, performance overhead) for marginal value. Morning batch processing is sufficient — the system prepares overnight, user reviews in the morning. | Cron-based `/today` execution pre-morning. On-demand `/new` for mid-day captures. Batch, not stream. |
| **Mobile app** | Building a mobile app for a system that lives in Obsidian + Claude Code is scope creep. Obsidian has its own mobile app and sync. | Use Obsidian mobile for reading. Capture via Obsidian mobile quick-add or share sheet. |
| **Chat interface for the vault** | A conversational chatbot over your notes sounds appealing but creates a parallel access pattern that competes with Obsidian's native UI. Users end up maintaining two mental models of their knowledge. | Claude Code sessions ARE the chat interface. The vault is the persistent layer. Don't build a second chat UI. |
| **Automatic memory promotion** | Skipping the human review gate for memory makes the system faster but less trustworthy. One bad memory entry corrupts all future sessions that reference it. The compounding flywheel amplifies errors as much as insights. | Keep `memory-proposals.md` → human approval → `memory.md` pipeline. Speed is less important than accuracy for long-term memory. |
| **Complex taxonomy / tagging system** | Folder hierarchies and tag taxonomies are the PKM trap that kills adoption. Users spend more time organizing than thinking. The left/right split is the only taxonomy needed. | Use wikilinks for connections. Use search for retrieval. The AI handles routing — the user shouldn't need to think about where things go. |
| **Notification system** | Push notifications from your knowledge base create anxiety and interrupt flow. The system should be pull-based: user asks `/today`, system delivers. | `/today` is the single pull-based touchpoint. No push notifications, no badges, no alerts. |
| **Multi-user / sharing** | This is a personal operating system. Adding collaboration features dilutes the single-user optimization and introduces permission complexity. | Share outputs (deliverables, reports) through normal channels. The vault itself stays single-user. |
| **Plugin marketplace / extensibility framework** | Building a plugin system for a personal tool is over-engineering. The user is Pete, the developer is Claude Code. New features are added directly, not through plugins. | Add features directly to the orchestration layer. `/new` and `/today` are the extension points. |
| **AI-generated voice content** | Never let the AI write content that sounds like Pete. The left vault is sacred. Even well-prompted AI writing subtly erodes authentic voice over time. | AI writes to RIGHT side only. Summaries, extracts, proposals — always clearly agent-generated. LEFT side is human-only. |

## Feature Dependencies

```
Memory compounding
  ├── memory-proposals.md (extraction) → memory.md (promotion)
  └── Requires: multi-source ingestion (to have material to extract from)

Daily briefing (/today)
  ├── Requires: Gmail MCP connector
  ├── Requires: Google Calendar MCP connector
  ├── Requires: memory.md (reads long-term memory)
  ├── Requires: cross-project .planning/ state (reads project status)
  └── Requires: GitHub MCP connector (reads activity)

Input routing (/new)
  ├── Requires: left/right directory structure
  ├── Requires: ingress filtering (ISPN/Genesys/Asana)
  └── Enables: memory compounding (new content feeds extraction)

Cross-project intelligence
  ├── Requires: filesystem access to ~/projects/*/
  └── Enables: slippage detection in /today

Semantic search
  └── Requires: vault content indexed (either plugin or Claude Code session)

Auto-suggested wikilinks
  ├── Requires: existing vault content to compare against
  └── Requires: /new routing (triggers after content placement)
```

## MVP Recommendation

Build in this order based on dependencies and value delivery:

**Wave 1 — Foundation (must ship first):**
1. Left/right vault directory structure with write-permission enforcement
2. `/new` input router with ingress filtering
3. `memory-proposals.md` extraction pipeline

**Wave 2 — Daily Intelligence (the "wow" moment):**
4. Gmail MCP connector (draft-only)
5. Google Calendar MCP connector (read-only)
6. `/today` daily briefing with all 6 sections
7. `memory.md` promotion workflow

**Wave 3 — Compounding (the flywheel):**
8. Cross-project `.planning/` state scanning
9. Slippage detection in `/today`
10. Auto-suggested wikilinks after `/new`

**Defer:**
- Semantic search: Claude Code sessions already provide ad-hoc semantic retrieval. Dedicated embedding-based search is a nice-to-have, not a must-have, when the orchestration layer can read every file.
- Job hunt section customization: Start with hardcoded sections, make configurable later when life phase changes.

## Competitive Landscape

| System | Strengths | Lacks (vs this project) |
|--------|-----------|------------------------|
| **Mem** | Auto-organization, semantic search, AI writing | No voice preservation, no write boundaries, no cross-project intelligence |
| **Notion AI** | Rich database integration, team collaboration | No memory compounding, no proactive briefing, no ingress filtering |
| **Reflect** | Clean UI, backlinks, AI chat over notes | No multi-source ingestion, no daily briefing automation |
| **Khoj** | Open-source, self-hosted, multi-source | No write-permission architecture, no human-in-the-loop memory |
| **Rewind / Limitless** | Captures everything (meetings, screen) | No knowledge structure, no routing intelligence, privacy concerns |
| **Obsidian + Smart Connections** | Local embeddings, semantic search | No orchestration layer, no proactive intelligence, no external integrations |

**This project's unique position:** The combination of voice-preserving write boundaries + human-in-the-loop memory + cross-project intelligence + zero-trust integrations does not exist in any current product. Each individual feature exists somewhere; the architecture that connects them does not.

## Sources

### Primary (HIGH confidence)
- PROJECT.md — project requirements, constraints, and architecture decisions
- CLAUDE.md — project overview and vault rules
- Cole Medin patterns — memory compounding, knowledge extraction (referenced in PROJECT.md as inspiration)
- Eric Michaud patterns — structured vault architecture, proactive briefing (referenced in PROJECT.md as inspiration)

### Secondary (MEDIUM confidence)
- Domain knowledge of Mem, Notion AI, Reflect, Khoj, Rewind, Obsidian plugin ecosystem from training data (verified against known product capabilities as of early 2025)
- PKM methodology patterns (Tiago Forte's PARA, Zettelkasten, evergreen notes) as context for table stakes expectations

### Tertiary (LOW confidence)
- Competitive landscape details may have shifted since training cutoff — specific product features should be re-verified before using in public-facing materials

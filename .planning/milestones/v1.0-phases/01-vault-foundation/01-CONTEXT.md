# Phase 1: Vault Foundation - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Mechanically enforce a write-permission boundary on the Obsidian vault so every agent write lands in the correct location, excluded content never reaches disk, and agent-generated prose passes anti-AI style validation. Vault lives at `~/Claude Cowork/`; project code lives at `~/projects/second-brain/`.

Requirements: VAULT-01, VAULT-02, VAULT-03, VAULT-04, XREF-01

</domain>

<decisions>
## Implementation Decisions

### Vault Directory Layout
- **D-01:** No `LEFT/` or `RIGHT/` parent wrapper folders. Domain folders live at vault root. Write-gateway enforces the boundary by path allowlist.
- **D-02:** RIGHT side (agent-writable paths at vault root): `memory/`, `briefings/`, `ctg/`, `job-hunt/`, `interview-prep/`, `content/`, `research/`, `ideas/`, `proposals/`
- **D-03:** LEFT side (human-only writes at vault root): `ABOUT ME/` (exists), `Daily/`, `Relationships/`, `Drafts/`
- **D-04:** Three-tier access model: LEFT paths = agent reads, never writes. RIGHT paths = agent reads and writes. Unknown paths (not in either list) = agent blocked entirely — no read, no write. `vault-paths.json` is the complete manifest of what the agent can see.
- **D-05:** Gateway configuration lives at `~/projects/second-brain/config/vault-paths.json` with `{left: [...], right: [...]}` arrays. Whitelist both sides.

### Ingress Filtering
- **D-06:** Two-stage filter with graceful degradation. Stage 1: keyword scan (case-insensitive, word-boundary match). No hit = immediate write (zero latency, common case). Hit = proceed to Stage 2.
- **D-07:** Stage 2 (fires only on Stage 1 match): Claude Haiku classifies content. BLOCK: content about or from ISPN/Genesys/Asana (architecture, processes, internal people, confidential strategy, client data). ALLOW: neutral tool references ("tracked in Asana"), career narrative ("learned X at Genesys, apply here"), generic industry mentions.
- **D-08:** Graceful degradation: Haiku timeout (>2s) or API unavailable = BLOCK + queue to `proposals/` for human review. Never silently bypass the filter.
- **D-09:** Keyword list in `config/excluded-terms.json`. Seed: `["ISPN", "Genesys", "Asana"]`. Reloadable without restart.
- **D-10:** Dedicated Phase 1 task: expand keyword list to 15-20 terms before v1 go-live. Target categories: former employer product names (Genesys Cloud, PureCloud, etc.), project codenames, client names, internal tool names, senior leadership names.
- **D-11:** Filter applies at every write point: `/new` captures, `/today` outputs, memory promotions.

### Style Guide Enforcement
- **D-12:** Prompt injection: full `ABOUT ME/anti-ai-writing-style.md` content injected into system prompt of any agent producing vault-destined content (`/new` classifier, `/today` generator, memory-proposal extractor, anything writing to RIGHT paths).
- **D-13:** Post-write lint: regex-only (NOT semantic). Banned words extracted from style guide at filter init, cached in memory, reloaded when style guide file changes. Case-insensitive, word-boundary match. Latency target: <10ms.
- **D-14:** Lint failure handling: 1st violation = reject write, request regeneration with specific violation callout ("you used 'genuinely' which is banned — regenerate without it"). 2nd violation on same write = queue to `proposals/` with violation flag for human review.
- **D-15:** Semantic style concerns (hedging patterns, corporate buzzword density, performative enthusiasm) handled by prompt injection only, not post-write validation.

### Wikilink Strategy
- **D-16:** Agent creates wikilinks freely on RIGHT side content. Agent proposes wikilinks for LEFT side content (human approves). Obsidian resolves links natively within the vault.

### Claude's Discretion
- Write-gateway implementation approach (hook, middleware, Node module — researcher/planner decides)
- Internal data structures for the path allowlist
- File-watching mechanism for config/style guide reloading
- Test strategy and tooling

### Folded Todos
None.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Vault Identity
- `~/Claude Cowork/ABOUT ME/anti-ai-writing-style.md` — Banned words, banned structural patterns, formatting preferences, tone calibration. Source of truth for post-write lint keyword list and prompt injection content.
- `~/Claude Cowork/ABOUT ME/about-me.md` — Identity, work style, communication preferences.
- `~/Claude Cowork/ABOUT ME/my-company.md` — Connor Advisors, CTG engagement, active projects, career strategy.

### Project Architecture
- `.planning/PROJECT.md` — Key decisions (write-permission boundary, project-alongside-vault, zero-trust posture), constraints, integration status.
- `.planning/REQUIREMENTS.md` — VAULT-01 through VAULT-04, XREF-01 acceptance criteria.
- `.planning/ROADMAP.md` — Phase 1 success criteria (5 items).

### Pattern Guidance
- `state/pattern-context.md` — Active design patterns from KB v2.1. Especially Pattern 2 (Zero-Trust on Model Output) for the write-permission boundary and Pattern 7 (Adaptive Denial Tracking) for ingress filter degradation.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- No existing code in `~/projects/second-brain/`. This is a greenfield phase.

### Established Patterns
- Obsidian MCP gateway already wired (Docker MCP → Local REST API plugin, verified in PROJECT.md)
- GitHub MCP gateway already wired (OAuth done)
- Filesystem MCP configured for `/Users/cpconnor/projects/`

### Integration Points
- Write-gateway must intercept all vault writes — whether via Obsidian MCP, direct filesystem, or future MCP connectors
- `config/vault-paths.json` and `config/excluded-terms.json` are new config files consumed by the gateway
- Style guide at `~/Claude Cowork/ABOUT ME/anti-ai-writing-style.md` is a LEFT-side file (read-only to agent) that drives RIGHT-side enforcement

</code_context>

<specifics>
## Specific Ideas

- Vault navigation should feel flat in Obsidian — no nested LEFT/RIGHT parent folders cluttering the sidebar
- The `proposals/` directory serves double duty: memory proposals AND ingress-filter quarantine (blocked writes with violation flags)
- Keyword expansion session is a distinct task from architecture work — schedule it separately in the plan
- Config files are reloadable without restart (both `vault-paths.json` and `excluded-terms.json`)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-vault-foundation*
*Context gathered: 2026-04-21*

# Phase 27: Context Honesty - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Smart discuss (auto — 4/4 grey areas defaulted)

<domain>
## Phase Boundary

No surface reinvents what already ships; no status block goes stale unnoticed; conflicting sources have a defined winner. Requirements: SURFACE-REACH-01 (already shipped — see below), REQ-CTX-01 (staleness hook), REQ-CTX-03 (authority hierarchy).

**SURFACE-REACH-01 status:** code shipped 2026-07-15 via PR #62 (ADR-019: reach exporter + standalone recall CLI). The remaining manual half — instruction-layer pointers — was completed 2026-07-15: `~/Claude Cowork/CLAUDE.md` created (Cowork layer); `~/.claude/CLAUDE.md` and `~/projects/CLAUDE.md` already carried the pointer. Desktop chat userPreferences line handed to Pete (cannot be written from the filesystem). This phase does NOT re-implement reach.

</domain>

<decisions>
## Implementation Decisions

### Staleness hook (REQ-CTX-01)
- SessionStart hook registered in `.claude/settings.json`, script at `.claude/hooks/staleness-check.*` following the existing hook pattern
- Warn-only, never blocking: prints a warning naming the stale file when `Last verified:` in project CLAUDE.md exceeds 14 days; prints nothing when fresh
- Checks project CLAUDE.md only (the file the requirement names); date format `Last verified: YYYY-MM-DD`
- Missing/unparseable date is itself a warning (a status block without a verifiable date is stale by definition), but never a non-zero blocking exit
- Unit-testable core (Node) with Jest tests; thin registration in settings.json

### Authority hierarchy (REQ-CTX-03)
- One normative home: `decisions/ADR-020-authority-hierarchy.md`, ranking the four CURRENT stores: `ABOUT ME/` canon > `memory.md` > `CLAUDE.md` > Anthropic auto-memory blob
- Every pairwise conflict has one defined winner; includes Rule-4 behavior: canon disagrees with Pete live → Pete wins and canon is stale — flag in-session, never silently defer to either side
- One fact, one home (A3): CLAUDE.md is a router — it points at the hierarchy, never restates it
- Scoped to current stores; the `~/memory/` target architecture in `.planning/research/AUTHORITY.md` stays research (separate milestone per ADR-019 alternatives)

### Enforcement wiring
- Reach-exporter pointer template (`src/reach-exporter.js` generated `second-brain.md`) carries the hierarchy one-liner so every allowlisted surface sees it
- Project CLAUDE.md gets a one-line router pointer to ADR-020
- `~/Claude Cowork/CLAUDE.md` gets the hierarchy one-liner (agent-writable; vault root is not LEFT)

### Absorbed debt (STATE.md: "Candidate for Phase 27")
- `loadExcludedTerms()` fail-open (`src/pipeline-infra.js:341-347`): `semanticSearch` must degrade or throw on empty/unloadable excluded terms instead of shipping ungated queries to Voyage — the ISPN/Genesys/Asana exclusion is a hard rule and must fail closed. Same work-class as the milestone goal (declared enforcement not performed); per LESSON-PRE-EXISTING-DEBT-ABSORPTION-01

### Claude's Discretion
- Exact hook script language/format of the warning line
- ADR-020 prose structure (follow ADR-018/019 shape)
- Whether staleness core is `.sh` or `.js` (prefer `.js` for Jest testability, matching memory-extraction-hook.js precedent)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Hook registration pattern: `.claude/settings.json` PreToolUse/PostToolUse entries pointing at `$CLAUDE_PROJECT_DIR/.claude/hooks/*.sh` (no SessionStart entry exists yet)
- `hooks/` (git hooks) vs `.claude/hooks/` (Claude Code hooks) — staleness hook belongs in `.claude/hooks/`
- `src/reach-exporter.js` generates the cross-surface pointer file — template edit propagates on next real promotion
- `src/pipeline-infra.js` `loadExcludedTerms()` (lines ~341-347) returns `[]` on error — the fail-open to close; `vault-gateway` config validation already fails closed (pattern to mirror)

### Established Patterns
- ADRs in `decisions/` (ADR-018, ADR-019) — short Status/Decision/Rationale/Consequences shape
- No `console.log` in production code (ESLint); errors explicitly handled; hooks warn via stdout per Claude Code hook contract
- Tests mirror src in `test/`; CI runs `CI=true npm test` (LESSON-PREFLIGHT-CI-MODE-01)

### Integration Points
- `.claude/settings.json` hooks block (SessionStart array to add)
- `CLAUDE.md:23` `> Last verified: 2026-07-15` — the exact line the hook parses
- `config/excluded-terms.json` — the config whose absence must now fail closed in the semantic path

</code_context>

<specifics>
## Specific Ideas

- Warning must name the stale file and the age in days so the fix is obvious (run `/gsd:sync-docs`)
- CLAUDE.md:23 comment already anticipates this hook ("a SessionStart staleness hook (v1.6 E-02) will read this date") — keep the comment accurate after wiring

</specifics>

<deferred>
## Deferred Ideas

- `~/memory/` canonical-store bootstrap (AUTHORITY/LIFECYCLE target architecture) — separate milestone, per ADR-019
- MCP server exposing /recall to Desktop/chat — deferred in ADR-019
- `hooks/pre-push` destructive-remedy fix — Phase 28 candidate (STATE.md)

</deferred>

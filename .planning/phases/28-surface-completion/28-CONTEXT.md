# Phase 28: Surface Completion - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Smart discuss (auto — 4/4 grey areas defaulted)

<domain>
## Phase Boundary

Every command and agent mode the repo advertises actually fires. Requirements: REQ-SURF-01 (/reroute slash wrapper), REQ-SURF-02 (docs-sync audit fires from pre-push).

</domain>

<decisions>
## Implementation Decisions

### /reroute wrapper (REQ-SURF-01)
- `.claude/commands/reroute.md` following the `.claude/commands/promote-unrouted.md` pattern (frontmatter description + node -e inline reference implementation)
- Calls `rerouteFile` from `./src/reroute` — return shape is `{rerouted, from?, to?, reason?, failureMode?}` (src/reroute.js:74-80). The wrapper MUST read `r.to` and `r.from`; `r.target` does not exist (the audit's own proposed diff had exactly this bug)
- Usage: `/reroute <file> --target <path>` per ROADMAP success criterion 1 — check src/reroute.js signature: if `rerouteFile(filePath)` takes no target (it re-classifies), the wrapper takes just the file path and reports `r.to`; document actual accepted flags from the source, don't invent them

### Pre-push docs-sync audit (REQ-SURF-02)
- Deterministic gate, no agent in the loop: new `hooks/pre-push-docsync.js` that REUSES exports from `hooks/post-merge-doc-sync.js` (`extractDocStats`, `getLiveStats`, `compareStats`) — do not duplicate the regexes
- Blocking semantics per Phase 23 contract: exit non-zero when test-count mismatch (exact) or coverage drift > `block_threshold_pct` (3.0, from `config/docsync.json`); warn-only below that
- Wired as a step in the existing `hooks/pre-push` bash script (hooks install via `git config core.hooksPath hooks`, package.json prepare)
- Escape hatch: `SKIP_DOCSYNC=1 git push` bypasses the docs gate (emergency pushes), documented in the hook output
- Keep runtime sane: getLiveStats runs jest --coverage; acceptable at push time (pushes are infrequent); do NOT add caching speculation

### Pre-push destructive-remedy fix (absorbed debt, STATE.md "Candidate for Phase 28")
- Current hooks/pre-push tells the user to `git reset --hard origin/master` on ANY local-vs-origin master mismatch; session 61's failure was local master AHEAD (unpushed commit) — following that advice would have destroyed it
- Fix: `git merge-base --is-ancestor master origin/master` → strictly behind → safe to recommend reset/pull; otherwise (ahead or diverged) → recommend `git push` / manual reconcile, NEVER `reset --hard`
- Keep the existing stale-base block for feature branches; only the remedy text and the behind/diverged distinction change

### Doc-count refresh (corollary — required for the new gate to pass)
- CLAUDE.md and README.md currently claim 1234 tests / 1205 passing / coverage 92.74/81.15; live suite is 1240 total (1202 passed, 38 skipped) with coverage Stmts 92.57 / Branch 81.07 / Funcs 96.03 / Lines 93.18 (2026-07-15 full run, post-27-03)
- Re-count LIVE at execution start (LESSON-LIVE-RECOUNT-AT-EXECUTE-01) — do not copy these numbers; capture from the actual jest/coverage output and update CLAUDE.md status block + README stats + test-file count

### Claude's Discretion
- Exact wording of hook block messages
- Whether pre-push-docsync.js is a separate file or a function added to post-merge-doc-sync.js invoked with a mode flag (prefer separate thin file reusing exports — single responsibility)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `hooks/post-merge-doc-sync.js` — exports extractDocStats/compareStats/getLiveStats (HOOK-DOCSYNC-01); the drift machinery to reuse
- `.claude/commands/promote-unrouted.md` — wrapper pattern to copy for reroute.md
- `config/docsync.json` — `{warn_threshold_pct: 1.0, block_threshold_pct: 3.0}`
- `hooks/pre-push` — bash, installed via core.hooksPath; currently only the stale-master check

### Established Patterns
- Git hooks live in `hooks/` (repo-tracked, core.hooksPath); Claude Code hooks in `.claude/hooks/`
- Hook tests in `test/` (post-merge-doc-sync has test coverage — mirror for the pre-push script)
- One jest invocation at a time, --forceExit (tasks/lessons.md)

### Integration Points
- `hooks/pre-push` — add docsync step + fix remedy text
- `.claude/commands/` — add reroute.md
- `CLAUDE.md` status block + `README.md` stats — refresh from live counts
- `src/reroute.js` `rerouteFile()` — consumed as-is, no changes

</code_context>

<specifics>
## Specific Ideas

- ROADMAP success criterion 1 wording says `/reroute <file> --target <path>` but src/reroute.js re-classifies rather than taking a target — the wrapper must reflect the REAL signature and report `r.to`; if there is a target/override param in the source, honor it; verify against source, not the criterion's paraphrase
- Success criterion 3: after this phase, grep CLAUDE.md's command table — every listed command must have a `.claude/commands/*.md` or script entry point

</specifics>

<deferred>
## Deferred Ideas

- Branch protection restore on GitHub master — repo-settings decision, Pete's call (STATE.md Open Blockers), not a phase
- MCP server for /recall — deferred in ADR-019

</deferred>

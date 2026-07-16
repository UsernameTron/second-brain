# Phase 6: Defect Fixes and UAT - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix known defects and validate the full capture-to-memory flow against real-world inputs. No new features. FIX-02 (config hot-reload) deferred to backlog — no real symptom observed. Phase scope: FIX-01, FIX-03, FIX-04, FIX-05, UAT-01, UAT-02, UAT-03.

Requirements: FIX-01, FIX-03, FIX-04, FIX-05, UAT-01, UAT-02, UAT-03

</domain>

<decisions>
## Implementation Decisions

### Remote Execution (D-01 through D-04)

- **D-01:** Calendar connector MUST work in remote trigger context. `today-command.js` currently imports `getCalendarEvents` but the remote trigger has the Calendar MCP connector attached. The fix: detect the attached MCP connector in the remote environment and use it instead of expecting a local mcpClient. This is the one integration that should achieve parity remotely.

- **D-02:** Gmail and GitHub connectors degrade gracefully in remote context — no changes needed. Per Phase 5 D-11, RemoteTrigger cannot reach gmail-mcp-pete (local stdio MCP server). GitHub Docker MCP is also local. Both return `{success: false}` per the no-throw contract (Phase 3 D-18). `/today` renders degraded sections per Phase 4 D-10/D-11.

- **D-03:** Path resolution: replace all hardcoded `/Users/cpconnor` references with `process.cwd()` or `__dirname`-relative paths. The remote environment runs from `/home/user/second-brain/` (or `/root/`). Any path that assumes macOS home directory structure must be environment-agnostic.

- **D-04:** Missing Haiku API key in remote environment: the style-policy classifier and any LLM-dependent code must degrade gracefully (skip classification, return a sensible default) instead of crashing. This is already covered by the no-throw contract — the fix is ensuring the actual implementation catches auth/key errors at the point of the API call.

### In-Batch Dedup (D-05)

- **D-05:** Fix promote-memories dedup with two changes: (1) Add a `Set` tracking promoted `contentHash` values within the batch loop — prevents promoting the same content twice in one batch. (2) Extend `isDuplicateInMemory()` to also check the proposals file (`memory-proposals.md`), not just `memory.md` and archive files. A proposal that's still pending review should not be re-promoted.

### UAT Methodology (D-06 through D-08)

- **D-06:** Generate synthetic test inputs for UAT-01 (classification accuracy). Plan includes a task to create 10+ diverse synthetic captures covering each domain: voice/reflections (LEFT), technical notes (RIGHT), meeting summaries (RIGHT), personal drafts (LEFT), mixed-domain content, edge cases with excluded terms, ambiguous inputs. No real captures from Pete's workflow needed.

- **D-07:** UAT-02 (wikilink relevance) evaluates whether promoted memories produce meaningful cross-references. Test against existing vault content at `~/Claude Cowork/`. The promoted memories should link to notes that actually exist and are topically relevant.

- **D-08:** UAT-03 (Obsidian UX walkthrough) is inherently manual — the full capture → classify → propose → promote flow must complete in the vault UI without workarounds. Plan should include this as a human checkpoint.

### Scope Deferral (D-09)

- **D-09:** FIX-02 (config hot-reload) deferred to backlog. Two hot-reload mechanisms already implemented: chokidar in vault-gateway.js, fs.watch in style-policy.js. No real symptom observed. Investigating a defect that may not exist is scope creep. If a symptom surfaces later, the diagnostic context will be obvious from the actual error.

### Claude's Discretion

- Specific detection mechanism for remote MCP connector in today-command.js (environment variable check, mcpClient shape inspection, etc.)
- Synthetic test input content and diversity mix for UAT-01
- Whether to use a test harness or manual script execution for UAT-01/02
- Order of operations: fix defects first then UAT, or interleave

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Remote Execution (FIX-03/04/05)
- `src/today-command.js` — Capstone module that fans out to all data sources; needs remote MCP connector detection
- `src/connectors/calendar.js` — Calendar connector wrapping Cowork native MCP tools
- `src/connectors/gmail.js` — Gmail connector (degrades remotely, no changes needed)
- `src/connectors/github.js` — GitHub connector (degrades remotely, no changes needed)
- `src/pipeline-infra.js` — `createHaikuClient()` — needs graceful degradation on missing API key
- `src/style-policy.js` — LLM classifier that may fail on missing API key
- `config/scheduling.json` — RemoteTrigger config with mcp_connections

### In-Batch Dedup (FIX-01)
- `src/promote-memories.js` — Promotion loop with `isDuplicateInMemory()` check (lines ~120-135 for dedup logic, ~330-336 for batch loop)
- `src/memory-proposals.js` — Proposals file management (needs to be checked by dedup)

### UAT
- `src/classifier.js` — Classification logic to validate in UAT-01
- `src/wikilink-engine.js` — Wikilink generation to validate in UAT-02
- `src/new-command.js` — Full `/new` pipeline for UAT-03 walkthrough

### Phase Dependencies
- `.planning/phases/05-integration-wiring/05-CONTEXT.md` — D-11 (RemoteTrigger can't reach local MCP), D-12 (trigger ID)
- `.planning/phases/04-daily-briefing-and-scheduling/04-CONTEXT.md` — D-10/D-11 (degradation format)
- `.planning/phases/03-external-integrations/03-CONTEXT.md` — D-18 (no-throw contract)

### Project Governance
- `.planning/PROJECT.md` — Zero-trust posture, key decisions, known gaps
- `.planning/REQUIREMENTS.md` — FIX-01, FIX-03, FIX-04, FIX-05, UAT-01, UAT-02, UAT-03 acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/promote-memories.js` — `isDuplicateInMemory()` exists, needs expansion to check proposals + within-batch Set
- `src/connectors/calendar.js` — Calendar connector already wraps MCP tools, needs remote detection path
- `src/pipeline-infra.js` — `createHaikuClient()` is the centralized LLM client factory
- `src/vault-gateway.js` — Config loading and watch mechanisms (chokidar + fs.watchFile)

### Established Patterns
- No-throw contract on all connectors (Phase 3 D-18) — `{success, data/error, failureMode}`
- mcpClient dependency injection in connectors and today-command
- Graceful degradation per section in `/today` output (Phase 4 D-10/D-11)
- `loadPipelineConfig()` centralizes config access
- `computeHash()` for content hashing in memory pipeline

### Integration Points
- `today-command.js` line 36-43 — connector imports and fanout; remote MCP detection goes here
- `promote-memories.js` batch loop (~line 330) — dedup Set insertion point
- `isDuplicateInMemory()` (~line 121) — add proposals file to check list
- `pipeline-infra.js` `createHaikuClient()` — graceful key-missing handling

</code_context>

<specifics>
## Specific Ideas

- Remote execution goal: "Calendar works remotely, everything else degrades cleanly" — not full parity with local execution
- RemoteTrigger ID: `trig_01KvxeDfYDAEwAzw9zw9DKKB` (from Phase 5)
- Remote environment path: `/home/user/second-brain/` or `/root/` — must be discovered, not assumed
- UAT-03 is a manual Obsidian walkthrough — plan as human checkpoint, not automated test

</specifics>

<deferred>
## Deferred Ideas

- **FIX-02 (config hot-reload):** Deferred to backlog. No symptom observed. Two mechanisms already implemented. Revisit if a real defect surfaces.

</deferred>

---

*Phase: 06-defect-fixes-and-uat*
*Context gathered: 2026-04-22*

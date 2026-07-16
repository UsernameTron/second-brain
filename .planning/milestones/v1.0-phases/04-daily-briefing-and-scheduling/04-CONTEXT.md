# Phase 4: Daily Briefing and Scheduling - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

A single `/today` command produces a comprehensive morning prep list from all data sources, writes it to the vault as a daily note, echoes it to the terminal, runs unattended on a cron schedule via RemoteTrigger, and degrades gracefully when sources fail. Phase 4 composes what Phases 2 and 3 built — it does NOT build new connectors or new pipeline infrastructure.

Requirements: TODAY-01, TODAY-02, TODAY-03, TODAY-04, SCHED-01, SCHED-02

</domain>

<traceability>
## Requirements Traceability

| Requirement | Description | Satisfied By |
|-------------|-------------|-------------|
| TODAY-01 | `/today` produces briefing with 6 sections (meetings, emails, frogs, job hunt, AI reality check, slippage) | D-01, D-02, D-03, D-04, D-05, D-06, D-07 |
| TODAY-02 | Top of briefing reports data source health | D-08, D-09 |
| TODAY-03 | `/today` scans cross-project STATE.md for slippage | D-12, D-13, D-14 |
| TODAY-04 | `/today` identifies hardest/most-avoided task (frog) | D-15 (deferred to Area 2 discussion — frog identification heuristic) |
| SCHED-01 | `/today` runs pre-morning via scheduled task | D-16, D-17, D-18 |
| SCHED-02 | Degraded briefing with warnings when sources fail | D-10, D-11, D-19 |

</traceability>

<decisions>
## Implementation Decisions

### Briefing Composition (D-01 through D-07)

- **D-01:** Fan-out pattern. `Promise.allSettled` over three connector calls (`getCalendarEvents`, `getRecentEmails`, `getGitHubActivity`) plus synchronous calls to `briefing-helpers.js` (`getProposalsPendingCount`, `getDeadLetterSummary`). Carries forward Phase 3 D-16/D-22 — confirmed as the Phase 4 implementation pattern.

- **D-02:** Output format — dual surface. Markdown note written to vault at `~/Claude Cowork/RIGHT/daily/YYYY-MM-DD.md` (source of truth). Terminal echo prints the same content when run interactively. One template, two surfaces. The vault note means `/today` is re-readable later without re-running the fan-out. RIGHT side per vault write-permission rules.

- **D-03:** Six sections in decay-rate descending order:
  1. **Meetings** — time-anchored, immediately actionable, highest decay
  2. **VIP Emails** — high-leverage, time-decaying
  3. **Slippage** — cross-project risk from `.planning/STATE.md` scan (TODAY-03)
  4. **Frog** — the single hardest/most-avoided task (TODAY-04)
  5. **GitHub** — async catchup, lower decay
  6. **Pipeline** — proposal count + dead-letter summary, lowest decay

  Ordering principle: decay-rate descending. Calendar decays fastest (meeting in 2 hours), pipeline state decays slowest (proposals wait). Frog at #4 deliberately — after slippage context is established, before low-decay async info.

- **D-04:** LLM usage — minimal, two Haiku calls maximum:
  - (a) Frog identification — requires judgment over heuristic-scored candidates (see D-15)
  - (b) Top-of-brief synthesis paragraph — 3-4 sentences tying the day together
  - Raw data rendering for everything else (calendar list, email list, GitHub activity list). No LLM-summarized data when the user wants the actual data. Keeps cost and latency low.

- **D-05:** Dry-run mode. `/today --dry-run` writes to a scratch path (`~/Claude Cowork/RIGHT/daily/_dry-run-YYYY-MM-DD.md`) instead of the vault daily note. Makes testing and future iteration safer. `mode: dry-run` in frontmatter distinguishes test briefings from real ones.

- **D-06:** Wikilink convention. When slippage mentions a project, the wikilink targets that project's vault-internal brief (e.g., `[[second-brain]]` pointing to a LEFT-side project note if one exists), never the external `~/projects/PROJECT/` filesystem path. Only create wikilinks to notes that exist in the vault.

- **D-07:** Section heading convention. Human-facing names: "Meetings" (not "Calendar"), "VIP Emails" (not "Gmail"), "Pipeline" (not "Briefing Helpers"). Horizontal rule after the synthesis blockquote before `## Meetings` for visual scannability.

### Frontmatter Template (D-08 through D-09)

- **D-08:** Daily note frontmatter uses YAML map for sources (not space-separated string). `gray-matter` is already in deps for native YAML parsing:
  ```yaml
  ---
  date: 2026-04-23
  sources:
    calendar: ok
    gmail: degraded
    github: ok
    pipeline: ok
  degraded: 1
  generated: 2026-04-23T11:55:00Z
  mode: scheduled|interactive|dry-run
  ---
  ```
  - `sources` map: machine-parseable per-source health
  - `degraded` integer: redundant with `sources` but enables `grep "^degraded: [1-9]"` across daily folder as a one-liner. Cost is three characters; payoff is queryability forever
  - `mode`: distinguishes scheduled runs, interactive `/today`, and test runs

- **D-09:** Full markdown template:
  ```markdown
  ---
  date: YYYY-MM-DD
  sources:
    calendar: ok|degraded
    gmail: ok|degraded
    github: ok|degraded
    pipeline: ok|degraded
  degraded: N
  generated: ISO8601
  mode: scheduled|interactive|dry-run
  ---

  # Daily Briefing — DayOfWeek, Mon DD

  > [3-4 sentence synthesis paragraph. Flags degraded sources.]

  ---

  ## Meetings
  [Calendar events as bullet list: time, title, attendees]

  ## VIP Emails
  [Email subject, sender, snippet — actionable items first]

  ## Slippage
  [Cross-project scan: stalled phases, overdue plans]

  ## Frog
  [Single hardest task with reasoning]

  ## GitHub
  [Commits, PRs, issues across UsernameTron repos]

  ## Pipeline
  [Proposal count, dead-letter summary from briefing-helpers]
  ```

### Degradation (D-10 through D-11)

- **D-10:** Per-section degradation. When `result.success === false`, the section renders:
  ```
  ⚠️ {source}: {error}
  ```
  Where `{error}` matches `/^[A-Z_]+: .+/` (e.g., `[gmail] MCP_TIMEOUT: gmail-mcp-pete did not respond within 30s`). Contract test enforces this regex on error rendering. The briefing continues with remaining sections. Maps to Phase 3 D-20 / SCHED-02.

- **D-11:** Synthesis threshold — always run. The synthesis paragraph is most valuable precisely when things are degraded — it contextualizes what you _do_ have. The synthesis receives degradation flags so it doesn't hallucinate around missing sources.
  - **Total-failure fallback:** When ALL sources fail, replace synthesis with diagnostic checklist:
    > All data sources unavailable. Check: (1) Docker Desktop running? (2) Obsidian Local REST API plugin enabled? (3) Network?
  - Same cost, turns a dead briefing into a debugging checklist on the one day it matters.

- **D-19:** Error envelope — inline only. Vault notes ARE the audit trail. No separate `state/briefing-errors.log`. Error strings must be grep-friendly per D-10 format. Failure-frequency report via: `grep -h '⚠️' ~/Claude\ Cowork/RIGHT/daily/*.md | sort | uniq -c`. Phase 4 plan should add a contract test: when a connector fails, the briefing renders the D-10 format where `{error}` matches the regex.

### Slippage Scanner (D-12 through D-14)

- **D-12:** Cross-project slippage scanner is inline in `/today` — a function inside the `/today` module, not a separate `src/scanners/` module. Extraction trigger: a second consumer (like `/gsd:portfolio`). Don't pre-extract on speculation.

- **D-13:** Scanner implementation:
  - Globs `~/projects/*/.planning/STATE.md`
  - Parses YAML frontmatter for: `status`, `last_activity`, `progress.percent`, `progress.completed_phases`, `progress.total_phases`
  - Identifies stalled phases: no `last_activity` within `staleDays` threshold
  - Reports: project name, current phase, percent complete, days since last activity
  - Configurable under `config/pipeline.json` → `slippage`:
    ```json
    "slippage": {
      "staleDays": 7,
      "excludeProjects": [],
      "maxProjects": 20
    }
    ```
  - `staleDays: 7` — 3 days fires on weekend slips (too noisy), 14 is too late. 7 catches genuine stalls without tripping on weekly cadence.
  - `excludeProjects` — seatbelt for the ISPN/Genesys/Asana exclusion rule. They shouldn't be in `~/projects/` but the config acknowledges the constraint.
  - `maxProjects: 20` — guards against `~/projects/` sprawl. If you cross 20, the briefing is telling you something about focus.

- **D-14:** Scanner failure mode. If a `STATE.md` can't be parsed (malformed YAML, missing frontmatter), skip that project silently and emit one warning to the synthesis context. Don't let one broken STATE.md kill the whole briefing.

### Frog Identification (D-15)

- **D-15:** Frog identification uses one Haiku call over heuristic-scored candidates. Exact heuristic and data sources to be resolved during planning (requires decisions about what "hardest/most-avoided" means operationally). Inputs to the Haiku call: slippage data, task age, prior frog history (if tracked). Output: single task with 1-2 sentence reasoning.

### Scheduling (D-16 through D-18)

- **D-16:** Primary mechanism: **RemoteTrigger API** (server-side cron via claude.ai). Verified via probe on 2026-04-22:
  - Created test trigger `trig_01NHx3Uz8ni8eZSfsMph4miY` (disabled, deleted after verification)
  - Confirmed: 5-field cron in UTC, `environment_id` required (Anthropic cloud: `env_01TjBJLSRwHfpUPcNVUK99Kb`), `mcp_connections` array for attaching MCP connectors, `persist_session` boolean
  - Google Calendar MCP connector available: `connector_uuid: f94e7416-4e60-44bc-9ed2-45fa49a68665`
  - Runs in Anthropic cloud with git checkout of repo — no local machine access
  - No 7-day expiry (unlike CronCreate)
  - User's timezone: America/Chicago. Cron expressions in UTC. 6:47 AM CDT = 11:47 AM UTC.

- **D-17:** Fallback chain: RemoteTrigger → CronCreate (durable, `.claude/scheduled_tasks.json`, but 7-day auto-expiry) → macOS launchd (system-level, requires plist management). Use the first option that works; don't implement all three.

- **D-18:** Scheduled `/today` configuration:
  - Trigger name: `second-brain-daily-briefing`
  - Schedule: pre-morning weekdays (exact time TBD during planning, ~6:45 AM CDT = ~11:45 AM UTC)
  - Model: `claude-sonnet-4-6` (sufficient for briefing composition)
  - Sources: `https://github.com/UsernameTron/second-brain`
  - MCP connections: Google Calendar (`f94e7416-4e60-44bc-9ed2-45fa49a68665`)
  - Prompt: self-contained `/today` invocation (remote agent has zero prior context)
  - `enabled: false` initially — enable after manual verification

### Gmail Scope Boundary (D-20 through D-22)

- **D-20:** gmail-mcp-pete OAuth wiring is **out-of-scope for Phase 4**. Tracked as a parallel workstream in its own repo (`~/projects/gmail-mcp-pete/`). Phase 4 builds against the connector interface contract; briefing works with stubs until OAuth lands.

- **D-21:** The Gmail connector in second-brain is already decoupled via `mcpClient` dependency injection. The `getRecentEmails`/`getEmailBody`/`createDraft` interface doesn't care whether the MCP behind it is stubs or live. Swap happens without changing second-brain code when OAuth ships.

- **D-22:** Contract test validates the interface works with either backend. Test asserts: (a) connector returns D-15 uniform shape on success and failure, (b) no direct MCP tool imports — only uses injected `mcpClient`, (c) VIP filtering applies regardless of backend. This test already exists from Phase 3; Phase 4 inherits it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 3 Contract (connector interface)
- `.planning/phases/03-external-integrations/03-CONTEXT.md` — D-15 through D-22: uniform result shape, no-throw contract, connector composition model, Phase 3/4 boundary
- `src/connectors/types.js` — SOURCE enum, makeResult/makeError factories, config loader

### Phase 2 Briefing Helpers
- `.planning/phases/02-content-pipeline/02-CONTEXT.md` — D-67: briefing helper functions spec
- `src/briefing-helpers.js` — getProposalsPendingCount, getDeadLetterSummary, formatBriefingSection

### Pipeline Infrastructure
- `src/pipeline-infra.js` — loadPipelineConfig, Haiku LLM client, correlation IDs
- `config/connectors.json` — connector-specific runtime config
- `config/pipeline.json` — pipeline config (slippage section to be added)

### Scheduling
- RemoteTrigger API verified via probe (2026-04-22). Schema documented in D-16.

### Project Governance
- `.planning/PROJECT.md` — core value, constraints, zero-trust posture, key decisions
- `.planning/REQUIREMENTS.md` — TODAY-01 through TODAY-04, SCHED-01, SCHED-02 acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/connectors/calendar.js` — `getCalendarEvents(mcpClient, window)` returns D-15 shape
- `src/connectors/gmail.js` — `getRecentEmails(mcpClient, window, vipOnly)` returns D-15 shape
- `src/connectors/github.js` — `getGitHubActivity(mcpClient, window)` returns D-15 shape with `warnings[]` for partial failure
- `src/connectors/types.js` — SOURCE enum, makeResult/makeError, getConnectorsConfig (memoized lazy loader)
- `src/briefing-helpers.js` — getProposalsPendingCount, getDeadLetterSummary, formatBriefingSection
- `src/pipeline-infra.js` — loadPipelineConfig, createHaikuClient, generateCorrelationId
- `gray-matter` (in deps) — YAML frontmatter parsing for daily notes

### Established Patterns
- No-throw contract: all connectors catch errors and return `{success: false}` (Phase 3 D-18)
- Memoized lazy config loading: `getConnectorsConfig()` (Phase 3 D-23)
- Config + JSON Schema validation: `config/*.json` + `config/schema/*.schema.json`
- Haiku LLM client: `createHaikuClient()` in pipeline-infra.js with classify() that never throws

### Integration Points
- `/today` command module: new `src/today-command.js`
- Config addition: `slippage` section in `config/pipeline.json` + schema update
- RemoteTrigger: trigger creation as Phase 4 deliverable (not code — API configuration)
- Daily note output: `~/Claude Cowork/RIGHT/daily/YYYY-MM-DD.md`

</code_context>

<specifics>
## Specific Ideas

- Section headings use human-facing names ("Meetings" not "Calendar")
- Horizontal rule after synthesis blockquote before first section for visual scannability
- Frog sits at position #4 — after slippage context, before low-decay async info
- Error strings must be grep-friendly: `[SOURCE] ERROR_CODE: human message`
- Diagnostic checklist on total failure — not just "sources unavailable"
- `degraded: N` integer in frontmatter for one-liner queryability across daily folder

</specifics>

<deferred>
## Deferred Ideas

- **gmail-mcp-pete OAuth wiring** — parallel workstream in its own repo. Tracked separately with its own acceptance criteria. Phase 4 works with stubs.
- **Slippage scanner extraction** — inline for now. Extract to `src/scanners/project-scanner.js` when a second consumer emerges (e.g., `/gsd:portfolio`).
- **Frog history tracking** — tracking which tasks were identified as frogs over time to improve identification. v2 feature.
- **Configurable /today sections** — CONFIG-01 in v2 requirements. Phase 4 ships with fixed 6 sections.

</deferred>

---

*Phase: 04-daily-briefing-and-scheduling*
*Context gathered: 2026-04-22*

# Phase 2: Content Pipeline - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Input routing via `/new` with automatic domain classification and left/right routing, plus memory compounding via a human-reviewed proposal/promotion workflow. Users can capture any input through `/new`; memory compounds daily through extraction, proposal, and promotion.

Requirements: INPUT-01, INPUT-02, INPUT-03, INPUT-04, MEM-01, MEM-02, MEM-03

</domain>

<traceability>
## Requirements Traceability

| Requirement | Description | Satisfied By |
|-------------|-------------|-------------|
| INPUT-01 | `/new` captures any input with domain classification | D-01, D-02, D-03, D-04, D-06, D-40 |
| INPUT-02 | Left/right routing with voice-authenticity gate | D-02 (Stage 1), D-12, D-13, D-14, D-15, D-16 |
| INPUT-03 | `/new` integrates ingress filtering — excluded content never reaches disk | D-40, D-41, D-43 |
| INPUT-04 | Wikilink suggestions on routed notes | D-17, D-18, D-19, D-20 |
| MEM-01 | Memory extraction from sessions and vault content | D-21, D-22, D-23, D-24, D-25, D-26, D-27, D-44, D-45, D-46 |
| MEM-02 | Human-reviewed proposal/promotion workflow | D-28, D-29, D-30, D-31, D-33, D-34 |
| MEM-03 | Batch-capped promotion with dedup and archiving | D-32, D-33, D-34 |

</traceability>

<decisions>
## Implementation Decisions

### Input Classification (D-01 through D-06)

- **D-01:** `/new` supports both invocation modes: argument-based (`/new 'text'`) for quick capture, interactive prompt when no args given.
- **D-02:** Domains map 1:1 to vault directories. Classifier is hierarchical, two-stage — NOT a flat 13-label model.
  - **Stage 1 — Voice gate:** Binary LEFT vs RIGHT classification based on voice-authenticity rule ("any file whose words should sound like ME lives on the LEFT"). Output: LEFT or RIGHT + confidence score.
  - **Stage 2 — Subdirectory pick:** Within the chosen side, pick the target directory. LEFT: ABOUT ME/, Daily/, Relationships/, Drafts/. RIGHT: memory/, briefings/, ctg/, job-hunt/, interview-prep/, content/, research/, ideas/. memory/ contains memory.md at `memory/memory.md` and `memory-archive/YYYY.md` files. proposals/ is a subsystem-owned destination (left-proposals, memory-proposals, unrouted). Classifier never routes to it directly. Output: full directory path + confidence score.
- **D-03:** Confidence-gated fallback:
  - Stage 1 confidence < 0.8 → prompt user to confirm LEFT/RIGHT before Stage 2
  - Stage 2 confidence < 0.7 → present top 2 candidates, ask user to pick
  - Above both thresholds → route silently, log decision, surface "routed to path/" in response
  In non-interactive invocation contexts (Stop hook, scheduled task, headless CLI), interactive fallbacks are disabled. Ambiguous classifications route to dead-letter with failure-mode: non-interactive-ambiguous. User reviews via `/reroute` on next session.
- **D-04:** LLM strategy: Haiku for both stages by default. Sonnet escalation on low-confidence Stage 2 results.
  - Stage 2 Haiku confidence >= 0.8 → accept Haiku result
  - Stage 2 Haiku confidence < 0.8 → re-run Stage 2 on Sonnet
  - Sonnet confidence >= 0.7 → accept Sonnet result
  - Sonnet confidence < 0.7 → fall through to interactive "pick top 2" prompt
  Stage 1 does not escalate to Sonnet; voice-gate binary classification is empirically reliable on Haiku. Sonnet is reserved for Stage 2 where label cardinality is higher.
- **D-05:** Domain extensibility: adding a new vault directory requires (a) add to RIGHT allowlist in vault-paths.json, (b) add label + one-line description to Stage 2 classifier prompt. No routing-table maintenance.
- **D-06:** Classification instrumentation: log every classification with input text length, Stage 1 result + confidence, Stage 2 result + confidence, whether Sonnet escalation fired, final destination. Calibrate 0.8/0.7 thresholds after 100+ invocations.

### Note Format (D-07 through D-11)

- **D-07:** Base format for every routed note: YAML frontmatter (created, source, domain, routed-by with stage-1/stage-2 provenance, filename-basis, tags) + raw input body preserved verbatim.
- **D-08:** Template overlays for 3 domains ONLY:
  - briefings/ → adds: attendees, meeting-date, decisions[], follow-ups[]
  - job-hunt/ → adds: company, role-title, stage, next-step-date, source-url
  - interview-prep/ → adds: company, role, interview-date, interviewer, stories-selected[], risk-questions[]
- **D-09:** Template field extraction: lightweight Haiku pass on templated-domain input to populate known fields. Low-confidence fields left empty — never invent values.
- **D-10:** Filename convention: input < 60 chars and title-like → use as filename (first-line). Long-form → Haiku generates 4-8 word filename (haiku-generated). User override via `--name` flag (user-provided). Collision: append -2, -3, etc.
- **D-11:** Timestamps: ISO-8601 with timezone offset for Dataview queries and sub-day sorting.

### Left/Right Routing (D-12 through D-16)

- **D-12:** LEFT-classified content routes to `proposals/left-proposals/` as a proposal file. Agent never writes to LEFT directories (D-04 from Phase 1 preserved).
- **D-13:** Left-proposal file format: frontmatter (created, type: left-proposal, source, suggested-left-path, proposal-action: create|append|edit-section, routed-by, status: pending) + suggested action + suggested content + review checklist (accept/edit/reject/re-route).
- **D-14:** Daily note handling: if classifier picks Daily, suggested-left-path defaults to `Daily/{today}.md` with proposal-action: append (or create if today's note doesn't exist).
- **D-15:** Review surface: Obsidian — user opens `proposals/left-proposals/` and filters on `status: pending` via Dataview. No CLI command required for review.
- **D-16:** Status lifecycle: pending → accepted | rejected | rerouted. Pruning: proposals pending > 14 days auto-archived to `proposals/left-proposals/archive/`. Not deleted — archived.

### Wikilink Suggestions (D-17 through D-20)

- **D-17:** Hybrid pipeline: filename search as cheap first pass, Haiku re-rank as semantic filter. Output capped at 3-5 links in a `## Related` footer section. Omit section entirely if nothing meets confidence.
- **D-18:** Cached vault index at `.cache/vault-index.json` with {path, title, first-line, tags} per note. Refresh on vault-gateway successful write + nightly full rebuild. No full-vault scan per /new call.
- **D-19:** Pipeline: (1) tokenize body + extract proper nouns + pull tags, (2) grep index for title overlap + first-line hits + tag overlap → top 20 candidates, (3) Haiku re-rank with relevance >= 0.6 threshold → top 3-5, (4) append `## Related` with wikilinks + 6-word reason per link.
- **D-20:** Boundary: RIGHT-routed notes link freely to LEFT or RIGHT files. LEFT proposals include suggested wikilinks INSIDE the proposal body under `## Suggested wikilinks` — not pre-applied to LEFT content (respects D-16 from Phase 1).

### Memory Extraction (D-21 through D-27)

- **D-21:** Three triggers: (1) session wrap hook (primary, automated on /wrap), (2) on-demand `/extract-memories` with --file, --dir, --since, --daily-range, (3) scheduled daily sweep of Daily/ notes at 23:45.
- **D-22:** Seven memory categories: DECISION, LEARNING, PREFERENCE, RELATIONSHIP, CONSTRAINT, PATTERN, OTHER. Extractor assigns exactly one per candidate.
- **D-23:** Category definitions (inclusion shape, example, exclusion rules) are owned by `config/templates.json` under the `memory-categories` key. Schema at `config/schema/memory-categories.schema.json`. OTHER requires one-sentence justification in the extractor output.
- **D-24:** Explicit exclusions from extraction: routine actions, status updates, debugging steps, TODO items, uninterpreted third-party quotes, ISPN/Genesys/Asana content, content already verbatim in memory.md.
- **D-25:** Confidence gate: >= 0.75 → write standard; 0.5-0.75 → write with status: low-confidence; < 0.5 → drop.
- **D-26:** Extraction prompt: Haiku with system prompt listing categories + rules, user prompt is transcript/file content. Returns JSON array of {category, content, source-ref, confidence, rationale}.
- **D-27:** Dedup across triggers via source-ref + content-hash check before writing to memory-proposals.md.

### Memory Promotion (D-28 through D-34)

- **D-28:** memory.md structure: single file, month-level sections (newest month at top), inline Dataview fields per entry (category::, source-ref::, tags::, added::, optional related::). Append-only within month.
- **D-29:** Entry format: `## YYYY-MM-DD · CATEGORY · source-ref-short` header, one-paragraph prose body, 4-6 inline fields.
- **D-30:** Review surface: Obsidian (primary, user marks checkboxes). CLI `/promote-memories` is the promotion executor — reads marks, validates, writes to memory.md, archives processed proposals. CLI is execution-only, never interactive.
- **D-31:** Proposal format: per-candidate section with checkboxes (accept/reject/edit-then-accept/defer), proposed tags, proposed related links. Exactly one box checked per candidate; ambiguous marking = skip with warning.
- **D-32:** Batch cap: 10 default (MEM-03), override via `--max N`, `--all` bypasses with confirmation. Promote by confidence-descending; excess deferred for next run.
- **D-33:** Dedup on promotion: content-hash check against memory.md + memory-archive/*.md. Match → skip, mark as duplicate-of-existing-memory.
- **D-34:** Growth management: archive oldest complete year to `memory-archive/YYYY.md` when memory.md exceeds 200KB or 500 entries. Retain current + previous year minimum. Dataview queries include archive.

### Error Handling (D-35 through D-39)

- **D-35:** Global fallback: dead-letter + notify. Input preservation is non-negotiable. Never lose captures. Dead-letter location: `proposals/unrouted/`.
- **D-36:** Failure-mode taxonomy: api-error, timeout, parse-error, confidence-floor, gate-rejection. Each maps to specific dead-letter behavior.
- **D-37:** Auto-retry: api-error and timeout only → retry after 15min, increment on failure, cap at 3 attempts, then freeze for manual handling. parse-error, confidence-floor, gate-rejection → never auto-retry.
- **D-38:** Notification: /new returns immediately with dead-letter path + failure mode. /today surfaces unrouted count. Count > 10 = top-line warning.
- **D-39:** Enrichment failures (wikilink, template extraction) never block the primary write path. Write note with base format, omit enrichment sections.

### Pipeline Composition (D-40 through D-43)

- **D-40:** Sequential pipeline: Stage 0 (exclusion gate, content-policy.js, Phase 1) → Stage 1 (voice gate) → Stage 2 (subdir pick) → Stage 3 (template extraction, conditional) → Stage 4 (wikilink generation) → Stage 5 (vault-gateway write).
- **D-41:** Stage 0 is a hard gate. On BLOCK, /new exits immediately — no dead-letter, no classification. On Stage 0 internal failure, fail-closed: dead-letter with failure-mode: exclusion-unavailable. Never fail-open on the trust boundary.
- **D-42:** Shared infrastructure across stages: single Haiku client wrapper, structured-output JSON parser, logger with correlation IDs (UUID per /new invocation), dead-letter writer.
- **D-43:** Phase boundary: content-policy.js is Phase 1 code, consumed via existing exports. Phase 2 does not modify its internals. Adding correlation IDs to its logs is an explicit Phase 2 task if needed.

### Session Transcript (D-44 through D-46)

- **D-44:** /wrap reads session transcript via transcript_path from hook stdin (JSONL format). Streams line-by-line, does not load full file.
- **D-45:** Extraction corpus: user messages, assistant text content, semantically-weighted tool outputs (git diff, merged PRs). Excludes: system messages, empty/short messages, Read/Glob/Grep/LS tool pairs.
- **D-46:** Oversized transcripts (> 5MB or > 2000 messages): chunked extraction in 100-message windows, deduplicate candidates across chunks by content-hash.

### Config and Carryovers (D-47 through D-50)

- **D-47:** Config layout: config/pipeline.json (new), config/templates.json (new), config/schema/*.schema.json (new). Alongside existing vault-paths.json and excluded-terms.json.
- **D-48:** Phase 2 owns hot-reload defect fix as prerequisite task (first task in Phase 2 execution). chokidar-based config/ directory watch, schema validation on change, atomic in-memory swap, config:reloaded event. Integration test required.
- **D-49:** Phase 2 owns excluded-terms expansion from 3 to 15-20 entries. Pete provides the list (account-specific knowledge). False-positive audit against 50-100 recent notes is non-negotiable exit criterion.
- **D-50:** All thresholds in config/pipeline.json, never hardcoded: classifier confidence floors, extraction confidence gates, wikilink accept threshold, batch cap, archive triggers, filename cutoff, retry delays.

### Claude's Discretion

- Dead-letter auto-retry implementation choice (cron vs launchd vs scheduled task)
- Vault index cache invalidation strategy details
- Correlation ID format (UUID v4 vs nanoid vs similar)
- Internal data structures for candidate dedup (hash algorithm, in-memory vs disk)
- Test tooling and mock strategy for LLM responses
- Daily note append vs create mechanic details
- Concurrency / file locking for /new + /wrap overlap
- .cache/ directory location and gitignore policy
- Logging schema for instrumentation logs

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Code (consume, do not modify internals)
- `src/vault-gateway.js` — Three-gate write pipeline (path guard → content filter → style lint). Phase 2 writes through this.
- `src/content-policy.js` — Two-stage exclusion filter (keyword + Haiku). Phase 2 Stage 0 consumes this.
- `src/style-policy.js` — Post-write lint with banned words. Phase 2 writes pass through this.
- `src/utils.js` — escapeRegex utility. Phase 2 reuses this.
- `config/vault-paths.json` — RIGHT/LEFT path allowlists. Phase 2 adds new vault directories here.
- `config/excluded-terms.json` — Ingress filter terms. Phase 2 expands from 3 to 15-20.

### Vault Identity
- `~/Claude Cowork/ABOUT ME/anti-ai-writing-style.md` — Banned words, tone calibration. Style lint source of truth.
- `~/Claude Cowork/ABOUT ME/about-me.md` — Identity, work style, communication preferences.

### Project Architecture
- `.planning/PROJECT.md` — Key decisions, constraints, zero-trust posture.
- `.planning/REQUIREMENTS.md` — INPUT-01 through INPUT-04, MEM-01 through MEM-03 acceptance criteria.
- `.planning/ROADMAP.md` — Phase 2 success criteria (6 items).

### Phase 1 Context
- `.planning/phases/01-vault-foundation/01-CONTEXT.md` — D-01 through D-16 decisions. Phase 2 inherits these.

### Pattern Guidance
- `state/pattern-context.md` — Active KB v2.1 patterns. Pattern 2 (Zero-Trust) for exclusion gate. Pattern 7 (Adaptive Denial) for dead-letter retry. Pattern 11 (Feature Flags as Perimeters) for LEFT/RIGHT boundary.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `vault-gateway.js:vaultWrite()` — Three-gate write pipeline. Phase 2 writes through this for RIGHT-side content.
- `vault-gateway.js:vaultRead()` — Three-tier read guard. Phase 2 uses for reading vault notes during wikilink indexing.
- `vault-gateway.js:toWikilink()`, `toQualifiedWikilink()` — Wikilink generation utilities.
- `vault-gateway.js:quarantine()` — Redacted metadata-only quarantine. Phase 2 dead-letter files use similar pattern.
- `vault-gateway.js:VaultWriteError` — Custom error class with codes (INVALID_PATH, PATH_BLOCKED, STYLE_VIOLATION, CONTENT_BLOCKED).
- `content-policy.js:checkContent()` — Two-stage exclusion filter. Phase 2 Stage 0 calls this directly.
- `content-policy.js:sanitizeTermForPrompt()` — Prompt injection defense. Phase 2 classifier prompts reuse this pattern.
- `utils.js:escapeRegex()` — Regex escaping utility.

### Established Patterns
- Haiku API calls via `@anthropic-ai/sdk` with structured prompts (content-policy.js:classifyWithHaiku)
- Config loading from `config/` directory with JSON.parse + validation (vault-gateway.js:loadConfig)
- fs.watch with debounce for hot-reload (currently defective — Phase 2 fixes)
- Audit logging via structured JSON to stderr (vault-gateway.js:logDecision)
- 96 tests across 5 suites (Jest)

### Integration Points
- /new classifier output feeds into vault-gateway.js:vaultWrite() for RIGHT-side writes
- /new LEFT-classified content writes to proposals/left-proposals/ (still through vaultWrite — proposals/ is RIGHT side)
- /wrap hook reads transcript_path from stdin, writes to memory-proposals.md via vaultWrite
- /promote-memories reads memory-proposals.md, appends to memory.md via vaultWrite
- Config hot-reload fix replaces vault-gateway.js:watchConfig() mechanism

</code_context>

<in_scope>
## In-Scope Deliverables

### New Commands
- `/new` — argument + interactive modes; hierarchical classifier; template extraction; wikilink suggestions; dead-letter on failure
- `/extract-memories` — on-demand extraction with --file, --dir, --since, --daily-range
- `/promote-memories` — reads marked state from memory-proposals.md, promotes accepted to memory.md, archives processed
- `/reroute` — re-invokes classifier on dead-letter or left-proposal files
- `/promote-unrouted` — manual promotion of dead-letter files with explicit target-path

### Modified Commands
- `/wrap` — add session-transcript memory-extraction step as Stop hook
- `/today` — add "Memory proposals pending: N" and "Unrouted dead-letter: N pending, M frozen" briefing sections

### New Config Files
- `config/pipeline.json` — all Phase 2 thresholds
- `config/templates.json` — per-domain template field definitions AND memory-category definitions (inclusion shape, example, exclusion rules, owned by the `memory-categories` key per D-23)
- `config/schema/*.schema.json` — JSON schemas for all config files, including `memory-categories.schema.json` per D-23

### Modified Config Files
- `config/excluded-terms.json` — expanded 3 → 15-20 entries (Pete-owned list)

### New Vault Directories
- `proposals/unrouted/` — dead-letter files
- `proposals/left-proposals/` — LEFT routing proposals
- `proposals/left-proposals/archive/` — auto-archived old proposals
- `memory-proposals-archive/` — archived processed proposals by month
- `memory-archive/` — yearly archive of old memory.md entries

### Infrastructure
- chokidar-based config hot-reload (fixes Phase 1 defect)
- Correlation ID generation + propagation
- Dead-letter auto-retry mechanism
- `.cache/vault-index.json` — cached note index
- Instrumentation logs: `.cache/memory-extraction.log`, `.cache/memory-promotion.log`, `.cache/classifier.log`

### Test Coverage
- All config files have schema validation tests
- Hot-reload integration test
- Classifier unit tests with mocked Haiku
- Sonnet escalation integration test
- Dead-letter tests for each failure mode
- Excluded-terms false-positive audit (50-100 recent notes)
- Phase 1 suite (96 tests) continues to pass
- Target: 60+ new tests, 150+ total at phase exit

</in_scope>

<specifics>
## Specific Ideas

- Vault navigation stays flat — no nested LEFT/RIGHT parent folders (carried from Phase 1)
- proposals/ serves triple duty: memory proposals, left-proposals, and unrouted dead-letter
- Excluded-terms expansion is Pete-owned research — agent formats list + generates test variants but does not fabricate entries
- Confidence thresholds (0.8/0.7/0.75/0.6) are starting points to calibrate after 100+ invocations — hot-reload fix enables live calibration
- Correlation IDs are the missing debuggability piece — without them, sequential pipeline stages produce scattered logs
- memory.md Dataview queries are a primary consumption surface — inline fields (field:: value) instead of YAML frontmatter because multiple entries per file

</specifics>

<deferred>
## Deferred Ideas

### v1.1 Backlog
- Email/calendar extraction triggers (requires Phase 3 MCP connectors)
- GitHub commit/PR memory extraction (requires Phase 3 MCP connectors)
- Memory expiry / `supersedes::` field for superseded entries
- `/promote-left` auto-mover (reads accepted proposals, copies to LEFT path)
- Per-domain wikilink boosting (weight same-domain links higher)
- Continuous extraction (rejected — batch is sufficient)
- Rate limiting / cost caps for LLM calls
- Vault-side `.config/` for user-facing knobs (VIP list, tags mapping)
- Cost/usage telemetry rollup and alerting dashboard
- Config schema migration tooling for future schema changes

### Plan-Level (resolved during planning, not interview)
- Daily note append vs create mechanic details
- `/promote-memories` confirmation UX when marked count exceeds batch cap
- Concurrency / file locking when /new and /wrap overlap
- Test data strategy (golden transcripts, mocked LLM responses)
- `.cache/` directory location and gitignore policy
- Logging schema for instrumentation logs
- Interactive confidence-gated prompt UX copy

### Reviewed Todos (not folded)
None — no matching todos found for Phase 2.

</deferred>

---

*Phase: 02-content-pipeline*
*Context gathered: 2026-04-22*

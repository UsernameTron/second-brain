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
| INPUT-01 | `/new` captures any input with domain classification | D-01, D-02, D-03, D-04, D-06, D-40, D-59 |
| INPUT-02 | Left/right routing with voice-authenticity gate | D-02 (Stage 1), D-12, D-13, D-14, D-15, D-16, D-59 |†
| INPUT-03 | `/new` integrates ingress filtering — excluded content never reaches disk | D-40, D-41, D-43, D-49 |
| INPUT-04 | Wikilink suggestions on routed notes | D-17, D-18, D-19, D-20 |
| MEM-01 | Memory extraction from sessions and vault content | D-21, D-22, D-23, D-24, D-25, D-26, D-27, D-44, D-45, D-46, D-55, D-56, D-64, D-65, D-66 |
| MEM-02 | Human-reviewed proposal/promotion workflow | D-28, D-29, D-30, D-31, D-33, D-34, D-55, D-56, D-57, D-58 |
| MEM-03 | Batch-capped promotion with dedup and archiving | D-32, D-33, D-34 |

† **INPUT-02 footnote:** LEFT routing enforcement IS the proposal queue per project design. PROJECT.md defines the write-permission boundary: "any file whose words should sound like ME lives on the LEFT" and agents never write to LEFT directly. D-12's routing to proposals/left-proposals/ satisfies INPUT-02's "route to LEFT" requirement through the proposal-queue mechanism — the proposal IS the route, with human review as the final gate before LEFT-side placement.

</traceability>

<decisions>
## Implementation Decisions

### Input Classification (D-01 through D-06, D-59)

- **D-01:** `/new` supports both invocation modes: argument-based (`/new 'text'`) for quick capture, interactive prompt when no args given.
- **D-02:** Domains map 1:1 to vault directories. Classifier is hierarchical, two-stage — NOT a flat 13-label model.
  - **Stage 1 — Voice gate:** Binary LEFT vs RIGHT classification based on voice-authenticity rule ("any file whose words should sound like ME lives on the LEFT"). Output: LEFT or RIGHT + confidence score.
  - **Stage 2 — Subdirectory pick:** Within the chosen side, pick the target directory. LEFT labels: ABOUT ME/, Daily/, Relationships/, Drafts/. RIGHT labels: memory/, briefings/, ctg/, job-hunt/, interview-prep/, content/, research/, ideas/. memory/ contains memory.md at `memory/memory.md` and `memory-archive/YYYY.md` files. proposals/ is a subsystem-owned destination (left-proposals, memory-proposals, unrouted). Classifier never routes to it directly. Output: full directory path + confidence score. **When Stage 1 = LEFT, the Stage 2 directory path is advisory only** (stored as `suggested-left-path` in the proposal file per D-13). The actual write target is always `proposals/left-proposals/` per D-12 — the classifier's LEFT subdirectory pick informs the human reviewer, it does not determine the write destination.
- **D-59:** Stage 1 voice-authenticity classification criteria. The voice gate answers: "Would this text sound natural if Pete said it aloud or wrote it himself?" Operational rules:
  - LEFT signals: first-person voice, personal opinions/reflections, relationship context, emotional content, identity statements, career narratives, communication style preferences. Examples: journal entries, personal notes, relationship notes, self-authored drafts.
  - RIGHT signals: structured data, agent-generated content, research summaries, extracted/synthesized information, technical reference, briefing output, template-driven content. Examples: meeting notes (structured), job postings (external data), memory entries, briefing sections.
  - Mixed content: if the input contains both personal voice and structured data, classify by dominant voice. If roughly equal, classify LEFT (human voice takes precedence — false-LEFT is recoverable via /reroute, false-RIGHT risks agent-written content on the LEFT side).
  - Ambiguity: short inputs (< 50 chars) with no clear voice signal default to RIGHT with reduced confidence (triggers D-03 fallback).
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

- **D-07:** Base format for every routed note: YAML frontmatter (created, source, domain, routed-by with stage-1/stage-2 provenance, filename-basis, tags) + raw input body preserved verbatim. **Note:** memory.md entries use inline Dataview fields (`field:: value`) instead of YAML frontmatter because multiple entries share one file — see D-29. These are intentionally different metadata strategies; do not assume consistency across note types.
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
- **D-32:** Batch cap: enforced hard ceiling of 10 per `/promote-memories` invocation (MEM-03 compliant). `--max N` overrides downward only; valid range 5-10. No `--all` bypass — the cap is a design constraint to keep review manageable, not a default. Promote by confidence-descending; excess marked candidates defer to next run with status: deferred.
- **D-33:** Dedup on promotion: content-hash check against memory.md + memory-archive/*.md. Match → skip, mark as duplicate-of-existing-memory.
- **D-34:** Growth management: archive oldest complete year to `memory-archive/YYYY.md` when memory.md exceeds 200KB or 500 entries. Retain current + previous year minimum. Dataview queries include archive.

### Error Handling (D-35 through D-39, D-67)

- **D-35:** Global fallback: dead-letter + notify. Input preservation is non-negotiable for content that passes Stage 0. Never lose captures that clear the exclusion gate. Dead-letter location: `proposals/unrouted/`. **Exclusion:** Stage 0 BLOCK results (D-41) are intentional rejections, not lost captures — they do not dead-letter. The "never lose captures" guarantee applies to Stages 1-5 only.
- **D-36:** Failure-mode taxonomy (7 modes, each maps to specific dead-letter behavior):
  - `api-error` — LLM API call failed (network, rate-limit, 5xx). Auto-retryable per D-37.
  - `timeout` — LLM call exceeded deadline. Auto-retryable per D-37.
  - `parse-error` — LLM returned non-parseable output (invalid JSON, missing fields). Not auto-retryable.
  - `confidence-floor` — Both Haiku and Sonnet (if escalated) returned below threshold. Not auto-retryable.
  - `gate-rejection` — Stage 0 content-policy rejection where fail-open is disallowed but dead-letter is appropriate (distinct from BLOCK, which exits without dead-letter per D-41).
  - `non-interactive-ambiguous` — Confidence below interactive-prompt threshold (D-03) in a non-interactive context (Stop hook, scheduled task, headless CLI). Not auto-retryable; user reviews via `/reroute` on next interactive session.
  - `exclusion-unavailable` — Stage 0 internal failure (content-policy.js crashed or unreachable). Fail-closed: dead-letter rather than skip exclusion gate. Auto-retryable per D-37.
- **D-37:** Auto-retry: api-error, timeout, and exclusion-unavailable → retry after 15min, increment on failure, cap at 3 attempts, then freeze for manual handling (status: frozen). parse-error, confidence-floor, gate-rejection, non-interactive-ambiguous → never auto-retry.
- **D-38:** Notification: /new returns immediately with dead-letter path + failure mode. /today surfaces unrouted count. Count > 10 = top-line warning.
- **D-39:** Enrichment failures (wikilink, template extraction) never block the primary write path. Write note with base format, omit enrichment sections.
- **D-67:** /today briefing sections for Phase 2 state. Two new sections appended to /today output:
  - **Memory proposals pending:** count of candidates with `status:: pending` in proposals/memory-proposals.md. Format: "Memory proposals pending: N awaiting review" (or omit section if 0).
  - **Unrouted dead-letter:** count of files in proposals/unrouted/ grouped by status. Format: "Unrouted: N pending, M frozen (3+ retry failures)". Count > 10 total = top-line warning: "⚠ N unrouted captures need attention". Count source: filesystem directory listing of proposals/unrouted/, status parsed from each file's frontmatter.

### Pipeline Composition (D-40 through D-43, D-68)

- **D-40:** Sequential pipeline: Stage 0 (exclusion gate, content-policy.js, Phase 1) → Stage 1 (voice gate) → Stage 2 (subdir pick) → Stage 3 (template extraction, conditional) → Stage 4 (wikilink generation) → Stage 5 (vault-gateway write).
- **D-41:** Stage 0 is a hard gate. On BLOCK, /new exits immediately — no dead-letter, no classification. On Stage 0 internal failure, fail-closed: dead-letter with failure-mode: exclusion-unavailable. Never fail-open on the trust boundary.
- **D-42:** Shared infrastructure across stages: single Haiku client wrapper, structured-output JSON parser, logger with correlation IDs (UUID per /new invocation), dead-letter writer.
- **D-43:** Phase boundary: content-policy.js, style-policy.js, vault-gateway.js, and utils.js are Phase 1 code, consumed via existing exports. Phase 2 does not modify their internals. Adding correlation IDs to their logs is an explicit Phase 2 task if needed. **Carve-out:** config files (vault-paths.json, excluded-terms.json) are parameters, not internals — they ARE in Phase 2 scope. Phase 2 adds entries to these files per D-68 and D-49.
- **D-68:** vault-paths.json additions for Phase 2. The following 5 directories are added to the RIGHT-side allowlist in vault-paths.json during Phase 2 bootstrap (first task):
  - `proposals/unrouted/` — dead-letter files (D-35)
  - `proposals/left-proposals/` — LEFT routing proposals (D-12)
  - `proposals/left-proposals/archive/` — auto-archived old proposals (D-16)
  - `memory-proposals-archive/` — archived processed proposals by month (D-57)
  - `memory-archive/` — yearly archive of old memory.md entries (D-34)
  Directories are created on first use (vault-gateway.js mkdir-on-write pattern), not at install time. proposals/unrouted/promoted/ and proposals/unrouted/rerouted/ (D-53, D-62) are subdirectories of proposals/unrouted/ and inherit its allowlist entry.

### /reroute Contract (D-60 through D-63)

- **D-60:** `/reroute <file>` re-invokes the full classification pipeline (Stages 1-5) on an existing dead-letter or left-proposal file. Stage 0 (exclusion gate) re-runs — if content now triggers BLOCK, the file is rejected (not rerouted) and the user is notified.
- **D-61:** Reprocessing stages: (1) read original input body from file (strip frontmatter/metadata), (2) run Stage 0, (3) run Stage 1 + Stage 2 classification, (4) apply template extraction if applicable, (5) generate wikilinks, (6) write to new destination via vault-gateway. On failure at any stage, leave original file in place unchanged and report the failure mode.
- **D-62:** File movement on success: original file is moved to `proposals/<origin>/rerouted/` with reroute metadata appended (rerouted-at, rerouted-from, rerouted-to). If the new classification is LEFT, the result goes to proposals/left-proposals/ per D-12 (never directly to LEFT). If RIGHT, the note is written to the classified RIGHT directory.
- **D-63:** Status transitions: dead-letter `status: unrouted` → `status: rerouted` (on success) or `status: reroute-failed` (on failure). Left-proposal `status: pending` → `status: rerouted` (on success). Rerouting a left-proposal to a different LEFT path updates suggested-left-path in the new proposal.

### /promote-unrouted Contract (D-51 through D-54)

- **D-51:** `/promote-unrouted <file> --target <path>` manually promotes a dead-letter file to a specified vault path. Required arguments: file (dead-letter filename in proposals/unrouted/) and --target (destination directory from vault-paths.json). No implicit classification — the user has already decided where this belongs.
- **D-52:** Validation pipeline: (1) verify file exists in proposals/unrouted/, (2) verify --target is a valid RIGHT-side path in vault-paths.json OR a valid LEFT label (in which case route to proposals/left-proposals/ with suggested-left-path set to --target per D-12), (3) re-run Stage 0 exclusion gate (content-policy.js) — if BLOCK, refuse promotion and report reason, (4) apply template extraction (D-08/D-09) if --target matches a templated domain, (5) generate wikilinks (D-17-D-19), (6) write via vault-gateway.
- **D-53:** On successful promotion: move original dead-letter file to proposals/unrouted/promoted/ with promotion metadata appended to frontmatter (promoted-at, promoted-to, promoted-by: manual). On failed promotion: leave file in place, report error.
- **D-54:** LEFT target handling: if --target resolves to a LEFT directory, promotion creates a left-proposal in proposals/left-proposals/ (never writes to LEFT directly). The proposal's suggested-left-path is set to --target. This preserves the write-permission boundary.

### Session Transcript (D-44 through D-46, D-64 through D-66)

- **D-44:** /wrap reads session transcript via transcript_path from hook stdin (JSONL format). Streams line-by-line, does not load full file.
- **D-64:** /wrap hook stdin schema (received as JSON via stdin from Claude Code Stop hook):
  ```json
  {
    "session_id": "string (Claude Code session UUID)",
    "transcript_path": "string (absolute path to .jsonl transcript file)",
    "cwd": "string (working directory)",
    "hook_event_name": "Stop"
  }
  ```
  Missing or unreadable transcript_path: log warning, skip memory extraction, continue with remaining /wrap steps (session logging, STATE.md update). Memory extraction failure never blocks /wrap completion.
- **D-65:** Source-ref formation for session-extracted candidates: `session:<session_id>` (from hook stdin). For /extract-memories file-based extraction: `file:<relative-vault-path>`. For daily sweep: `daily:<YYYY-MM-DD>`. These populate the `source_file` field in memory-proposals.md (D-56).
- **D-66:** Dedup across /wrap and daily sweep: before writing any candidate to memory-proposals.md, check content_hash against (a) all pending/deferred candidates in memory-proposals.md, (b) all entries in memory.md, (c) all entries in memory-archive/*.md. Match on content_hash → skip silently. This prevents the daily sweep from duplicating candidates already extracted by /wrap for the same day.
- **D-45:** Extraction corpus: user messages, assistant text content, tool outputs that represent decisions or outcomes (git diff summaries, merged PR titles, created/modified file paths). Excludes: system-reminder messages, messages < 20 characters, raw Read/Glob/Grep/Bash-ls output (high volume, low signal). "Semantically weighted" means: git diff and PR content weighted 2x in the extraction prompt as high-signal sources.
- **D-46:** Oversized transcripts (> 5MB or > 2000 messages): chunked extraction in 100-message windows with 10-message overlap at boundaries to preserve context. Deduplicate candidates across chunks by content_hash before writing to memory-proposals.md.

### memory-proposals.md Schema (D-55 through D-58)

- **D-55:** Location: `proposals/memory-proposals.md` (RIGHT side, single active file). File-level structure: YAML frontmatter (last_updated, total_pending, total_processed) followed by per-candidate sections in reverse-chronological order (newest first).
- **D-56:** Per-candidate section format:
  ```
  ### <candidate-id> · <CATEGORY> · <source-ref-short>
  - [ ] accept
  - [ ] reject
  - [ ] edit-then-accept
  - [ ] defer

  **Content:** <one-paragraph proposed memory entry>
  **Proposed tags:** <comma-separated>
  **Proposed related:** <wikilinks>

  session_id:: <claude-session-id from hook stdin or "manual" for /extract-memories>
  captured_at:: <ISO-8601 timestamp of extraction>
  source_file:: <vault path or transcript path that produced this candidate>
  category:: <one of 7 categories from D-22>
  confidence:: <0.00-1.00>
  content_hash:: <SHA-256 hex, first 12 chars>
  status:: pending | accepted | rejected | duplicate | deferred
  extraction_trigger:: wrap | extract-memories | daily-sweep
  ```
  Candidate-id format: `mem-YYYYMMDD-NNN` (date of extraction + sequence number within that day).
- **D-57:** Rotation: when memory-proposals.md exceeds 100 candidates (regardless of status), archive all non-pending candidates to `memory-proposals-archive/YYYY-MM.md` grouped by month. Pending candidates remain in the active file. Archive runs at the start of `/promote-memories` before promotion logic.
- **D-58:** Concurrency model for /wrap + /extract-memories concurrent writes: file-level advisory lock via `<proposals/memory-proposals.md>.lock` lockfile. Lock acquisition with 5-second timeout. On lock timeout: buffer candidates to `proposals/memory-proposals-pending.jsonl` (append-only). Next writer that acquires the lock flushes the pending buffer first. This prevents data loss without requiring complex file-merge logic.

### Config and Carryovers (D-47 through D-50, D-68)

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
- `/reroute` — re-invokes classifier on dead-letter or left-proposal files (D-60 through D-63)
- `/promote-unrouted` — manual promotion of dead-letter files with explicit target-path (D-51 through D-54)

### Modified Commands
- `/wrap` — add session-transcript memory-extraction step as Stop hook (D-64 through D-66)
- `/today` — add "Memory proposals pending: N" and "Unrouted dead-letter: N pending, M frozen" briefing sections (D-67)

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

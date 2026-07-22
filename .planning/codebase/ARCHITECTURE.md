# Architecture

**Analysis Date:** 2026-07-21

## Pattern Overview

**Overall:** Config-driven pipeline architecture over a single markdown vault substrate. There is no server process — plain Node.js CJS modules in `src/` are invoked by Claude Code slash commands (`.claude/commands/*.md`), standalone CLI scripts (`scripts/*.js`), and macOS `launchd` schedules. Every workflow is a sequential pipeline with explicit fail-open/fail-closed gates rather than a request/response service.

**Key characteristics:**
- **Single write-enforcement choke point.** All vault mutations route through `src/vault-gateway.js`'s three sequential guards (path allowlist → content policy → style lint). No module writes to the vault directly.
- **Never-throw LLM client contract.** `src/pipeline-infra.js`'s `createLlmClient()` wraps every Anthropic/local-LLM call so failures surface as `{success:false, failureMode}` data, never exceptions — callers branch on the result instead of catching.
- **Adaptive-denial health tracking (Pattern 7).** `src/utils/voyage-health.js` and `src/utils/classifier-health.js` persist consecutive-failure counts to `~/.cache/second-brain/*.json` so independent CLI invocations (interactive session, nightly sweep, monthly dream) coordinate on a known-bad endpoint instead of each burning a full timeout.
- **Non-fatal side channels.** Embedding (`indexNewEntries`), reach export, SQLite rebuild, contradiction-flagging, and stats recording all wrap their own try/catch around the primary write — a side-channel failure is logged and surfaced in the return envelope, never thrown back at the caller.
- **Human-in-the-loop gates via checkbox parsing.** Both the memory-promotion pipeline and dream-consolidation pipeline stage proposals as markdown files with `- [ ] accept/reject/...` checkboxes, parsed by one shared `parseCheckboxState()` (`src/memory-proposals.js`) — no second parser exists for the dream changeset.
- **Snapshot-before-mutate.** The one workflow that edits *existing* memory entries (`dream --apply`) snapshots `memory.md` + `embeddings.jsonl` + `index.db` first and auto-restores on a post-apply retrieval regression.

## Layers

**Vault substrate (write-permission boundary):**
- Location: `src/vault-gateway.js`
- Purpose: enforces the LEFT (human voice, read-only to agents) vs RIGHT (agent-writable) split declared in `config/vault-paths.json`. Guard 1 path allowlist + canonical-path/symlink/traversal defense; Guard 2 content-policy scan (`src/content-policy.js`); Guard 3 style lint (`src/style-policy.js`). Also owns config hot-reload and the redacted quarantine path.
- Used by: every writer — `memory-extractor.js`, `promote-memories.js` (via `daily-stats.js`'s `vaultWriteAtomic`), `new-command.js`, `pipeline-infra.js`'s `writeDeadLetter`.

**Config layer:**
- Location: `src/pipeline-infra.js` (`loadConfigWithOverlay`) + `config/*.json` + `config/schema/*.json`
- Purpose: every config file loads with an optional gitignored `<name>.local.json` deep-merge overlay, then optional AJV schema validation. Orphan-overlay detection warns once per process if a `.local.json` exists but no loader references its base name.

**Classification pipeline (`/new`):**
- Location: `src/classifier.js` + `src/new-command.js`
- Purpose: Stage 0 exclusion gate → Stage 1 binary LEFT/RIGHT voice gate (Haiku only) → Stage 2 subdirectory pick (Haiku, Sonnet escalation below `sonnetEscalationThreshold`). `new-command.js` then owns template extraction, note formatting, the vault write, and non-blocking wikilink enrichment.

**Memory pipeline (compounding layer):**
- Location: `src/memory-extractor.js` → `src/memory-proposals.js` → `src/promote-memories.js`
- Purpose: extraction (session transcript or vault file → Haiku candidates) → staging with lock + hash-dedup → human-reviewed promotion into `memory/memory.md`, with category coercion, related-link population, contradiction flagging, and archive rollover.

**Semantic + keyword retrieval:**
- Location: `src/semantic-index.js`, `src/memory-reader.js`
- Purpose: `memory-reader.js` parses `memory.md` and runs `minisearch` keyword search; `semantic-index.js` embeds via Voyage AI, cosine-scores with recency decay, and fuses both via Reciprocal Rank Fusion (`hybridSearch`). Both apply the same `DOWNRANK_FACTOR` to superseded/stale entries so lifecycle state affects ranking without deleting anything.

**Reach layer (cross-surface export):**
- Location: `src/reach-exporter.js`
- Purpose: after every real promotion, regenerates a pointer + capped digest file (`second-brain.md`) and an index line in every Claude Code auto-memory directory listed in `config/reach-targets.json`. Re-applies the exclusion gate at egress, fail-closed (ADR-018/ADR-019).

**`/today` orchestrator:**
- Location: `src/today-command.js` + `src/today/*.js`
- Purpose: thin shell (post Phase-15 refactor) that fans out to connectors and pipeline state in parallel, then composes four extracted stages: `slippage-scanner.js`, `frog-identifier.js`, `llm-augmentation.js`, `briefing-renderer.js`, plus `memory-health.js`, `compounding-trend.js`, and `sweep-status.js`.

**Dream consolidation (monthly maintenance):**
- Location: `src/dream.js` + `scripts/dream.js`
- Purpose: MERGE-pair detection (cosine + shortRef prefix), Sonnet-authored merges with a mechanical anti-hallucination quote guard, STALE flagging (dead-reference / age / contradiction), and cross-session MISSED-PATTERNS extraction — all proposal-only. A separate `--apply` path snapshots, applies accepted ops, and gates on live-vault retrievability.

**Health/degradation trackers:**
- Location: `src/utils/voyage-health.js`, `src/utils/classifier-health.js`
- Purpose: cross-invocation, fs-only (no live endpoint) failure counters; 3 consecutive failures open a degraded-mode window so callers skip a known-bad path instead of timing out again.

**Index layer:**
- Location: `scripts/build-index.js`
- Purpose: pure derivation — rebuilds a `node:sqlite` DB (`entries` + FTS5 + `proposals` + `unrouted` tables) from `memory.md`/proposals/dead-letters on every run. Never a source of truth; drift-checked against `embeddings.jsonl` line count.

## Data Flow

**Memory compounding pipeline (extraction → promotion → retrieval → reach):**

```
session transcript / vault file
        │
        ▼
memory-extractor.js  ──Haiku classify──▶ candidates (category, confidence, rationale)
        │  confidence >= 0.5, content-policy PASS, hash-dedup
        ▼
memory-proposals.js  (writeCandidate, lock+dedup)
        │
        ▼
proposals/memory-proposals.md   (mem-YYYYMMDD-NNN sections, checkbox: accept/reject/edit/defer)
        │  human reviews checkboxes
        ▼
promote-memories.js  (promoteMemories)
        │  ├─ category coercion, related-link population (Voyage cosine + wikilink-engine)
        │  ├─ contradiction-check.js (flag-only, never blocks)
        │  └─ archive rollover (proposals + memory tail)
        ▼
memory/memory.md  (canonical store, append-only, auto-regenerated index block)
        │
        ├──▶ semantic-index.js  indexNewEntries()  ──▶ ~/.cache/second-brain/embeddings.jsonl
        ├──▶ build-index.js  buildIndex()          ──▶ ~/.cache/second-brain/index.db (SQLite, derived)
        └──▶ reach-exporter.js  runReachExport()    ──▶ second-brain.md + MEMORY.md line
                                                          in every config/reach-targets.json dir
```

Retrieval (`/recall`, `session-memory-inject.js`) reads `memory.md` + `embeddings.jsonl` via `memory-reader.js` (keyword) and `semantic-index.js` (semantic/hybrid) — never re-derives from the SQLite index, which exists for ad-hoc querying only.

**`/new` classification (input → routed vault file or dead-letter):**

```
raw input ──▶ Stage 0 exclusion gate (content-policy) ──BLOCK──▶ reject, no dead-letter
        │ PASS
        ▼
Stage 1 voice gate (Haiku, binary LEFT/RIGHT)
        │ confidence < threshold + non-interactive ──▶ dead-letter (proposals/unrouted/)
        ▼
Stage 2 subdirectory pick (Haiku → Sonnet escalation below threshold)
        │ both below accept threshold ──▶ needsInteractive (top-2 candidates)
        ▼
note-formatter.js (template fields, filename) ──▶ vault-gateway.vaultWrite()
        │ LEFT  → proposals/left-proposals/<file>
        │ RIGHT → <directory>/<file>
        ▼
wikilink-engine.js (non-blocking enrichment)
```

**`/today` briefing (parallel fan-out → single markdown):**

```
Promise.allSettled: [calendar, gmail, github connectors]  +  [proposals count, dead-letter summary]
        │
        ├─ slippage-scanner.js  (scan ~/projects/*/.planning/STATE.md)
        ├─ frog-identifier.js   (Haiku over slippage candidates, heuristic fallback)
        ├─ memory-reader.js     getMemoryEcho()  (calendar/email topics → relevant memory entries)
        ├─ today/memory-health.js, today/compounding-trend.js, today/sweep-status.js  (pure, from daily-stats rows)
        ├─ llm-augmentation.js  (Haiku synthesis paragraph, or static checklist if all sources degraded)
        ▼
briefing-renderer.js  renderBriefing()  ──▶ RIGHT/daily/<date>.md  +  stdout echo (interactive mode)
        │
        ▼
daily-stats.js  recordDailyStats()  (non-fatal; feeds tomorrow's compounding-trend read)
```

**Dream consolidation (`--propose` / `--apply`, monthly, human gate between):**

```
--propose:  detectMergePairs (cosine) → authorMerge (Sonnet + quote-guard) ─┐
            detectStale (dead-ref → age → contradiction, budget-capped)    ├─▶ writeChangeset()
            detectPatterns (Sonnet over session-log/decisions, cosine dedup)┘      │
                                                                                     ▼
                                                        proposals/dream-changeset-YYYY-MM.md
                                                                     │ human checks accept/reject/defer
                                                                     ▼
--apply:  snapshotStore() → acquireProposalsLock() → applyOps() (MERGE inserts + supersedes sources,
          STALE appends flag) → build-index.js + reach-exporter (non-fatal) →
          runEvalGate() [live hybridSearch retrievability check]
                     │ pass ──▶ stamp applied:: <ISO>, update state/dream-ledger.json
                     │ fail ──▶ restoreSnapshot() + revert accept boxes to unresolved
```

## Key Abstractions

**Three-gate write enforcement (`VaultWriteError`):**
- Purpose: single choke point for every vault mutation; codes `INVALID_PATH` / `PATH_BLOCKED` / `STYLE_VIOLATION` / `CONTENT_BLOCKED` distinguish security rejection from policy rejection.
- Examples: `src/vault-gateway.js:421` (`vaultWrite`), `src/vault-gateway.js:522` (`vaultWriteAtomic`, used by `daily-stats.js`)

**Never-throw LLM result envelope:**
- Purpose: every classify call returns `{success, data, error, failureMode}`; failureMode is a closed taxonomy (`api-error`, `timeout`, `parse-error`, `config-error`, `exclusion-unavailable`, `non-interactive-ambiguous`, `haiku-cap`) that downstream code branches on instead of catching exceptions.
- Examples: `src/pipeline-infra.js:138` (`createLlmClient`)

**Content hash as canonical entry ID:**
- Purpose: 12-char sha256 slice of normalized content is the dedup key across proposals/memory.md/archives AND the Obsidian block-ref anchor (`^<hash>`) for related-link wikilinks — headings collide across entries, hashes never do.
- Examples: `src/utils/memory-utils.js` (`computeHash`), used throughout `memory-proposals.js`, `promote-memories.js`, `memory-reader.js`

**Checkbox-driven human review (shared parser):**
- Purpose: `parseCheckboxState()` is the ONE parser for both the memory-promotion gate and the dream-changeset gate (explicit operator hard constraint, Phase 34) — no drift between the two review UIs.
- Examples: `src/memory-proposals.js:64`, consumed by `src/promote-memories.js:124` and `src/dream.js:531`

**Adaptive Denial Tracking (Pattern 7):**
- Purpose: fs-only cross-invocation health state; 3 consecutive failures open a timed degraded window so a wedged local model or rate-limited API is skipped instead of retried per-call.
- Examples: `src/utils/voyage-health.js`, `src/utils/classifier-health.js`

**Reciprocal Rank Fusion:**
- Purpose: combines keyword-search rank and semantic-search rank via `1/(k+rank)` summation rather than blending raw scores from two different distributions.
- Examples: `src/semantic-index.js:537` (`hybridSearch`)

**Fail-closed exclusion gate re-applied at every boundary:**
- Purpose: content that already passed ingress policy is re-checked at every subsequent egress point, because the extraction→staging path bypasses the ingress gate.
- Examples: `classifier.js` Stage 0, `semantic-index.js` `semanticSearch` (pre-Voyage-call), `reach-exporter.js` (pre-render), `session-memory-inject.js` (pre-injection)

## Entry Points

**Claude Code slash commands** (`.claude/commands/*.md`): `today.md`, `new.md`, `wrap.md`, `recall.md`, `reroute.md`, `promote-memories.md`, `promote-unrouted.md` — each a thin markdown wrapper invoking the matching `src/*-command.js` or `scripts/*.js`.

**Standalone CLI scripts** (`scripts/*.js`): `wrap.js`, `daily-sweep.js`, `dream.js`, `eval-recall.js`, `compounding-report.js`, `recall.js`, `build-index.js`, `migrate-memory-wiki.js`, `verify-baseline.js`, `validate-archive.js`. Each loads `dotenv` itself under `require.main === module` — library code in `src/` never does (`HOOK-DOTENV-01` convention), so tests can require these modules with a controlled env.

**Claude Code hooks** (`.claude/hooks/`): `session-memory-inject.js` (SessionStart — proactive memory digest, budget-timed race against a timeout, exclusion-gated); `memory-extraction-hook.js` (Stop — triggers extraction); `auto-test.sh`, `protected-file-guard.sh`, `security-scan-gate.sh`, `staleness-check.js`.

**Scheduled jobs** (macOS `launchd`): `config/com.secondbrain.daily-sweep.plist` → `scripts/daily-sweep.js` (23:45 daily); `config/com.secondbrain.dream.plist` → `scripts/dream.js --propose` (monthly, propose-only — `--apply` is explicitly never scheduled, human-invoked only).

**Repo git hooks** (`hooks/`, `core.hooksPath`-managed): `pre-commit` (schema validation + vault-boundary check), `pre-push` (staleness + docs-sync gate), `post-merge` (non-blocking docs-drift warning).

## Error Handling

**Strategy:** fail-closed for security/policy gates, fail-open (non-fatal) for enrichment side effects. A gate that cannot verify safety denies by default; a side channel that fails degrades the feature but never blocks the primary write.

**Patterns:**
- **Dead-letter preservation** (`src/pipeline-infra.js:433` `writeDeadLetter`): any Stage 0-2 classification failure preserves the original input verbatim in `proposals/unrouted/` with a 7-mode failure taxonomy in frontmatter, rather than silently dropping content.
- **Isolated non-fatal side channels:** embedding (`indexNewEntries`), reach export (`runReachExport`), SQLite rebuild (`buildIndex`), contradiction flagging (`checkContradiction`), and stats recording each wrap their own try/catch inside `promote-memories.js` — one failing does not roll back the memory.md append that already happened.
- **Snapshot-first mutation with auto-restore:** `dream --apply` is the only workflow that edits existing entries; `runEvalGate()` reverts via `restoreSnapshot()` and un-checks the accept boxes on any post-apply retrieval regression.
- **Fail-open status lines:** `today/sweep-status.js`'s `computeSweepLine()` never throws — a missing/corrupt proof-of-fire file renders `sweep NEVER RAN` rather than crashing the briefing.

## Cross-Cutting Concerns

**Logging:** structured JSON to stderr only, via `logDecision()` (`vault-gateway.js`), `logInstrumentation()` (`classifier.js`), and `logReach()` (`reach-exporter.js`). Entries carry `action`/`path`/`decision`/`reason` metadata — never a content payload. `console.log` is ESLint-banned in production code; the one exception is `today-command.js`'s interactive-mode briefing echo (explicitly annotated).

**Validation:** every config load can request AJV schema validation (`loadConfigWithOverlay(name, {validate: true})`) against `config/schema/<name>.schema.json`; `pipeline.json` and `templates.json` additionally assert required top-level sections beyond schema shape.

**Authorization boundary:** no multi-user auth — the equivalent boundary is `vault-gateway.js`'s LEFT/RIGHT write allowlist (`config/vault-paths.json`), enforced identically regardless of caller.

**Content policy:** `src/content-policy.js` (keyword scan + Haiku classification, `config/excluded-terms.json`) is re-invoked at every boundary content crosses — ingress (classifier Stage 0, memory-extractor), promotion-time related-link titles, and egress (reach-exporter digest entries, session-memory-inject bullets, semantic search queries) — rather than trusted once at ingress.

---

*Architecture analysis: 2026-07-21*

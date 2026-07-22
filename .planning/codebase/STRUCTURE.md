# Codebase Structure

**Analysis Date:** 2026-07-21

## Directory Layout

```
second-brain/
├── src/                    # Pipeline library modules (CJS, single-responsibility)
│   ├── today/              # /today orchestrator's extracted stages (Phase 15 refactor)
│   ├── connectors/          # External API connectors + shared result-shape contract
│   └── utils/               # Cross-cutting utilities (health trackers, hashing, schema validation)
├── scripts/                # Standalone CLI entry points (each loads dotenv itself)
├── test/                   # Jest suite, mirrors src/ layout plus integration/uat/fixtures
├── config/                 # JSON config, optionally overlaid by gitignored *.local.json
│   └── schema/              # AJV JSON Schema definitions, one per config file
├── hooks/                  # Repo-managed git hooks (core.hooksPath) + their JS implementations
├── .claude/
│   ├── hooks/                # Claude Code lifecycle hooks (SessionStart, Stop, gates)
│   ├── agents/               # Claude Code subagent definitions
│   ├── skills/               # Claude Code skill definitions (dream-apply, dream-propose, ...)
│   ├── commands/             # Slash command markdown wrappers (/today, /new, /wrap, ...)
│   └── worktrees/            # Executor worktrees (gitignored, ephemeral)
├── eval/                   # Frozen retrieval eval fixtures (seed vault, golden set, baselines)
├── decisions/               # Architecture Decision Records (ADR-018, ADR-019, ADR-020)
├── docs/                    # Supplementary docs (devops handoff, local-llm backlog)
├── state/                   # Mutable runtime state (session log, decisions log, dream ledger)
├── tasks/                   # Operator lessons.md, todo.md, triage notes
├── engineering-status/     # Generated STATUS.md source data + narrative prompt
├── .planning/               # GSD execution state (phases, milestones, quick tasks, research)
│   └── codebase/             # Codebase mapping documents (this file lives here)
├── .github/workflows/      # CI pipeline definitions
└── coverage/                # Generated Jest coverage report (gitignored)
```

## Directory Purposes

**`src/`:**
- Purpose: all production pipeline logic. Plain CJS (`'use strict'` + `module.exports`), no build step, no framework.
- Contains: one module per pipeline concern — vault gateway, classifier, memory extractor/proposals/promoter, semantic index, reach exporter, dream consolidation, daily stats, wikilink engine, note formatter, content/style policy, lifecycle maintenance, command entry files (`new-command.js`, `recall-command.js`, `reroute.js`, `promote-unrouted.js`).
- Key files: `vault-gateway.js` (write enforcement), `pipeline-infra.js` (config loaders + LLM client factory, imported almost everywhere), `classifier.js`, `memory-extractor.js`, `memory-proposals.js`, `promote-memories.js`, `semantic-index.js`, `memory-reader.js`, `reach-exporter.js`, `dream.js`, `today-command.js`.

**`src/today/`:**
- Purpose: modules extracted from `today-command.js` during the Phase 15 architecture refactor so the orchestrator stays a thin fan-out shell.
- Contains: `slippage-scanner.js` (pure, scans `~/projects/*/.planning/STATE.md`), `frog-identifier.js` (one Haiku call + heuristic fallback), `llm-augmentation.js` (synthesis paragraph), `briefing-renderer.js` (synchronous markdown assembly, six sections), `memory-health.js` (anomaly detector over daily-stats rows), `compounding-trend.js` (pure trend engine, shared by `/today` and the CLI), `sweep-status.js` (fail-open proof-of-fire line).

**`src/connectors/`:**
- Purpose: external API integrations, each returning the uniform `makeResult`/`makeError` shape defined in `types.js`.
- Contains: `calendar.js` (Google Calendar), `gmail.js`, `github.js`, `types.js` (SOURCE enum + result factories + connectors config loader).

**`src/utils/`:**
- Purpose: small, cross-cutting helpers with no pipeline-stage identity of their own.
- Contains: `voyage-health.js` / `classifier-health.js` (adaptive-denial trackers, cache-dir JSON state), `memory-utils.js` (`computeHash`, `sourceRefShort`), `validate-schema.js` (AJV wrapper).

**`scripts/`:**
- Purpose: process entry points invoked directly by a human, a slash command, or `launchd` — never required by another `src/` module at the top level.
- Contains: `wrap.js` (/wrap extraction), `daily-sweep.js` (23:45 scheduled sweep), `dream.js` (`--propose`/`--dry-run`/`--apply`), `build-index.js` (SQLite rebuild, also exports `buildIndex` for in-process reuse by `promote-memories.js`/`dream.js`), `eval-recall.js`, `compounding-report.js`, `recall.js`, `migrate-memory-wiki.js`, `validate-archive.js`, `verify-baseline.js`, `engstatus.sh`, `setup-remote-trigger.sh`.
- Convention: every script that touches `src/` loads `dotenv` itself, guarded by `require.main === module` — `src/` library code never calls `dotenv.config()` at import time (`HOOK-DOTENV-01`).

**`test/`:**
- Purpose: Jest suite, structure mirrors `src/`.
- Contains: `test/today/`, `test/connectors/`, `test/utils/`, `test/unit/` (finer-grained unit tests not yet migrated to a mirrored path), `test/integration/` (cross-module flows: promotion→reach, recall end-to-end, semantic search, today→stats), `test/uat/` (`.uat.test.js` suffix, skip-gated from CI via `process.env.CI`), `test/hooks/` (both `.test.js` and `.test.sh` for shell hooks), `test/agents/`, `test/fixtures/` (`memory-sample.md`).

**`config/`:**
- Purpose: all tunables as JSON, loaded via `loadConfigWithOverlay()` (`src/pipeline-infra.js`).
- Contains: `pipeline.json` (classifier/extraction/wikilink/promotion/retry/leftProposal/filename/slippage/thresholds/stats/memory/memoryHealth/dream/sessionInject — the largest config, schema-validated with required-section checks), `vault-paths.json` (LEFT/RIGHT allowlist), `excluded-terms.json`, `memory-categories.json`, `reach-targets.json`, `scheduling.json`, `templates.json`, `connectors.json`, `docsync.json`, plus the two `launchd` `.plist` files and a `pipeline.local.json` (gitignored overlay, `pipeline.local.example.json` as the checked-in template).
- Overlay convention: any `<name>.json` may have a sibling `<name>.local.json`, deep-merged at load time. Unwired `.local.json` files (no loader references that base name) print a one-time stderr warning.

**`config/schema/`:**
- Purpose: AJV JSON Schema, one file per validated config, same base name (`pipeline.schema.json`, `vault-paths.schema.json`, etc.).

**`hooks/`:**
- Purpose: repo-managed git hooks. `npm run prepare` sets `core.hooksPath=hooks`, so this directory is live (not `.git/hooks/`).
- Contains: `pre-commit` / `pre-commit-schema-validate.js` / `pre-commit-vault-boundary.js`, `pre-push` / `pre-push-docsync.js`, `post-merge` / `post-merge-doc-sync.js`.

**`.claude/hooks/`:**
- Purpose: Claude Code lifecycle hooks — distinct from the git hooks above (different trigger model, registered in `settings.json`).
- Contains: `session-memory-inject.js` (SessionStart, Phase 35 — proactive memory digest), `memory-extraction-hook.js` (Stop), `auto-test.sh`, `protected-file-guard.sh`, `security-scan-gate.sh` (+ its `.md` doc), `staleness-check.js` (reads `CLAUDE.md`'s "Last verified" line).

**`.claude/agents/`:**
- Purpose: subagent role definitions consumed by the Claude Code Task tool.
- Contains: `docs-sync.md`, `memory-specialist.md`, `pipeline-reviewer.md`, `security-scanner.md`, `test-runner.md`, `test-verifier.md`, `vault-guardian.md`.

**`.claude/skills/`:**
- Purpose: skill definitions (`SKILL.md` per directory) invoked via the Skill tool.
- Contains: `config-validator/`, `dream-apply/`, `dream-propose/`, `dream-memory-consolidation/` (also has a `_MANIFEST.md`), `pipeline-health/`.

**`.claude/commands/`:**
- Purpose: slash-command wrappers, one markdown file per command, each delegating to the matching `src/*-command.js` or `scripts/*.js`.
- Contains: `today.md`, `new.md`, `wrap.md`, `recall.md`, `reroute.md`, `promote-memories.md`, `promote-unrouted.md`.

**`eval/`:**
- Purpose: retrieval-quality regression fixtures, frozen so eval runs are reproducible.
- Contains: `seed-vault/` (frozen vault fixture), `golden-recall.json` (query→expected-hash golden set), `baseline-*.json` (recall@5/MRR snapshots per `npm run eval:recall -- --baseline`), `baseline-sentinel-hashes.json`, `.cache/` (gitignored working cache).

**`decisions/`:**
- Purpose: ADRs — durable architectural decisions with rationale, not living docs.
- Contains: `ADR-018-cross-surface-reach.md`, `ADR-019-reach-layer-mechanism.md`, `ADR-020-authority-hierarchy.md`.

**`docs/`:**
- Purpose: supplementary reference docs that don't fit the ADR or `.planning/` shape.
- Contains: `DEVOPS-HANDOFF.md`, `second-brain-local-llm-backlog.md`.

**`state/`:**
- Purpose: mutable runtime artifacts written by the running system itself — project-local, not vault content.
- Contains: `session-log.md`, `decisions.md` (both read by `dream.js`'s MISSED-PATTERNS detector), `dream-ledger.json` (propose/apply run history), `pattern-context.md`, `daily-sweep-last-run.json` (sweep proof-of-fire, read by `today/sweep-status.js`), `transcripts-swept.json`.

**`tasks/`:**
- Purpose: operator-facing working notes per the global CLAUDE.md convention, not GSD-managed.
- Contains: `lessons.md` (operator-correction log), `todo.md`, `promotion-triage-2026-07-19.md`.

**`engineering-status/`:**
- Purpose: generated status snapshot inputs for `scripts/engstatus.sh`.
- Contains: `INDEX.md`, `NARRATIVE-PROMPT.md`, `.last-snapshot` (git-derived facts, regenerated — not hand-edited).

**`.planning/`:**
- Purpose: GSD execution state for this project — phases, milestones, backlog, requirements, roadmap.
- Contains: `phases/`, `milestones/` (`v1.0-phases/` through `v1.8-phases/`), `quick/` (`/gsd:quick` task folders), `research/`, `debug/`, `dependencies/`, `ecosystem/`, `reports/`, `state/`, plus top-level `PROJECT.md`, `STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md`, `REVIEWS.md`, `MILESTONES.md`, `RETROSPECTIVE.md`, `HANDOFF.md`, `backlog.md`, `todos.md`.

**`.planning/codebase/`:**
- Purpose: codebase mapping documents (this file's own location) — consumed by `/gsd:plan-phase` and `/gsd:execute-phase` to ground planning in actual code rather than assumption.

**`.github/workflows/`:**
- Purpose: CI pipeline — ESLint, CodeQL, license-checker, Node 22 matrix, coverage thresholds, GitGuardian secrets scan (per root `CLAUDE.md`).

**No dedicated `wiki/` directory:** wikilink generation is code, not a content directory — `src/wikilink-engine.js` builds an in-memory vault index and suggests `[[links]]` at promotion/note-write time; `scripts/migrate-memory-wiki.js` is the one sanctioned one-off mutation path for retrofitting links into an existing `memory.md`. There is no `wiki/` path in the repo or the vault.

## Key File Locations

**Entry Points:**
- `scripts/wrap.js`, `scripts/daily-sweep.js`, `scripts/dream.js`, `scripts/build-index.js`, `scripts/recall.js`: standalone CLIs
- `.claude/commands/*.md`: slash-command wrappers
- `.claude/hooks/session-memory-inject.js`: SessionStart hook

**Configuration:**
- `config/pipeline.json` (+ `pipeline.local.json` overlay, gitignored): the primary tunables file — classifier thresholds, extraction chunking, promotion batch caps, memory/semantic search params, dream budgets, session-inject config
- `config/vault-paths.json`: LEFT/RIGHT write-permission allowlist
- `config/schema/*.json`: AJV schemas paired 1:1 with config files

**Core Logic:**
- `src/vault-gateway.js`: write enforcement
- `src/pipeline-infra.js`: config loading + LLM client factory (imported by nearly every other module)
- `src/promote-memories.js`, `src/memory-extractor.js`, `src/memory-proposals.js`: the memory pipeline
- `src/semantic-index.js`, `src/memory-reader.js`: retrieval
- `src/dream.js`: consolidation detection + apply

**Testing:**
- `test/<mirror-of-src>/*.test.js`: unit tests
- `test/integration/*.test.js`: cross-module flows
- `test/uat/*.uat.test.js`: end-to-end, CI-skip-gated

## Naming Conventions

**Files:**
- Library modules: `kebab-case.js` matching their primary export's concern (`memory-proposals.js`, `reach-exporter.js`)
- Command entry files: `<verb>-command.js` (`today-command.js`, `new-command.js`, `recall-command.js`) or bare verb (`reroute.js`, `promote-unrouted.js`)
- Test files: `<module-name>.test.js`, co-located under a mirrored `test/` path; UAT suffix `.uat.test.js`; shell-hook tests `.test.sh`

**Directories:**
- Config schemas share the exact base name of the config they validate (`pipeline.json` ↔ `pipeline.schema.json`)
- `.planning/quick/` and `.planning/milestones/` subfolders are date/version-stamped, generated by GSD commands — not hand-created

## Where to Add New Code

**New pipeline stage or command:**
- Primary code: new module in `src/`, following the existing single-responsibility pattern (one concern, `module.exports` at the bottom, JSDoc module header with `@module` tag)
- If it's a new slash command: add a thin `.claude/commands/<name>.md` wrapper plus a `src/<name>-command.js` (or reuse an existing command file if extending)
- Tests: mirrored path under `test/` (e.g., `src/foo.js` → `test/foo.test.js`)

**New `/today` section:**
- Implementation: new file in `src/today/`, imported and composed by `today-command.js`; keep it synchronous/pure where possible (see `compounding-trend.js`, `sweep-status.js` — pure functions over already-fetched data), following the null-suppression precedent (return `null`/empty to hide the section rather than rendering a broken one)

**New external integration:**
- Implementation: `src/connectors/<service>.js`, returning `makeResult`/`makeError` from `src/connectors/types.js`; register any new config in `config/connectors.json` + `config/schema/connectors.schema.json`

**New config value:**
- Add to the relevant `config/*.json`, update its paired `config/schema/*.schema.json`, and read it via `loadConfigWithOverlay()` (never `fs.readFileSync` directly) so the overlay + validation conventions stay intact

**Utilities:**
- Shared, stage-agnostic helpers: `src/utils/`
- One-off private helpers scoped to a single module's problem (e.g., `dream.js`'s own `_cosine`) are kept as module-local copies rather than widening another module's public surface — an established precedent in this codebase, not an oversight

## Special Directories

**`.claude/worktrees/`:**
- Purpose: ephemeral executor worktrees
- Generated: Yes
- Committed: No (gitignored) — cannot run this repo's Jest suite from inside a worktree (no `node_modules` symlink)

**`coverage/`:**
- Purpose: Jest coverage report (lcov + HTML)
- Generated: Yes
- Committed: No (gitignored)

**`eval/.cache/` and `.cache/` (repo root):**
- Purpose: working caches for the eval harness and general scratch
- Generated: Yes
- Committed: No

**`state/`:**
- Purpose: live runtime state, mutated by the running system (not build output, not vault content)
- Generated: Yes (continuously appended/rewritten)
- Committed: Yes — this is deliberate; `state/session-log.md` and `state/decisions.md` are source material for `dream.js`'s pattern detection, so they're tracked

---

*Structure analysis: 2026-07-21*

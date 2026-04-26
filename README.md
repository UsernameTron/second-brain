[![CI](https://github.com/UsernameTron/second-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/UsernameTron/second-brain/actions/workflows/ci.yml)

# Second Brain

A personal operating system for Pete Connor: Obsidian vault with compounding memory, proactive daily briefing, and intelligent input routing. Hybrid architecture combining Cole Medin's memory-compounding approach with left/right write-permission vault boundaries.

## What This Is

CLI commands that orchestrate an Obsidian vault into a second brain. Three core commands:
- **`/today`** — Daily prep list: 6-section briefing with cross-project slippage scanner, calendar summary, Gmail VIP filter, GitHub activity, and memory snapshot
- **`/new`** — Input routing: two-stage LLM classifier that sends mixed input to correct vault location (LEFT for identity/context, RIGHT for active work)
- **`/wrap`** — Session memory extraction: auto-extracts learnings, decisions, insights into `memory-proposals.md` for human-in-the-loop promotion

Built for a technical executive who directs AI. The project code lives in this repo (`src/`, `test/`, `.planning/`). The vault lives in Obsidian at `~/Claude Cowork/`. They couple via MCP (Docker MCP Gateway + Obsidian Local REST API plugin).

## Quick Start

### Prerequisites
- Node.js 20+ (22 LTS recommended, tested in CI matrix)
- Obsidian 1.7+ with Local REST API plugin running
- Claude Code with GSD framework deployed

### Installation
```bash
npm install
npm run lint  # ESLint 10 (flat config)
npm test      # Jest 30 — 1190 total tests (1152 pass, 38 skipped in CI)
```

**Optional: Semantic memory search** — Set `VOYAGE_API_KEY` in `.env` to enable `/recall --semantic` and `/recall --hybrid`. Without the key, `/recall` falls back to keyword search. See [docs/DEVOPS-HANDOFF.md](docs/DEVOPS-HANDOFF.md) for acquisition steps and configuration.

### Running Commands
```bash
# From Claude Code terminal in the second-brain project:
/today        # Generate morning briefing
/new          # Route input to vault
/wrap         # Extract session memories
```

All commands are Claude Code `/` commands invoked through the Obsidian MCP gateway.

## Project Structure

```
src/                          # Core modules (27 .js files total)
├── vault-gateway.js         # LEFT/RIGHT boundary enforcement
├── today-command.js         # Daily briefing orchestrator (post-Phase-15 shell, 230 LOC)
├── classifier.js            # Two-stage LLM input router (runStage0/1/2 + classifyInput)
├── new-command.js           # /new entry point — classify + format + vault write
├── pipeline-infra.js        # Shared infra: correlation IDs, LLM client factory,
│                            # writeDeadLetter, loadConfigWithOverlay, 8 loaders
├── content-policy.js        # Ingress filter: exclusion terms + prompt-injection defense
├── style-policy.js          # Anti-AI style lint against banned words from style guide
├── memory-extractor.js      # Session transcript → candidate memories via Haiku
├── memory-proposals.js      # Staging to memory-proposals.md with file locking
├── promote-memories.js      # Human-reviewed promotion to memory.md with archival
├── promote-unrouted.js      # Bulk promote from dead-letter
├── reroute.js               # Reclassify previously routed items
├── lifecycle.js             # Sweep + dead-letter retry + auto-archive
├── wikilink-engine.js       # Post-write wikilink enrichment + vault index
├── note-formatter.js        # YAML frontmatter + template overlay
├── briefing-helpers.js      # Pipeline state aggregation for /today
├── config-validator.js      # AJV-based config-file validator (skill entry)
├── utils.js                 # Shared helpers (escapeRegex, date formatters)
├── today/                   # Phase 15 extracted modules (pure functions)
│   ├── slippage-scanner.js  # Scans ~/projects/*/.planning/STATE.md
│   ├── frog-identifier.js   # Picks daily frog via Haiku + heuristic fallback
│   ├── llm-augmentation.js  # Synthesis blockquote + diagnostic checklist
│   └── briefing-renderer.js # Markdown assembly, source health, date helpers
└── connectors/              # MCP connector adapters (uniform return shape)
    ├── calendar.js          # Google Calendar events
    ├── gmail.js             # VIP-filtered Gmail (draft-only OAuth)
    ├── github.js            # UsernameTron repo activity
    └── types.js             # Connector registry + SOURCE enum

test/                         # 1190 tests across 56 files
├── unit/                    # Module-level tests
├── integration/             # Cross-module flow tests
└── uat/                     # End-to-end command behavior (guarded from CI)

.planning/                    # GSD execution state
├── PROJECT.md              # Project charter, constraints, key decisions
├── MILESTONES.md           # Release history: v1.0, v1.1, v1.2, v1.3
└── STATE.md                # Current execution checkpoint

.claude/
├── agents/                 # 6 deployed specialists
│   ├── docs-sync.md
│   ├── pipeline-reviewer.md
│   ├── security-scanner.md
│   ├── test-runner.md
│   ├── test-verifier.md
│   └── vault-guardian.md
└── hooks/                  # 4 lifecycle hooks with test harnesses
    ├── auto-test.sh
    ├── protected-file-guard.sh
    ├── security-scan-gate.sh
    └── memory-extraction-hook.js

config/                      # Config files with optional .local.json overlays
├── pipeline.json           # Classifier thresholds, extraction chunk size, promotion
│                           # cadence, retry policy, filename generation, slippage tuning
├── connectors.json         # MCP connector registry (Gmail, Calendar, GitHub)
├── scheduling.json         # RemoteTrigger cron (weekday /today schedule, DST notes)
├── excluded-terms.json     # Ingress hard-block list (15 terms: Asana, Genesys, ISPN, etc.)
├── vault-paths.json        # LEFT/RIGHT vault boundary definitions
├── templates.json          # Domain templates (briefings, job-hunt, interview-prep) +
│                           # memory categories for extraction
└── schema/                 # AJV JSON Schemas for all 6 config files above

CLAUDE.md                    # Project governance, commands, conventions
```

## Status

**Latest Release:** v1.5.0 Internal Hardening (2026-04-26) | Phase 22-25 complete: Unicode Hardening, Pre-Commit Hooks, Doc Sync, UAT Rebaseline
- **1190 total tests** across 56 test files (1152 passing, 38 skipped in CI)
- **Branch coverage:** 81.28% (threshold: ≥80% enforced in CI)
- **Lint:** 0 ESLint no-console warnings
- **CI gates:** ESLint 10, CodeQL SAST, license-checker, Node 20+22 matrix, GitGuardian secrets scan
- **Shipped milestones:** v1.0 MVP (2026-04-22), v1.1 Go Live (2026-04-23), v1.2 Automation & Quality (2026-04-23), v1.3 Review Remediation (2026-04-24), v1.4 Closeout Hygiene (2026-04-25), v1.5 Internal Hardening (2026-04-26)

For detailed release history and known gaps, see [.planning/MILESTONES.md](.planning/MILESTONES.md).

## Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| **Vault** | Obsidian 1.7+ | Local-first markdown substrate at `~/Claude Cowork/` |
| **Orchestration** | Claude Code | Command execution via `/today`, `/new`, `/wrap` |
| **Runtime** | Node.js 20+22 LTS | Project code execution (tested matrix in CI) |
| **AI Models** | Anthropic Haiku/Sonnet | Primary LLM for classification and briefing generation |
| **Fallback** | LM Studio | Local LLM if Anthropic API unavailable |
| **Testing** | Jest 30 | Unit + integration + UAT (UAT guarded from CI) |
| **Linting** | ESLint 10 (flat config) | Code quality gate (53 violations fixed in v1.3) |
| **Security** | CodeQL + GitGuardian | SAST + secrets scanning in CI |
| **Config validation** | AJV 8 | JSON schema validation for all config files |
| **File watching** | chokidar 3.6 | CJS-compatible file system events |

**Key dependencies:** `@anthropic-ai/sdk` 0.90+, `gray-matter` 4.0 (YAML parsing), `dotenv` 17.4 (env vars), `voyageai` 0.2.1 (Phase 19 semantic embeddings, MIT)

**MCP integrations:** Gmail, Google Calendar, GitHub, Filesystem (all via Docker MCP Gateway)

## Development

### Test Coverage

```bash
npm test                    # Run all tests (1190 total; set CI=true to skip UAT)
npm run lint               # ESLint validation
npm run test:uat           # UAT tests (requires CI= to unblock)
```

**Coverage targets:**
- Overall: ≥80% (branch coverage, enforced in CI)
- Critical modules (auth, vault boundary): ≥95%
- All other modules: ≥80%

Current coverage: Statements 94.62%, Functions 96.94%, Lines 95.53%, Branch 81.28%

### Project Governance

Uses [GSD (Get Shit Done) framework](https://github.com/Pete-Gets-Shit-Done) for:
- Phase-gated development (planning → implementation → verification → ship)
- Automated agent coordination (6 deployed specialists in `.claude/agents/`)
- Lifecycle hooks for security, testing, memory extraction
- Structured decision logging in `.planning/STATE.md`

Before editing: Use `/gsd:quick`, `/gsd:debug`, or `/gsd:execute-phase` to maintain planning artifacts.

### Key Decisions

**Architecture:**
- LEFT/RIGHT vault split is a write-permission boundary, not content-type split
- Left vault is read-only to agents (preserves human voice)
- Right vault allows agent-generated content
- All external integrations use minimum viable permissions (OAuth scopes, path allowlists)

**No:** Obsidian Git sync (conflicts with project versioning), database-backed memory (markdown + Dataview sufficient), overengineered scheduling (Claude Desktop native tasks)

For complete architecture details, see [.planning/PROJECT.md](.planning/PROJECT.md).

## Commands Reference

| Command | When to Use | What It Does |
|---------|-------------|--------------|
| `/today` | Morning routine | Generate 6-section briefing: slippage, meetings, emails, GitHub, memory, weather |
| `/new` | Capture mixed input | Route to LEFT (identity) or RIGHT (work) vault via two-stage LLM |
| `/wrap` | End of session | Extract learnings, decisions, patterns into `memory-proposals.md` |
| `/promote-memories` | Review daily | Human-approve memory candidates from staging to `memory.md` |
| `/reroute` | Fix misclassified item | Re-route previously classified note to different location |
| `/promote-unrouted` | Bulk-promote | Move all unrouted items from staging to workspace |
| `/recall <query>` | Keyword recall | Minisearch over `memory.md` — AND semantics, quoted phrases, negation. Flags: `--category <name>`, `--since YYYY-MM-DD`, `--top N` (default 5) |
| `/recall --semantic <query>` | Semantic search | Voyage AI embedding search with cosine similarity + recency decay (0.55 threshold; requires `VOYAGE_API_KEY`). Accepts the same `--category` / `--since` / `--top N` flags |
| `/recall --hybrid <query>` | Hybrid search | RRF fusion of keyword + semantic results; degrades gracefully to keyword if Voyage unavailable. Accepts the same `--category` / `--since` / `--top N` flags |

## Known Gaps and Deferred Work

v1.5 (Phase 22-25) completed the v1.4 backlog items and Unicode hardening:

- **HYG-UNICODE-02** → resolved via Phase 22 NFKD Unicode Matcher (full-width Latin, soft-hyphen injection, non-ASCII whitespace)
- **HYG-JSDOC-01** → resolved Phase 21 (53 public exports + 2 _testOnly carve-outs)
- **HYG-CONSOLE-01** → resolved Phase 21 (32 primary + 3 corollary disables, all category-tagged per D-LOCK-2)
- **Phase 23 Pre-Commit Hooks** → schema validation, vault boundary guard, dotenv policy enforcement
- **Phase 24 Doc Sync Agent** → documentation consistency checks and API surface parity
- **Phase 25 UAT Rebaseline** → re-baselined all tests post-Unicode fix; removed todo entries

See [.planning/MILESTONES.md](.planning/MILESTONES.md) for complete v1.5 release details.

## Author

C. Pete Connor — Connor Advisors LLC

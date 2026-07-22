# Codebase Map — Second Brain

> Generated 2026-07-21 by the full-project audit (`/gsd:map-codebase`, 4 parallel mapper agents).
> Deep documents live in [`.planning/codebase/`](../.planning/codebase/) — this page is the orientation layer.
> Companion one-page purpose infographic: [`second-brain-purpose.drawio.png`](second-brain-purpose.drawio.png).

## What this is

A config-driven pipeline over an Obsidian vault (`~/Claude Cowork`) — no server process. Plain Node.js 22 CJS modules in `src/` are invoked three ways: Claude Code slash commands (`/today`, `/new`, `/wrap`, `/recall`, `/promote-memories`), standalone CLI scripts (`scripts/*.js`, each loading dotenv itself), and macOS launchd schedules (weekday-morning briefing, nightly sweep, monthly dream consolidation).

## The seven deep documents

| Document | What it covers | Load-bearing facts |
|---|---|---|
| [STACK.md](../.planning/codebase/STACK.md) | Languages, deps, CI | JS CommonJS only, no build step; Jest 30, ESLint 10 flat; chokidar pinned 3.6 (CJS compat), voyageai exact-pinned 0.2.1; CI = Node 22 matrix + CodeQL + license-checker + GitGuardian |
| [ARCHITECTURE.md](../.planning/codebase/ARCHITECTURE.md) | Patterns, data flow | Single write choke point (`vault-gateway.js`: path allowlist → content policy → style lint); never-throw LLM client contract (`{success, failureMode}` envelopes); adaptive-denial health trackers shared across CLI invocations; human-in-the-loop checkbox gates with ONE shared parser |
| [STRUCTURE.md](../.planning/codebase/STRUCTURE.md) | Directory layout | `src/` library modules, `src/today/` orchestrator stages, `src/connectors/` (briefing-only), `scripts/` dotenv-gated entry points, `config/` + `config/schema/` (AJV, protected-file-guarded), `hooks/` git hooks (repo-managed via core.hooksPath), `.claude/hooks/` Claude Code hooks |
| [CONVENTIONS.md](../.planning/codebase/CONVENTIONS.md) | Standards observed | kebab-case files, verb-first camelCase functions, `'use strict'` everywhere; no console.log in src (eslint-enforced, per-site disables documented); errors as data, not throws |
| [TESTING.md](../.planning/codebase/TESTING.md) | Test setup | Jest config inline in package.json; test/ mirrors src/; UAT skip-logic under CI; JEST_WORKER_ID counter-pollution tripwire; eval harness `npm run eval:recall` vs frozen seed vault + committed baseline |
| [INTEGRATIONS.md](../.planning/codebase/INTEGRATIONS.md) | External services | Anthropic (Haiku→Sonnet escalation), LM Studio local fallback (qwen3.6-27b, health-gated capped Haiku fallback), Voyage AI embeddings (0.55 threshold), Obsidian Local REST API, Docker MCP gateway, launchd trio |
| [CONCERNS.md](../.planning/codebase/CONCERNS.md) | Debt + risks | Branch protection restored and schema_version type fixed 2026-07-21 (PR #91); god-module watchlist (dream.js 1005 LOC, all tested); zero TODO/FIXME markers; zero silent empty catches |

## The one diagram to hold in your head

```
capture (inbox / daily notes / session transcripts)
        │  nightly sweep 23:45 + /wrap + /new
        ▼
two-stage LLM classifier (local 27B → capped Haiku fallback)
        │  writes ONLY through vault-gateway (allowlist → content policy → style)
        ▼
vault: LEFT (Pete's voice, read-only) │ RIGHT (agent-writable)
        │  extraction stages proposals → HUMAN checkbox gate → /promote-memories
        ▼
memory.md + embeddings sidecar + SQLite index  ←  monthly dream propose/apply (human-only)
        │
        ▼
retrieval: /recall (keyword/semantic/hybrid) · /today briefing (weekday 06:45)
           · SessionStart injection (fail-open, egress-filtered, ~750-token cap)
```

## Where to start reading

- Vault safety model: `src/vault-gateway.js`
- LLM call plumbing + fallbacks: `src/pipeline-infra.js` (721 LOC grab-bag — watchlist)
- Memory lifecycle: `src/memory-extractor.js` → `src/memory-proposals.js` → `src/promote-memories.js` → `src/memory-reader.js`
- Retrieval: `src/semantic-index.js` (Voyage + RRF hybrid)
- Daily briefing: `src/today-command.js` + `src/today/*`
- Consolidation: `src/dream.js` (+ `scripts/dream.js`, human-gated apply)

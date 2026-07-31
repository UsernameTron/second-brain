# Codebase Map — Second Brain

> Generated 2026-07-21 by the full-project audit (`/gsd:map-codebase`, 4 parallel mapper agents); facts re-verified 2026-07-31 against master @ 161e9f0 (PR #96, 13 reliability fixes).
> Deep documents live in [`.planning/codebase/`](../.planning/codebase/) — this page is the orientation layer.
> Companion one-page purpose infographic: [`second-brain-purpose.drawio.png`](second-brain-purpose.drawio.png).
> Vault-side navigation legend (how to read the graph in Obsidian): `maps/how-to-read-the-brain-map.md` in the vault.

## What this is

A config-driven pipeline over an Obsidian vault (`~/Claude Cowork`) — no server process. Plain Node.js 22 CJS modules in `src/` are invoked three ways: Claude Code slash commands (`/today`, `/new`, `/wrap`, `/recall`, `/promote-memories`), standalone CLI scripts (`scripts/*.js`, each loading dotenv itself), and macOS launchd schedules (weekday-morning briefing, nightly sweep, monthly dream consolidation).

## The seven deep documents

| Document | What it covers | Load-bearing facts |
|---|---|---|
| [STACK.md](../.planning/codebase/STACK.md) | Languages, deps, CI | JS CommonJS only, no build step; Jest 30, ESLint 10 flat; chokidar pinned 3.6 (CJS compat), voyageai exact-pinned 0.2.1; CI = Node 22 matrix + CodeQL + license-checker + GitGuardian |
| [ARCHITECTURE.md](../.planning/codebase/ARCHITECTURE.md) | Patterns, data flow | Single write choke point (`vault-gateway.js`: path allowlist → content policy → style lint); never-throw LLM client contract (`{success, failureMode}` envelopes); adaptive-denial health trackers shared across CLI invocations; human-in-the-loop checkbox gates with ONE shared parser; proposal writes serialized by a pid-probed lock (a stale-by-age `proposals.lock` is reclaimed only when `process.kill(pid, 0)` proves the holder dead — live/EPERM holders never are, corrupt/pid-less locks always are); extraction runs against ONE extraction-wide deadline (each classify gets the remaining budget; below a 2s floor chunking stops with a recorded `timeout` failure) and chunks on message count **first**, then accumulated bytes (`extraction.oversizeThresholdBytes`, 5 MiB) |
| [STRUCTURE.md](../.planning/codebase/STRUCTURE.md) | Directory layout | `src/` library modules, `src/today/` orchestrator stages, `src/connectors/` (briefing-only), `scripts/` dotenv-gated entry points, `config/` + `config/schema/` (AJV, protected-file-guarded), `hooks/` git hooks (repo-managed via core.hooksPath), `.claude/hooks/` Claude Code hooks |
| [CONVENTIONS.md](../.planning/codebase/CONVENTIONS.md) | Standards observed | kebab-case files, verb-first camelCase functions, `'use strict'` everywhere; no console.log in src (eslint-enforced, per-site disables documented); errors as data, not throws |
| [TESTING.md](../.planning/codebase/TESTING.md) | Test setup | Jest config inline in package.json; test/ mirrors src/; UAT skip-logic under CI; JEST_WORKER_ID counter-pollution tripwire; eval harness `npm run eval:recall` vs frozen seed vault + committed baseline |
| [INTEGRATIONS.md](../.planning/codebase/INTEGRATIONS.md) | External services | Anthropic (Haiku→Sonnet escalation), LM Studio local fallback (qwen3.6-27b at 65,536-token loaded context; `classifier.llm.localTimeoutMs` 900000 in the operator's gitignored `pipeline.local.json` — absent that overlay the code default is 10s; health-gated capped Haiku fallback), Voyage AI embeddings (0.55 threshold), Obsidian Local REST API, Docker MCP gateway, launchd trio — the scheduled briefing (`scripts/today-scheduled.js`) now exits 1 on a resolved error envelope, so launchd no longer records success on a briefing-less morning |
| [CONCERNS.md](../.planning/codebase/CONCERNS.md) | Debt + risks | Branch protection restored and schema_version type fixed 2026-07-21 (PR #91); 13 reliability fixes 2026-07-31 (PR #96 — lock reclaim, extraction deadline, byte-bounded chunking, dead oversize config enforced, per-file extraction-error isolation, config-load failures logged not swallowed); god-module watchlist (dream.js 1005 LOC, all tested); zero TODO/FIXME markers; zero silent empty catches |

## The one diagram to hold in your head

```
capture (inbox / daily notes / session transcripts)
        │  nightly sweep 23:45 + /wrap + /new
        ▼
two-stage LLM classifier (local 27B, 65k ctx → capped Haiku fallback)
        │  one extraction-wide deadline; chunk on message count, then bytes
        │  writes ONLY through vault-gateway (allowlist → content policy → style)
        ▼
vault: LEFT (Pete's voice, read-only) │ RIGHT (agent-writable)
        │        navigation layer: maps/home.md → 6 MOCs (a new note cluster
        │        needs a hub there or it drops off the graph entirely)
        ▼
proposals/memory-proposals.md   (pid-probed lock; contended writes are
        │                        BUFFERED, never lost — /wrap reports N staged,
        │                        M buffered, run again to drain)
        │
        ▼
   ┌────────────────────────────────────────────────┐
   │  HUMAN checkbox gate — per-candidate accept/   │
   │  reject; nothing crosses without a person      │
   └────────────────────────────────────────────────┘
        │  /promote-memories drains ≤10 accepted per run (promotion.batchCapMax);
        │  overflow stays `deferred` and promotable, rejects are archived
        ▼
memory.md + embeddings sidecar + SQLite index  ←  monthly dream propose/apply (human-only)
        │
        ▼
retrieval: /recall (keyword/semantic/hybrid) · /today briefing (weekday 06:45,
           exits 1 on failure) · SessionStart injection (fail-open,
           egress-filtered, ~750-token cap)
```

## Where to start reading

- Vault safety model: `src/vault-gateway.js`
- LLM call plumbing + fallbacks: `src/pipeline-infra.js` (731 LOC grab-bag — watchlist)
- Memory lifecycle: `src/memory-extractor.js` → `src/memory-proposals.js` → `src/promote-memories.js` → `src/memory-reader.js`
- Retrieval: `src/semantic-index.js` (Voyage + RRF hybrid)
- Daily briefing: `src/today-command.js` + `src/today/*`
- Consolidation: `src/dream.js` (+ `scripts/dream.js`, human-gated apply)

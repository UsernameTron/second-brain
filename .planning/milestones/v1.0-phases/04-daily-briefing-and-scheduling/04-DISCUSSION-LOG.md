# Phase 4: Daily Briefing and Scheduling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 04-daily-briefing-and-scheduling
**Areas discussed:** Briefing Composition, Scheduling Mechanism, Gmail Scope Boundary

---

## Area 1: Briefing Composition

### Sub-decision A: Markdown Template

| Option | Description | Selected |
|--------|-------------|----------|
| Space-separated sources string | `sources: calendar:ok gmail:degraded` | |
| YAML map sources | `sources:\n  calendar: ok\n  gmail: degraded` | ✓ |

**User's choice:** YAML map with four refinements: (1) native YAML parse via gray-matter already in deps, (2) add `degraded: N` integer for grep queryability, (3) `dry-run` as third mode value, (4) wikilinks target vault-internal briefs only, never external filesystem paths. Add horizontal rule after synthesis blockquote. Use "Meetings" over "Calendar" for human-facing headings.

### Sub-decision B: Synthesis Threshold

| Option | Description | Selected |
|--------|-------------|----------|
| Always run synthesis | Haiku synthesis runs even with degraded sections | ✓ |
| Skip when >= N degraded | Save Haiku call when mostly empty | |

**User's choice:** Always run. On total failure, replace with diagnostic checklist: "Check: (1) Docker Desktop running? (2) Obsidian Local REST API plugin enabled? (3) Network?" — turns dead briefing into debugging checklist.

### Sub-decision C: Slippage Scanner Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in /today | Function inside /today module, ~60 lines | ✓ |
| Separate scanner module | `src/scanners/project-scanner.js` for reuse | |

**User's choice:** Inline. Extraction trigger: a second consumer. Staleness threshold: 7 days (3 too noisy for weekends, 14 too late). Configurable under `config/pipeline.json` → `slippage` with `staleDays`, `excludeProjects`, `maxProjects: 20`. Scanner failure mode: skip silently, emit one warning to synthesis context.

### Sub-decision D: Error Envelope

| Option | Description | Selected |
|--------|-------------|----------|
| Inline only | Vault notes are the audit trail | ✓ |
| Separate error log | `state/briefing-errors.log` append-only | |

**User's choice:** Inline only. Error strings must be grep-friendly: `[SOURCE] ERROR_CODE: human message`. Contract test enforces regex `/^[A-Z_]+: .+/` on error rendering. Failure-frequency report via grep across daily folder.

---

## Area 2: Scheduling Mechanism (Pre-answered)

| Option | Description | Selected |
|--------|-------------|----------|
| RemoteTrigger API | Server-side cron via claude.ai, no expiry | ✓ (primary) |
| CronCreate durable | Local persistent, 7-day auto-expiry | (fallback 1) |
| macOS launchd | System-level plist management | (fallback 2) |

**User's choice:** Pre-answered. Resolution path: probe RemoteTrigger API with test task, verify schema, document syntax, delete test. Probe executed successfully — trigger `trig_01NHx3Uz8ni8eZSfsMph4miY` created (disabled), schema verified, user directed to delete at https://claude.ai/code/scheduled.

**Notes:** CronCreate has 7-day auto-expiry on recurring tasks — disqualifies it as primary for a permanent daily briefing. RemoteTrigger runs in Anthropic cloud, survives session restarts, no expiry.

---

## Area 3: Gmail Scope Boundary (Pre-answered)

| Option | Description | Selected |
|--------|-------------|----------|
| Block Phase 4 on OAuth | Wait for gmail-mcp-pete OAuth before building briefing | |
| Parallel workstream | OAuth in its own repo, Phase 4 uses interface contract | ✓ |

**User's choice:** Pre-answered. gmail-mcp-pete OAuth is out-of-scope for Phase 4. Phase 4 builds against connector interface contract. Briefing works with stubs; swap without code changes when OAuth lands. Contract test validates interface with either backend.

---

## Claude's Discretion

- Frog identification heuristic details (D-15) — user provided direction that it needs Haiku judgment over heuristic-scored candidates. Exact heuristic to be resolved during planning.

## Deferred Ideas

- gmail-mcp-pete OAuth wiring — parallel workstream in its own repo
- Slippage scanner extraction — when a second consumer emerges
- Frog history tracking — v2 feature
- Configurable /today sections — CONFIG-01 in v2 requirements

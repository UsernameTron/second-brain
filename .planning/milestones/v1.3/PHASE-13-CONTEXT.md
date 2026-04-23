# Phase 13 — Config Schema Gaps

**Phase:** 13
**Milestone:** v1.3 Review Remediation
**Status:** PENDING
**Dependencies:** Phase 12 (safeLoadPipelineConfig must exist before overlay helper expands)

## Scope

### New schemas (B-14 / R6)
- Author `config/schema/excluded-terms.schema.json` — array of strings, minItems 1
- Author `config/schema/scheduling.schema.json` — cron-expression regex pattern for schedule fields
- Author `config/schema/vault-paths.schema.json` — left/right array constraints, haikuContextChars integer bounds
- Wire all three into config-validator skill's schema registry

### Orphan schema cleanup
- `config/schema/memory-categories.schema.json` exists but has no corresponding config file
- Decision: delete it OR extract categories from `config/templates.json` into `config/memory-categories.json` and validate against it
- Research needed during discuss phase to determine which path

### Config centralization
- Hardcoded parameters scattered across source files:
  - memory-extractor thresholds
  - memory-proposals lock timeout
  - content-policy Haiku timeout
  - wikilink-engine token budget
- Centralize into `config/pipeline.json` under new sections
- Each centralized parameter gets schema coverage via `pipeline.schema.json` extension

### Overlay helper adoption
- `loadConfigWithOverlay()` currently only used by pipeline.json loader
- Extend to: vault-paths, connectors, scheduling, excluded-terms loaders
- Each loader gets `{name}.local.json` support (gitignored)
- Remove the startup-warning workaround once all loaders use overlay

## Backlog Items Addressed

| Backlog ID | Item |
|------------|------|
| B-14 | Missing schemas for vault-paths, excluded-terms, scheduling |
| B-12 | AJV removeSchema catch (may resolve with schema registry cleanup) |

## Key Files

- `config/schema/` — new schema files
- `src/pipeline-infra.js` — loadConfigWithOverlay, config loaders
- `src/validate-schema.js` — config-validator engine
- `config/pipeline.json` — centralized parameters target
- `.claude/skills/config-validator/SKILL.md` — schema registry

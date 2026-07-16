---
phase: 10-agent-hardening-and-skills
plan: "02"
subsystem: skills
tags: [skills, pipeline, health-check, SKILL-02]
dependency_graph:
  requires: [phase-8-hook-infrastructure]
  provides: [pipeline-health-skill]
  affects: [.claude/skills/pipeline-health/]
tech_stack:
  added: []
  patterns: [health-check skill, structured status table, verdict categories]
key_files:
  created:
    - .claude/skills/pipeline-health/SKILL.md
  modified: []
decisions:
  - "Connector check uses file-existence probe rather than MCP status query (not scriptable)"
  - "Scheduler check reads config/scheduling.json rather than querying Claude Desktop tasks (not scriptable)"
  - "All individual checks timeout at 5 seconds to keep total under 30 seconds"
metrics:
  duration: "~3 minutes"
  completed: "2026-04-23T16:25:00Z"
  tasks_completed: 1
  files_modified: 1
requirements_completed: [SKILL-02]
---

# Phase 10 Plan 02: Pipeline Health Skill Summary

Created `/pipeline-health` skill providing operational visibility into the second-brain pipeline via four structured checks and a HEALTHY/DEGRADED/UNHEALTHY verdict.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create pipeline-health skill | f92e6be | .claude/skills/pipeline-health/SKILL.md |

## What Was Built

**pipeline-health skill** (`.claude/skills/pipeline-health/SKILL.md`):
- 105 lines (under 200 limit)
- Proper frontmatter: name, description with "Use when..." trigger language and trigger phrases
- Four sequential checks:
  1. **Config Validation** — runs `node src/config-validator.js`, reports PASS/FAIL
  2. **Connector Reachability** — checks file existence for gmail.js, github.js, calendar.js connectors
  3. **Vault REST API** — `curl` to `localhost:27123` with 5s timeout, reports UP/DOWN/AUTH-REQUIRED
  4. **Scheduler State** — reads `config/scheduling.json`, reports OK/MISSING
- Structured output: Pipeline Health Report table with component/status/detail columns
- Verdict logic: HEALTHY (all OK), DEGRADED (1-2 non-critical), UNHEALTHY (config fails or vault down)

## Deviations from Plan

None.

## Known Stubs

None.

## Self-Check: PASSED

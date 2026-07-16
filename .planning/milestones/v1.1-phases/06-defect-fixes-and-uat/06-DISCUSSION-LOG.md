# Phase 6: Defect Fixes and UAT - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 06-defect-fixes-and-uat
**Areas discussed:** Remote execution target, UAT execution approach, Config hot-reload scope, Dedup fix boundaries

---

## Remote Execution Target

| Option | Description | Selected |
|--------|-------------|----------|
| Calendar works remotely, rest degrades | Detect attached MCP connector for calendar; Gmail+GitHub degrade per D-11 | ✓ |
| Full parity with local | Proxy all MCP connectors to remote env | |
| Accept all degradation | Don't fix remote, just prevent crashes | |

**User's choice:** Calendar works remotely, everything else degrades cleanly. Not full parity.
**Notes:** Calendar MCP connector is attached to the trigger config, so today-command.js should detect and use it. Gmail+GitHub are local-only by design. Paths must use process.cwd()/__dirname instead of hardcoded /Users/cpconnor. Missing Haiku API key should degrade, not crash. User was emphatic: "Don't over-scope this."

---

## UAT Execution Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Real captures from workflow | Pete provides 10+ inputs from actual daily use | |
| Synthetic test inputs | Plan generates diverse synthetic captures covering each domain | ✓ |

**User's choice:** Generate synthetic inputs
**Notes:** Plan should include task to create 10+ diverse synthetic captures. UAT-03 (Obsidian walkthrough) remains manual.

---

## Config Hot-Reload Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Investigate first | Diagnostic task to reproduce defect, identify symptom | |
| Skip FIX-02 | Defer to backlog, no real symptom observed | ✓ |

**User's choice:** Skip FIX-02
**Notes:** Two hot-reload mechanisms already implemented (chokidar in vault-gateway, fs.watch in style-policy). Nobody's hit a real symptom. Investigating a defect that may not exist is scope creep in a phase with 7 other requirements. Defer to backlog — if someone hits it later, the diagnostic context will be obvious from the actual symptom.

---

## Dedup Fix Boundaries

| Option | Description | Selected |
|--------|-------------|----------|
| Within-batch Set only | Add Set tracking in batch loop, keep existing isDuplicateInMemory | |
| Within-batch Set + proposals check | Also check proposals file in addition to memory.md/archives | ✓ |

**User's choice:** Yes, check proposals file too, and add within-batch Set.
**Notes:** A proposal still pending review should not be re-promoted. Clear, unambiguous direction.

---

## Claude's Discretion

- Detection mechanism for remote MCP connector (env var, mcpClient shape, etc.)
- Synthetic test input content and diversity mix
- Test harness approach for UAT-01/02
- Task ordering (defects first then UAT, or interleaved)

## Deferred Ideas

- FIX-02 (config hot-reload) — deferred to backlog, no real symptom

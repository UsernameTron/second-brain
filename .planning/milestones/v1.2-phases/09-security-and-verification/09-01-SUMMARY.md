---
phase: 09-security-and-verification
plan: "01"
subsystem: security
tags: [security, hooks, agents, SEC-01, HOOK-03]
dependency_graph:
  requires: [phase-8-hook-infrastructure]
  provides: [security-scanner-agent, security-scan-gate-hook]
  affects: [.claude/settings.json, ship-pipeline]
tech_stack:
  added: []
  patterns: [PreToolUse Bash gate, read-only auditor agent, structured JSON contract]
key_files:
  created:
    - .claude/agents/security-scanner.md
    - .claude/hooks/security-scan-gate.sh
  modified:
    - .claude/settings.json
decisions:
  - "Agent named security-scanner (not sec-01) to match agent invocation convention `claude --agent security-scanner`"
  - "Gate script uses case/esac pattern matching for ship commands — consistent with existing hook style"
  - "Agent failure falls back to CRITICAL blocking finding rather than silently passing — fail-closed posture"
  - "Added npx semantic-release to ship command list per security-scan-gate.md spec (plan action omitted it)"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-23T16:06:59Z"
  tasks_completed: 2
  files_modified: 3
requirements_completed: [SEC-01]
---

# Phase 09 Plan 01: Security Scanner and Gate Hook Summary

SEC-01 security scanner agent deployed as a read-only Bash/Grep/Glob auditor with 4-step scan protocol (staged secret patterns, npm audit, protected file mutations, JSON output), wired to PreToolUse gate that intercepts ship commands and exits 2 on blocking findings.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create security scanner agent and gate script | 55abe9a | .claude/agents/security-scanner.md, .claude/hooks/security-scan-gate.sh |
| 2 | Wire security-scan-gate into settings.json | 81ba729 | .claude/settings.json |

## What Was Built

**security-scanner agent** (`.claude/agents/security-scanner.md`):
- Read-only agent (tools: Read, Grep, Glob, Bash — no Write, no Edit)
- 4-step protocol: secret scan, npm audit, protected file check, JSON output
- Secret patterns: AWS AKIA keys, GitHub tokens (ghp_, gho_, ghs_, github_pat_), generic API keys, base64 secrets
- npm audit HIGH/CRITICAL → blocking array; LOW/MODERATE → findings warnings
- Protected files: `.env`, `.env.*`, `config/schema/**`, `*credentials*` → blocking
- Output contract: `{ "pass": bool, "findings": [...], "blocking": [...] }` — matches HOOK-03 spec

**security-scan-gate.sh** (`.claude/hooks/security-scan-gate.sh`):
- PreToolUse Bash hook following existing hook pattern (set -euo pipefail, INPUT=$(cat), node JSON parse)
- Gates ship commands: `git push`, `gh pr create`, `gh pr merge`, `npx semantic-release`
- Non-ship Bash commands: exits 0 immediately (no-op)
- Invokes `claude --agent security-scanner --print`
- Agent failure falls back to CRITICAL blocking — fail-closed posture
- Exits 2 on any blocking finding, exits 0 on clean or warning-only

**settings.json update**:
- Removed `_hook03_pending` stub comment (D-08 fulfilled)
- Added PreToolUse Bash matcher entry with 60s timeout for security-scan-gate.sh
- All existing hooks preserved: PostToolUse auto-test, PreToolUse protected-file-guard

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added npx semantic-release to ship command list**
- **Found during:** Task 1 implementation
- **Issue:** Plan action listed 3 ship commands (git push, gh pr create, gh pr merge) but security-scan-gate.md spec listed a 4th: `npx semantic-release`
- **Fix:** Added `*"npx semantic-release"*` case to the IS_SHIP detection in security-scan-gate.sh
- **Files modified:** .claude/hooks/security-scan-gate.sh
- **Commit:** 55abe9a

## Known Stubs

None — all functionality is wired end-to-end.

## Self-Check: PASSED

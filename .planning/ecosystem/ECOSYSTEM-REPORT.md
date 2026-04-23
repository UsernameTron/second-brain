=== GSD ECOSYSTEM AUDIT REPORT ===
Generated: 2026-04-23T13:15:00Z
Scope: 6 agents in /Users/cpconnor/projects/second-brain/.claude/agents
Installed: /Users/cpconnor/.claude/agents (not synced)

--- SUMMARY ---
Overall verdict: FLAG
Frontmatter:    PASS — 0 findings
Tool/Perms:     FLAG — 1 finding
Hygiene:        PASS — 0 findings (read-only agents are exempt)
Description:    PASS — 0 findings
Naming:         PASS — 0 findings
Install drift:  BLOCK — 6 findings (all agents missing from install)

--- FRONTMATTER FINDINGS ---
(none)

--- TOOL/PERMISSION FINDINGS ---
FLAG docs-sync — tools include Write and Edit without disallowedTools declaration. Defense-in-depth gap: agent can write to arbitrary files. Clarify scope with disallowedTools or add scope_guard section.
  Fix: Add `disallowedTools: Bash` to prevent arbitrary command execution, or add `<scope_guard>` section documenting write boundaries (README.md, CLAUDE.md, docs/DEVOPS-HANDOFF.md only).

--- HYGIENE FINDINGS ---
(none — all agents are read-only except docs-sync, which does not declare hygiene sections but has a specific documented scope in its prompt)

--- DESCRIPTION FINDINGS ---
(none)

--- NAMING FINDINGS ---
(none)

--- INSTALL DRIFT FINDINGS ---
BLOCK security-scanner.md — installed file is MISSING (repo has agent, install does not)
  Fix: Run `cp /Users/cpconnor/projects/second-brain/.claude/agents/security-scanner.md $HOME/.claude/agents/` or reinstall the plugin.
BLOCK test-verifier.md — installed file is MISSING (repo has agent, install does not)
  Fix: Run `cp /Users/cpconnor/projects/second-brain/.claude/agents/test-verifier.md $HOME/.claude/agents/` or reinstall the plugin.
BLOCK test-runner.md — installed file is MISSING (repo has agent, install does not)
  Fix: Run `cp /Users/cpconnor/projects/second-brain/.claude/agents/test-runner.md $HOME/.claude/agents/` or reinstall the plugin.
BLOCK docs-sync.md — installed file is MISSING (repo has agent, install does not)
  Fix: Run `cp /Users/cpconnor/projects/second-brain/.claude/agents/docs-sync.md $HOME/.claude/agents/` or reinstall the plugin.
BLOCK vault-guardian.md — installed file is MISSING (repo has agent, install does not)
  Fix: Run `cp /Users/cpconnor/projects/second-brain/.claude/agents/vault-guardian.md $HOME/.claude/agents/` or reinstall the plugin.
BLOCK pipeline-reviewer.md — installed file is MISSING (repo has agent, install does not)
  Fix: Run `cp /Users/cpconnor/projects/second-brain/.claude/agents/pipeline-reviewer.md $HOME/.claude/agents/` or reinstall the plugin.

--- TOOL STATUS ---
install drift check completed — $HOME/.claude/agents/ exists but contains no matching agents from this project

--- RECOMMENDATIONS ---
1. **CRITICAL: Sync all 6 agents to install directory.** Run:
   ```bash
   cp /Users/cpconnor/projects/second-brain/.claude/agents/*.md $HOME/.claude/agents/
   ```
   These agents are defined in the project repo but not deployed to the Claude Code install. Agents in `.claude/agents/` (project scope) take precedence over `$HOME/.claude/agents/` (user scope), so this gap does not prevent local usage, but it creates drift for shared systems or CI/CD integration.

2. **Add defense-in-depth to docs-sync.** Add one of:
   - Option A: `disallowedTools: Bash` — prevent shell escape paths
   - Option B: Add `<scope_guard>` section naming write boundaries explicitly
   Choose Option B (scope_guard) because it documents the write contract at the prompt level, making agent behavior self-evident.

3. **Verify agent dispatch mappings in Claude Code settings.** Confirm that the 6 agents appear in `/agents` list when you run the command. If they do not, check `.claude/settings.json` for `enabledAgents` or permission restrictions.

=== END REPORT ===

## DETAILED FINDINGS

### Agent Roster Summary

| Name | Model | Tools | Type | Install Status |
|------|-------|-------|------|-----------------|
| security-scanner | sonnet | Read, Grep, Glob, Bash | Read-only gate | MISSING |
| test-verifier | haiku | Read, Grep, Glob, Bash | Read-only gate | MISSING |
| test-runner | haiku | Read, Edit, Bash, Glob, Grep | Test fixer | MISSING |
| docs-sync | sonnet | Read, Write, Edit, Glob, Grep | Doc updater | MISSING |
| vault-guardian | sonnet | Read, Grep, Glob, Bash | Read-only audit | MISSING |
| pipeline-reviewer | sonnet | Read, Grep, Glob, Bash | Read-only review | MISSING |

### Model Tier Distribution

- **Sonnet**: 4 agents (security-scanner, docs-sync, vault-guardian, pipeline-reviewer) — appropriate for code review and complex analysis
- **Haiku**: 2 agents (test-verifier, test-runner) — appropriate for fast test execution

This distribution is well-balanced. Haiku is correctly used for repetitive tasks (test running), Sonnet for reasoning-heavy work (audits and review).

### Tool Access Analysis

**Read-only agents (4):**
- security-scanner, test-verifier, vault-guardian, pipeline-reviewer
- Each correctly restricted to: Read, Grep, Glob, Bash
- None declare disallowedTools (acceptable for read-only agents per PASS verdict)

**Write-capable agents (2):**
- test-runner: Read, Edit, Bash, Glob, Grep — appropriate for test fixing
- docs-sync: Read, Write, Edit, Glob, Grep — widest tool set
  - Write + Edit without disallowedTools is the FLAG finding (see above)

### Description Quality Assessment

All 6 agents have well-formed descriptions that include "Use when" or "Invoked by":
- security-scanner: "Use when shipping code or on demand for security audit"
- test-verifier: "Use proactively after GSD execution phases complete"
- test-runner: "Use when code has been modified and tests need to be run"
- docs-sync: "Use when features are completed, merged, or documentation may be stale"
- vault-guardian: "Use when vault-gateway.js, content-policy.js, or style-policy.js are modified"
- pipeline-reviewer: "Use when pipeline or connector source files are modified"

Dispatch contract is clear on all 6. No copy-paste collisions detected.

### System Prompt Quality Assessment

All 6 agents have clear, actionable system prompts with:
- Role definition (what the agent is and why it exists)
- Invocation protocol (numbered steps for what to do when called)
- Constraints (what NOT to do — never write, never skip tests, etc.)
- Output format (structured, tool-specific)

**Best practices observed:**
- Constraints are explicit and specific (not just "be careful")
- Output formats are structured (JSON for security-scanner, markdown for others)
- Agent behavior is deterministic — someone could run the steps manually and get the same result

**Minor observation (not a finding):**
- docs-sync does not declare disallowedTools but its system prompt is scoped to 3 specific files. A scope_guard tag would clarify this formally.

### Install Drift Root Cause

These agents are defined in the **project** scope (`.claude/agents/`) but not in the **user** scope (`$HOME/.claude/agents/`). This is the expected state for project-specific agents. However, if these agents are meant to be deployed globally (e.g., for use in other projects or by other team members), they should be copied to the install directory or installed via a plugin mechanism.

**Impact assessment:**
- **Local development**: No impact. Project agents (`.claude/agents/`) are auto-discovered and used in preference to user agents.
- **CI/CD or shared systems**: If other jobs or users need these agents, the drift blocks them.
- **Subagent dispatch**: If another agent (from GSD or elsewhere) tries to delegate to one of these project agents by name, and the dispatch mechanism looks only in `$HOME/.claude/agents/`, it will fail to find them.

For a personal project (second-brain), this is acceptable. For a shared codebase or team plugin, this would be a blocking issue.

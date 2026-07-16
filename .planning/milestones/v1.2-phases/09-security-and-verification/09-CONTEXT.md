# Phase 9: Security & Verification - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Deploy three security and verification components that close the quality loop opened by Phase 8's hook infrastructure:
1. **SEC-01**: Security scanner agent that fulfills the HOOK-03 integration contract (secrets, npm audit, protected files)
2. **SEC-02**: Independent test verification gate that reports pass/fail without fixing — distinct from test-runner's fix-it role
3. **SEC-03**: Config/schema validation skill with AJV-based script for draft-07 JSON Schema validation

Phase 8 dependency: HOOK-03 stub at `.claude/hooks/security-scan-gate.md` defines the invocation contract. This phase implements the agent that contract calls.

</domain>

<decisions>
## Implementation Decisions

### SEC-01: Security Scanner Agent
- D-01: Agent file at `.claude/agents/security-scanner.md` (not `sec-01.md`). HOOK-03 gate script references agent by this name. Descriptive naming consistent with existing agents (vault-guardian, pipeline-reviewer).
- D-02: Strict HOOK-03 contract scope only — (a) scan staged changes for secrets/tokens/credential patterns, (b) run `npm audit --audit-level=high` and surface HIGH/CRITICAL, (c) check that no protected file (.env, .env.*, config/schema/**, *credentials*) appears in staged changes. No OWASP pattern scanning or scope creep.
- D-03: Agent model is `sonnet` — security scanning benefits from reasoning quality for pattern recognition. Not run frequently (only on ship commands). Consistent with vault-guardian and pipeline-reviewer model choice.
- D-04: npm audit handling — parse JSON output, HIGH/CRITICAL findings go in `blocking` array (blocks ship). LOW/MEDIUM go in `findings` array as warnings (logged but do not block). Matches REQUIREMENTS acceptance criteria.
- D-05: Agent tools: `Read, Grep, Glob, Bash` (read-only commands only). Agent never modifies files — any write attempt is a test failure per REQUIREMENTS.
- D-06: Agent outputs structured JSON per HOOK-03 contract: `{ "pass": boolean, "findings": [...], "blocking": [...] }`. Each finding has `{ "severity", "file", "line", "description" }`.
- D-07: HOOK-03 gate script (`.claude/hooks/security-scan-gate.sh`) to be created per contract. Fires on Bash PreToolUse, matches ship commands (git push, gh pr create, gh pr merge). Invokes security-scanner agent, parses JSON response, exits 2 on blocking findings.
- D-08: Add PreToolUse Bash entry to `.claude/settings.json` alongside existing hooks. Remove `_hook03_pending` comment field.

### SEC-02: Test Verification Gate
- D-09: Agent file at `.claude/agents/test-verifier.md`. Read-only reporter — tools: `Read, Grep, Glob, Bash`. No Edit tool (unlike test-runner which has Edit for fixing).
- D-10: No baseline tracking — current test suite is 547 pass / 0 fail. Agent reports all failures with file:line context. Baseline tracking adds complexity without value when suite is green.
- D-11: Agent model is `haiku` — running `npm test` and parsing output is mechanical. Speed matters for a gate. Consistent with test-runner model choice.
- D-12: Distinct from test-runner agent: test-verifier reports only (read-only), test-runner fixes (has Edit). Both coexist — different purpose, different permissions, different triggers.
- D-13: GSD integration — agent description includes trigger language for /gsd:verify-work. GSD spawns it during verification via agent description matching. No hook needed.
- D-14: Output format: pass/fail counts, failure details with file:line, overall verdict. Clear enough for GSD state machine to parse.

### SEC-03: Config/Schema Validation Skill
- D-15: Skill file at `.claude/skills/config-validator/SKILL.md`. Invokes `node src/config-validator.js` for validation.
- D-16: Validation engine: `ajv` npm package as devDependency. Standard for draft-07 JSON Schema which all 4 existing schemas use. Requires user approval per dependency rule.
- D-17: Dynamic discovery — glob `config/schema/*.schema.json`, derive config file path by removing `.schema` suffix (e.g., `connectors.schema.json` → `config/connectors.json`). Future-proof for new schemas.
- D-18: Missing config handling — if schema exists but config file does not (memory-categories.json), report WARNING (not error). Skill validates only configs that exist.
- D-19: Config files without schemas (excluded-terms.json, scheduling.json, vault-paths.json) are silently skipped — no warning needed.
- D-20: Validation output: file name, schema name, PASS/FAIL, and on failure: JSON path + error description per AJV output.
- D-21: Skill is testable — `src/config-validator.js` has Jest tests covering: valid config passes, invalid config fails with path, missing config warns, malformed JSON errors.

### Claude's Discretion
- Hook script implementation details (shell parsing, JSON extraction approach) — follow existing patterns from auto-test.sh and protected-file-guard.sh
- Secret pattern regex library — Claude selects patterns for common secret formats (AWS keys, GitHub tokens, generic API keys, base64 secrets)
- AJV configuration options (allErrors, verbose, etc.)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.claude/hooks/auto-test.sh` — pattern for PostToolUse hook with node -e JSON parsing from stdin
- `.claude/hooks/protected-file-guard.sh` — pattern for PreToolUse gate with exit 2 blocking
- `.claude/hooks/security-scan-gate.md` — HOOK-03 integration contract (invocation interface, JSON schema, settings.json entry template)
- `.claude/settings.json` — existing hook registrations (PostToolUse Write|Edit for auto-test, PreToolUse Write|Edit for protected-file-guard)
- Existing agents (4): test-runner.md, docs-sync.md, vault-guardian.md, pipeline-reviewer.md — all follow consistent frontmatter + system prompt pattern

### Established Patterns
- Hook scripts: bash with `set -euo pipefail`, `INPUT=$(cat)`, node -e for JSON parsing, exit 0 for pass, exit 2 for block
- Agent files: YAML frontmatter (name, description, tools, model), structured system prompt with When Invoked / Constraints / Output Format sections
- Config schemas: draft-07 JSON Schema at `config/schema/*.schema.json`, corresponding config at `config/*.json`
- Test convention: `src/{module}.js` → `test/{module}.test.js`

### Integration Points
- `.claude/settings.json` — new PreToolUse Bash entry for security-scan-gate hook
- `.claude/agents/` — 2 new agent files (security-scanner.md, test-verifier.md)
- `.claude/skills/config-validator/` — new skill directory
- `src/config-validator.js` — new source module
- `test/config-validator.test.js` — new test file
- `package.json` — `ajv` devDependency addition

</code_context>

<specifics>
## Specific Ideas

- CRITICAL CORRECTION applied: all references use `config/schema/` (singular), not `config/schemas/` (plural)
- HOOK-03 contract at `.claude/hooks/security-scan-gate.md` is the authoritative spec for SEC-01 invocation interface
- Agent naming: `security-scanner.md` per REQUIREMENTS, not `sec-01.md` per HOOK-03 implementation checklist — HOOK-03 script updated to use correct agent name
- memory-categories.json does not exist despite having a schema — SEC-03 handles as WARNING

</specifics>

<deferred>
## Deferred Ideas

- OWASP pattern scanning (eval, innerHTML, SQL concat) — out of scope for v1.2. Could be added to security-scanner agent in future milestone.
- Baseline test tracking (.planning/test-baseline.json) — unnecessary while suite is green. Revisit if test failures become chronic.
- SubagentStop hook for automatic test-verifier trigger — GSD-native invocation is sufficient for v1.2.

</deferred>

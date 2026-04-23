# Requirements: v1.2 Automation & Quality

## Categories

---

### Hook Infrastructure

#### HOOK-01 — Auto-Run Tests on Source Edit

Adds a PostToolUse hook in `.claude/settings.json` that runs the matching Jest test file whenever a file under `src/` is edited. Keeps the test feedback loop immediate without requiring manual invocation. The hook resolves the test path by convention (e.g., `src/foo.js` → `test/foo.test.js`) and runs Jest on that file only.

**Acceptance Criteria:**
- `.claude/settings.json` is created with a PostToolUse hook matching Write and Edit tools
- Hook maps `src/{module}.js` → `test/{module}.test.js` and runs Jest on the matching file; skips silently when no test file is found
- Hook output is visible in the Claude Code terminal (not silently swallowed)
- Hook does not block the tool response — runs as a side effect
- Existing test suite still passes after hook is wired

**Source:** Backlog 999.7

---

#### HOOK-02 — Protected File Edit Guard

Adds a PreToolUse hook in `.claude/settings.json` that blocks any Edit or Write tool call targeting `config/schema/`, `.env*`, or credential files unless the user has explicitly approved. Prevents accidental schema or secret mutation during automated execution waves.

**Acceptance Criteria:**
- `.claude/settings.json` is created (or extended if HOOK-01 creates it first) with a PreToolUse hook on Write and Edit
- Hook blocks edits to `config/schema/**`, `.env`, `.env.*`, and `*credentials*` paths and exits with code 2
- Blocking message identifies which file was blocked and instructs the user how to approve
- Hook does not interfere with reads (Grep, Glob, Read tools are unaffected)
- A manual override path is documented (e.g., bypass comment or explicit user-confirm mechanism)

**Source:** Backlog 999.8

---

#### HOOK-03 — Mandatory Security Scan in Ship Pipeline

Integrates the Security Scanner agent (SEC-01) as a required gate in the `/gsd:ship` pipeline. The scan must pass before a PR is created; any finding at severity HIGH or above blocks the ship and prints a summary.

**Acceptance Criteria:**
- `/gsd:ship` invokes the security scanner agent before creating the PR
- Pipeline halts and prints finding summary if HIGH or CRITICAL issues are detected
- LOW/MEDIUM findings are logged as warnings but do not block
- Scan result is recorded in the PR description or linked artifact
- Pipeline still completes normally when no findings exist

**Source:** Backlog 999.3

---

### Security & Verification

#### SEC-01 — Security Scanner Agent

Creates a read-only Claude Code subagent at `.claude/agents/security-scanner.md` that scans the project for secrets, hardcoded credentials, dependency vulnerabilities, and OAuth scope creep. Agent is invoked by HOOK-03 and can also be run on demand.

**Acceptance Criteria:**
- Agent file exists at `.claude/agents/security-scanner.md` with `tools: Read, Grep, Glob, Bash` (read-only commands only)
- Agent scans for: hardcoded secrets/tokens, `.env` values committed to git, `npm audit` HIGH/CRITICAL vulns, and OAuth scopes exceeding minimum viable permissions
- Agent outputs a structured finding report (severity, file, line, description)
- Agent never modifies files — any write attempt is a test failure
- Agent is invokable standalone via `Use the security-scanner agent`

**Source:** Backlog 999.5

---

#### SEC-02 — Independent Test Verification Gate

Creates a separate verification subagent at `.claude/agents/test-verifier.md` that re-runs the full test suite after any GSD execution phase completes. Agent is independent of the executor — it has no knowledge of what was built and validates outcomes only.

**Acceptance Criteria:**
- Agent file exists at `.claude/agents/test-verifier.md`
- Agent runs the full Jest suite and reports pass/fail counts and any failures with file/line context
- Agent is triggered automatically by `/gsd:verify-work` and can also be invoked manually
- Agent output clearly distinguishes pre-existing failures from new failures (via baseline diff if available)
- A failing verification blocks phase completion in GSD state

**Source:** Backlog 999.2

---

#### SEC-03 — Config/Schema Validation Skill

Creates a Claude Code skill at `.claude/skills/config-validator/` that validates each `config/*.json` file against its corresponding `config/schema/*.schema.json`. Closes both 999.4 (original request) and 999.10 (schema coverage expansion).

**Acceptance Criteria:**
- Skill file exists at `.claude/skills/config-validator/SKILL.md`
- Skill validates all JSON files in `config/` that have a matching schema in `config/schema/`
- Validation uses AJV or equivalent; reports file name, schema name, and validation error with JSON path
- Skill exits cleanly when all configs are valid; exits with non-zero and summary when any fail
- Covers all four existing schemas: `connectors`, `memory-categories`, `pipeline`, `templates`

**Source:** Backlog 999.4, 999.10

---

### Agent & Skill Improvements

#### SKILL-01 — Agent Roster Hardening

Applies four targeted improvements to existing agents without adding new agents. Improvements address: missing tool restrictions, imprecise description trigger language, missing model declarations, and missing output format contracts.

**Acceptance Criteria:**
- Each of the four targeted agents has a documented improvement applied (tool list, description, model field, or output contract)
- No new agent files are created — all changes are edits to existing `.claude/agents/*.md` files
- Descriptions are updated to include explicit "Use when..." trigger language per skill creation standards
- All modified agents specify a `model:` field (not left to default)
- Agent inventory in STATE.md is updated to reflect changes

**Source:** Backlog 999.6

---

#### SKILL-02 — Pipeline Health Check Skill

Creates a `/pipeline-health` skill at `.claude/skills/pipeline-health/SKILL.md` that provides operational visibility into the second-brain pipeline: connector status, scheduler state, vault accessibility, and recent error counts.

**Acceptance Criteria:**
- Skill file exists at `.claude/skills/pipeline-health/SKILL.md`
- Skill checks: MCP connector reachability, `config/pipeline.json` validity, Obsidian Local REST API response, and last-run timestamps from scheduler logs if available
- Output is a structured status table (component, status, last-checked, notes)
- Skill completes in under 30 seconds
- Skill is user-invokable via `/pipeline-health` natural language trigger

**Source:** Backlog 999.9

---

#### SKILL-03 — context7 MCP Integration

Installs the context7 MCP server and creates `.mcp.json` in the project root to make it available to all project sessions. Provides up-to-date library documentation lookups during development.

**Acceptance Criteria:**
- `.mcp.json` exists at project root with context7 server entry
- context7 server is reachable via `/mcp` status check in Claude Code
- MCP tool `resolve-library-id` and `get-library-docs` are available in session
- `.mcp.json` is committed to the repo (not in `.gitignore`)
- Installation steps are documented in a CLAUDE.md update or inline comment in `.mcp.json`

**Source:** Backlog 999.11

---

### CI & Infrastructure

#### CI-01 — CI Coverage Enforcement and Dependency Audit

Adds Jest `--coverage` enforcement and `npm audit` to the CI pipeline. Coverage threshold is set at 90% overall per global CLAUDE.md standard. Audit fails the build on HIGH or CRITICAL vulnerabilities.

**Acceptance Criteria:**
- CI configuration runs `jest --coverage --coverageThreshold` with overall 90% minimum
- `npm audit --audit-level=high` is a required CI step that fails the build on HIGH/CRITICAL findings
- Coverage report artifact is published per CI run
- CI fails fast on audit failure before running tests (audit is cheaper)
- Current test suite meets the coverage threshold before this item is closed

**Source:** Backlog 999.12

---

#### CI-02 — Local LLM Routing for Haiku Classification

Wires the LM Studio local inference server (localhost:1234) as the target for classification tasks currently routed to Claude Haiku. Reduces API cost and latency for high-frequency, low-complexity calls such as input routing and category tagging.

**Acceptance Criteria:**
- Configuration in `config/connectors.json` or equivalent supports an `llm.local` endpoint pointing to `localhost:1234`
- Classification calls (input routing, memory category tagging) use the local endpoint when it is reachable; fall back to Haiku when it is not
- Fallback is explicit (logged, not silent) and does not change output format
- LM Studio model selection is configurable, not hardcoded
- Integration is covered by at least one test that mocks the local endpoint

**Source:** Backlog 999.1

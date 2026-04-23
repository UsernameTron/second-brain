# Phase 8: Hook Infrastructure — Plan

## Overview

Deploy three Claude Code hooks: an auto-test runner (HOOK-01), a protected-file edit guard (HOOK-02), and a security-scan integration stub (HOOK-03). HOOK-01 and HOOK-02 are fully implemented here. HOOK-03 is documented as an integration contract pending Phase 9's SEC-01 agent deployment.

---

## Wave 1 (all tasks parallel-eligible)

### Plan 08-01: Create Hook Scripts and Settings

**Requirement:** HOOK-01, HOOK-02

**Files to create/modify:**
- `.claude/hooks/auto-test.sh` — PostToolUse shell script: maps edited src/ file to its test counterpart, runs Jest if the test file exists
- `.claude/hooks/protected-file-guard.sh` — PreToolUse shell script: blocks edits to protected paths, exits 2 with descriptive message
- `.claude/settings.json` — new file; registers both hooks under PostToolUse and PreToolUse

---

#### Tasks

1. **Create `.claude/hooks/auto-test.sh`**

   Logic:
   - Read JSON from stdin. Parse `tool_input.file_path` using `node -e` inline (no external deps, avoids Python/jq dependency assumptions).
   - Extract file path. If empty or not under `src/`, exit 0 silently.
   - Derive the test path: strip leading path components to get the basename without extension, construct `test/{basename}.test.js`.
   - Check if the test file exists at `$CLAUDE_PROJECT_DIR/test/{basename}.test.js`. If it does not exist, exit 0 silently.
   - If the test file exists, run: `cd "$CLAUDE_PROJECT_DIR" && npx jest --testPathPattern="test/{basename}.test.js" --no-coverage 2>&1`
   - Exit 0 regardless of test result — this hook is a side-effect observer, not a gate. Output is printed for context but does not block.
   - Timeout enforced by settings.json (30s).

   Full script content:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   INPUT=$(cat)

   FILE_PATH=$(node -e "
     try {
       const d = JSON.parse(process.argv[1]);
       const fp = (d.tool_input || {}).file_path || '';
       process.stdout.write(fp);
     } catch(e) { process.stdout.write(''); }
   " "$INPUT" 2>/dev/null || true)

   if [ -z "$FILE_PATH" ]; then
     exit 0
   fi

   # Only act on src/ files
   case "$FILE_PATH" in
     */src/*.js|src/*.js) ;;
     *) exit 0 ;;
   esac

   # Derive basename without extension
   BASENAME=$(basename "$FILE_PATH" .js)

   TEST_FILE="$CLAUDE_PROJECT_DIR/test/${BASENAME}.test.js"

   if [ ! -f "$TEST_FILE" ]; then
     exit 0
   fi

   echo "[auto-test] Running test for ${BASENAME}..."
   cd "$CLAUDE_PROJECT_DIR"
   npx jest --testPathPattern="test/${BASENAME}\\.test\\.js" --no-coverage 2>&1 || true

   exit 0
   ```

2. **Create `.claude/hooks/protected-file-guard.sh`**

   Logic:
   - Read JSON from stdin. Parse `tool_input.file_path` using `node -e` inline.
   - Apply pattern matching against protected path rules:
     - `config/schema/**` — any path containing `config/schema/`
     - `.env` — exact filename `.env`
     - `.env.*` — filename starting with `.env.`
     - `*credentials*` — filename containing the word `credentials`
   - If no pattern matches, exit 0 (allow).
   - If a pattern matches, print a descriptive message to stderr and exit 2 (block).
   - This hook fires on Write and Edit tools only (enforced via matcher in settings.json). It does not interfere with Read.

   Full script content:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   INPUT=$(cat)

   FILE_PATH=$(node -e "
     try {
       const d = JSON.parse(process.argv[1]);
       const fp = (d.tool_input || {}).file_path || '';
       process.stdout.write(fp);
     } catch(e) { process.stdout.write(''); }
   " "$INPUT" 2>/dev/null || true)

   if [ -z "$FILE_PATH" ]; then
     exit 0
   fi

   BASENAME=$(basename "$FILE_PATH")

   # Check: config/schema/** — path segment match
   if echo "$FILE_PATH" | grep -q "config/schema/"; then
     echo "BLOCKED: $FILE_PATH is under config/schema/ — protected configuration schema. Edit requires manual review." >&2
     exit 2
   fi

   # Check: .env (exact basename)
   if [ "$BASENAME" = ".env" ]; then
     echo "BLOCKED: $FILE_PATH is a .env secrets file — protected from automated edits." >&2
     exit 2
   fi

   # Check: .env.* (basename starts with .env.)
   case "$BASENAME" in
     .env.*)
       echo "BLOCKED: $FILE_PATH is a .env.* secrets file — protected from automated edits." >&2
       exit 2
       ;;
   esac

   # Check: *credentials* (basename contains "credentials")
   case "$BASENAME" in
     *credentials*)
       echo "BLOCKED: $FILE_PATH contains 'credentials' in filename — protected from automated edits." >&2
       exit 2
       ;;
   esac

   exit 0
   ```

3. **Create `.claude/settings.json`**

   Register HOOK-01 as PostToolUse on Write|Edit with 30s timeout. Register HOOK-02 as PreToolUse on Write|Edit with 10s timeout. HOOK-03 stub entry is present but commented out (JSON does not support comments — use a placeholder `_disabled` key pattern described in the security-scan-gate.md stub).

   The `_hook03_pending` key at the top level serves as documentation of the deferred hook and is ignored by the Claude Code hook engine.

   Full file content:
   ```json
   {
     "_hook03_pending": "HOOK-03 security-scan-gate — deferred to Phase 9. Requires SEC-01 agent. See .claude/hooks/security-scan-gate.md for integration contract.",
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "Write|Edit",
           "hooks": [
             {
               "type": "command",
               "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/auto-test.sh",
               "timeout": 30
             }
           ]
         }
       ],
       "PreToolUse": [
         {
           "matcher": "Write|Edit",
           "hooks": [
             {
               "type": "command",
               "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/protected-file-guard.sh",
               "timeout": 10
             }
           ]
         }
       ]
     }
   }
   ```

4. **Make hook scripts executable**

   Run: `chmod +x .claude/hooks/auto-test.sh .claude/hooks/protected-file-guard.sh`

---

#### Verification

**HOOK-01 (auto-test):**
- Edit `src/classifier.js` (has matching test). Confirm Claude output shows `[auto-test] Running test for classifier...` and Jest output appears inline.
- Edit `src/vault-gateway.js` (has matching test). Confirm test runs.
- Edit a file with no matching test (e.g., `src/utils/some-util.js` if test absent). Confirm silent exit — no output, no error.
- Edit a non-src file (e.g., `README.md`). Confirm no test runs.

**HOOK-02 (protected-file-guard):**
- Attempt to write `.env`. Confirm Claude reports blocked with descriptive message, edit does not proceed.
- Attempt to write `.env.production`. Confirm blocked.
- Attempt to write `config/schema/memory.schema.json`. Confirm blocked.
- Attempt to write `my-credentials.json`. Confirm blocked.
- Read `.env` (Read tool). Confirm hook does NOT fire (matcher is Write|Edit only).
- Write `src/classifier.js`. Confirm edit proceeds normally (not a protected path).

**settings.json:**
- Confirm file is valid JSON: `node -e "require('./.claude/settings.json')"` — exits 0.
- Confirm hook scripts are executable: `ls -l .claude/hooks/auto-test.sh .claude/hooks/protected-file-guard.sh`

---

### Plan 08-02: HOOK-03 Integration Point (Stub)

**Requirement:** HOOK-03

**Note:** SEC-01 (Security Scanner Agent) does not yet exist — it is planned for Phase 9. This task documents the integration contract so Phase 9 can implement without ambiguity.

**Files to create:**
- `.claude/hooks/security-scan-gate.md` — integration spec and contract for Phase 9

---

#### Tasks

1. **Create `.claude/hooks/security-scan-gate.md`**

   Document the following:

   **Hook identity:**
   - Event: `PreToolUse` (fires before the ship pipeline executes)
   - Matcher: `Bash` — specifically intercepts `Bash` commands matching the ship/push pattern (e.g., `git push`, `gh pr create`)
   - Type: `command`
   - Timeout: 60s (security scan may run multiple checks)
   - Script path: `.claude/hooks/security-scan-gate.sh` (to be created in Phase 9)

   **Triggering condition:**
   - The hook fires on any Bash tool use. The script is responsible for inspecting `tool_input.command` from stdin JSON and determining whether it matches a ship action. If it does not match, the script exits 0 immediately (no-op). This avoids a separate matcher per git command variant.
   - Ship commands to match: `git push`, `gh pr create`, `gh pr merge`, `npx semantic-release`, any command containing `push` and a remote ref.

   **SEC-01 invocation contract:**
   - The hook script will invoke the SEC-01 agent (once deployed) by calling `claude --agent sec-01 --non-interactive --input "$SCAN_PAYLOAD"` or equivalent.
   - SEC-01 must return a JSON result on stdout: `{"pass": true|false, "findings": [...], "blocking": [...]}`.
   - If `blocking` array is non-empty, the hook exits 2 and prints findings to stderr.
   - If `pass` is true and `blocking` is empty, exit 0.

   **SEC-01 expected capabilities (Phase 9 contract):**
   - Scan staged changes for secrets (API keys, tokens, credentials patterns)
   - Run `npm audit --audit-level=high` and surface critical/high findings
   - Check that no file in the protected list (`.env`, `.env.*`, `config/schema/**`, `*credentials*`) appears in `git diff --staged --name-only`
   - Produce structured JSON output conforming to the contract above

   **settings.json entry (to be added in Phase 9):**
   ```json
   {
     "matcher": "Bash",
     "hooks": [
       {
         "type": "command",
         "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/security-scan-gate.sh",
         "timeout": 60
       }
     ]
   }
   ```
   This entry is added to the `PreToolUse` array alongside the existing protected-file-guard hook.

   **Phase 9 implementation checklist:**
   - Deploy SEC-01 agent to `.claude/agents/sec-01.md`
   - Create `.claude/hooks/security-scan-gate.sh` per contract above
   - Add `PreToolUse` Bash entry to `.claude/settings.json`
   - Verify: attempt `git push` with a staged `.env` — confirm block. Attempt clean push — confirm pass.

---

#### Verification

- File `.claude/hooks/security-scan-gate.md` exists and is committed.
- Document is complete: contains hook identity, triggering condition, SEC-01 invocation contract, expected capabilities, settings.json stub entry, and Phase 9 checklist.
- No script is created — stub is documentation only.

---

## Phase Acceptance Criteria

- [ ] `.claude/hooks/auto-test.sh` exists, is executable, passes smoke tests for HOOK-01
- [ ] `.claude/hooks/protected-file-guard.sh` exists, is executable, blocks all four protected path patterns
- [ ] `.claude/settings.json` is valid JSON and registers both hooks correctly
- [ ] Editing a protected path via Write or Edit is blocked with a descriptive stderr message
- [ ] Editing a src/ file with a matching test triggers silent Jest run as side effect
- [ ] Editing a src/ file without a matching test produces no output or error
- [ ] Read tool is never blocked by the protected-file-guard hook
- [ ] `.claude/hooks/security-scan-gate.md` documents the full HOOK-03 integration contract
- [ ] No Phase 9 artifacts are created prematurely

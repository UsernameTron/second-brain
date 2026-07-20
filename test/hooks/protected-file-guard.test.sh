#!/usr/bin/env bash
set -euo pipefail

# ── Test harness for .claude/hooks/protected-file-guard.sh ────────────────────
# Phase 16 (D-03a). Pattern matches test/hooks/security-scan-gate.test.sh
# from Phase 12 — simple bash assertions, no bats-core dependency.
#
# Runs the hook with JSON inputs on stdin, asserts exit codes and stderr.
# Usage: bash test/hooks/protected-file-guard.test.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOK="$PROJECT_DIR/.claude/hooks/protected-file-guard.sh"

if [ ! -x "$HOOK" ] && [ ! -f "$HOOK" ]; then
  echo "FAIL: hook not found at $HOOK"
  exit 1
fi

PASS=0
FAIL=0

# Invoke hook with JSON on stdin; capture exit code + stderr to separate files.
run_hook() {
  local json="$1" stderr_file="$2"
  echo "$json" | bash "$HOOK" 2>"$stderr_file"
}

assert_exit() {
  local test_name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $test_name (exit $actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name — expected exit $expected, got $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_stderr_contains() {
  local test_name="$1" pattern="$2" stderr_file="$3"
  if grep -q "$pattern" "$stderr_file"; then
    echo "  PASS: $test_name (stderr contains '$pattern')"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name — stderr missing '$pattern' (got: $(cat "$stderr_file"))"
    FAIL=$((FAIL + 1))
  fi
}

assert_stderr_empty() {
  local test_name="$1" stderr_file="$2"
  if [ ! -s "$stderr_file" ]; then
    echo "  PASS: $test_name (stderr empty)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name — expected empty stderr, got: $(cat "$stderr_file")"
    FAIL=$((FAIL + 1))
  fi
}

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

echo "== protected-file-guard.sh tests =="

# ── 1. Passing cases (exit 0) ────────────────────────────────────────────────

echo "Test 1: regular src/ file passes through"
STDERR="$WORK_DIR/err1.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"src/classifier.js"}}' "$STDERR" || EXIT=$?
assert_exit "regular src file" 0 "$EXIT"
assert_stderr_empty "regular src file stderr empty" "$STDERR"

echo "Test 2: missing file_path exits 0 (no-op)"
STDERR="$WORK_DIR/err2.txt"
EXIT=0
run_hook '{"tool_input":{}}' "$STDERR" || EXIT=$?
assert_exit "missing file_path" 0 "$EXIT"

echo "Test 3: malformed JSON input exits 0 (node parse fails, treated as empty)"
STDERR="$WORK_DIR/err3.txt"
EXIT=0
run_hook 'not valid json' "$STDERR" || EXIT=$?
assert_exit "malformed JSON" 0 "$EXIT"

# ── 2. config/schema/** blocks (exit 2) ──────────────────────────────────────

echo "Test 4: config/schema/ path blocks"
STDERR="$WORK_DIR/err4.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"config/schema/pipeline.schema.json"}}' "$STDERR" || EXIT=$?
assert_exit "config/schema/ block" 2 "$EXIT"
assert_stderr_contains "schema block message" "protected configuration schema" "$STDERR"

echo "Test 5: nested config/schema/ path blocks"
STDERR="$WORK_DIR/err5.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"/Users/foo/proj/config/schema/vault-paths.schema.json"}}' "$STDERR" || EXIT=$?
assert_exit "nested config/schema/ block" 2 "$EXIT"

# ── 3. .env blocks (exit 2) ──────────────────────────────────────────────────

echo "Test 6: .env exact basename blocks"
STDERR="$WORK_DIR/err6.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"/some/path/.env"}}' "$STDERR" || EXIT=$?
assert_exit ".env block" 2 "$EXIT"
assert_stderr_contains ".env block message" "\.env secrets file" "$STDERR"

echo "Test 7: .env.local blocks (.env.* pattern)"
STDERR="$WORK_DIR/err7.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":".env.local"}}' "$STDERR" || EXIT=$?
assert_exit ".env.local block" 2 "$EXIT"
assert_stderr_contains ".env.local block message" "\.env\.\* secrets file" "$STDERR"

echo "Test 8: .env.production blocks (.env.* pattern)"
STDERR="$WORK_DIR/err8.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"/proj/.env.production"}}' "$STDERR" || EXIT=$?
assert_exit ".env.production block" 2 "$EXIT"

# ── 4. credentials blocks (exit 2) ───────────────────────────────────────────

echo "Test 9: credentials in basename blocks"
STDERR="$WORK_DIR/err9.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"/config/credentials.json"}}' "$STDERR" || EXIT=$?
assert_exit "credentials.json block" 2 "$EXIT"
assert_stderr_contains "credentials block message" "contains 'credentials'" "$STDERR"

echo "Test 10: api-credentials suffix blocks"
STDERR="$WORK_DIR/err10.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"secrets/api-credentials.yaml"}}' "$STDERR" || EXIT=$?
assert_exit "api-credentials block" 2 "$EXIT"

# ── 5. Negative cases: credentials substring not in basename ─────────────────

echo "Test 11: credentials in parent dir only does NOT block"
STDERR="$WORK_DIR/err11.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"/path/credentials/readme.md"}}' "$STDERR" || EXIT=$?
assert_exit "credentials dir only" 0 "$EXIT"

echo "Test 12: env in filename (not .env) does NOT block"
STDERR="$WORK_DIR/err12.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"src/env-helper.js"}}' "$STDERR" || EXIT=$?
assert_exit "env in filename not blocked" 0 "$EXIT"

# ── 6. Bash writes to protected paths (the Edit-only bypass) ─────────────────
# The guard originally read tool_input.file_path only, so `echo x > .env` via
# Bash reached protected files that Edit could not touch.

bash_case() {
  local n="$1" desc="$2" cmd="$3" expected="$4"
  local json stderr_file="$WORK_DIR/errb$n.txt" EXIT=0
  json=$(node -e 'process.stdout.write(JSON.stringify({tool_input:{command:process.argv[1]}}))' "$cmd")
  echo "Bash test $n: $desc"
  run_hook "$json" "$stderr_file" || EXIT=$?
  assert_exit "$desc" "$expected" "$EXIT"
}

# Must BLOCK — writes reaching a protected path
bash_case 1 'redirect into config/schema/'   'echo pwned > config/schema/pipeline.schema.json' 2
bash_case 2 'append into .env'               'echo TOKEN=x >> .env'                            2
bash_case 3 'sed -i on .env'                 "sed -i '' 's/a/b/' .env"                         2
bash_case 4 'cp onto config/schema/'         'cp /tmp/x config/schema/a.json'                  2
bash_case 5 'tee into .env.local'            'tee .env.local < /tmp/y'                         2
bash_case 6 'mv onto a credentials file'     'mv /tmp/c my-credentials.json'                   2

# Must ALLOW — reads and unrelated commands must not regress ergonomics
bash_case 7  'plain read of a schema'        'cat config/schema/pipeline.schema.json'          0
bash_case 8  'read with stderr redirect'     'cat config/schema/x.json 2>/dev/null'            0
bash_case 9  'grep an env example'           'grep foo .env.example'                           0
bash_case 10 'unrelated redirect'            'npx jest > out.txt 2>&1'                         0
bash_case 11 'read after a redirect+&&'      'npx jest > o.txt 2>&1 && cat config/schema/a.json' 0
bash_case 12 'ordinary command'              'npm run lint'                                    0

# Edit path must still block — the original guarantee is intact
echo "Bash test 13: Edit to config/schema/ still blocks"
STDERR="$WORK_DIR/errb13.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"config/schema/pipeline.schema.json"}}' "$STDERR" || EXIT=$?
assert_exit "Edit still blocked" 2 "$EXIT"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "=== Summary ==="
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

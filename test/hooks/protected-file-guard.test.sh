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

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "=== Summary ==="
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

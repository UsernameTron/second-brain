#!/usr/bin/env bash
set -euo pipefail

# ── Test harness for .claude/hooks/auto-test.sh ──────────────────────────────
# Phase 16 (D-03a). The auto-test hook is observer-only — it always exits 0.
# These tests verify the matcher logic (only src/*.js paths trigger tests)
# and the test-file existence guard (no test file → skip silently).
#
# Usage: bash test/hooks/auto-test.test.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOK="$PROJECT_DIR/.claude/hooks/auto-test.sh"

if [ ! -f "$HOOK" ]; then
  echo "FAIL: hook not found at $HOOK"
  exit 1
fi

PASS=0
FAIL=0

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# Set up a fake project dir with matching + missing test files
export CLAUDE_PROJECT_DIR="$WORK_DIR/project"
mkdir -p "$CLAUDE_PROJECT_DIR/test"
mkdir -p "$CLAUDE_PROJECT_DIR/src"
# A test file that exists → matching trigger
cat > "$CLAUDE_PROJECT_DIR/test/has-test.test.js" <<'EOF'
test('stub', () => { expect(1).toBe(1); });
EOF
# No test file for "no-test" basename

# Stub npx so we don't actually run jest
MOCK_BIN="$WORK_DIR/mock-bin"
mkdir -p "$MOCK_BIN"
cat > "$MOCK_BIN/npx" <<'EOF'
#!/usr/bin/env bash
# Record invocation, always succeed
echo "$@" > "$CLAUDE_PROJECT_DIR/.npx-call"
exit 0
EOF
chmod +x "$MOCK_BIN/npx"

ORIG_PATH="$PATH"
export PATH="$MOCK_BIN:$PATH"

run_hook() {
  local json="$1" stdout_file="$2"
  echo "$json" | bash "$HOOK" >"$stdout_file" 2>&1
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

assert_file_absent() {
  local test_name="$1" file="$2"
  if [ ! -f "$file" ]; then
    echo "  PASS: $test_name (file absent)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name — expected $file to be absent"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_present() {
  local test_name="$1" file="$2"
  if [ -f "$file" ]; then
    echo "  PASS: $test_name (file present)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name — expected $file to be present"
    FAIL=$((FAIL + 1))
  fi
}

# Reset between tests
reset_npx_trace() { rm -f "$CLAUDE_PROJECT_DIR/.npx-call"; }

echo "== auto-test.sh tests =="

# ── 1. No file_path → exit 0, no action ──────────────────────────────────────

echo "Test 1: missing file_path exits 0, does not invoke npx"
reset_npx_trace
STDOUT="$WORK_DIR/out1.txt"
EXIT=0
run_hook '{"tool_input":{}}' "$STDOUT" || EXIT=$?
assert_exit "no file_path" 0 "$EXIT"
assert_file_absent "no file_path → no npx call" "$CLAUDE_PROJECT_DIR/.npx-call"

echo "Test 2: malformed JSON exits 0, does not invoke npx"
reset_npx_trace
STDOUT="$WORK_DIR/out2.txt"
EXIT=0
run_hook 'not json' "$STDOUT" || EXIT=$?
assert_exit "malformed JSON" 0 "$EXIT"
assert_file_absent "malformed JSON → no npx call" "$CLAUDE_PROJECT_DIR/.npx-call"

# ── 2. Non-src files → exit 0, no action ─────────────────────────────────────

echo "Test 3: test/ file does not trigger (matcher only acts on src/)"
reset_npx_trace
STDOUT="$WORK_DIR/out3.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"test/has-test.test.js"}}' "$STDOUT" || EXIT=$?
assert_exit "test/ file skipped" 0 "$EXIT"
assert_file_absent "test/ file → no npx call" "$CLAUDE_PROJECT_DIR/.npx-call"

echo "Test 4: docs/ file does not trigger"
reset_npx_trace
STDOUT="$WORK_DIR/out4.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"docs/readme.md"}}' "$STDOUT" || EXIT=$?
assert_exit "docs/ file skipped" 0 "$EXIT"
assert_file_absent "docs/ file → no npx call" "$CLAUDE_PROJECT_DIR/.npx-call"

echo "Test 5: non-.js src file does not trigger"
reset_npx_trace
STDOUT="$WORK_DIR/out5.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"src/schema.json"}}' "$STDOUT" || EXIT=$?
assert_exit "non-js src file skipped" 0 "$EXIT"
assert_file_absent "non-js src file → no npx call" "$CLAUDE_PROJECT_DIR/.npx-call"

# ── 3. src/ file without matching test → exit 0, no action ───────────────────

echo "Test 6: src/ file without matching test exits 0, does not invoke npx"
reset_npx_trace
STDOUT="$WORK_DIR/out6.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"src/no-test.js"}}' "$STDOUT" || EXIT=$?
assert_exit "missing test file skipped" 0 "$EXIT"
assert_file_absent "missing test file → no npx call" "$CLAUDE_PROJECT_DIR/.npx-call"

# ── 4. src/ file WITH matching test → exit 0, npx invoked ────────────────────

echo "Test 7: src/ file with matching test invokes npx jest"
reset_npx_trace
STDOUT="$WORK_DIR/out7.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"src/has-test.js"}}' "$STDOUT" || EXIT=$?
assert_exit "matching test triggers" 0 "$EXIT"
assert_file_present "matching test → npx invoked" "$CLAUDE_PROJECT_DIR/.npx-call"

echo "Test 8: absolute src/ path with matching test invokes npx"
reset_npx_trace
STDOUT="$WORK_DIR/out8.txt"
EXIT=0
run_hook '{"tool_input":{"file_path":"/Users/foo/proj/src/has-test.js"}}' "$STDOUT" || EXIT=$?
assert_exit "absolute src path triggers" 0 "$EXIT"
assert_file_present "absolute src path → npx invoked" "$CLAUDE_PROJECT_DIR/.npx-call"

# Restore PATH
export PATH="$ORIG_PATH"

echo ""
echo "=== Summary ==="
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

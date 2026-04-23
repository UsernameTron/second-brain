#!/usr/bin/env bash
set -euo pipefail

# ── Test harness for .claude/hooks/security-scan-gate.sh ──────────────────────
# Runs the hook with mock inputs, asserts exit codes and log entries.
# Usage: bash test/hooks/security-scan-gate.test.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOK="$PROJECT_DIR/.claude/hooks/security-scan-gate.sh"

# Temp workspace for mocks and logs
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# Set up fake project dir with .cache for logs
export CLAUDE_PROJECT_DIR="$WORK_DIR/project"
mkdir -p "$CLAUDE_PROJECT_DIR/.cache"

# Initialize a git repo so git diff --cached works
(cd "$CLAUDE_PROJECT_DIR" && git init -q && git commit --allow-empty -q -m "init")

# Save original PATH for restoration
ORIG_PATH="$PATH"

# Create mock bin directory
MOCK_BIN="$WORK_DIR/mock-bin"
mkdir -p "$MOCK_BIN"

PASS=0
FAIL=0

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

assert_log_contains() {
  local test_name="$1" pattern="$2" log_file="$CLAUDE_PROJECT_DIR/.cache/security-scan-log.jsonl"
  if [ -f "$log_file" ] && grep -q "$pattern" "$log_file"; then
    echo "  PASS: $test_name (log contains '$pattern')"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name — log missing '$pattern'"
    FAIL=$((FAIL + 1))
  fi
}

assert_no_log() {
  local test_name="$1" log_file="$CLAUDE_PROJECT_DIR/.cache/security-scan-log.jsonl"
  if [ ! -f "$log_file" ] || [ ! -s "$log_file" ]; then
    echo "  PASS: $test_name (no log entry)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name — expected no log entry but file exists with content"
    FAIL=$((FAIL + 1))
  fi
}

reset_log() {
  rm -f "$CLAUDE_PROJECT_DIR/.cache/security-scan-log.jsonl"
}

# ── Test 1: Non-ship command → exit 0, no log ────────────────────────────────
echo "Test 1: Non-ship command passes through"
reset_log

EXIT_CODE=0
echo '{"tool_input":{"command":"git status"}}' | bash "$HOOK" 2>/dev/null || EXIT_CODE=$?

assert_exit "non-ship exits 0" 0 "$EXIT_CODE"
assert_no_log "non-ship produces no log"

# ── Test 2: Ship command + clean agent JSON → exit 0, scan-complete log ───────
echo ""
echo "Test 2: Ship command with clean agent scan"
reset_log

# Create mock claude that returns clean JSON
cat > "$MOCK_BIN/claude" << 'MOCK'
#!/usr/bin/env bash
echo '{"pass":true,"findings":[],"blocking":[]}'
exit 0
MOCK
chmod +x "$MOCK_BIN/claude"

EXIT_CODE=0
export PATH="$MOCK_BIN:$ORIG_PATH"
echo '{"tool_input":{"command":"git push origin main"}}' | bash "$HOOK" 2>/dev/null || EXIT_CODE=$?
export PATH="$ORIG_PATH"

assert_exit "clean scan exits 0" 0 "$EXIT_CODE"
assert_log_contains "clean scan logs scan-complete" "scan-complete"

# ── Test 3: Ship command + agent failure → grep fallback → exit 0 ─────────────
echo ""
echo "Test 3: Ship command with agent failure, grep fallback (no secrets)"
reset_log

# Mock claude that fails
cat > "$MOCK_BIN/claude" << 'MOCK'
#!/usr/bin/env bash
echo "Error: agent not found" >&2
exit 1
MOCK
chmod +x "$MOCK_BIN/claude"

EXIT_CODE=0
export PATH="$MOCK_BIN:$ORIG_PATH"
echo '{"tool_input":{"command":"git push origin main"}}' | bash "$HOOK" 2>/dev/null || EXIT_CODE=$?
export PATH="$ORIG_PATH"

assert_exit "agent failure with clean diff exits 0" 0 "$EXIT_CODE"
assert_log_contains "agent failure logs agent-fallback" "agent-fallback"

# ── Test 4: Ship command + agent failure + .env staged → exit 2 ───────────────
echo ""
echo "Test 4: Ship command with agent failure and .env staged"
reset_log

# Stage a .env file in the mock git repo
echo "SECRET=value" > "$CLAUDE_PROJECT_DIR/.env"
(cd "$CLAUDE_PROJECT_DIR" && git add .env)

EXIT_CODE=0
export PATH="$MOCK_BIN:$ORIG_PATH"
echo '{"tool_input":{"command":"git push origin main"}}' | bash "$HOOK" 2>/dev/null || EXIT_CODE=$?
export PATH="$ORIG_PATH"

assert_exit ".env staged exits 2" 2 "$EXIT_CODE"
assert_log_contains ".env staged logs agent-fallback" "agent-fallback"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════"
echo "Results: $PASS passed, $FAIL failed"
echo "══════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

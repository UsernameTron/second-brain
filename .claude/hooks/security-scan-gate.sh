#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)

# Extract the bash command from tool input
COMMAND=$(node -e "
  try {
    const d = JSON.parse(process.argv[1]);
    const cmd = (d.tool_input || {}).command || '';
    process.stdout.write(cmd);
  } catch(e) { process.stdout.write(''); }
" "$INPUT" 2>/dev/null || true)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only gate ship commands
IS_SHIP=false
case "$COMMAND" in
  *"git push"*) IS_SHIP=true ;;
  *"gh pr create"*) IS_SHIP=true ;;
  *"gh pr merge"*) IS_SHIP=true ;;
  *"npx semantic-release"*) IS_SHIP=true ;;
esac

if [ "$IS_SHIP" != "true" ]; then
  exit 0
fi

echo "[security-scan-gate] Ship command detected. Running security scan..." >&2

# Invoke security-scanner agent with prompt argument
SCAN_RESULT=$(cd "$CLAUDE_PROJECT_DIR" && claude --agent security-scanner --print "Scan staged changes for secrets, dependency vulnerabilities, and protected file mutations. Return JSON only." 2>&1)
SCAN_EXIT=$?

# If agent failed or result is not valid JSON, fall back to grep-based scan
if [ $SCAN_EXIT -ne 0 ] || ! echo "$SCAN_RESULT" | node -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))" 2>/dev/null; then
  echo "[security-scan-gate] Agent failed (exit $SCAN_EXIT). Running grep-based fallback..." >&2

  # Grep staged diff for secret patterns
  STAGED_DIFF=$(cd "$CLAUDE_PROJECT_DIR" && git diff --cached 2>/dev/null || true)
  GREP_BLOCKED=false

  if echo "$STAGED_DIFF" | grep -qE 'AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}'; then
    echo "[security-scan-gate] GREP FALLBACK: Possible secret pattern found in staged changes" >&2
    GREP_BLOCKED=true
  fi

  STAGED_FILES=$(cd "$CLAUDE_PROJECT_DIR" && git diff --cached --name-only 2>/dev/null || true)
  if echo "$STAGED_FILES" | grep -qE '(^|/)\.env($|\.)'; then
    echo "[security-scan-gate] GREP FALLBACK: .env file staged" >&2
    GREP_BLOCKED=true
  fi

  # Log the agent failure
  LOG_DIR="$CLAUDE_PROJECT_DIR/.cache"
  mkdir -p "$LOG_DIR"
  echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"event\":\"agent-fallback\",\"exit\":$SCAN_EXIT,\"grep_blocked\":$GREP_BLOCKED}" >> "$LOG_DIR/security-scan-log.jsonl"

  if [ "$GREP_BLOCKED" = "true" ]; then
    exit 2
  fi
  echo "[security-scan-gate] Agent failed but grep fallback found nothing suspicious. Allowing." >&2
  exit 0
fi

# Extract blocking array length and report
HAS_BLOCKING=$(node -e "
  try {
    const r = JSON.parse(process.argv[1]);
    const b = r.blocking || [];
    if (b.length > 0) {
      console.error('[security-scan-gate] BLOCKED — ' + b.length + ' blocking finding(s):');
      b.forEach(f => console.error('  ' + f.severity + ': ' + (f.file || '(no file)') + (f.line ? ':' + f.line : '') + ' — ' + f.description));
      process.stdout.write('blocked');
    } else {
      const f = r.findings || [];
      if (f.length > 0) {
        console.error('[security-scan-gate] Passed with ' + f.length + ' warning(s):');
        f.forEach(w => console.error('  ' + w.severity + ': ' + w.description));
      } else {
        console.error('[security-scan-gate] Clean — no findings.');
      }
      process.stdout.write('pass');
    }
  } catch(e) {
    console.error('[security-scan-gate] Failed to parse scan result: ' + e.message);
    process.stdout.write('blocked');
  }
" "$SCAN_RESULT" 2>&1 || echo "blocked")

# Log successful scan
LOG_DIR="$CLAUDE_PROJECT_DIR/.cache"
mkdir -p "$LOG_DIR"
FINDING_COUNT=$(echo "$SCAN_RESULT" | node -e "try{const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String((r.blocking||[]).length+(r.findings||[]).length))}catch{process.stdout.write('0')}" 2>/dev/null || echo "0")
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"event\":\"scan-complete\",\"exit\":0,\"findings\":$FINDING_COUNT,\"blocked\":\"$HAS_BLOCKING\"}" >> "$LOG_DIR/security-scan-log.jsonl"

if [ "$HAS_BLOCKING" = "blocked" ]; then
  exit 2
fi

exit 0

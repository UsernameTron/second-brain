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

# Invoke security-scanner agent
SCAN_RESULT=$(cd "$CLAUDE_PROJECT_DIR" && claude --agent security-scanner --print 2>/dev/null || echo '{"pass":false,"blocking":[{"severity":"CRITICAL","file":"","line":0,"description":"Security scanner agent failed to execute"}]}')

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
" "$SCAN_RESULT" 2>&2 || echo "blocked")

if [ "$HAS_BLOCKING" = "blocked" ]; then
  exit 2
fi

exit 0

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

COMMAND=$(node -e "
  try {
    const d = JSON.parse(process.argv[1]);
    const cmd = (d.tool_input || {}).command || '';
    process.stdout.write(cmd);
  } catch(e) { process.stdout.write(''); }
" "$INPUT" 2>/dev/null || true)

# ── Bash writes to protected paths ───────────────────────────────────────────
# The file_path checks below only see Edit/Write. A Bash call reaches the same
# files (`echo x > .env`, `sed -i`, `cp` onto a target), so gate those too.
#
# HEURISTIC, not a security boundary: matches a write verb followed by a
# protected path in the same command segment. Indirection defeats it —
# `P=.env; echo x > $P` is NOT caught. This stops naive and accidental writes;
# it is not a sandbox.
if [ -z "$FILE_PATH" ] && [ -n "$COMMAND" ]; then
  PROTECTED='(config/schema/|\.env|credentials)'
  SEG='[^;|&]*'

  # Redirection (> or >>) pointing at a protected path. Reads are unaffected:
  # in `cat config/schema/x.json 2>/dev/null` the path precedes the redirect.
  if echo "$COMMAND" | grep -Eq ">>?[[:space:]]*${SEG}${PROTECTED}"; then
    echo "BLOCKED: Bash command redirects into a protected path (config/schema/, .env*, *credentials*). Write requires manual review." >&2
    exit 2
  fi

  # In-place / copy-style writes targeting a protected path.
  if echo "$COMMAND" | grep -Eq "(^|[[:space:];|&(])(tee|sed[[:space:]]+-i|mv|cp|dd|truncate|install)[[:space:]]${SEG}${PROTECTED}"; then
    echo "BLOCKED: Bash command writes to a protected path (config/schema/, .env*, *credentials*). Write requires manual review." >&2
    exit 2
  fi
fi

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

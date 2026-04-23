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

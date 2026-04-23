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
npx jest --testPathPatterns="test/${BASENAME}\\.test\\.js" --no-coverage 2>&1 || true

exit 0

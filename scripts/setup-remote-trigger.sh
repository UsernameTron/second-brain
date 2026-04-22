#!/usr/bin/env bash
set -euo pipefail

# Setup script for second-brain daily briefing RemoteTrigger
# Run this once to create the trigger. Enable manually after verification.
#
# Prerequisites:
#   - ANTHROPIC_API_KEY environment variable set
#   - Environment ID verified (env_01TjBJLSRwHfpUPcNVUK99Kb)
#   - Google Calendar MCP connector configured (f94e7416-...)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../config/scheduling.json"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ERROR: ANTHROPIC_API_KEY not set. Get it from https://console.anthropic.com/"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required. Install via: brew install jq"
  exit 1
fi

echo "Creating RemoteTrigger: second-brain-daily-briefing"
echo "Schedule: 45 11 * * 1-5 (UTC) = 6:45 AM CDT weekdays"
echo "Enabled: false (enable manually after testing)"
echo ""

curl -s -X POST https://api.anthropic.com/v1/triggers \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2025-01-01" \
  -d @- <<'PAYLOAD' | jq .
{
  "name": "second-brain-daily-briefing",
  "schedule": "45 11 * * 1-5",
  "model": "claude-sonnet-4-6",
  "environment_id": "env_01TjBJLSRwHfpUPcNVUK99Kb",
  "sources": [{"type": "github", "url": "https://github.com/UsernameTron/second-brain"}],
  "mcp_connections": [{"connector_uuid": "f94e7416-4e60-44bc-9ed2-45fa49a68665"}],
  "persist_session": false,
  "enabled": false,
  "prompt": "You are running the second-brain daily briefing. Read CLAUDE.md first. Then run the /today command by executing: node -e \"require('./src/today-command').runToday({ mode: 'scheduled' }).then(r => console.log(r.briefing || r.error))\". Report the output."
}
PAYLOAD

echo ""
echo "Trigger created (disabled). To enable:"
echo "  1. Verify /today works: node -e \"require('./src/today-command').runToday({ mode: 'dry-run' }).then(r => console.log(r.briefing))\""
echo "  2. Enable at https://claude.ai/code/scheduled"
echo "  3. Or via API: curl -X PATCH .../triggers/{id} -d '{\"enabled\": true}'"

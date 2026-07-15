#!/usr/bin/env node
'use strict';

/**
 * staleness-check.js
 *
 * Claude Code SessionStart hook (REQ-CTX-01). Warns when the project
 * CLAUDE.md `> Last verified:` status date is more than 14 days stale.
 * Never blocks a session — always exits 0.
 *
 * Registration in settings.json:
 * "hooks": {
 *   "SessionStart": [{ "hooks": [{ "command": "node .claude/hooks/staleness-check.js" }] }]
 * }
 */

const fs = require('fs');
const path = require('path');

const LAST_VERIFIED_RE = /^>\s*Last verified:\s*(\d{4}-\d{2}-\d{2})/m;
const STALE_THRESHOLD_DAYS = 14;

/**
 * @param {string} claudeMdContent
 * @param {Date} now
 * @returns {string|null} warning message, or null if fresh
 */
function checkStaleness(claudeMdContent, now) {
  const match = LAST_VERIFIED_RE.exec(claudeMdContent || '');
  if (!match) {
    return "[staleness] CLAUDE.md has no parseable 'Last verified:' date — a status block without a verifiable date is stale by definition. Run /gsd:sync-docs.";
  }

  const date = match[1];
  const parsedDate = new Date(date);
  const ageDays = Math.floor((now - parsedDate) / 86400000);

  if (ageDays > STALE_THRESHOLD_DAYS) {
    return '[staleness] CLAUDE.md status block is ' + ageDays + ' days stale (Last verified: ' + date + '). Run /gsd:sync-docs to refresh.';
  }

  return null;
}

if (require.main === module) {
  let content;
  try {
    const claudeMdPath = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'CLAUDE.md');
    content = fs.readFileSync(claudeMdPath, 'utf8');
  } catch (_) {
    content = '';
  }

  const message = checkStaleness(content, new Date());
  if (message) {
    process.stdout.write(message + '\n');
  }

  process.exit(0);
}

module.exports = { checkStaleness };

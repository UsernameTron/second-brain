'use strict';

/**
 * staleness-check.test.js
 *
 * Tests for .claude/hooks/staleness-check.js — REQ-CTX-01 SessionStart
 * staleness warning. Pure-function assertions against a fixed `now`.
 */

const { checkStaleness } = require('../.claude/hooks/staleness-check');

const NOW = new Date('2026-07-15T12:00:00.000Z');

function fixture(date) {
  return `# Project\n\n> Last verified: ${date}  <!-- refresh at each /gsd:sync-docs -->\n\nBody.\n`;
}

describe('checkStaleness', () => {
  test('fresh date (0 days old) returns null', () => {
    expect(checkStaleness(fixture('2026-07-15'), NOW)).toBeNull();
  });

  test('exactly 14 days old returns null (boundary, not stale)', () => {
    expect(checkStaleness(fixture('2026-07-01'), NOW)).toBeNull();
  });

  test('15 days old returns a warning naming CLAUDE.md and the age', () => {
    const msg = checkStaleness(fixture('2026-06-30'), NOW);
    expect(msg).not.toBeNull();
    expect(msg).toContain('15 days');
    expect(msg).toContain('CLAUDE.md');
    expect(msg).toContain('/gsd:sync-docs');
  });

  test('77 days old returns a warning (historical audit case)', () => {
    const msg = checkStaleness(fixture('2026-04-29'), NOW);
    expect(msg).not.toBeNull();
    expect(msg).toContain('77 days');
  });

  test('missing "Last verified:" line returns a warning and never throws', () => {
    const msg = checkStaleness('# Project\n\nNo status block here.\n', NOW);
    expect(msg).not.toBeNull();
    expect(msg).toContain('no parseable');
    expect(msg).toContain('/gsd:sync-docs');
  });

  test('empty/undefined content is treated as unparseable', () => {
    expect(checkStaleness('', NOW)).not.toBeNull();
    expect(checkStaleness(undefined, NOW)).not.toBeNull();
  });
});

'use strict';

/**
 * style-policy.test.js
 *
 * Tests for src/style-policy.js
 * Guards: style lint with banned word extraction, attemptCount enforcement,
 * and createVaultWriter wrapper.
 */

// ── Style guide fixture (matches real anti-ai-writing-style.md table format) ──
const STYLE_GUIDE_FIXTURE = `# Anti-AI Writing Style Guide

## Banned Words — Never Use These

| Word/Phrase | Why Banned |
|---|---|
| genuinely | Filler |
| honestly | Implies other responses aren't honest |
| straightforward | Condescending and usually wrong |
| dive in / let's dive deep | Content-free transition |
| game-changer | Meaningless |
| leverage (as a verb) | Corporate rot |
| synergy / synergies | Automatic disqualifier |
| innovative / cutting-edge | Says nothing |
| seamlessly | Reality never is |
| empower / empowering | Marketing speak |
| unlock (your potential, etc.) | Same |
| robust | Lazy descriptor |
| of course | Stop |
| certainly | No |
| absolutely | No |

## Banned Structural Patterns

- Never start with context about what you're about to do.
`;

// ── Banned words extracted from fixture ──────────────────────────────────────
const FIXTURE_BANNED_WORDS = [
  'genuinely', 'honestly', 'straightforward', 'robust', 'of course',
];

const {
  checkStyle,
  extractBannedWords,
  getStyleGuideForPrompt: _getStyleGuideForPrompt,
  createVaultWriter,
} = require('../src/style-policy');

// ── 11. Clean content passes ──────────────────────────────────────────────────
describe('11. checkStyle — clean content passes', () => {
  test('returns PASS for content with no banned words', () => {
    const result = checkStyle('This is a clear, direct test note.', FIXTURE_BANNED_WORDS, 0);
    expect(result).toEqual({ decision: 'PASS' });
  });
});

// ── 12. First violation rejects ───────────────────────────────────────────────
describe('12. checkStyle — first violation rejects', () => {
  test('returns REJECT for content with banned word on first attempt', () => {
    const result = checkStyle('This is genuinely great content', FIXTURE_BANNED_WORDS, 0);
    expect(result.decision).toBe('REJECT');
    expect(result.violation).toBe('genuinely');
    expect(result.reason).toMatch(/genuinely/);
  });

  test('REJECT reason mentions regeneration', () => {
    const result = checkStyle('This is genuinely great', FIXTURE_BANNED_WORDS, 0);
    expect(result.reason).toMatch(/regenerate/);
  });
});

// ── 13. Repeated violation quarantines ────────────────────────────────────────
describe('13. checkStyle — repeated violation quarantines', () => {
  test('returns QUARANTINE for content with banned word on second attempt', () => {
    const result = checkStyle('This is genuinely great content', FIXTURE_BANNED_WORDS, 1);
    expect(result.decision).toBe('QUARANTINE');
    expect(result.violation).toBe('genuinely');
  });

  test('returns QUARANTINE for attemptCount > 1 as well', () => {
    const result = checkStyle('robust design pattern', FIXTURE_BANNED_WORDS, 2);
    expect(result.decision).toBe('QUARANTINE');
  });
});

// ── 14. attemptCount is required ─────────────────────────────────────────────
describe('14. checkStyle — attemptCount is required', () => {
  test('throws TypeError when attemptCount is undefined', () => {
    expect(() => checkStyle('content', FIXTURE_BANNED_WORDS, undefined)).toThrow(TypeError);
    expect(() => checkStyle('content', FIXTURE_BANNED_WORDS, undefined)).toThrow(
      /attemptCount must be a number/
    );
  });

  test('throws TypeError when attemptCount is null', () => {
    expect(() => checkStyle('content', FIXTURE_BANNED_WORDS, null)).toThrow(TypeError);
  });

  test('throws TypeError when attemptCount is a string', () => {
    expect(() => checkStyle('content', FIXTURE_BANNED_WORDS, '0')).toThrow(TypeError);
  });
});

// ── 15. Banned word extraction from style guide ───────────────────────────────
describe('15. extractBannedWords — extracts words from style guide table', () => {
  test('returns array containing "genuinely"', () => {
    const words = extractBannedWords(STYLE_GUIDE_FIXTURE);
    expect(words).toContain('genuinely');
  });

  test('returns array containing "honestly"', () => {
    const words = extractBannedWords(STYLE_GUIDE_FIXTURE);
    expect(words).toContain('honestly');
  });

  test('returns array containing "robust"', () => {
    const words = extractBannedWords(STYLE_GUIDE_FIXTURE);
    expect(words).toContain('robust');
  });

  test('returns array containing "of course"', () => {
    const words = extractBannedWords(STYLE_GUIDE_FIXTURE);
    expect(words).toContain('of course');
  });

  test('returns lowercase entries', () => {
    const words = extractBannedWords(STYLE_GUIDE_FIXTURE);
    words.forEach(w => expect(w).toBe(w.toLowerCase()));
  });

  test('does not include table header row', () => {
    const words = extractBannedWords(STYLE_GUIDE_FIXTURE);
    expect(words).not.toContain('word/phrase');
  });

  test('does not include separator row', () => {
    const words = extractBannedWords(STYLE_GUIDE_FIXTURE);
    expect(words).not.toContain('---');
    words.forEach(w => expect(w).not.toMatch(/^-+$/));
  });
});

// ── 16. createVaultWriter ─────────────────────────────────────────────────────
describe('16. createVaultWriter', () => {
  test('returns object with getSystemPromptPrefix function', () => {
    const writer = createVaultWriter('test-agent');
    expect(writer).toHaveProperty('getSystemPromptPrefix');
    expect(typeof writer.getSystemPromptPrefix).toBe('function');
  });

  test('returns object with write function', () => {
    const writer = createVaultWriter('test-agent');
    expect(writer).toHaveProperty('write');
    expect(typeof writer.write).toBe('function');
  });

  test('getSystemPromptPrefix contains agent name', () => {
    const writer = createVaultWriter('memory-extractor');
    const prefix = writer.getSystemPromptPrefix();
    expect(prefix).toContain('memory-extractor');
  });

  test('getSystemPromptPrefix contains style guide text', () => {
    const writer = createVaultWriter('test-agent');
    const prefix = writer.getSystemPromptPrefix();
    // Style guide is loaded at module level — prefix should contain substantial text
    expect(prefix.length).toBeGreaterThan(50);
  });

  test('getSystemPromptPrefix contains STYLE GUIDE marker', () => {
    const writer = createVaultWriter('test-agent');
    const prefix = writer.getSystemPromptPrefix();
    expect(prefix).toMatch(/STYLE GUIDE/);
  });
});

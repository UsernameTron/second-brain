'use strict';

/**
 * memory-utils.test.js
 *
 * Unit tests for shared memory utility functions in src/utils/memory-utils.js.
 * Covers computeHash and sourceRefShort — both functions must be exported
 * from a single source-of-truth module used by promote-memories, memory-extractor,
 * memory-reader, and recall-command.
 */

const { computeHash, sourceRefShort } = require('../../src/utils/memory-utils');

describe('computeHash', () => {
  test('returns a 12-character lowercase hex string', () => {
    const result = computeHash('hello');
    expect(result).toHaveLength(12);
    expect(result).toMatch(/^[0-9a-f]{12}$/);
  });

  test('normalizes by trim and lowercase — whitespace and case do not cause misses', () => {
    expect(computeHash('Hello')).toBe(computeHash('hello '));
  });

  test('null input returns hash of empty string without throwing', () => {
    expect(() => computeHash(null)).not.toThrow();
    expect(computeHash(null)).toHaveLength(12);
    expect(computeHash(null)).toBe(computeHash(''));
  });

  test('undefined input returns hash of empty string without throwing', () => {
    expect(() => computeHash(undefined)).not.toThrow();
    expect(computeHash(undefined)).toHaveLength(12);
    expect(computeHash(undefined)).toBe(computeHash(''));
  });
});

describe('sourceRefShort', () => {
  test('session: prefix — returns 8-char slice after "session:"', () => {
    expect(sourceRefShort('session:abc123def456xyz')).toBe('session:abc123de');
  });

  test('file: prefix — returns basename without extension', () => {
    expect(sourceRefShort('file:/path/to/notes.md')).toBe('file:notes');
  });

  test('daily: prefix — returns passthrough', () => {
    expect(sourceRefShort('daily:2026-04-23')).toBe('daily:2026-04-23');
  });

  test('null input returns "unknown"', () => {
    expect(sourceRefShort(null)).toBe('unknown');
  });

  test('empty string returns "unknown"', () => {
    expect(sourceRefShort('')).toBe('unknown');
  });

  test('unknown prefix — truncates to 20 chars', () => {
    // 'custom:abcdefghijklmnopqrstuvwxyz'.slice(0, 20) === 'custom:abcdefghijklm' (20 chars)
    expect(sourceRefShort('custom:abcdefghijklmnopqrstuvwxyz')).toBe('custom:abcdefghijklm');
  });
});

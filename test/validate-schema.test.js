'use strict';

/**
 * validate-schema.test.js
 *
 * Comprehensive tests for src/utils/validate-schema.js.
 * The function is pure (no side effects, no mocks needed).
 * Tests every branch in the check() function.
 */

const path = require('path');
const { validateAgainstSchema } = require('../src/utils/validate-schema');

// ── Object type tests ─────────────────────────────────────────────────────────

describe('validateAgainstSchema — object type', () => {
  const schema = {
    type: 'object',
    required: ['name', 'age'],
    properties: {
      name: { type: 'string' },
      age: { type: 'integer', minimum: 0 },
      active: { type: 'boolean' },
    },
    additionalProperties: false,
  };

  test('valid object returns { valid: true, errors: [] }', () => {
    const result = validateAgainstSchema({ name: 'Pete', age: 40 }, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('missing required field returns error with field name', () => {
    const result = validateAgainstSchema({ name: 'Pete' }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"age"'))).toBe(true);
  });

  test('both required fields missing returns two errors', () => {
    const result = validateAgainstSchema({}, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  test('additionalProperties: false catches extra keys', () => {
    const result = validateAgainstSchema({ name: 'Pete', age: 40, extra: 'boom' }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"extra"'))).toBe(true);
  });

  test('null input where object expected returns error', () => {
    const result = validateAgainstSchema(null, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected object'))).toBe(true);
  });

  test('array input where object expected returns error', () => {
    const result = validateAgainstSchema([1, 2, 3], schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected object'))).toBe(true);
  });

  test('string input where object expected returns error', () => {
    const result = validateAgainstSchema('not-an-object', schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected object'))).toBe(true);
  });

  test('optional fields present validate against their schema', () => {
    const result = validateAgainstSchema({ name: 'Pete', age: 40, active: 'yes' }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected boolean'))).toBe(true);
  });
});

// ── Number type tests ─────────────────────────────────────────────────────────

describe('validateAgainstSchema — number type', () => {
  const schema = { type: 'number', minimum: 0, maximum: 1 };

  test('valid number passes', () => {
    const result = validateAgainstSchema(0.75, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('string where number expected returns error', () => {
    const result = validateAgainstSchema('0.5', schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected number'))).toBe(true);
  });

  test('value below minimum returns error', () => {
    const result = validateAgainstSchema(-0.1, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('minimum'))).toBe(true);
  });

  test('value above maximum returns error', () => {
    const result = validateAgainstSchema(1.1, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('maximum'))).toBe(true);
  });

  test('float is valid number (not integer-constrained)', () => {
    const result = validateAgainstSchema(0.5, schema);
    expect(result.valid).toBe(true);
  });
});

// ── Integer type tests ────────────────────────────────────────────────────────

describe('validateAgainstSchema — integer type', () => {
  const schema = { type: 'integer', minimum: 1, maximum: 100 };

  test('valid integer passes', () => {
    const result = validateAgainstSchema(42, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('float fails integer validation', () => {
    const result = validateAgainstSchema(3.14, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected integer'))).toBe(true);
  });

  test('string fails integer validation', () => {
    const result = validateAgainstSchema('42', schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected integer'))).toBe(true);
  });

  test('integer below minimum returns error', () => {
    const result = validateAgainstSchema(0, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('minimum'))).toBe(true);
  });

  test('integer above maximum returns error', () => {
    const result = validateAgainstSchema(101, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('maximum'))).toBe(true);
  });
});

// ── String type tests ─────────────────────────────────────────────────────────

describe('validateAgainstSchema — string type', () => {
  const schema = { type: 'string', minLength: 3 };

  test('valid string passes', () => {
    const result = validateAgainstSchema('hello', schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('number where string expected returns error', () => {
    const result = validateAgainstSchema(42, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected string'))).toBe(true);
  });

  test('string below minLength returns error', () => {
    const result = validateAgainstSchema('ab', schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('minLength'))).toBe(true);
  });

  test('string exactly at minLength passes', () => {
    const result = validateAgainstSchema('abc', schema);
    expect(result.valid).toBe(true);
  });
});

// ── Boolean type tests ────────────────────────────────────────────────────────

describe('validateAgainstSchema — boolean type', () => {
  const schema = { type: 'boolean' };

  test('true passes boolean validation', () => {
    const result = validateAgainstSchema(true, schema);
    expect(result.valid).toBe(true);
  });

  test('false passes boolean validation', () => {
    const result = validateAgainstSchema(false, schema);
    expect(result.valid).toBe(true);
  });

  test('string where boolean expected returns error', () => {
    const result = validateAgainstSchema('true', schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected boolean'))).toBe(true);
  });

  test('number where boolean expected returns error', () => {
    const result = validateAgainstSchema(1, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected boolean'))).toBe(true);
  });
});

// ── Array type tests ──────────────────────────────────────────────────────────

describe('validateAgainstSchema — array type', () => {
  const schema = {
    type: 'array',
    minItems: 2,
    maxItems: 4,
    items: { type: 'string' },
  };

  test('valid array passes', () => {
    const result = validateAgainstSchema(['a', 'b', 'c'], schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('string where array expected returns error', () => {
    const result = validateAgainstSchema('not-an-array', schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected array'))).toBe(true);
  });

  test('array below minItems returns error', () => {
    const result = validateAgainstSchema(['a'], schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('minItems'))).toBe(true);
  });

  test('array above maxItems returns error', () => {
    const result = validateAgainstSchema(['a', 'b', 'c', 'd', 'e'], schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('maxItems'))).toBe(true);
  });

  test('array items type checking — wrong element type returns error', () => {
    const result = validateAgainstSchema(['a', 42, 'c'], schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected string'))).toBe(true);
  });

  test('array with all correct item types passes', () => {
    const result = validateAgainstSchema(['x', 'y'], schema);
    expect(result.valid).toBe(true);
  });
});

// ── Nested object validation ──────────────────────────────────────────────────

describe('validateAgainstSchema — nested objects', () => {
  const schema = {
    type: 'object',
    required: ['meta'],
    properties: {
      meta: {
        type: 'object',
        required: ['version'],
        properties: {
          version: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
    },
  };

  test('nested valid object passes', () => {
    const result = validateAgainstSchema({ meta: { version: 2 } }, schema);
    expect(result.valid).toBe(true);
  });

  test('nested missing required field returns error', () => {
    const result = validateAgainstSchema({ meta: {} }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"version"'))).toBe(true);
  });

  test('nested wrong type returns error', () => {
    const result = validateAgainstSchema({ meta: { version: 'two' } }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('expected integer'))).toBe(true);
  });

  test('nested additional property returns error', () => {
    const result = validateAgainstSchema({ meta: { version: 1, extra: 'oops' } }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"extra"'))).toBe(true);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('validateAgainstSchema — edge cases', () => {
  test('undefined schema node is a no-op (no errors)', () => {
    const result = validateAgainstSchema('anything', undefined);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('null schema node is a no-op (no errors)', () => {
    const result = validateAgainstSchema('anything', null);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('empty schema object (no type) is a no-op (no errors)', () => {
    const result = validateAgainstSchema({ foo: 'bar' }, {});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ── Integration: validate real pipeline.json against pipeline.schema.json ─────

describe('validateAgainstSchema — integration with pipeline config', () => {
  test('pipeline.json validates against pipeline.schema.json', () => {
    const schema = require(path.join(__dirname, '..', 'config', 'schema', 'pipeline.schema.json'));
    const data = require(path.join(__dirname, '..', 'config', 'pipeline.json'));

    const result = validateAgainstSchema(data, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

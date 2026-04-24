'use strict';

/**
 * Tests for memory.echoThreshold schema extension on pipeline.schema.json.
 *
 * These tests validate the AJV schema accepts valid memory configs and rejects
 * invalid values — ensuring safeLoadPipelineConfig() won't silently pass bad data.
 */

const Ajv = require('ajv');
const schema = require('../../config/schema/pipeline.schema.json');
const pipelineConfig = require('../../config/pipeline.json');

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

/**
 * Helper: return a deep clone of pipeline.json with `memory` block mutated.
 * @param {object|undefined} memoryBlock - The memory block to apply (undefined removes it)
 * @returns {object} Full config clone with memory set
 */
function configWith(memoryBlock) {
  const base = JSON.parse(JSON.stringify(pipelineConfig));
  if (memoryBlock === undefined) {
    delete base.memory;
  } else {
    base.memory = memoryBlock;
  }
  return base;
}

describe('pipeline.schema.json — memory.echoThreshold', () => {
  test('Test 1: valid config with memory.echoThreshold 0.65 passes validation', () => {
    const config = configWith({ echoThreshold: 0.65 });
    const valid = validate(config);
    expect(valid).toBe(true);
    expect(validate.errors).toBeNull();
  });

  test('Test 2: memory.echoThreshold 1.5 fails validation (exceeds maximum 1)', () => {
    const config = configWith({ echoThreshold: 1.5 });
    const valid = validate(config);
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
    expect(validate.errors.length).toBeGreaterThan(0);
  });

  test('Test 3: memory.echoThreshold "high" fails validation (wrong type)', () => {
    const config = configWith({ echoThreshold: 'high' });
    const valid = validate(config);
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
    expect(validate.errors.length).toBeGreaterThan(0);
  });

  test('Test 4: memory: {} (empty object, no echoThreshold) passes validation (echoThreshold is optional)', () => {
    const config = configWith({});
    const valid = validate(config);
    expect(valid).toBe(true);
    expect(validate.errors).toBeNull();
  });

  test('Test 5: unknown key under memory (memory.foo) fails validation (additionalProperties: false)', () => {
    const config = configWith({ foo: 1 });
    const valid = validate(config);
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
    expect(validate.errors.length).toBeGreaterThan(0);
  });

  test('Test 6: live config/pipeline.json validates successfully against the current schema', () => {
    const config = JSON.parse(JSON.stringify(pipelineConfig));
    const valid = validate(config);
    expect(valid).toBe(true);
    expect(validate.errors).toBeNull();
  });
});

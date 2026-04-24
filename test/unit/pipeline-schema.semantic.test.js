'use strict';

/**
 * Tests for memory.semantic schema extension on pipeline.schema.json.
 *
 * These tests validate the AJV schema accepts valid memory.semantic blocks and
 * rejects invalid values — ensuring loadConfigWithOverlay('pipeline', {validate:true})
 * won't silently pass bad data through to semantic-index.js consumers.
 *
 * The live-config test runs last because it depends on pipeline.json containing
 * the memory.semantic defaults populated in Task 3.
 */

const Ajv = require('ajv');
const schema = require('../../config/schema/pipeline.schema.json');
const pipelineConfig = require('../../config/pipeline.json');

const ajv = new Ajv({ allErrors: true });
// Delete $schema so AJV draft-07 validator doesn't try to fetch the meta-schema
const compiledSchema = JSON.parse(JSON.stringify(schema));
delete compiledSchema.$schema;
const validate = ajv.compile(compiledSchema);

/**
 * Helper: return a deep clone of pipeline.json with `memory.semantic` mutated.
 * If semanticBlock is undefined, removes the semantic key from memory.
 * @param {object|undefined} semanticBlock - The semantic sub-object to apply
 * @returns {object} Full config clone with memory.semantic set
 */
function configWithSemantic(semanticBlock) {
  const base = JSON.parse(JSON.stringify(pipelineConfig));
  // Ensure memory block exists
  if (!base.memory) {
    base.memory = { echoThreshold: 0.65 };
  }
  if (semanticBlock === undefined) {
    delete base.memory.semantic;
  } else {
    base.memory.semantic = semanticBlock;
  }
  return base;
}

/** A complete valid memory.semantic block with all 9 defaults */
const validSemantic = {
  model: 'voyage-4-lite',
  threshold: 0.72,
  recencyDecay: 0.2,
  rrfK: 60,
  candidatesPerSource: 20,
  embedBatchSize: 128,
  timeoutMs: 3000,
  degradedModeMinutes: 15,
  embeddingDim: 1024,
};

describe('pipeline.schema.json — memory.semantic', () => {
  test('complete block with all 9 defaults passes validation', () => {
    const config = configWithSemantic(validSemantic);
    const valid = validate(config);
    expect(valid).toBe(true);
    expect(validate.errors).toBeNull();
  });

  test('threshold 1.5 fails validation (exceeds maximum 1)', () => {
    const config = configWithSemantic({ ...validSemantic, threshold: 1.5 });
    const valid = validate(config);
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
    expect(validate.errors.length).toBeGreaterThan(0);
  });

  test('model "gpt-4" fails validation (not in enum)', () => {
    const config = configWithSemantic({ ...validSemantic, model: 'gpt-4' });
    const valid = validate(config);
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
    expect(validate.errors.length).toBeGreaterThan(0);
  });

  test('embedBatchSize 200 fails validation (exceeds maximum 128)', () => {
    const config = configWithSemantic({ ...validSemantic, embedBatchSize: 200 });
    const valid = validate(config);
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
    expect(validate.errors.length).toBeGreaterThan(0);
  });

  test('unknown key fails validation (additionalProperties: false)', () => {
    const config = configWithSemantic({ ...validSemantic, unknownKey: 5 });
    const valid = validate(config);
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
    expect(validate.errors.length).toBeGreaterThan(0);
  });

  test('omitted (only echoThreshold present) still validates (optional sub-object)', () => {
    const config = configWithSemantic(undefined);
    const valid = validate(config);
    expect(valid).toBe(true);
    expect(validate.errors).toBeNull();
  });

  test('missing required key threshold fails validation', () => {
    const { threshold, ...withoutThreshold } = validSemantic; // eslint-disable-line no-unused-vars
    const config = configWithSemantic(withoutThreshold);
    const valid = validate(config);
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
    expect(validate.errors.length).toBeGreaterThan(0);
  });

  test('embeddingDim 512 fails validation (enum: [1024] only)', () => {
    const config = configWithSemantic({ ...validSemantic, embeddingDim: 512 });
    const valid = validate(config);
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
    expect(validate.errors.length).toBeGreaterThan(0);
  });

  // Runs LAST — depends on pipeline.json containing memory.semantic defaults (Task 3)
  test('live config/pipeline.json validates successfully against schema', () => {
    // Clear require cache to pick up any changes since module load
    delete require.cache[require.resolve('../../config/pipeline.json')];
    const liveConfig = require('../../config/pipeline.json');
    const config = JSON.parse(JSON.stringify(liveConfig));
    const valid = validate(config);
    expect(valid).toBe(true);
    expect(validate.errors).toBeNull();
  });
});

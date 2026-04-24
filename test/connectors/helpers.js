'use strict';

/**
 * test/connectors/helpers.js
 *
 * Shared Jest assertion helpers for connector contract tests.
 * Imported by Wave 2 connector tests to assert every return value
 * conforms to the D-15 uniform result shape.
 *
 * Usage:
 *   const { assertSuccessShape, assertErrorShape, assertSourceEnum } = require('../connectors/helpers');
 *   assertSuccessShape(result);  // throws Jest assertion error if shape is wrong
 *
 * @module test/connectors/helpers
 */

const { SOURCE } = require('../../src/connectors/types');

/** Set of valid SOURCE values for membership checks */
const _validSources = new Set(Object.values(SOURCE));

/** ISO 8601 regex matching the format produced by new Date().toISOString() */
const _ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Assert that a connector result matches the D-15 success shape.
 *
 * Expected shape:
 *   { success: true, data: <non-null>, error: null, source: <valid SOURCE>, fetchedAt: <ISO8601> }
 *
 * Also verifies no extra fields are present (exact 5-field contract).
 *
 * @param {*} result - The value returned by a connector
 */
function assertSuccessShape(result) {
  expect(result).toHaveProperty('success', true);
  expect(result).toHaveProperty('data');
  expect(result.data).not.toBeNull();
  expect(result).toHaveProperty('error', null);
  expect(
    _validSources.has(result.source)
  ).toBe(true); // source must be a valid SOURCE enum member
  expect(typeof result.fetchedAt).toBe('string');
  expect(new Date(result.fetchedAt).toISOString()).toBe(result.fetchedAt);
  // Exact-field check: no extra fields allowed
  expect(Object.keys(result).sort()).toEqual(['data', 'error', 'fetchedAt', 'source', 'success']);
}

/**
 * Assert that a connector result matches the D-15 error shape.
 *
 * Expected shape:
 *   { success: false, data: null, error: <non-empty string>, source: <valid SOURCE>, fetchedAt: <ISO8601> }
 *
 * Also verifies no extra fields are present (exact 5-field contract).
 *
 * @param {*} result - The value returned by a connector
 */
function assertErrorShape(result) {
  expect(result).toHaveProperty('success', false);
  expect(result).toHaveProperty('data', null);
  expect(result).toHaveProperty('error');
  expect(typeof result.error).toBe('string');
  expect(result.error.length).toBeGreaterThan(0);
  expect(
    _validSources.has(result.source)
  ).toBe(true); // source must be a valid SOURCE enum member
  expect(typeof result.fetchedAt).toBe('string');
  expect(new Date(result.fetchedAt).toISOString()).toBe(result.fetchedAt);
  // Exact-field check: no extra fields allowed
  expect(Object.keys(result).sort()).toEqual(['data', 'error', 'fetchedAt', 'source', 'success']);
}

/**
 * Assert that a result's source field is a valid SOURCE enum member.
 *
 * @param {*} result - Object with a .source field
 */
function assertSourceEnum(result) {
  expect(
    _validSources.has(result.source)
  ).toBe(true); // source must be a valid SOURCE enum member
}

module.exports = { assertSuccessShape, assertErrorShape, assertSourceEnum };

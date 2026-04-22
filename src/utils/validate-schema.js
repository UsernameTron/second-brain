'use strict';

/**
 * validate-schema.js
 *
 * Lightweight recursive JSON Schema validator for project config files.
 * Handles the subset of JSON Schema Draft-07 used by this project's schemas:
 *   - type: object, string, integer, number, boolean, array
 *   - required, properties
 *   - minimum, maximum (for number/integer)
 *   - minLength (for string)
 *   - minItems, maxItems (for array)
 *   - items (for array element type)
 *   - additionalProperties: false
 *
 * Returns { valid: boolean, errors: string[] } — never throws.
 *
 * @module validate-schema
 */

/**
 * Validate data against a JSON Schema node.
 *
 * @param {*} data - The value to validate
 * @param {object} schema - JSON Schema node
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateAgainstSchema(data, schema) {
  const errors = [];

  function check(obj, schemaNode, pathPrefix) {
    if (!schemaNode || typeof schemaNode !== 'object') return;

    const type = schemaNode.type;

    if (type === 'object') {
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        errors.push(`${pathPrefix}: expected object, got ${Array.isArray(obj) ? 'array' : typeof obj}`);
        return;
      }

      const required = schemaNode.required || [];
      for (const key of required) {
        if (!(key in obj)) {
          errors.push(`${pathPrefix}: missing required field "${key}"`);
        } else {
          const childSchema = (schemaNode.properties && schemaNode.properties[key]) || {};
          check(obj[key], childSchema, `${pathPrefix}.${key}`);
        }
      }

      // Check present optional fields against their schemas
      if (schemaNode.properties) {
        for (const key of Object.keys(obj)) {
          if (!required.includes(key) && schemaNode.properties[key]) {
            check(obj[key], schemaNode.properties[key], `${pathPrefix}.${key}`);
          }
        }
      }

      // additionalProperties: false
      if (schemaNode.additionalProperties === false && schemaNode.properties) {
        const allowed = new Set(Object.keys(schemaNode.properties));
        for (const key of Object.keys(obj)) {
          if (!allowed.has(key)) {
            errors.push(`${pathPrefix}: additional property "${key}" not allowed`);
          }
        }
      }

    } else if (type === 'number') {
      if (typeof obj !== 'number') {
        errors.push(`${pathPrefix}: expected number, got ${typeof obj}`);
        return;
      }
      if (schemaNode.minimum !== undefined && obj < schemaNode.minimum) {
        errors.push(`${pathPrefix}: value ${obj} is less than minimum ${schemaNode.minimum}`);
      }
      if (schemaNode.maximum !== undefined && obj > schemaNode.maximum) {
        errors.push(`${pathPrefix}: value ${obj} is greater than maximum ${schemaNode.maximum}`);
      }

    } else if (type === 'integer') {
      if (!Number.isInteger(obj)) {
        errors.push(`${pathPrefix}: expected integer, got ${typeof obj} (${obj})`);
        return;
      }
      if (schemaNode.minimum !== undefined && obj < schemaNode.minimum) {
        errors.push(`${pathPrefix}: value ${obj} is less than minimum ${schemaNode.minimum}`);
      }
      if (schemaNode.maximum !== undefined && obj > schemaNode.maximum) {
        errors.push(`${pathPrefix}: value ${obj} is greater than maximum ${schemaNode.maximum}`);
      }

    } else if (type === 'string') {
      if (typeof obj !== 'string') {
        errors.push(`${pathPrefix}: expected string, got ${typeof obj}`);
        return;
      }
      if (schemaNode.minLength !== undefined && obj.length < schemaNode.minLength) {
        errors.push(`${pathPrefix}: string length ${obj.length} is less than minLength ${schemaNode.minLength}`);
      }

    } else if (type === 'boolean') {
      if (typeof obj !== 'boolean') {
        errors.push(`${pathPrefix}: expected boolean, got ${typeof obj}`);
      }

    } else if (type === 'array') {
      if (!Array.isArray(obj)) {
        errors.push(`${pathPrefix}: expected array, got ${typeof obj}`);
        return;
      }
      if (schemaNode.minItems !== undefined && obj.length < schemaNode.minItems) {
        errors.push(`${pathPrefix}: array length ${obj.length} is less than minItems ${schemaNode.minItems}`);
      }
      if (schemaNode.maxItems !== undefined && obj.length > schemaNode.maxItems) {
        errors.push(`${pathPrefix}: array length ${obj.length} is greater than maxItems ${schemaNode.maxItems}`);
      }
      if (schemaNode.items) {
        obj.forEach((item, i) => check(item, schemaNode.items, `${pathPrefix}[${i}]`));
      }
    }
  }

  check(data, schema, '$');
  return { valid: errors.length === 0, errors };
}

module.exports = { validateAgainstSchema };

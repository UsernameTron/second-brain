'use strict';

/**
 * types.js
 *
 * Shared connector infrastructure for Phase 3 external integrations.
 * Provides:
 *   - SOURCE enum (D-15): frozen set of valid connector identifiers
 *   - makeResult / makeError: uniform result shape factories (D-15)
 *   - loadConnectorsConfig: fail-fast config loader with full schema validation
 *   - getConnectorsConfig: memoized lazy wrapper for connector use
 *
 * Design principles:
 *   - SOURCE enum is frozen — modification attempts are silently ignored in strict mode
 *   - Result shapes are exact: no extra fields, enabling assertive contract tests
 *   - loadConnectorsConfig validates full JSON Schema (not just top-level key checks)
 *   - getConnectorsConfig is memoized to avoid repeated file I/O
 *
 * @module src/connectors/types
 */

const fs = require('fs');
const path = require('path');
const { validateAgainstSchema } = require('../utils/validate-schema');

// ── Path resolution ──────────────────────────────────────────────────────────

// types.js lives at src/connectors/ — need two levels up to reach project root.
// CONFIG_DIR is evaluated lazily (inside loadConnectorsConfig) so that
// CONFIG_DIR_OVERRIDE set in tests takes effect at call time, not module load time.
function _getConfigDir() {
  return process.env.CONFIG_DIR_OVERRIDE
    || path.join(__dirname, '..', '..', 'config');
}

// ── SOURCE enum (D-15) ───────────────────────────────────────────────────────

/**
 * SOURCE enum — frozen set of valid connector source identifiers.
 * Per D-15: every connector result must carry a source from this enum.
 *
 * @type {{ CALENDAR: 'calendar', GMAIL: 'gmail', GITHUB: 'github' }}
 */
const SOURCE = Object.freeze({
  CALENDAR: 'calendar',
  GMAIL: 'gmail',
  GITHUB: 'github',
});

/** Set of valid source values for fast membership checks */
const _validSources = new Set(Object.values(SOURCE));

// ── Result shape factories (D-15) ────────────────────────────────────────────

/**
 * Create a uniform success result shape.
 * Per D-15: { success, data, error, source, fetchedAt }
 *
 * @param {string} source - Must be a value from SOURCE enum
 * @param {*} data - The connector's fetched data
 * @returns {{ success: true, data: *, error: null, source: string, fetchedAt: string }}
 * @throws {Error} If source is not a valid SOURCE enum value
 */
function makeResult(source, data) {
  if (!_validSources.has(source)) {
    throw new Error(
      `makeResult: invalid source "${source}". Must be one of: ${[...SOURCE].join(', ')}`
    );
  }
  return {
    success: true,
    data,
    error: null,
    source,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Create a uniform error result shape.
 * Per D-15: { success, data, error, source, fetchedAt }
 *
 * @param {string} source - Must be a value from SOURCE enum
 * @param {string} errorMessage - Human-readable error description
 * @returns {{ success: false, data: null, error: string, source: string, fetchedAt: string }}
 * @throws {Error} If source is not a valid SOURCE enum value
 */
function makeError(source, errorMessage) {
  if (!_validSources.has(source)) {
    throw new Error(
      `makeError: invalid source "${source}". Must be one of: ${[...SOURCE].join(', ')}`
    );
  }
  return {
    success: false,
    data: null,
    error: errorMessage,
    source,
    fetchedAt: new Date().toISOString(),
  };
}

// ── Config loader ────────────────────────────────────────────────────────────

/**
 * Load and validate connectors.json against its JSON schema.
 *
 * Follows the loadPipelineConfig() pattern from pipeline-infra.js:
 *   - Reads from CONFIG_DIR (or CONFIG_DIR_OVERRIDE in tests)
 *   - Parses JSON
 *   - Performs full JSON Schema validation (not just top-level key checks)
 *   - Throws descriptive errors on any violation
 *
 * @returns {object} Parsed connector configuration
 * @throws {Error} If file is missing, JSON is invalid, or schema validation fails
 */
function loadConnectorsConfig() {
  const configDir = _getConfigDir();
  const configPath = path.join(configDir, 'connectors.json');
  const schemaPath = path.join(configDir, 'schema', 'connectors.schema.json');

  // Read and parse connectors.json
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);

  // Read and parse schema
  const schemaRaw = fs.readFileSync(schemaPath, 'utf8');
  const schema = JSON.parse(schemaRaw);

  // Full JSON Schema validation
  const { valid, errors } = validateAgainstSchema(config, schema);
  if (!valid) {
    throw new Error(
      `connectors.json validation failed:\n${errors.join('\n')}`
    );
  }

  return config;
}

// ── Memoized config accessor ─────────────────────────────────────────────────

let _cachedConfig = null;

/**
 * Return the connector config, loading it once on first call.
 * Connectors should call getConnectorsConfig() rather than loadConnectorsConfig()
 * directly to avoid repeated file I/O while preserving fail-fast semantics.
 *
 * @returns {object} Parsed connector configuration (same reference on every call)
 * @throws {Error} On first call if config is missing or invalid
 */
function getConnectorsConfig() {
  if (!_cachedConfig) {
    _cachedConfig = loadConnectorsConfig();
  }
  return _cachedConfig;
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  SOURCE,
  makeResult,
  makeError,
  loadConnectorsConfig,
  getConnectorsConfig,
};

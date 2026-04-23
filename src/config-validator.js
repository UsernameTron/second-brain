'use strict';

/**
 * config-validator.js
 *
 * AJV-based validation engine for config/*.json files against their
 * corresponding config/schema/*.schema.json schemas.
 *
 * Exports:
 *   validateFile(configPath, schemaPath) -> Promise<Result>
 *   validateAll(configDir, schemaDir)    -> Promise<Result[]>
 *   main(configDir, schemaDir)           -> Promise<void>  (CLI entry point)
 *
 * Result shape:
 *   { file, schema, status: 'PASS'|'FAIL'|'WARNING'|'ERROR', errors: [] }
 *   Each error: { path: '/json/path', message: 'description' }
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true });

// Default paths relative to the project root
const DEFAULT_CONFIG_DIR = path.join(__dirname, '..', 'config');
const DEFAULT_SCHEMA_DIR = path.join(__dirname, '..', 'config', 'schema');

/**
 * Validates a single config file against a JSON Schema file.
 *
 * @param {string} configPath - Absolute or relative path to the config JSON
 * @param {string} schemaPath - Absolute or relative path to the schema JSON
 * @returns {Promise<{file, schema, status, errors}>}
 */
async function validateFile(configPath, schemaPath) {
  const result = {
    file: configPath,
    schema: schemaPath,
    status: 'PASS',
    errors: [],
  };

  // 1. Parse schema
  let schema;
  try {
    const rawSchema = fs.readFileSync(schemaPath, 'utf8');
    schema = JSON.parse(rawSchema);
  } catch (err) {
    result.status = 'ERROR';
    result.errors.push({ path: '', message: `Schema parse error: ${err.message}` });
    return result;
  }

  // 2. Parse config
  let config;
  try {
    const rawConfig = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(rawConfig);
  } catch (err) {
    result.status = 'ERROR';
    result.errors.push({ path: '', message: `Config parse error: ${err.message}` });
    return result;
  }

  // 3. Compile schema and validate.  AJV caches compiled validators by
  //    schema URI, so we use a unique key per schema path to avoid cache
  //    collisions across test runs that write different schemas to the same
  //    relative path.
  let validate;
  try {
    // Remove $schema keyword so AJV 8 doesn't try to fetch it as a meta-schema
    const schemaForCompile = Object.assign({}, schema);
    // Give each schema a unique $id to prevent cache collisions
    schemaForCompile.$id = schemaForCompile.$id || `file://${path.resolve(schemaPath)}`;
    // Remove $schema keyword — AJV 8 draft-07 mode doesn't need it
    delete schemaForCompile.$schema;

    // Try to remove from cache first (for test re-use with same $id)
    try { ajv.removeSchema(schemaForCompile.$id); } catch (_) { /* ok */ }

    validate = ajv.compile(schemaForCompile);
  } catch (err) {
    result.status = 'ERROR';
    result.errors.push({ path: '', message: `Schema compile error: ${err.message}` });
    return result;
  }

  const valid = validate(config);
  if (valid) {
    return result; // PASS
  }

  // Map AJV errors to our shape
  result.status = 'FAIL';
  result.errors = (validate.errors || []).map(e => ({
    path: e.instancePath || '/',
    message: e.message || 'Unknown validation error',
  }));

  return result;
}

/**
 * Discovers all schemas in schemaDir and validates the corresponding config
 * file in configDir. Schema-to-config mapping:
 *   config/schema/foo.schema.json -> config/foo.json
 *
 * Config files that have no schema (e.g. excluded-terms.json) are silently
 * skipped — only schema files drive discovery.
 *
 * If a schema exists but the config file does not, returns WARNING.
 *
 * @param {string} configDir
 * @param {string} schemaDir
 * @returns {Promise<Array<{file, schema, status, errors}>>}
 */
async function validateAll(configDir = DEFAULT_CONFIG_DIR, schemaDir = DEFAULT_SCHEMA_DIR) {
  const results = [];

  let schemaFiles;
  try {
    schemaFiles = fs.readdirSync(schemaDir).filter(f => f.endsWith('.schema.json'));
  } catch (err) {
    throw new Error(`Cannot read schema directory "${schemaDir}": ${err.message}`);
  }

  for (const schemaFilename of schemaFiles) {
    const schemaPath = path.join(schemaDir, schemaFilename);
    // Derive config filename: strip ".schema.json", add ".json"
    const configFilename = schemaFilename.replace(/\.schema\.json$/, '.json');
    const configPath = path.join(configDir, configFilename);

    if (!fs.existsSync(configPath)) {
      // WARNING — schema exists but config file is missing
      results.push({
        file: configPath,
        schema: schemaPath,
        status: 'WARNING',
        errors: [{ path: '', message: `Config file not found: ${configPath}` }],
      });
      continue;
    }

    const result = await validateFile(configPath, schemaPath);
    results.push(result);
  }

  return results;
}

/**
 * CLI entry point. Validates all configs and prints a results table.
 * Exits 0 if all results are PASS or WARNING.
 * Exits 1 if any result is FAIL or ERROR.
 *
 * @param {string} [configDir]
 * @param {string} [schemaDir]
 */
async function main(configDir = DEFAULT_CONFIG_DIR, schemaDir = DEFAULT_SCHEMA_DIR) {
  const results = await validateAll(configDir, schemaDir);

  // Print results table
  console.log('\nConfig Validation Results');
  console.log('='.repeat(80));
  for (const r of results) {
    const file = path.relative(process.cwd(), r.file);
    const schema = path.relative(process.cwd(), r.schema);
    console.log(`\n[${r.status}] ${file}`);
    console.log(`       Schema: ${schema}`);
    if (r.errors.length > 0) {
      for (const e of r.errors) {
        console.log(`       Error:  ${e.path || '(root)'} — ${e.message}`);
      }
    }
  }
  console.log('\n' + '='.repeat(80));

  const hasFailure = results.some(r => r.status === 'FAIL' || r.status === 'ERROR');
  process.exit(hasFailure ? 1 : 0);
}

module.exports = { validateFile, validateAll, main };

// CLI entry point
if (require.main === module) {
  main().catch(err => {
    console.error('Unexpected error:', err.message);
    process.exit(1);
  });
}

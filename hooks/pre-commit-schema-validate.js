#!/usr/bin/env node
'use strict';

/**
 * pre-commit-schema-validate.js
 *
 * Pre-commit hook: AJV-based schema validation for staged files.
 *
 * Validates:
 *   - config/*.json files against config/schema/{basename}.schema.json
 *   - daily-stats.md YAML frontmatter against config/schema/daily-stats-frontmatter.schema.json
 *
 * Exports:
 *   validateStagedFiles(filePaths, opts?) -> Promise<{ exitCode, errors }>
 *
 * CLI: reads staged files via `git diff --cached --name-only --diff-filter=ACM`
 *      exits 0 on pass, 1 on failure.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Ajv = require('ajv');
const matter = require('gray-matter');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
const DEFAULT_SCHEMA_DIR = path.join(PROJECT_ROOT, 'config', 'schema');

/**
 * Validate a list of staged file paths.
 *
 * In pre-commit context, filePaths are relative to PROJECT_ROOT (from git diff).
 * In test context, filePaths may be absolute (temp files).
 *
 * Detection strategy:
 *   - daily-stats.md: match by basename
 *   - config/*.json: match by relative git path (config/<name>.json) OR
 *     by basename if opts.schemaDir is provided (test mode, temp files)
 *
 * @param {string[]} filePaths - file paths to validate
 * @param {object}   [opts]
 * @param {string}   [opts.schemaDir] - override schema directory (for testing)
 * @param {string}   [opts.configDir] - override config directory (for testing)
 * @returns {Promise<{ exitCode: number, errors: string[] }>}
 */
async function validateStagedFiles(filePaths, opts = {}) {
  const schemaDir = opts.schemaDir || DEFAULT_SCHEMA_DIR;
  const ajv = new Ajv({ allErrors: true });

  /** @type {string[]} */
  const errors = [];

  for (const filePath of filePaths) {
    const basename = path.basename(filePath);
    const resolvedPath = path.resolve(filePath);

    // daily-stats.md frontmatter validation
    if (basename === 'daily-stats.md') {
      const schemaPath = path.join(schemaDir, 'daily-stats-frontmatter.schema.json');
      if (!fs.existsSync(schemaPath)) {
        continue;
      }

      let fileContent;
      try {
        fileContent = fs.readFileSync(resolvedPath, 'utf8');
      } catch (err) {
        errors.push(`${filePath}: cannot read file -- ${err.message}`);
        continue;
      }

      const { data: frontmatter } = matter(fileContent);
      errors.push(..._validate(ajv, schemaPath, frontmatter, filePath));
      continue;
    }

    // config/*.json validation
    // A file is a config JSON if:
    //   (a) its path matches the config/ directory pattern (e.g., relative path "config/pipeline.json"), OR
    //   (b) test mode: schemaDir was overridden and the file is a .json not under schema/
    if (isConfigJson(filePath, opts)) {
      const schemaName = basename.replace(/\.json$/, '') + '.schema.json';
      const schemaPath = path.join(schemaDir, schemaName);

      if (!fs.existsSync(schemaPath)) {
        continue;
      }

      let configData;
      try {
        const raw = fs.readFileSync(resolvedPath, 'utf8');
        configData = JSON.parse(raw);
      } catch (err) {
        errors.push(`${filePath}: cannot parse JSON -- ${err.message}`);
        continue;
      }

      errors.push(..._validate(ajv, schemaPath, configData, filePath));
    }
  }

  return {
    exitCode: errors.length > 0 ? 1 : 0,
    errors,
  };
}

/**
 * Returns true if the given file path should be treated as a config JSON.
 *
 * In normal (pre-commit) mode: path must contain /config/ and not /config/schema/.
 * In test mode (opts.schemaDir provided): match by .json extension not under /schema/.
 *
 * @param {string} filePath
 * @param {object} opts
 * @returns {boolean}
 */
function isConfigJson(filePath, opts = {}) {
  if (!filePath.endsWith('.json')) return false;
  const normalized = filePath.replace(/\\/g, '/');
  // Never match schema files themselves
  if (/\/schema\//.test(normalized) || /config\/schema/.test(normalized)) return false;

  // Normal mode: require /config/ in path
  if (!opts.schemaDir) {
    return /\/config\/[^/]+\.json$/.test(normalized) ||
           /^config\/[^/]+\.json$/.test(normalized);
  }

  // Test mode (schemaDir overridden): match any .json that has a known schema
  // Just return true for .json files not under schema — the schema lookup will skip if no schema found
  return true;
}

/**
 * Compile the schema at schemaPath and validate data.
 * Returns array of error strings (empty = valid).
 *
 * @param {Ajv} ajv
 * @param {string} schemaPath
 * @param {unknown} data
 * @param {string} label - file label for error messages
 * @returns {string[]}
 */
function _validate(ajv, schemaPath, data, label) {
  let schema;
  try {
    const raw = fs.readFileSync(schemaPath, 'utf8');
    schema = JSON.parse(raw);
  } catch (err) {
    return [`${label}: cannot load schema ${schemaPath} -- ${err.message}`];
  }

  const schemaForCompile = Object.assign({}, schema);
  schemaForCompile.$id = schemaForCompile.$id || `file://${path.resolve(schemaPath)}`;
  delete schemaForCompile.$schema;

  try { ajv.removeSchema(schemaForCompile.$id); } catch (_) { /* ok */ }

  let validate;
  try {
    validate = ajv.compile(schemaForCompile);
  } catch (err) {
    return [`${label}: schema compile error -- ${err.message}`];
  }

  const valid = validate(data);
  if (valid) return [];

  return (validate.errors || []).map(e => {
    const field = e.instancePath || '(root)';
    return `${label}: ${field} ${e.message} (AJV path: ${e.instancePath})`;
  });
}

/**
 * Get staged file paths from git.
 * @returns {string[]}
 */
function getStagedFiles() {
  try {
    // execSync with hardcoded command string -- no user input, safe from injection
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
    });
    return output.trim().split('\n').filter(Boolean).map(f => path.join(PROJECT_ROOT, f));
  } catch (_) {
    return [];
  }
}

module.exports = { validateStagedFiles, isConfigJson };

// CLI entry point
if (require.main === module) {
  const stagedFiles = getStagedFiles();
  validateStagedFiles(stagedFiles)
    .then(({ exitCode, errors }) => {
      if (errors.length > 0) {
        process.stderr.write('[pre-commit-schema-validate] Validation failures:\n');
        for (const e of errors) {
          process.stderr.write(`  ${e}\n`);
        }
      }
      process.exit(exitCode);
    })
    .catch(err => {
      process.stderr.write(`[pre-commit-schema-validate] Unexpected error: ${err.message}\n`);
      process.exit(1);
    });
}

'use strict';

/**
 * test/config-validator-coverage.test.js
 *
 * Phase 16 branch coverage safety margin for src/config-validator.js.
 * Targets the branches that were still uncovered after the existing
 * test/config-validator.test.js suite:
 *   L50-52    validateFile: schema file malformed JSON
 *   L84-86    validateFile: AJV compile error (structurally invalid schema)
 *   L125     validateAll: readdir(schemaDir) throws (ENOENT)
 *   L136-142  validateAll: schema exists but config file missing → WARNING
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateFile, validateAll } = require('../src/config-validator');

describe('config-validator coverage margin', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cfgval-cov-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* cleanup */ }
  });

  // ── validateFile error paths ─────────────────────────────────────────────

  test('returns ERROR when schema file is malformed JSON (L50-52)', async () => {
    const schemaPath = path.join(tmpDir, 'bad.schema.json');
    const configPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(schemaPath, '{ bad json', 'utf8');
    fs.writeFileSync(configPath, '{}', 'utf8');

    const result = await validateFile(configPath, schemaPath);

    expect(result.status).toBe('ERROR');
    expect(result.errors[0].message).toMatch(/Schema parse error/);
  });

  test('returns ERROR when config file is malformed JSON (L62)', async () => {
    const schemaPath = path.join(tmpDir, 'ok.schema.json');
    const configPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(schemaPath, JSON.stringify({ type: 'object' }), 'utf8');
    fs.writeFileSync(configPath, '{ malformed', 'utf8');

    const result = await validateFile(configPath, schemaPath);

    expect(result.status).toBe('ERROR');
    expect(result.errors[0].message).toMatch(/Config parse error/);
  });

  test('returns ERROR when schema is structurally invalid (AJV compile error) (L84-86)', async () => {
    const schemaPath = path.join(tmpDir, 'invalid.schema.json');
    const configPath = path.join(tmpDir, 'any.json');
    // "type": 42 is invalid — AJV will throw during compile
    fs.writeFileSync(schemaPath, JSON.stringify({ type: 42 }), 'utf8');
    fs.writeFileSync(configPath, '{}', 'utf8');

    const result = await validateFile(configPath, schemaPath);

    expect(result.status).toBe('ERROR');
    expect(result.errors[0].message).toMatch(/Schema compile error/);
  });

  // ── validateAll error paths ──────────────────────────────────────────────

  test('throws when schema directory does not exist (L125)', async () => {
    const missingSchemaDir = path.join(tmpDir, 'does-not-exist-schemas');
    const configDir = tmpDir;

    await expect(validateAll(configDir, missingSchemaDir)).rejects.toThrow(
      /Cannot read schema directory/
    );
  });

  test('returns WARNING when schema exists but config file is missing (L136-142)', async () => {
    const schemaDir = path.join(tmpDir, 'schema');
    const configDir = tmpDir;
    fs.mkdirSync(schemaDir);
    // Schema with no matching config file
    fs.writeFileSync(
      path.join(schemaDir, 'orphan.schema.json'),
      JSON.stringify({ type: 'object' }),
      'utf8'
    );

    const results = await validateAll(configDir, schemaDir);

    const orphan = results.find(r => r.schema.includes('orphan.schema.json'));
    expect(orphan).toBeDefined();
    expect(orphan.status).toBe('WARNING');
    expect(orphan.errors[0].message).toMatch(/Config file not found/);
  });

  test('returns PASS for valid schema + config pair', async () => {
    const schemaDir = path.join(tmpDir, 'schema');
    const configDir = tmpDir;
    fs.mkdirSync(schemaDir);
    fs.writeFileSync(
      path.join(schemaDir, 'thing.schema.json'),
      JSON.stringify({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(configDir, 'thing.json'),
      JSON.stringify({ name: 'foo' }),
      'utf8'
    );

    const results = await validateAll(configDir, schemaDir);
    const thing = results.find(r => r.schema.includes('thing.schema.json'));
    expect(thing.status).toBe('PASS');
  });

  test('returns FAIL when config does not match schema', async () => {
    const schemaDir = path.join(tmpDir, 'schema');
    const configDir = tmpDir;
    fs.mkdirSync(schemaDir);
    fs.writeFileSync(
      path.join(schemaDir, 'strict.schema.json'),
      JSON.stringify({ type: 'object', required: ['id'], properties: { id: { type: 'number' } } }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(configDir, 'strict.json'),
      JSON.stringify({ id: 'not-a-number' }),
      'utf8'
    );

    const results = await validateAll(configDir, schemaDir);
    const strict = results.find(r => r.schema.includes('strict.schema.json'));
    expect(strict.status).toBe('FAIL');
    expect(strict.errors.length).toBeGreaterThan(0);
  });
});

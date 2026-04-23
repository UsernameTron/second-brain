'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateFile, validateAll } = require('../src/config-validator');

const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
const SCHEMA_DIR = path.join(PROJECT_ROOT, 'config', 'schema');

describe('config-validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-validator-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------ //
  // Integration tests against real config files
  // ------------------------------------------------------------------ //

  describe('validateAll() — real config directory', () => {
    let results;

    beforeAll(async () => {
      results = await validateAll(CONFIG_DIR, SCHEMA_DIR);
    });

    test('returns an array of results', () => {
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    test('Test 1: connectors.json validates as PASS', () => {
      const r = results.find(r => path.basename(r.file) === 'connectors.json');
      expect(r).toBeDefined();
      expect(r.status).toBe('PASS');
      expect(r.errors).toHaveLength(0);
    });

    test('Test 2: pipeline.json validates as PASS', () => {
      const r = results.find(r => path.basename(r.file) === 'pipeline.json');
      expect(r).toBeDefined();
      expect(r.status).toBe('PASS');
      expect(r.errors).toHaveLength(0);
    });

    test('Test 3: templates.json validates as PASS', () => {
      const r = results.find(r => path.basename(r.file) === 'templates.json');
      expect(r).toBeDefined();
      expect(r.status).toBe('PASS');
      expect(r.errors).toHaveLength(0);
    });

    test('Test 4: memory-categories.json missing — returns WARNING (not error)', () => {
      const r = results.find(r => path.basename(r.file) === 'memory-categories.json');
      expect(r).toBeDefined();
      expect(r.status).toBe('WARNING');
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.errors[0].message).toMatch(/not found/i);
    });

    test('configs without schemas (excluded-terms, scheduling, vault-paths) are not in results', () => {
      const names = results.map(r => path.basename(r.file));
      expect(names).not.toContain('excluded-terms.json');
      expect(names).not.toContain('scheduling.json');
      expect(names).not.toContain('vault-paths.json');
    });
  });

  // ------------------------------------------------------------------ //
  // Unit tests for edge cases using temp files
  // ------------------------------------------------------------------ //

  describe('validateFile() — unit tests with temp fixtures', () => {
    const simpleSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1 },
        count: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    };

    function writeTmp(filename, content) {
      const filePath = path.join(tmpDir, filename);
      fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      return filePath;
    }

    test('Test 5: malformed JSON config — returns ERROR with parse error message', async () => {
      const schemaPath = writeTmp('valid.schema.json', simpleSchema);
      const configPath = writeTmp('broken.json', '{ this is not valid JSON }');
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('ERROR');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toBeTruthy();
    });

    test('Test 6: config with schema violation — returns FAIL with JSON path and description', async () => {
      const schemaPath = writeTmp('schema.schema.json', simpleSchema);
      const configPath = writeTmp('invalid.json', { name: 123 }); // name should be string
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
      expect(result.errors.length).toBeGreaterThan(0);
      const err = result.errors[0];
      expect(err).toHaveProperty('path');
      expect(err).toHaveProperty('message');
      expect(err.message).toBeTruthy();
    });

    test('valid config — returns PASS with empty errors array', async () => {
      const schemaPath = writeTmp('schema.schema.json', simpleSchema);
      const configPath = writeTmp('valid.json', { name: 'hello', count: 5 });
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('PASS');
      expect(result.errors).toHaveLength(0);
    });

    test('missing required field — returns FAIL with error referencing the missing field', async () => {
      const schemaPath = writeTmp('schema.schema.json', simpleSchema);
      const configPath = writeTmp('missing-required.json', { count: 5 }); // missing required name
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------ //
  // Test 7: exit code behaviour via main()
  // ------------------------------------------------------------------ //

  describe('main() exit code', () => {
    test('Test 7: exit code 0 when all results are PASS or WARNING', async () => {
      // Use real config dir — should exit 0 (connectors/pipeline/templates PASS, memory-categories WARNING)
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const { main } = require('../src/config-validator');
      await main(CONFIG_DIR, SCHEMA_DIR);

      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    test('exit code 1 when any result is FAIL or ERROR', async () => {
      const schemaDir = path.join(tmpDir, 'schema');
      fs.mkdirSync(schemaDir);
      const configDir = path.join(tmpDir, 'config');
      fs.mkdirSync(configDir);

      // Write a schema
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      };
      fs.writeFileSync(path.join(schemaDir, 'myfile.schema.json'), JSON.stringify(schema));
      // Write a violating config
      fs.writeFileSync(path.join(configDir, 'myfile.json'), JSON.stringify({ name: 999 }));

      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const { main } = require('../src/config-validator');
      await main(configDir, schemaDir);

      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });
});

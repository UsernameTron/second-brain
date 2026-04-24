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

    test('1: connectors.json validates as PASS', () => {
      const r = results.find(r => path.basename(r.file) === 'connectors.json');
      expect(r).toBeDefined();
      expect(r.status).toBe('PASS');
      expect(r.errors).toHaveLength(0);
    });

    test('2: pipeline.json validates as PASS', () => {
      const r = results.find(r => path.basename(r.file) === 'pipeline.json');
      expect(r).toBeDefined();
      expect(r.status).toBe('PASS');
      expect(r.errors).toHaveLength(0);
    });

    test('3: templates.json validates as PASS', () => {
      const r = results.find(r => path.basename(r.file) === 'templates.json');
      expect(r).toBeDefined();
      expect(r.status).toBe('PASS');
      expect(r.errors).toHaveLength(0);
    });

    test('4: memory-categories.json validates as PASS', () => {
      const r = results.find(r => path.basename(r.file) === 'memory-categories.json');
      expect(r).toBeDefined();
      expect(r.status).toBe('PASS');
      expect(r.errors).toHaveLength(0);
    });

    test('5: excluded-terms.json validates as PASS', () => {
      const r = results.find(r => path.basename(r.file) === 'excluded-terms.json');
      expect(r).toBeDefined();
      expect(r.status).toBe('PASS');
      expect(r.errors).toHaveLength(0);
    });

    test('6: scheduling.json validates as PASS', () => {
      const r = results.find(r => path.basename(r.file) === 'scheduling.json');
      expect(r).toBeDefined();
      expect(r.status).toBe('PASS');
      expect(r.errors).toHaveLength(0);
    });

    test('7: vault-paths.json validates as PASS', () => {
      const r = results.find(r => path.basename(r.file) === 'vault-paths.json');
      expect(r).toBeDefined();
      expect(r.status).toBe('PASS');
      expect(r.errors).toHaveLength(0);
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

    test('5: malformed JSON config — returns ERROR with parse error message', async () => {
      const schemaPath = writeTmp('valid.schema.json', simpleSchema);
      const configPath = writeTmp('broken.json', '{ this is not valid JSON }');
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('ERROR');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toBeTruthy();
    });

    test('6: config with schema violation — returns FAIL with JSON path and description', async () => {
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
    test('7: exit code 0 when all results are PASS or WARNING', async () => {
      // Use real config dir — should exit 0 (connectors/pipeline/templates PASS, memory-categories WARNING)
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const { main } = require('../src/config-validator');
      await main(CONFIG_DIR, SCHEMA_DIR);

      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    test('exit code 1 when any result is FAIL or ERROR (memory-categories WARNING does not trigger)', async () => {
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

  // ------------------------------------------------------------------ //
  // Schema-specific validation tests (T13.1-T13.3, T13.5)
  // ------------------------------------------------------------------ //

  describe('vault-paths schema validation', () => {
    function writeTmp(filename, content) {
      const filePath = path.join(tmpDir, filename);
      fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      return filePath;
    }

    const schemaPath = path.join(SCHEMA_DIR, 'vault-paths.schema.json');

    test('path with .. traversal fails', async () => {
      const configPath = writeTmp('traversal.json', { left: ['../etc'], right: ['memory'] });
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('absolute path fails', async () => {
      const configPath = writeTmp('absolute.json', { left: ['/etc/passwd'], right: ['memory'] });
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('empty left array fails', async () => {
      const configPath = writeTmp('empty-left.json', { left: [], right: ['memory'] });
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('haikuContextChars negative fails', async () => {
      const configPath = writeTmp('neg-ctx.json', { left: ['ABOUT ME'], right: ['memory'], haikuContextChars: -1 });
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('haikuContextChars over 200000 fails', async () => {
      const configPath = writeTmp('big-ctx.json', { left: ['ABOUT ME'], right: ['memory'], haikuContextChars: 200001 });
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('valid vault-paths passes', async () => {
      const configPath = writeTmp('valid-vp.json', { left: ['ABOUT ME'], right: ['memory', 'proposals'], haikuContextChars: 100 });
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('PASS');
    });
  });

  describe('scheduling schema validation', () => {
    function writeTmp(filename, content) {
      const filePath = path.join(tmpDir, filename);
      fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      return filePath;
    }

    const schemaPath = path.join(SCHEMA_DIR, 'scheduling.schema.json');

    test('bad cron (6 fields) fails', async () => {
      const configPath = writeTmp('bad-cron.json', {
        trigger: { name: 'test', id: 'trig_x', schedule: '0 0 * * * *', model: 'claude-sonnet-4-6' },
      });
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('missing trigger.id fails', async () => {
      const configPath = writeTmp('no-id.json', {
        trigger: { name: 'test', schedule: '0 0 * * *', model: 'claude-sonnet-4-6' },
      });
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('number for schedule fails', async () => {
      const configPath = writeTmp('bad-type.json', {
        trigger: { name: 'test', id: 'trig_x', schedule: 12345, model: 'claude-sonnet-4-6' },
      });
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('valid minimal trigger passes', async () => {
      const configPath = writeTmp('valid-sched.json', {
        trigger: { name: 'test', id: 'trig_x', schedule: '45 11 * * 1-5', model: 'claude-sonnet-4-6' },
      });
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('PASS');
    });
  });

  describe('excluded-terms schema validation', () => {
    function writeTmp(filename, content) {
      const filePath = path.join(tmpDir, filename);
      fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      return filePath;
    }

    const schemaPath = path.join(SCHEMA_DIR, 'excluded-terms.schema.json');

    test('empty array fails (minItems: 1)', async () => {
      const configPath = writeTmp('empty.json', []);
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('item with backtick fails', async () => {
      const configPath = writeTmp('backtick.json', ['valid', 'bad`term']);
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('item under 2 chars fails', async () => {
      const configPath = writeTmp('short.json', ['A']);
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('array over 100 items fails', async () => {
      const items = Array.from({ length: 101 }, (_, i) => `term-${i}`);
      const configPath = writeTmp('toomany.json', items);
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('FAIL');
    });

    test('valid array of strings passes', async () => {
      const configPath = writeTmp('valid-terms.json', ['Genesys', 'ISPN', 'Asana']);
      const result = await validateFile(configPath, schemaPath);
      expect(result.status).toBe('PASS');
    });
  });

  // ------------------------------------------------------------------ //
  // memory.semantic schema integration (Phase 19 additions)             //
  // ------------------------------------------------------------------ //

  describe('memory.semantic schema integration', () => {
    const pipelineSchemaPath = path.join(SCHEMA_DIR, 'pipeline.schema.json');

    // Minimal valid pipeline.json with a complete memory.semantic block
    const validPipelineBase = {
      classifier: { stage1ConfidenceThreshold: 0.8, stage2ConfidenceThreshold: 0.7, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
      extraction: { confidenceAccept: 0.75, confidenceLowConfidence: 0.5, chunkSize: 100, chunkOverlap: 10, oversizeThresholdBytes: 5242880, oversizeThresholdMessages: 2000 },
      wikilink: { relevanceThreshold: 0.6, maxSuggestions: 5, minSuggestions: 3, candidatePoolSize: 20 },
      promotion: { batchCapMax: 10, batchCapMin: 5, archiveEntriesThreshold: 500, archiveSizeThresholdKB: 200, proposalArchiveThreshold: 100 },
      retry: { delayMinutes: 15, maxAttempts: 3 },
      leftProposal: { autoArchiveDays: 14 },
      filename: { maxLength: 60, haikuWordRange: [4, 8] },
      slippage: { staleDays: 7, excludeProjects: [], maxProjects: 20 },
    };

    function writeTmpPipeline(filename, overrideMemory) {
      const content = overrideMemory !== undefined
        ? { ...validPipelineBase, memory: overrideMemory }
        : { ...validPipelineBase };
      const filePath = path.join(tmpDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
      return filePath;
    }

    test('pipeline.json with a complete valid memory.semantic block → { valid: true }', async () => {
      const configPath = writeTmpPipeline('sem-valid.json', {
        echoThreshold: 0.65,
        semantic: {
          model: 'voyage-4-lite',
          threshold: 0.72,
          recencyDecay: 0.2,
          rrfK: 60,
        },
      });
      const result = await validateFile(configPath, pipelineSchemaPath);
      expect(result.status).toBe('PASS');
      expect(result.errors).toHaveLength(0);
    });

    test('memory.semantic.threshold = 1.5 → FAIL (maximum is 1)', async () => {
      const configPath = writeTmpPipeline('sem-threshold-over.json', {
        semantic: {
          model: 'voyage-4-lite',
          threshold: 1.5,
          recencyDecay: 0.2,
          rrfK: 60,
        },
      });
      const result = await validateFile(configPath, pipelineSchemaPath);
      expect(result.status).toBe('FAIL');
      const thresholdError = result.errors.find(e =>
        (e.path && e.path.includes('threshold')) || (e.message && e.message.includes('maximum'))
      );
      expect(thresholdError).toBeDefined();
    });

    test('memory.semantic.model = "gpt-4" → FAIL (enum allows only voyage-4-lite)', async () => {
      const configPath = writeTmpPipeline('sem-bad-model.json', {
        semantic: {
          model: 'gpt-4',
          threshold: 0.72,
          recencyDecay: 0.2,
          rrfK: 60,
        },
      });
      const result = await validateFile(configPath, pipelineSchemaPath);
      expect(result.status).toBe('FAIL');
      const modelError = result.errors.find(e =>
        (e.path && e.path.includes('model')) || (e.message && e.message.toLowerCase().includes('enum'))
      );
      expect(modelError).toBeDefined();
    });

    test('live config/pipeline.json (with full memory.semantic block) → { valid: true }', async () => {
      const livePipelinePath = path.join(CONFIG_DIR, 'pipeline.json');
      const result = await validateFile(livePipelinePath, pipelineSchemaPath);
      expect(result.status).toBe('PASS');
      expect(result.errors).toHaveLength(0);
    });
  });
});

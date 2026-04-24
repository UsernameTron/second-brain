'use strict';

/**
 * config-schemas.test.js
 *
 * Tests that config files exist, are valid JSON, contain required content,
 * and validate against their JSON schemas.
 */

const fs = require('fs');
const path = require('path');

const { validateAgainstSchema } = require('../src/utils/validate-schema');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const SCHEMA_DIR = path.join(CONFIG_DIR, 'schema');

// Helper: load and parse JSON file, throw with useful context on failure
function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

// ── vault-paths.json tests ──────────────────────────────────────────────────

describe('config/vault-paths.json', () => {
  let vaultPaths;

  beforeAll(() => {
    vaultPaths = loadJson(path.join(CONFIG_DIR, 'vault-paths.json'));
  });

  test('parses as valid JSON', () => {
    expect(vaultPaths).toBeDefined();
    expect(typeof vaultPaths).toBe('object');
  });

  test('has non-empty right array', () => {
    expect(Array.isArray(vaultPaths.right)).toBe(true);
    expect(vaultPaths.right.length).toBeGreaterThan(0);
  });

  test('right array includes proposals/unrouted', () => {
    expect(vaultPaths.right).toContain('proposals/unrouted');
  });

  test('right array includes proposals/left-proposals', () => {
    expect(vaultPaths.right).toContain('proposals/left-proposals');
  });

  test('right array includes proposals/left-proposals/archive', () => {
    expect(vaultPaths.right).toContain('proposals/left-proposals/archive');
  });

  test('right array includes memory-proposals-archive', () => {
    expect(vaultPaths.right).toContain('memory-proposals-archive');
  });

  test('right array includes memory-archive', () => {
    expect(vaultPaths.right).toContain('memory-archive');
  });

  test('has non-empty left array', () => {
    expect(Array.isArray(vaultPaths.left)).toBe(true);
    expect(vaultPaths.left.length).toBeGreaterThan(0);
  });

  test('left and right arrays have no overlap', () => {
    const leftSet = new Set(vaultPaths.left);
    const overlap = vaultPaths.right.filter(r => leftSet.has(r));
    expect(overlap).toHaveLength(0);
  });
});

// ── pipeline.json tests ─────────────────────────────────────────────────────

describe('config/pipeline.json', () => {
  let pipeline;
  let schema;

  beforeAll(() => {
    pipeline = loadJson(path.join(CONFIG_DIR, 'pipeline.json'));
    schema = loadJson(path.join(SCHEMA_DIR, 'pipeline.schema.json'));
  });

  test('parses as valid JSON', () => {
    expect(pipeline).toBeDefined();
    expect(typeof pipeline).toBe('object');
  });

  test('validates against pipeline.schema.json', () => {
    const result = validateAgainstSchema(pipeline, schema);
    if (!result.valid) {
      throw new Error(`Schema validation failed:\n${result.errors.join('\n')}`);
    }
    expect(result.valid).toBe(true);
  });

  test('has classifier section with stage1ConfidenceThreshold = 0.8', () => {
    expect(pipeline.classifier).toBeDefined();
    expect(pipeline.classifier.stage1ConfidenceThreshold).toBe(0.8);
  });

  test('has classifier section with stage2ConfidenceThreshold = 0.7', () => {
    expect(pipeline.classifier.stage2ConfidenceThreshold).toBe(0.7);
  });

  test('has classifier section with sonnetEscalationThreshold = 0.8', () => {
    expect(pipeline.classifier.sonnetEscalationThreshold).toBe(0.8);
  });

  test('has classifier section with sonnetAcceptThreshold = 0.7', () => {
    expect(pipeline.classifier.sonnetAcceptThreshold).toBe(0.7);
  });

  test('has extraction section with confidenceAccept = 0.75', () => {
    expect(pipeline.extraction).toBeDefined();
    expect(pipeline.extraction.confidenceAccept).toBe(0.75);
  });

  test('has extraction section with oversizeThresholdBytes', () => {
    expect(pipeline.extraction.oversizeThresholdBytes).toBeDefined();
    expect(typeof pipeline.extraction.oversizeThresholdBytes).toBe('number');
  });

  test('has wikilink section with relevanceThreshold = 0.6', () => {
    expect(pipeline.wikilink).toBeDefined();
    expect(pipeline.wikilink.relevanceThreshold).toBe(0.6);
  });

  test('has promotion section with batchCapMax = 10', () => {
    expect(pipeline.promotion).toBeDefined();
    expect(pipeline.promotion.batchCapMax).toBe(10);
  });

  test('has retry section with maxAttempts = 3', () => {
    expect(pipeline.retry).toBeDefined();
    expect(pipeline.retry.maxAttempts).toBe(3);
  });

  test('has leftProposal section with autoArchiveDays = 14', () => {
    expect(pipeline.leftProposal).toBeDefined();
    expect(pipeline.leftProposal.autoArchiveDays).toBe(14);
  });

  test('has filename section with maxLength = 60', () => {
    expect(pipeline.filename).toBeDefined();
    expect(pipeline.filename.maxLength).toBe(60);
  });
});

// ── templates.json tests ────────────────────────────────────────────────────

describe('config/templates.json', () => {
  let templates;
  let schema;

  beforeAll(() => {
    templates = loadJson(path.join(CONFIG_DIR, 'templates.json'));
    schema = loadJson(path.join(SCHEMA_DIR, 'templates.schema.json'));
  });

  test('parses as valid JSON', () => {
    expect(templates).toBeDefined();
    expect(typeof templates).toBe('object');
  });

  test('validates against templates.schema.json', () => {
    const result = validateAgainstSchema(templates, schema);
    if (!result.valid) {
      throw new Error(`Schema validation failed:\n${result.errors.join('\n')}`);
    }
    expect(result.valid).toBe(true);
  });

  test('has domain-templates key', () => {
    expect(templates['domain-templates']).toBeDefined();
    expect(typeof templates['domain-templates']).toBe('object');
  });

  test('domain-templates has exactly 3 entries', () => {
    const keys = Object.keys(templates['domain-templates']);
    expect(keys).toHaveLength(3);
  });

  test('domain-templates includes briefings', () => {
    expect(templates['domain-templates']['briefings']).toBeDefined();
  });

  test('domain-templates includes job-hunt', () => {
    expect(templates['domain-templates']['job-hunt']).toBeDefined();
  });

  test('domain-templates includes interview-prep', () => {
    expect(templates['domain-templates']['interview-prep']).toBeDefined();
  });

  test('briefings template has required fields', () => {
    const fields = templates['domain-templates']['briefings'].fields;
    expect(Array.isArray(fields)).toBe(true);
    expect(fields).toContain('attendees');
    expect(fields).toContain('meeting-date');
    expect(fields).toContain('decisions');
    expect(fields).toContain('follow-ups');
  });

  test('job-hunt template has required fields', () => {
    const fields = templates['domain-templates']['job-hunt'].fields;
    expect(Array.isArray(fields)).toBe(true);
    expect(fields).toContain('company');
    expect(fields).toContain('role-title');
    expect(fields).toContain('stage');
    expect(fields).toContain('next-step-date');
    expect(fields).toContain('source-url');
  });

  test('interview-prep template has required fields', () => {
    const fields = templates['domain-templates']['interview-prep'].fields;
    expect(Array.isArray(fields)).toBe(true);
    expect(fields).toContain('company');
    expect(fields).toContain('role');
    expect(fields).toContain('interview-date');
    expect(fields).toContain('interviewer');
    expect(fields).toContain('stories-selected');
    expect(fields).toContain('risk-questions');
  });

  test('has memory-categories key', () => {
    expect(templates['memory-categories']).toBeDefined();
    expect(typeof templates['memory-categories']).toBe('object');
  });

  test('memory-categories has exactly 7 entries', () => {
    const keys = Object.keys(templates['memory-categories']);
    expect(keys).toHaveLength(7);
  });

  test('memory-categories includes all 7 required categories', () => {
    const cats = templates['memory-categories'];
    expect(cats['DECISION']).toBeDefined();
    expect(cats['LEARNING']).toBeDefined();
    expect(cats['PREFERENCE']).toBeDefined();
    expect(cats['RELATIONSHIP']).toBeDefined();
    expect(cats['CONSTRAINT']).toBeDefined();
    expect(cats['PATTERN']).toBeDefined();
    expect(cats['OTHER']).toBeDefined();
  });

  test('each memory-category has description, example, and exclusions', () => {
    const cats = templates['memory-categories'];
    for (const [_name, cat] of Object.entries(cats)) {
      expect(cat.description).toBeDefined();
      expect(typeof cat.description).toBe('string');
      expect(cat.example).toBeDefined();
      expect(typeof cat.example).toBe('string');
      expect(cat.exclusions).toBeDefined();
      expect(typeof cat.exclusions).toBe('string');
    }
  });

  test('OTHER category notes justification requirement', () => {
    const other = templates['memory-categories']['OTHER'];
    // Per D-23: OTHER requires one-sentence justification
    const notesJustification =
      other.description.toLowerCase().includes('justification') ||
      other.exclusions.toLowerCase().includes('justification') ||
      JSON.stringify(other).toLowerCase().includes('justification');
    expect(notesJustification).toBe(true);
  });
});

// ── Schema files existence tests ─────────────────────────────────────────────

describe('config/schema/ files', () => {
  test('pipeline.schema.json exists', () => {
    expect(() => loadJson(path.join(SCHEMA_DIR, 'pipeline.schema.json'))).not.toThrow();
  });

  test('templates.schema.json exists', () => {
    expect(() => loadJson(path.join(SCHEMA_DIR, 'templates.schema.json'))).not.toThrow();
  });

  test('memory-categories.schema.json exists', () => {
    expect(() => loadJson(path.join(SCHEMA_DIR, 'memory-categories.schema.json'))).not.toThrow();
  });

  test('memory-categories.schema.json validates a correct category map', () => {
    const schema = loadJson(path.join(SCHEMA_DIR, 'memory-categories.schema.json'));
    const validMap = {
      DECISION: {
        description: 'A deliberate choice between alternatives',
        example: 'Chose JWT over sessions for stateless auth',
        exclusions: 'Routine actions, status updates'
      }
    };
    const result = validateAgainstSchema(validMap, schema);
    expect(result.valid).toBe(true);
  });

  test('memory-categories.schema.json rejects category missing description', () => {
    const schema = loadJson(path.join(SCHEMA_DIR, 'memory-categories.schema.json'));
    const invalidMap = {
      DECISION: {
        example: 'An example',
        exclusions: 'Some exclusions'
        // missing description
      }
    };
    const result = validateAgainstSchema(invalidMap, schema);
    expect(result.valid).toBe(false);
  });
});

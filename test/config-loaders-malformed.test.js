'use strict';

/**
 * test/config-loaders-malformed.test.js
 *
 * Phase 16 (B-13/B-17): malformed-input tests for every config loader.
 *
 * Per CONTEXT.md decisions:
 *   D-06: Two direct tests against loadConfigWithOverlay — JSON parse failure
 *         and schema validation failure. Covers the contract once.
 *   D-07: Six smoke tests — one per loader, malformed JSON fixture, verifying
 *         each loader wires through the overlay helper and surfaces the error
 *         correctly (throw vs safe default, depending on the loader's contract).
 *
 * Why not a full 12-test matrix (JSON + schema per loader): schema validation
 * logic is identical across loaders (they all go through loadConfigWithOverlay).
 * One direct schema-failure test proves the shared path works.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const realConfigDir = path.join(__dirname, '..', 'config');

function makeTempConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-malformed-'));
}

function cleanup(tmpDir) {
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* cleanup */ }
  }
}

// ── Direct loadConfigWithOverlay tests (D-06) ────────────────────────────────

describe('loadConfigWithOverlay error paths', () => {
  let tmpDir;

  afterEach(() => {
    delete process.env.CONFIG_DIR_OVERRIDE;
    jest.resetModules();
    cleanup(tmpDir);
    tmpDir = null;
  });

  test('throws SyntaxError-shaped error when base JSON is malformed', () => {
    tmpDir = makeTempConfigDir();
    fs.writeFileSync(path.join(tmpDir, 'pipeline.json'), '{ invalid json ', 'utf8');
    process.env.CONFIG_DIR_OVERRIDE = tmpDir;
    jest.resetModules();

    const { loadConfigWithOverlay } = require('../src/pipeline-infra');

    expect(() => loadConfigWithOverlay('pipeline')).toThrow(/JSON|Unexpected/i);
  });

  test('throws schema violation error when merged config fails schema validation', () => {
    tmpDir = makeTempConfigDir();
    // Copy the real pipeline base + schema, but write an override that breaks schema
    fs.copyFileSync(
      path.join(realConfigDir, 'pipeline.json'),
      path.join(tmpDir, 'pipeline.json')
    );
    const schemaDir = path.join(tmpDir, 'schema');
    fs.mkdirSync(schemaDir);
    fs.copyFileSync(
      path.join(realConfigDir, 'schema', 'pipeline.schema.json'),
      path.join(schemaDir, 'pipeline.schema.json')
    );
    // Write a local overlay that violates schema (provider must be enum)
    fs.writeFileSync(
      path.join(tmpDir, 'pipeline.local.json'),
      JSON.stringify({ classifier: { llm: { provider: 'not-a-valid-provider' } } })
    );
    process.env.CONFIG_DIR_OVERRIDE = tmpDir;
    jest.resetModules();

    const { loadConfigWithOverlay } = require('../src/pipeline-infra');

    expect(() => loadConfigWithOverlay('pipeline', { validate: true })).toThrow(/violates schema/);
  });

  test('throws ENOENT-shaped error when base file is missing', () => {
    tmpDir = makeTempConfigDir();
    process.env.CONFIG_DIR_OVERRIDE = tmpDir;
    jest.resetModules();

    const { loadConfigWithOverlay } = require('../src/pipeline-infra');

    expect(() => loadConfigWithOverlay('pipeline')).toThrow(/ENOENT|no such file/i);
  });

  test('throws when overlay local file is malformed JSON', () => {
    tmpDir = makeTempConfigDir();
    fs.copyFileSync(
      path.join(realConfigDir, 'pipeline.json'),
      path.join(tmpDir, 'pipeline.json')
    );
    fs.writeFileSync(path.join(tmpDir, 'pipeline.local.json'), '{ bad }', 'utf8');
    process.env.CONFIG_DIR_OVERRIDE = tmpDir;
    jest.resetModules();

    const { loadConfigWithOverlay } = require('../src/pipeline-infra');

    expect(() => loadConfigWithOverlay('pipeline')).toThrow();
  });
});

// ── Per-loader smoke tests (D-07) ────────────────────────────────────────────

describe('per-loader malformed JSON smoke tests', () => {
  let tmpDir;

  function writeMalformed(name) {
    tmpDir = makeTempConfigDir();
    fs.writeFileSync(path.join(tmpDir, `${name}.json`), '{ bad: unclosed', 'utf8');
    process.env.CONFIG_DIR_OVERRIDE = tmpDir;
    jest.resetModules();
  }

  afterEach(() => {
    delete process.env.CONFIG_DIR_OVERRIDE;
    jest.resetModules();
    cleanup(tmpDir);
    tmpDir = null;
  });

  test('loadPipelineConfig throws on malformed pipeline.json', () => {
    writeMalformed('pipeline');
    const { loadPipelineConfig } = require('../src/pipeline-infra');
    expect(() => loadPipelineConfig()).toThrow();
  });

  test('loadTemplatesConfig throws on malformed templates.json', () => {
    writeMalformed('templates');
    const { loadTemplatesConfig } = require('../src/pipeline-infra');
    expect(() => loadTemplatesConfig()).toThrow();
  });

  test('loadConnectorsConfig throws on malformed connectors.json', () => {
    writeMalformed('connectors');
    const { loadConnectorsConfig } = require('../src/pipeline-infra');
    expect(() => loadConnectorsConfig()).toThrow();
  });

  test('loadSchedulingConfig throws on malformed scheduling.json', () => {
    writeMalformed('scheduling');
    const { loadSchedulingConfig } = require('../src/pipeline-infra');
    expect(() => loadSchedulingConfig()).toThrow();
  });

  test('loadExcludedTerms returns [] on malformed excluded-terms.json (silent degrade)', () => {
    writeMalformed('excluded-terms');
    const { loadExcludedTerms } = require('../src/pipeline-infra');
    const result = loadExcludedTerms();
    expect(result).toEqual([]);
  });

  test('safeLoadVaultPaths returns safe default on malformed vault-paths.json', () => {
    writeMalformed('vault-paths');
    const { safeLoadVaultPaths } = require('../src/pipeline-infra');
    const result = safeLoadVaultPaths();
    expect(result).toEqual({ left: [], right: [], haikuContextChars: 100 });
  });

  test('safeLoadPipelineConfig returns { config: null, error } on malformed pipeline.json', () => {
    writeMalformed('pipeline');
    const { safeLoadPipelineConfig } = require('../src/pipeline-infra');
    const result = safeLoadPipelineConfig();
    expect(result.config).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

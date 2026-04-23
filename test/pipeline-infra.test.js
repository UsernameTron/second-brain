'use strict';

/**
 * pipeline-infra.test.js
 *
 * Tests for src/pipeline-infra.js — shared infrastructure module.
 * Covers: generateCorrelationId, createHaikuClient, createSonnetClient,
 *         writeDeadLetter, loadPipelineConfig, loadTemplatesConfig.
 *
 * Also tests chokidar-based hot-reload in vault-gateway.js (integration).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── generateCorrelationId ────────────────────────────────────────────────────

describe('generateCorrelationId', () => {
  let generateCorrelationId;

  beforeAll(() => {
    ({ generateCorrelationId } = require('../src/pipeline-infra'));
  });

  test('returns a string', () => {
    const id = generateCorrelationId();
    expect(typeof id).toBe('string');
  });

  test('returns a UUID v4 format string', () => {
    const id = generateCorrelationId();
    // UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx where y is 8, 9, a, or b
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidV4Regex.test(id)).toBe(true);
  });

  test('returns unique values on each call', () => {
    const ids = new Set();
    for (let i = 0; i < 10; i++) {
      ids.add(generateCorrelationId());
    }
    expect(ids.size).toBe(10);
  });
});

// ── createHaikuClient ────────────────────────────────────────────────────────

describe('createHaikuClient', () => {
  let createHaikuClient;
  let mockCreate;

  beforeAll(() => {
    // Mock @anthropic-ai/sdk before requiring pipeline-infra
    jest.mock('@anthropic-ai/sdk', () => {
      const mockCreate = jest.fn();
      return jest.fn().mockImplementation(() => ({
        messages: { create: mockCreate }
      }));
    });

    // Re-require to pick up the mock
    jest.resetModules();
    jest.mock('@anthropic-ai/sdk', () => {
      mockCreate = jest.fn();
      return jest.fn().mockImplementation(() => ({
        messages: { create: mockCreate }
      }));
    });
  });

  // Fresh mock setup per describe block
  beforeEach(() => {
    jest.resetModules();
    mockCreate = jest.fn();
    jest.mock('@anthropic-ai/sdk', () => {
      return jest.fn().mockImplementation(() => ({
        messages: { create: mockCreate }
      }));
    });
    ({ createHaikuClient } = require('../src/pipeline-infra'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.unmock('@anthropic-ai/sdk');
    jest.resetModules();
  });

  test('returns object with classify() method', () => {
    const client = createHaikuClient();
    expect(typeof client).toBe('object');
    expect(typeof client.classify).toBe('function');
  });

  test('classify() returns { success: true, data } on successful JSON response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: '{"label":"RIGHT","confidence":0.9}' }]
    });

    const client = createHaikuClient();
    const result = await client.classify('system prompt', 'user content');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ label: 'RIGHT', confidence: 0.9 });
  });

  test('classify() returns { success: false, failureMode: parse-error } on non-JSON response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'not valid json at all' }]
    });

    const client = createHaikuClient();
    const result = await client.classify('system prompt', 'user content');

    expect(result.success).toBe(false);
    expect(result.failureMode).toBe('parse-error');
    expect(typeof result.error).toBe('string');
  });

  test('classify() returns { success: false, failureMode: api-error } on API failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API request failed'));

    const client = createHaikuClient();
    const result = await client.classify('system prompt', 'user content');

    expect(result.success).toBe(false);
    expect(result.failureMode).toBe('api-error');
    expect(typeof result.error).toBe('string');
  });

  test('classify() never throws — all errors captured in return value', async () => {
    mockCreate.mockRejectedValueOnce(new Error('network timeout'));

    const client = createHaikuClient();
    await expect(client.classify('system prompt', 'user content')).resolves.toBeDefined();
  });
});

// ── createLlmClient — missing API key graceful degradation (FIX-04) ──────────

describe('createLlmClient — missing API key', () => {
  beforeEach(() => {
    jest.resetModules();
    // Mock SDK constructor to throw (simulates missing ANTHROPIC_API_KEY)
    jest.mock('@anthropic-ai/sdk', () => {
      return jest.fn().mockImplementation(() => {
        throw new Error('The ANTHROPIC_API_KEY environment variable is missing or empty');
      });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.unmock('@anthropic-ai/sdk');
    jest.resetModules();
  });

  test('createHaikuClient returns object with classify() when API key missing', () => {
    const { createHaikuClient } = require('../src/pipeline-infra');
    const client = createHaikuClient();
    expect(typeof client).toBe('object');
    expect(typeof client.classify).toBe('function');
  });

  test('classify() returns { success: false, failureMode: api-error } when API key missing', async () => {
    const { createHaikuClient } = require('../src/pipeline-infra');
    const client = createHaikuClient();
    const result = await client.classify('system prompt', 'user content');

    expect(result.success).toBe(false);
    expect(result.failureMode).toBe('api-error');
    expect(result.error).toMatch(/initialization failed|ANTHROPIC_API_KEY/i);
  });

  test('createSonnetClient also degrades gracefully when API key missing', async () => {
    const { createSonnetClient } = require('../src/pipeline-infra');
    const client = createSonnetClient();
    const result = await client.classify('system prompt', 'user content');

    expect(result.success).toBe(false);
    expect(result.failureMode).toBe('api-error');
  });
});

// ── createSonnetClient ───────────────────────────────────────────────────────

describe('createSonnetClient', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('@anthropic-ai/sdk', () => {
      return jest.fn().mockImplementation(() => ({
        messages: { create: jest.fn().mockResolvedValue({
          content: [{ text: '{"result":"ok"}' }]
        })}
      }));
    });
  });

  afterAll(() => {
    jest.unmock('@anthropic-ai/sdk');
    jest.resetModules();
  });

  test('createSonnetClient is exported and returns object with classify()', () => {
    const { createSonnetClient } = require('../src/pipeline-infra');
    const client = createSonnetClient();
    expect(typeof client).toBe('object');
    expect(typeof client.classify).toBe('function');
  });
});

// ── writeDeadLetter ──────────────────────────────────────────────────────────

describe('writeDeadLetter', () => {
  let writeDeadLetter;
  let tmpVaultRoot;

  beforeEach(() => {
    jest.resetModules();
    jest.unmock('@anthropic-ai/sdk');

    // Create temp vault root with required directory structure
    tmpVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-letter-test-'));
    fs.mkdirSync(path.join(tmpVaultRoot, 'proposals', 'unrouted'), { recursive: true });

    // Set environment for gateway to use our temp root
    process.env.VAULT_ROOT = tmpVaultRoot;

    ({ writeDeadLetter } = require('../src/pipeline-infra'));
  });

  afterEach(() => {
    delete process.env.VAULT_ROOT;
    jest.resetModules();
    // Cleanup temp dir
    try {
      fs.rmSync(tmpVaultRoot, { recursive: true, force: true });
    } catch (_) {}
  });

  test('writes a file to proposals/unrouted/ directory', async () => {
    await writeDeadLetter('test body content', 'api-error', 'test-correlation-id-1234');

    const files = fs.readdirSync(path.join(tmpVaultRoot, 'proposals', 'unrouted'));
    expect(files.length).toBeGreaterThan(0);
  });

  test('written file has correct YAML frontmatter fields', async () => {
    const correlationId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await writeDeadLetter('test body', 'api-error', correlationId);

    const files = fs.readdirSync(path.join(tmpVaultRoot, 'proposals', 'unrouted'));
    const content = fs.readFileSync(
      path.join(tmpVaultRoot, 'proposals', 'unrouted', files[0]),
      'utf8'
    );

    expect(content).toContain('failure-mode: api-error');
    expect(content).toContain(`correlation-id: ${correlationId}`);
    expect(content).toContain('status: unrouted');
    expect(content).toContain('retry-count: 0');
    expect(content).toContain('created:');
  });

  test('written file preserves original input body verbatim after frontmatter', async () => {
    const inputBody = 'This is the original input body.\nMultiple lines preserved verbatim.';
    await writeDeadLetter(inputBody, 'timeout', 'test-id-5678');

    const files = fs.readdirSync(path.join(tmpVaultRoot, 'proposals', 'unrouted'));
    const content = fs.readFileSync(
      path.join(tmpVaultRoot, 'proposals', 'unrouted', files[0]),
      'utf8'
    );

    // The body should appear after the closing --- of frontmatter
    const afterFrontmatter = content.split('---\n').slice(2).join('---\n');
    expect(afterFrontmatter.trim()).toContain(inputBody);
  });

  test('filename follows the expected pattern with date and correlation ID prefix', async () => {
    const correlationId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    await writeDeadLetter('body', 'parse-error', correlationId);

    const files = fs.readdirSync(path.join(tmpVaultRoot, 'proposals', 'unrouted'));
    const filename = files[0];

    // Pattern: unrouted-YYYYMMDD-HHmmss-<first8ofCorrelationId>.md
    expect(filename).toMatch(/^unrouted-\d{8}-\d{6}-[a-z0-9]+\.md$/);
    expect(filename).toContain('bbbbbbbb');
  });

  test('uses original-source from metadata or defaults to unknown', async () => {
    await writeDeadLetter('body', 'api-error', 'test-corr-id-9999', { source: 'session:abc123' });

    const files = fs.readdirSync(path.join(tmpVaultRoot, 'proposals', 'unrouted'));
    const content = fs.readFileSync(
      path.join(tmpVaultRoot, 'proposals', 'unrouted', files[0]),
      'utf8'
    );

    expect(content).toContain('original-source: session:abc123');
  });

  test('defaults original-source to unknown when no metadata provided', async () => {
    await writeDeadLetter('body', 'timeout', 'test-corr-id-0000');

    const files = fs.readdirSync(path.join(tmpVaultRoot, 'proposals', 'unrouted'));
    const content = fs.readFileSync(
      path.join(tmpVaultRoot, 'proposals', 'unrouted', files[0]),
      'utf8'
    );

    expect(content).toContain('original-source: unknown');
  });
});

// ── loadPipelineConfig ───────────────────────────────────────────────────────

describe('loadPipelineConfig', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.unmock('@anthropic-ai/sdk');
  });

  test('returns parsed pipeline.json content', () => {
    const { loadPipelineConfig } = require('../src/pipeline-infra');
    const config = loadPipelineConfig();
    expect(typeof config).toBe('object');
    expect(config.classifier).toBeDefined();
    expect(config.classifier.stage1ConfidenceThreshold).toBe(0.8);
  });

  test('returns object with all required top-level sections', () => {
    const { loadPipelineConfig } = require('../src/pipeline-infra');
    const config = loadPipelineConfig();
    expect(config.classifier).toBeDefined();
    expect(config.extraction).toBeDefined();
    expect(config.wikilink).toBeDefined();
    expect(config.promotion).toBeDefined();
    expect(config.retry).toBeDefined();
    expect(config.leftProposal).toBeDefined();
    expect(config.filename).toBeDefined();
  });
});

// ── config overlay (pipeline.local.json) ────────────────────────────────────

describe('loadConfigWithOverlay', () => {
  let tmpDir, configDir;
  const realConfigDir = path.join(__dirname, '..', 'config');

  function setupTempConfig(localOverrides) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-'));
    configDir = tmpDir;
    // Copy base pipeline.json
    fs.copyFileSync(
      path.join(realConfigDir, 'pipeline.json'),
      path.join(configDir, 'pipeline.json')
    );
    // Copy schema
    const schemaDir = path.join(configDir, 'schema');
    fs.mkdirSync(schemaDir);
    fs.copyFileSync(
      path.join(realConfigDir, 'schema', 'pipeline.schema.json'),
      path.join(schemaDir, 'pipeline.schema.json')
    );
    // Write local overlay if provided
    if (localOverrides) {
      fs.writeFileSync(
        path.join(configDir, 'pipeline.local.json'),
        JSON.stringify(localOverrides, null, 2)
      );
    }
    process.env.CONFIG_DIR_OVERRIDE = configDir;
    jest.resetModules();
  }

  afterEach(() => {
    delete process.env.CONFIG_DIR_OVERRIDE;
    jest.resetModules();
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('overlay merges correctly — overridden value applied, base values unchanged', () => {
    setupTempConfig({ classifier: { llm: { provider: 'local' } } });
    const { loadPipelineConfig } = require('../src/pipeline-infra');
    const config = loadPipelineConfig();
    expect(config.classifier.llm.provider).toBe('local');
    expect(config.classifier.stage1ConfidenceThreshold).toBe(0.8);
  });

  test('deep-merge preserves sibling fields within nested objects', () => {
    setupTempConfig({ classifier: { llm: { localEndpoint: 'http://localhost:9999' } } });
    const { loadPipelineConfig } = require('../src/pipeline-infra');
    const config = loadPipelineConfig();
    expect(config.classifier.llm.localEndpoint).toBe('http://localhost:9999');
    expect(config.classifier.llm.provider).toBe('anthropic');
    expect(config.classifier.llm.localModel).toBe('qwen2.5-coder-7b');
  });

  test('no overlay present — returns base config unchanged', () => {
    setupTempConfig(null);
    const { loadPipelineConfig } = require('../src/pipeline-infra');
    const config = loadPipelineConfig();
    expect(config.classifier.llm.provider).toBe('anthropic');
    expect(config.classifier.stage1ConfidenceThreshold).toBe(0.8);
  });

  test('schema-violation overlay throws with descriptive error', () => {
    setupTempConfig({ classifier: { llm: { provider: 'invalid-provider' } } });
    const { loadPipelineConfig } = require('../src/pipeline-infra');
    expect(() => loadPipelineConfig()).toThrow(/violates schema/);
  });

  test('base file on disk is not mutated by overlay merge', () => {
    setupTempConfig({ classifier: { llm: { provider: 'local' } } });
    const { loadPipelineConfig } = require('../src/pipeline-infra');
    loadPipelineConfig();
    const baseRaw = fs.readFileSync(path.join(configDir, 'pipeline.json'), 'utf8');
    const base = JSON.parse(baseRaw);
    expect(base.classifier.llm.provider).toBe('anthropic');
  });
});

// ── loadTemplatesConfig ──────────────────────────────────────────────────────

describe('loadTemplatesConfig', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.unmock('@anthropic-ai/sdk');
  });

  test('returns parsed templates.json content', () => {
    const { loadTemplatesConfig } = require('../src/pipeline-infra');
    const config = loadTemplatesConfig();
    expect(typeof config).toBe('object');
    expect(config['memory-categories']).toBeDefined();
  });

  test('returns object with domain-templates and memory-categories', () => {
    const { loadTemplatesConfig } = require('../src/pipeline-infra');
    const config = loadTemplatesConfig();
    expect(config['domain-templates']).toBeDefined();
    expect(config['memory-categories']).toBeDefined();
  });

  test('memory-categories has all 7 categories', () => {
    const { loadTemplatesConfig } = require('../src/pipeline-infra');
    const config = loadTemplatesConfig();
    const cats = config['memory-categories'];
    expect(cats['DECISION']).toBeDefined();
    expect(cats['LEARNING']).toBeDefined();
    expect(cats['PREFERENCE']).toBeDefined();
    expect(cats['RELATIONSHIP']).toBeDefined();
    expect(cats['CONSTRAINT']).toBeDefined();
    expect(cats['PATTERN']).toBeDefined();
    expect(cats['OTHER']).toBeDefined();
  });
});

// ── local LLM routing ───────────────────────────────────────────────────────

describe('local LLM routing', () => {
  let mockLogDecision;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    mockLogDecision = jest.fn();

    // Mock vault-gateway for logDecision
    jest.mock('../src/vault-gateway', () => ({
      logDecision: (...args) => mockLogDecision(...args),
      configEvents: { on: jest.fn(), once: jest.fn(), emit: jest.fn() },
      initGateway: jest.fn(),
    }));

    // Mock content-policy
    jest.mock('../src/content-policy', () => ({
      sanitizeTermForPrompt: jest.fn((t) => t),
    }));

    // Mock Anthropic SDK — always available for fallback
    jest.mock('@anthropic-ai/sdk', () => {
      const mockCreate = jest.fn().mockResolvedValue({
        content: [{ text: '{"label":"RIGHT","confidence":0.85}' }],
      });
      return jest.fn().mockImplementation(() => ({
        messages: { create: mockCreate },
      }));
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.unmock('@anthropic-ai/sdk');
    jest.unmock('../src/vault-gateway');
    jest.unmock('../src/content-policy');
    jest.resetModules();
  });

  function mockPipelineConfig(llmOverride) {
    const realFs = jest.requireActual('fs');
    const realPath = jest.requireActual('path');
    const configPath = realPath.join(__dirname, '..', 'config', 'pipeline.json');
    const baseConfig = JSON.parse(realFs.readFileSync(configPath, 'utf8'));
    if (llmOverride !== undefined) {
      baseConfig.classifier.llm = llmOverride;
    }
    jest.doMock('fs', () => {
      const actual = jest.requireActual('fs');
      return {
        ...actual,
        readFileSync: jest.fn((filePath, encoding) => {
          if (typeof filePath === 'string' && filePath.includes('pipeline.json')) {
            return JSON.stringify(baseConfig);
          }
          return actual.readFileSync(filePath, encoding);
        }),
      };
    });
  }

  test('when provider is "local" and endpoint responds, uses local endpoint', async () => {
    mockPipelineConfig({ provider: 'local', localEndpoint: 'http://localhost:1234', localModel: 'test-model' });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"label":"RIGHT","confidence":0.9}' } }],
      }),
    });

    const { createHaikuClient } = require('../src/pipeline-infra');
    const client = createHaikuClient();
    const result = await client.classify('system', 'content');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ label: 'RIGHT', confidence: 0.9 });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:1234/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('when local endpoint is unreachable, falls back to Anthropic', async () => {
    mockPipelineConfig({ provider: 'local', localEndpoint: 'http://localhost:1234', localModel: 'test-model' });

    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

    const { createHaikuClient } = require('../src/pipeline-infra');
    const client = createHaikuClient();
    const result = await client.classify('system', 'content');

    // Should fall back to Anthropic and succeed
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ label: 'RIGHT', confidence: 0.85 });
  });

  test('fallback logs via logDecision with FALLBACK reason', async () => {
    mockPipelineConfig({ provider: 'local', localEndpoint: 'http://localhost:1234', localModel: 'test-model' });

    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

    const { createHaikuClient } = require('../src/pipeline-infra');
    const client = createHaikuClient();
    await client.classify('system', 'content');

    expect(mockLogDecision).toHaveBeenCalledWith(
      'LLM_CLASSIFY',
      'test-model',
      'FALLBACK',
      expect.stringContaining('local endpoint unreachable')
    );
  });

  test('when provider is "anthropic", uses Anthropic SDK (default behavior)', async () => {
    mockPipelineConfig({ provider: 'anthropic', localEndpoint: 'http://localhost:1234', localModel: 'test-model' });

    global.fetch = jest.fn();

    const { createHaikuClient } = require('../src/pipeline-infra');
    const client = createHaikuClient();
    const result = await client.classify('system', 'content');

    expect(result.success).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('when llm config section is absent, defaults to Anthropic (backward compat)', async () => {
    mockPipelineConfig(undefined);
    // Remove llm key entirely
    jest.resetModules();
    const realFs = jest.requireActual('fs');
    const configPath = path.join(__dirname, '..', 'config', 'pipeline.json');
    const baseConfig = JSON.parse(realFs.readFileSync(configPath, 'utf8'));
    delete baseConfig.classifier.llm;
    jest.doMock('fs', () => {
      const actual = jest.requireActual('fs');
      return {
        ...actual,
        readFileSync: jest.fn((filePath, encoding) => {
          if (typeof filePath === 'string' && filePath.includes('pipeline.json')) {
            return JSON.stringify(baseConfig);
          }
          return actual.readFileSync(filePath, encoding);
        }),
      };
    });

    global.fetch = jest.fn();

    const { createHaikuClient } = require('../src/pipeline-infra');
    const client = createHaikuClient();
    const result = await client.classify('system', 'content');

    expect(result.success).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('local endpoint parse error returns parse-error without fallback', async () => {
    mockPipelineConfig({ provider: 'local', localEndpoint: 'http://localhost:1234', localModel: 'test-model' });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'not valid json' } }],
      }),
    });

    const { createHaikuClient } = require('../src/pipeline-infra');
    const client = createHaikuClient();
    const result = await client.classify('system', 'content');

    expect(result.success).toBe(false);
    expect(result.failureMode).toBe('parse-error');
  });
});

// ── Exports completeness ─────────────────────────────────────────────────────

describe('pipeline-infra module exports', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.unmock('@anthropic-ai/sdk');
  });

  test('exports all 6 required functions', () => {
    const infra = require('../src/pipeline-infra');
    expect(typeof infra.generateCorrelationId).toBe('function');
    expect(typeof infra.createHaikuClient).toBe('function');
    expect(typeof infra.createSonnetClient).toBe('function');
    expect(typeof infra.writeDeadLetter).toBe('function');
    expect(typeof infra.loadPipelineConfig).toBe('function');
    expect(typeof infra.loadTemplatesConfig).toBe('function');
  });
});

// ── vault-gateway.js chokidar hot-reload ─────────────────────────────────────

describe('vault-gateway.js chokidar hot-reload', () => {
  test('vault-gateway.js source contains chokidar (not raw fs.watch for config)', () => {
    const gatewaySource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'vault-gateway.js'),
      'utf8'
    );
    expect(gatewaySource).toContain('chokidar');
  });

  test('vault-gateway.js exports configEvents', () => {
    jest.resetModules();
    delete process.env.VAULT_ROOT;
    const gateway = require('../src/vault-gateway');
    expect(gateway.configEvents).toBeDefined();
    expect(typeof gateway.configEvents.on).toBe('function');
  });

  test('chokidar watch fires config:reloaded event on file change', (done) => {
    jest.resetModules();

    // Create isolated temp config dir
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chokidar-test-'));
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir);

    // Copy the real config files so loadConfig() works
    const realConfigDir = path.join(__dirname, '..', 'config');
    for (const file of ['vault-paths.json', 'excluded-terms.json', 'pipeline.json', 'templates.json']) {
      fs.copyFileSync(path.join(realConfigDir, file), path.join(configDir, file));
    }

    // Set env to use our temp config dir
    process.env.CONFIG_DIR_OVERRIDE = configDir;

    const { configEvents, initGateway } = require('../src/vault-gateway');

    configEvents.once('config:reloaded', () => {
      delete process.env.CONFIG_DIR_OVERRIDE;
      jest.resetModules();
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
      done();
    });

    // Initialize gateway with chokidar watching
    initGateway();

    // Give chokidar/watchFile time to initialize before triggering change
    setTimeout(() => {
      const vaultPaths = JSON.parse(fs.readFileSync(path.join(configDir, 'vault-paths.json'), 'utf8'));
      vaultPaths._testTimestamp = Date.now();
      fs.writeFileSync(path.join(configDir, 'vault-paths.json'), JSON.stringify(vaultPaths, null, 2));
    }, 1000);
  }, 10000);
});

// ── safeLoadVaultPaths (T12.2) ──────────────────────────────────────────────

describe('safeLoadVaultPaths', () => {
  const SAFE_DEFAULT = { left: [], right: [], haikuContextChars: 100 };
  let tmpDir, originalConfigDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-paths-test-'));
    originalConfigDir = process.env.CONFIG_DIR_OVERRIDE;
    process.env.CONFIG_DIR_OVERRIDE = tmpDir;
    // Clear module cache so pipeline-infra picks up new CONFIG_DIR
    jest.resetModules();
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.CONFIG_DIR_OVERRIDE;
    } else {
      process.env.CONFIG_DIR_OVERRIDE = originalConfigDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns parsed content for valid vault-paths.json', () => {
    const validConfig = { left: ['ABOUT ME'], right: ['memory'], haikuContextChars: 200 };
    fs.writeFileSync(path.join(tmpDir, 'vault-paths.json'), JSON.stringify(validConfig));
    const { safeLoadVaultPaths } = require('../src/pipeline-infra');
    expect(safeLoadVaultPaths()).toEqual(validConfig);
  });

  test('returns safe default for missing vault-paths.json', () => {
    const { safeLoadVaultPaths } = require('../src/pipeline-infra');
    expect(safeLoadVaultPaths()).toEqual(SAFE_DEFAULT);
  });

  test('returns safe default for malformed vault-paths.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'vault-paths.json'), '{ broken json!!!');
    const { safeLoadVaultPaths } = require('../src/pipeline-infra');
    expect(safeLoadVaultPaths()).toEqual(SAFE_DEFAULT);
  });

  test('calls logDecision on error with LOAD_ERROR', () => {
    // No vault-paths.json → triggers error path
    const mockLogDecision = jest.fn();
    jest.doMock('../src/vault-gateway', () => ({ logDecision: mockLogDecision }));
    const { safeLoadVaultPaths } = require('../src/pipeline-infra');
    safeLoadVaultPaths();
    expect(mockLogDecision).toHaveBeenCalledWith('CONFIG', 'vault-paths.json', 'LOAD_ERROR', expect.any(String));
  });
});

// ── safeLoadPipelineConfig (T12.3) ──────────────────────────────────────────

describe('safeLoadPipelineConfig', () => {
  let tmpDir, originalConfigDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-pipeline-config-'));
    originalConfigDir = process.env.CONFIG_DIR_OVERRIDE;
    process.env.CONFIG_DIR_OVERRIDE = tmpDir;
    jest.resetModules();
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.CONFIG_DIR_OVERRIDE;
    } else {
      process.env.CONFIG_DIR_OVERRIDE = originalConfigDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns { config, error: null } on valid config', () => {
    // Write a valid pipeline.json with required sections
    const validConfig = {
      classifier: { shortInputChars: 100 },
      extraction: {},
      wikilink: {},
      promotion: {},
      retry: {},
      leftProposal: {},
      filename: {},
      slippage: {},
    };
    fs.writeFileSync(path.join(tmpDir, 'pipeline.json'), JSON.stringify(validConfig));
    // Schema dir must exist but schema file is optional for non-validate path
    fs.mkdirSync(path.join(tmpDir, 'schema'), { recursive: true });
    const { safeLoadPipelineConfig } = require('../src/pipeline-infra');
    const result = safeLoadPipelineConfig();
    expect(result.error).toBeNull();
    expect(result.config).toMatchObject(validConfig);
  });

  test('returns { config: null, error } on malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'pipeline.json'), '{ bad json!!!');
    const { safeLoadPipelineConfig } = require('../src/pipeline-infra');
    const result = safeLoadPipelineConfig();
    expect(result.config).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  test('returns { config: null, error } on missing required section', () => {
    // Missing 'classifier' required section
    const partial = { extraction: {}, wikilink: {}, promotion: {}, retry: {}, leftProposal: {}, filename: {}, slippage: {} };
    fs.writeFileSync(path.join(tmpDir, 'pipeline.json'), JSON.stringify(partial));
    fs.mkdirSync(path.join(tmpDir, 'schema'), { recursive: true });
    const { safeLoadPipelineConfig } = require('../src/pipeline-infra');
    const result = safeLoadPipelineConfig();
    expect(result.config).toBeNull();
    expect(result.error.message).toContain('classifier');
  });

  test('calls logDecision with LOAD_ERROR on failure', () => {
    fs.writeFileSync(path.join(tmpDir, 'pipeline.json'), '{ broken');
    const mockLogDecision = jest.fn();
    jest.doMock('../src/vault-gateway', () => ({ logDecision: mockLogDecision }));
    const { safeLoadPipelineConfig } = require('../src/pipeline-infra');
    safeLoadPipelineConfig();
    expect(mockLogDecision).toHaveBeenCalledWith('CONFIG', 'pipeline.json', 'LOAD_ERROR', expect.any(String));
  });
});

// ── classifyLocal — T12.5 LLM fallback hardening ────────────────────────────

describe('classifyLocal — LLM fallback hardening', () => {
  let mockLogDecision;
  let mockAnthropicCreate;
  let tmpConfigDir;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    mockLogDecision = jest.fn();
    mockAnthropicCreate = jest.fn().mockResolvedValue({
      content: [{ text: '{"fallback":true}' }],
    });

    // Create temp config dir with local LLM provider — must include all required sections
    tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-test-'));
    const realConfigDir = path.join(__dirname, '..', 'config');
    const realConfig = JSON.parse(fs.readFileSync(path.join(realConfigDir, 'pipeline.json'), 'utf8'));
    realConfig.classifier.llm = {
      provider: 'local',
      localEndpoint: 'http://localhost:9999',
      localModel: 'test-model',
    };
    fs.writeFileSync(path.join(tmpConfigDir, 'pipeline.json'), JSON.stringify(realConfig));
    // Copy schema dir so validation passes
    const schemaDir = path.join(realConfigDir, 'schema');
    if (fs.existsSync(schemaDir)) {
      fs.cpSync(schemaDir, path.join(tmpConfigDir, 'schema'), { recursive: true });
    }
    process.env.CONFIG_DIR_OVERRIDE = tmpConfigDir;

    jest.doMock('../src/vault-gateway', () => ({
      logDecision: mockLogDecision,
      vaultWrite: jest.fn().mockResolvedValue({ decision: 'WRITTEN' }),
    }));
    jest.doMock('../src/content-policy', () => ({
      sanitizeTermForPrompt: jest.fn((t) => t),
    }));
    jest.doMock('@anthropic-ai/sdk', () => {
      return jest.fn().mockImplementation(() => ({
        messages: { create: mockAnthropicCreate },
      }));
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.CONFIG_DIR_OVERRIDE;
    jest.restoreAllMocks();
    try { fs.rmSync(tmpConfigDir, { recursive: true, force: true }); } catch (_) {}
  });

  afterAll(() => {
    jest.resetModules();
  });

  function loadClient() {
    const { createHaikuClient } = require('../src/pipeline-infra');
    return createHaikuClient();
  }

  test('falls back to Anthropic on AbortError (timeout)', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    const client = loadClient();
    const result = await client.classify('sys', 'content');

    expect(mockLogDecision).toHaveBeenCalledWith(
      'LLM_CLASSIFY', 'test-model', 'FALLBACK', expect.stringContaining('aborted')
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ fallback: true });
  });

  test('falls back to Anthropic on ECONNREFUSED', async () => {
    const connErr = new Error('fetch failed');
    connErr.code = 'ECONNREFUSED';
    global.fetch = jest.fn().mockRejectedValue(connErr);
    const client = loadClient();
    const result = await client.classify('sys', 'content');

    expect(mockLogDecision).toHaveBeenCalledWith(
      'LLM_CLASSIFY', 'test-model', 'FALLBACK', expect.stringContaining('unreachable')
    );
    expect(result.success).toBe(true);
  });

  test('does NOT fall back on HTTP 500 — returns api-error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const client = loadClient();
    const result = await client.classify('sys', 'content');

    expect(result.success).toBe(false);
    expect(result.failureMode).toBe('api-error');
    expect(result.error).toContain('HTTP 500');
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  test('returns api-error on malformed response shape (missing choices)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ id: 'abc', object: 'chat.completion' }),
    });
    const client = loadClient();
    const result = await client.classify('sys', 'content');

    expect(result.success).toBe(false);
    expect(result.failureMode).toBe('api-error');
    expect(result.error).toContain('missing expected shape');
    expect(mockLogDecision).toHaveBeenCalledWith(
      'LLM_CLASSIFY', 'test-model', 'SHAPE_ERROR', expect.any(String)
    );
  });

  test('returns parse-error on invalid JSON in response content', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'not valid json at all' } }],
      }),
    });
    const client = loadClient();
    const result = await client.classify('sys', 'content');

    expect(result.success).toBe(false);
    expect(result.failureMode).toBe('parse-error');
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  test('successful local classification returns parsed data', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: '{"category":"note","confidence":0.95}' } }],
      }),
    });
    const client = loadClient();
    const result = await client.classify('sys', 'content');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ category: 'note', confidence: 0.95 });
  });
});

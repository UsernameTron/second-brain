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

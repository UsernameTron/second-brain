'use strict';

/**
 * promote-unrouted.test.js
 *
 * Tests for src/promote-unrouted.js — manual promotion of dead-letter files.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/classifier', () => ({
  runStage0: jest.fn(),
  classifyInput: jest.fn(),
}));

jest.mock('../src/note-formatter', () => ({
  formatNote: jest.fn(),
  formatLeftProposal: jest.fn(),
  generateFilename: jest.fn(),
  extractTemplateFields: jest.fn(),
}));

jest.mock('../src/wikilink-engine', () => ({
  suggestWikilinks: jest.fn(),
  refreshIndexEntry: jest.fn(),
}));

jest.mock('../src/vault-gateway', () => ({
  vaultWrite: jest.fn(),
  vaultRead: jest.fn(),
  VaultWriteError: class VaultWriteError extends Error {
    constructor(msg, code) { super(msg); this.code = code; }
  },
  logDecision: jest.fn(),
  normalizePath: jest.fn(p => p),
  getConfig: jest.fn(() => ({ left: [], right: [] })),
  configEvents: { on: jest.fn() },
}));

jest.mock('../src/pipeline-infra', () => ({
  generateCorrelationId: jest.fn(() => 'test-corr-id'),
  createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
  writeDeadLetter: jest.fn(),
  loadPipelineConfig: jest.fn(() => ({
    classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
    filename: { maxLength: 60, haikuWordRange: [4, 8] },
  })),
  safeLoadVaultPaths: jest.fn(() => ({ left: ['ABOUT ME', 'Daily'], right: ['memory', 'briefings', 'research'], haikuContextChars: 100 })),
  loadTemplatesConfig: jest.fn(() => ({ 'domain-templates': {}, 'memory-categories': {} })),
}));

// ── Test setup ───────────────────────────────────────────────────────────────

let tmpDir;

function buildDeadLetterContent(body = 'Test dead-letter input content.') {
  return [
    '---',
    'created: "2026-04-22T10:00:00+00:00"',
    'failure-mode: api-error',
    'correlation-id: abc-123',
    'status: unrouted',
    'retry-count: 0',
    'original-source: cli',
    '---',
    '',
    body,
  ].join('\n');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pu-test-'));
  const unroutedDir = path.join(tmpDir, 'proposals', 'unrouted');
  fs.mkdirSync(unroutedDir, { recursive: true });

  process.env.VAULT_ROOT = tmpDir;
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

  jest.resetModules();

  // Re-register mocks after resetModules
  jest.mock('../src/classifier', () => ({
    runStage0: jest.fn(),
    classifyInput: jest.fn(),
  }));

  jest.mock('../src/note-formatter', () => ({
    formatNote: jest.fn().mockResolvedValue('---\ncreated: 2026\n---\nBody'),
    formatLeftProposal: jest.fn().mockResolvedValue('---\ntype: left-proposal\nstatus: pending\n---\nBody'),
    generateFilename: jest.fn().mockResolvedValue({ filename: 'test-note.md', filenameBasis: 'first-line' }),
    extractTemplateFields: jest.fn().mockResolvedValue({}),
  }));

  jest.mock('../src/wikilink-engine', () => ({
    suggestWikilinks: jest.fn().mockResolvedValue({ section: '', links: [] }),
    refreshIndexEntry: jest.fn().mockResolvedValue(undefined),
  }));

  jest.mock('../src/vault-gateway', () => ({
    vaultWrite: jest.fn().mockResolvedValue({ path: 'research/test.md' }),
    vaultRead: jest.fn().mockResolvedValue(null),
    VaultWriteError: class VaultWriteError extends Error {
      constructor(msg, code) { super(msg); this.code = code; }
    },
    logDecision: jest.fn(),
    normalizePath: jest.fn(p => p),
    getConfig: jest.fn(() => ({ left: [], right: [] })),
    configEvents: { on: jest.fn() },
  }));

  jest.mock('../src/pipeline-infra', () => ({
    generateCorrelationId: jest.fn(() => 'test-corr-id'),
    createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
    writeDeadLetter: jest.fn(),
    loadPipelineConfig: jest.fn(() => ({
      classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
      filename: { maxLength: 60, haikuWordRange: [4, 8] },
    })),
    safeLoadVaultPaths: jest.fn(() => ({ left: ['ABOUT ME', 'Daily'], right: ['memory', 'briefings', 'research'], haikuContextChars: 100 })),
    loadTemplatesConfig: jest.fn(() => ({ 'domain-templates': {}, 'memory-categories': {} })),
  }));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
  delete process.env.CONFIG_DIR_OVERRIDE;
  jest.restoreAllMocks();
});

// ── promoteUnrouted ──────────────────────────────────────────────────────────

describe('promoteUnrouted', () => {
  test('returns error if file not found in proposals/unrouted/', async () => {
    const { promoteUnrouted } = require('../src/promote-unrouted');
    const result = await promoteUnrouted('nonexistent-file.md', { target: 'research' });
    expect(result.promoted).toBe(false);
    expect(result.reason).toMatch(/not found|does not exist/i);
  });

  test('returns error for invalid target path', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent(), 'utf8');

    const { promoteUnrouted } = require('../src/promote-unrouted');
    const result = await promoteUnrouted(filename, { target: 'invalid-nonexistent-dir-xyz' });
    expect(result.promoted).toBe(false);
    expect(result.reason).toMatch(/invalid target/i);
  });

  test('re-runs Stage 0 before promotion', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent(), 'utf8');

    jest.resetModules();
    const mockRunStage0 = jest.fn().mockResolvedValue({ blocked: false });
    jest.mock('../src/classifier', () => ({ runStage0: mockRunStage0, classifyInput: jest.fn() }));
    jest.mock('../src/note-formatter', () => ({
      formatNote: jest.fn().mockResolvedValue('---\ncreated: 2026\n---\nBody'),
      formatLeftProposal: jest.fn().mockResolvedValue('---\ntype: left-proposal\nstatus: pending\n---\nBody'),
      generateFilename: jest.fn().mockResolvedValue({ filename: 'test.md', filenameBasis: 'first-line' }),
      extractTemplateFields: jest.fn().mockResolvedValue({}),
    }));
    jest.mock('../src/wikilink-engine', () => ({
      suggestWikilinks: jest.fn().mockResolvedValue({ section: '', links: [] }),
      refreshIndexEntry: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../src/vault-gateway', () => ({
      vaultWrite: jest.fn().mockResolvedValue({ path: 'research/test.md' }),
      vaultRead: jest.fn().mockResolvedValue(null),
      VaultWriteError: class VaultWriteError extends Error { constructor(m, c) { super(m); this.code = c; } },
      logDecision: jest.fn(), normalizePath: jest.fn(p => p),
      getConfig: jest.fn(() => ({ left: [], right: [] })), configEvents: { on: jest.fn() },
    }));
    jest.mock('../src/pipeline-infra', () => ({
      generateCorrelationId: jest.fn(() => 'test-corr-id'),
      createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
      writeDeadLetter: jest.fn(),
      loadPipelineConfig: jest.fn(() => ({
        classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
        filename: { maxLength: 60, haikuWordRange: [4, 8] },
      })),
      safeLoadVaultPaths: jest.fn(() => ({ left: ['ABOUT ME', 'Daily'], right: ['memory', 'briefings', 'research'], haikuContextChars: 100 })),
      loadTemplatesConfig: jest.fn(() => ({ 'domain-templates': {}, 'memory-categories': {} })),
    }));

    const { promoteUnrouted } = require('../src/promote-unrouted');
    await promoteUnrouted(filename, { target: 'research' });
    expect(mockRunStage0).toHaveBeenCalled();
  });

  test('Stage 0 BLOCK refuses promotion', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent('ISPN content that should be blocked.'), 'utf8');

    jest.resetModules();
    jest.mock('../src/classifier', () => ({
      runStage0: jest.fn().mockResolvedValue({ blocked: true, reason: 'excluded content' }),
      classifyInput: jest.fn(),
    }));
    jest.mock('../src/note-formatter', () => ({
      formatNote: jest.fn(), formatLeftProposal: jest.fn(),
      generateFilename: jest.fn(), extractTemplateFields: jest.fn(),
    }));
    jest.mock('../src/wikilink-engine', () => ({
      suggestWikilinks: jest.fn(), refreshIndexEntry: jest.fn(),
    }));
    jest.mock('../src/vault-gateway', () => ({
      vaultWrite: jest.fn(), vaultRead: jest.fn(),
      VaultWriteError: class VaultWriteError extends Error { constructor(m, c) { super(m); this.code = c; } },
      logDecision: jest.fn(), normalizePath: jest.fn(p => p),
      getConfig: jest.fn(() => ({ left: [], right: [] })), configEvents: { on: jest.fn() },
    }));
    jest.mock('../src/pipeline-infra', () => ({
      generateCorrelationId: jest.fn(() => 'test-corr-id'),
      createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
      writeDeadLetter: jest.fn(),
      loadPipelineConfig: jest.fn(() => ({ classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 }, filename: { maxLength: 60, haikuWordRange: [4, 8] } })),
      safeLoadVaultPaths: jest.fn(() => ({ left: ['ABOUT ME', 'Daily'], right: ['memory', 'briefings', 'research'], haikuContextChars: 100 })),
      loadTemplatesConfig: jest.fn(() => ({ 'domain-templates': {}, 'memory-categories': {} })),
    }));

    const { promoteUnrouted } = require('../src/promote-unrouted');
    const result = await promoteUnrouted(filename, { target: 'research' });
    expect(result.promoted).toBe(false);
    expect(result.reason).toMatch(/blocked/i);
  });

  test('LEFT target routes to proposals/left-proposals/ not directly to LEFT', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent('Personal journal entry content.'), 'utf8');

    jest.resetModules();
    const mockVaultWrite = jest.fn().mockResolvedValue({ path: 'proposals/left-proposals/test.md' });
    jest.mock('../src/classifier', () => ({
      runStage0: jest.fn().mockResolvedValue({ blocked: false }),
      classifyInput: jest.fn(),
    }));
    jest.mock('../src/note-formatter', () => ({
      formatNote: jest.fn().mockResolvedValue('---\ncreated: 2026\n---\nBody'),
      formatLeftProposal: jest.fn().mockResolvedValue('---\ntype: left-proposal\nstatus: pending\n---\nBody'),
      generateFilename: jest.fn().mockResolvedValue({ filename: 'test.md', filenameBasis: 'first-line' }),
      extractTemplateFields: jest.fn().mockResolvedValue({}),
    }));
    jest.mock('../src/wikilink-engine', () => ({
      suggestWikilinks: jest.fn().mockResolvedValue({ section: '', links: [] }),
      refreshIndexEntry: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../src/vault-gateway', () => ({
      vaultWrite: mockVaultWrite,
      vaultRead: jest.fn().mockResolvedValue(null),
      VaultWriteError: class VaultWriteError extends Error { constructor(m, c) { super(m); this.code = c; } },
      logDecision: jest.fn(), normalizePath: jest.fn(p => p),
      getConfig: jest.fn(() => ({ left: [], right: [] })), configEvents: { on: jest.fn() },
    }));
    jest.mock('../src/pipeline-infra', () => ({
      generateCorrelationId: jest.fn(() => 'test-corr-id'),
      createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
      writeDeadLetter: jest.fn(),
      loadPipelineConfig: jest.fn(() => ({ classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 }, filename: { maxLength: 60, haikuWordRange: [4, 8] } })),
      safeLoadVaultPaths: jest.fn(() => ({ left: ['ABOUT ME', 'Daily'], right: ['memory', 'briefings', 'research'], haikuContextChars: 100 })),
      loadTemplatesConfig: jest.fn(() => ({ 'domain-templates': {}, 'memory-categories': {} })),
    }));

    const { promoteUnrouted } = require('../src/promote-unrouted');
    // 'Daily' is a LEFT label in vault-paths.json
    const result = await promoteUnrouted(filename, { target: 'Daily' });

    // Should route to proposals/left-proposals/, never directly to LEFT
    expect(result.promoted).toBe(true);
    const writeCalls = mockVaultWrite.mock.calls;
    const destinations = writeCalls.map(call => call[0]);
    const wentToLeftProposals = destinations.some(d => d.includes('left-proposals'));
    expect(wentToLeftProposals).toBe(true);
    // Ensure nothing was written directly to 'Daily/' (LEFT side)
    const wentDirectlyToLeft = destinations.some(d => d.startsWith('Daily/'));
    expect(wentDirectlyToLeft).toBe(false);
  });

  test('on success moves file to proposals/unrouted/promoted/ with metadata', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent(), 'utf8');

    jest.resetModules();
    jest.mock('../src/classifier', () => ({
      runStage0: jest.fn().mockResolvedValue({ blocked: false }),
      classifyInput: jest.fn(),
    }));
    jest.mock('../src/note-formatter', () => ({
      formatNote: jest.fn().mockResolvedValue('---\ncreated: 2026\n---\nBody'),
      formatLeftProposal: jest.fn(),
      generateFilename: jest.fn().mockResolvedValue({ filename: 'test.md', filenameBasis: 'first-line' }),
      extractTemplateFields: jest.fn().mockResolvedValue({}),
    }));
    jest.mock('../src/wikilink-engine', () => ({
      suggestWikilinks: jest.fn().mockResolvedValue({ section: '', links: [] }),
      refreshIndexEntry: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../src/vault-gateway', () => ({
      vaultWrite: jest.fn().mockResolvedValue({ path: 'research/test.md' }),
      vaultRead: jest.fn().mockResolvedValue(null),
      VaultWriteError: class VaultWriteError extends Error { constructor(m, c) { super(m); this.code = c; } },
      logDecision: jest.fn(), normalizePath: jest.fn(p => p),
      getConfig: jest.fn(() => ({ left: [], right: [] })), configEvents: { on: jest.fn() },
    }));
    jest.mock('../src/pipeline-infra', () => ({
      generateCorrelationId: jest.fn(() => 'test-corr-id'),
      createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
      writeDeadLetter: jest.fn(),
      loadPipelineConfig: jest.fn(() => ({ classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 }, filename: { maxLength: 60, haikuWordRange: [4, 8] } })),
      safeLoadVaultPaths: jest.fn(() => ({ left: ['ABOUT ME', 'Daily'], right: ['memory', 'briefings', 'research'], haikuContextChars: 100 })),
      loadTemplatesConfig: jest.fn(() => ({ 'domain-templates': {}, 'memory-categories': {} })),
    }));

    const { promoteUnrouted } = require('../src/promote-unrouted');
    const result = await promoteUnrouted(filename, { target: 'research' });
    expect(result.promoted).toBe(true);

    // Original file should be gone from unrouted/
    expect(fs.existsSync(dlPath)).toBe(false);

    // Should exist in proposals/unrouted/promoted/
    const promotedPath = path.join(tmpDir, 'proposals', 'unrouted', 'promoted', filename);
    expect(fs.existsSync(promotedPath)).toBe(true);

    // Should have promotion metadata
    const promotedContent = fs.readFileSync(promotedPath, 'utf8');
    expect(promotedContent).toMatch(/promoted-at:/);
    expect(promotedContent).toMatch(/promoted-to:/);
    expect(promotedContent).toMatch(/promoted-by: manual/);
  });

  test('returns { promoted, destination } on success', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent(), 'utf8');

    jest.resetModules();
    jest.mock('../src/classifier', () => ({
      runStage0: jest.fn().mockResolvedValue({ blocked: false }),
      classifyInput: jest.fn(),
    }));
    jest.mock('../src/note-formatter', () => ({
      formatNote: jest.fn().mockResolvedValue('---\ncreated: 2026\n---\nBody'),
      formatLeftProposal: jest.fn(),
      generateFilename: jest.fn().mockResolvedValue({ filename: 'test.md', filenameBasis: 'first-line' }),
      extractTemplateFields: jest.fn().mockResolvedValue({}),
    }));
    jest.mock('../src/wikilink-engine', () => ({
      suggestWikilinks: jest.fn().mockResolvedValue({ section: '', links: [] }),
      refreshIndexEntry: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../src/vault-gateway', () => ({
      vaultWrite: jest.fn().mockResolvedValue({ path: 'research/test.md' }),
      vaultRead: jest.fn().mockResolvedValue(null),
      VaultWriteError: class VaultWriteError extends Error { constructor(m, c) { super(m); this.code = c; } },
      logDecision: jest.fn(), normalizePath: jest.fn(p => p),
      getConfig: jest.fn(() => ({ left: [], right: [] })), configEvents: { on: jest.fn() },
    }));
    jest.mock('../src/pipeline-infra', () => ({
      generateCorrelationId: jest.fn(() => 'test-corr-id'),
      createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
      writeDeadLetter: jest.fn(),
      loadPipelineConfig: jest.fn(() => ({ classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 }, filename: { maxLength: 60, haikuWordRange: [4, 8] } })),
      safeLoadVaultPaths: jest.fn(() => ({ left: ['ABOUT ME', 'Daily'], right: ['memory', 'briefings', 'research'], haikuContextChars: 100 })),
      loadTemplatesConfig: jest.fn(() => ({ 'domain-templates': {}, 'memory-categories': {} })),
    }));

    const { promoteUnrouted } = require('../src/promote-unrouted');
    const result = await promoteUnrouted(filename, { target: 'research' });
    expect(result.promoted).toBe(true);
    expect(result.destination).toBeDefined();
  });

  test('generates wikilinks during promotion', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent(), 'utf8');

    jest.resetModules();
    const mockSuggestWikilinks = jest.fn().mockResolvedValue({ section: '## Related\n- [[Some Note]]', links: [{ path: 'research/note.md', title: 'Some Note' }] });
    jest.mock('../src/classifier', () => ({
      runStage0: jest.fn().mockResolvedValue({ blocked: false }),
      classifyInput: jest.fn(),
    }));
    jest.mock('../src/note-formatter', () => ({
      formatNote: jest.fn().mockResolvedValue('---\ncreated: 2026\n---\nBody'),
      formatLeftProposal: jest.fn(),
      generateFilename: jest.fn().mockResolvedValue({ filename: 'test.md', filenameBasis: 'first-line' }),
      extractTemplateFields: jest.fn().mockResolvedValue({}),
    }));
    jest.mock('../src/wikilink-engine', () => ({
      suggestWikilinks: mockSuggestWikilinks,
      refreshIndexEntry: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../src/vault-gateway', () => ({
      vaultWrite: jest.fn().mockResolvedValue({ path: 'research/test.md' }),
      vaultRead: jest.fn().mockResolvedValue(null),
      VaultWriteError: class VaultWriteError extends Error { constructor(m, c) { super(m); this.code = c; } },
      logDecision: jest.fn(), normalizePath: jest.fn(p => p),
      getConfig: jest.fn(() => ({ left: [], right: [] })), configEvents: { on: jest.fn() },
    }));
    jest.mock('../src/pipeline-infra', () => ({
      generateCorrelationId: jest.fn(() => 'test-corr-id'),
      createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
      writeDeadLetter: jest.fn(),
      loadPipelineConfig: jest.fn(() => ({ classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 }, filename: { maxLength: 60, haikuWordRange: [4, 8] } })),
      safeLoadVaultPaths: jest.fn(() => ({ left: ['ABOUT ME', 'Daily'], right: ['memory', 'briefings', 'research'], haikuContextChars: 100 })),
      loadTemplatesConfig: jest.fn(() => ({ 'domain-templates': {}, 'memory-categories': {} })),
    }));

    const { promoteUnrouted } = require('../src/promote-unrouted');
    await promoteUnrouted(filename, { target: 'research' });
    expect(mockSuggestWikilinks).toHaveBeenCalled();
  });
});

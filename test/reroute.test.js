'use strict';

/**
 * reroute.test.js
 *
 * Tests for src/reroute.js — re-classification of dead-letter or left-proposal files.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let tmpDir;

function buildDeadLetterContent(body = 'Test reroute content.', overrides = {}) {
  const frontmatter = {
    created: '"2026-04-22T10:00:00+00:00"',
    'failure-mode': 'api-error',
    'correlation-id': 'abc-123',
    status: 'unrouted',
    'retry-count': '0',
    'original-source': 'cli',
    ...overrides,
  };
  const fmLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  return ['---', ...fmLines, '---', '', body].join('\n');
}

function buildLeftProposalContent(body = 'Personal journal entry.') {
  return [
    '---',
    'created: "2026-04-22T10:00:00+00:00"',
    'type: left-proposal',
    'source: cli',
    'suggested-left-path: Daily/2026-04-22.md',
    'proposal-action: append',
    'status: pending',
    '---',
    '',
    '## Review',
    '',
    '- [ ] Accept',
    '- [ ] Edit',
    '- [ ] Reject',
    '- [ ] Re-route',
    '',
    body,
  ].join('\n');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-test-'));
  const unroutedDir = path.join(tmpDir, 'proposals', 'unrouted');
  const leftProposalsDir = path.join(tmpDir, 'proposals', 'left-proposals');
  fs.mkdirSync(unroutedDir, { recursive: true });
  fs.mkdirSync(leftProposalsDir, { recursive: true });

  process.env.VAULT_ROOT = tmpDir;
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

  jest.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
  delete process.env.CONFIG_DIR_OVERRIDE;
  jest.restoreAllMocks();
});

function setupMocks({ stage0Result, classifyResult, vaultWriteMock } = {}) {
  const mockStage0Result = stage0Result || { blocked: false };
  const mockClassifyResult = classifyResult || {
    correlationId: 'test-corr',
    blocked: false,
    side: 'RIGHT',
    directory: 'research',
    confidence: 0.9,
  };
  const mockVaultWriteFn = vaultWriteMock || jest.fn().mockResolvedValue({ path: 'research/rerouted-note.md' });

  jest.doMock('../src/classifier', () => ({
    runStage0: jest.fn().mockResolvedValue(mockStage0Result),
    classifyInput: jest.fn().mockResolvedValue(mockClassifyResult),
  }));
  jest.doMock('../src/note-formatter', () => ({
    formatNote: jest.fn().mockResolvedValue('---\ncreated: 2026\n---\nBody'),
    formatLeftProposal: jest.fn().mockResolvedValue('---\ntype: left-proposal\nstatus: pending\n---\nBody'),
    generateFilename: jest.fn().mockResolvedValue({ filename: 'rerouted-note.md', filenameBasis: 'first-line' }),
    extractTemplateFields: jest.fn().mockResolvedValue({}),
  }));
  jest.doMock('../src/wikilink-engine', () => ({
    suggestWikilinks: jest.fn().mockResolvedValue({ section: '', links: [] }),
    refreshIndexEntry: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('../src/vault-gateway', () => ({
    vaultWrite: mockVaultWriteFn,
    vaultRead: jest.fn().mockResolvedValue(null),
    VaultWriteError: class VaultWriteError extends Error { constructor(m, c) { super(m); this.code = c; } },
    logDecision: jest.fn(), normalizePath: jest.fn(p => p),
    getConfig: jest.fn(() => ({ left: [], right: [] })), configEvents: { on: jest.fn() },
  }));
  jest.doMock('../src/pipeline-infra', () => ({
    generateCorrelationId: jest.fn(() => 'test-corr-id'),
    createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
    writeDeadLetter: jest.fn(),
    loadPipelineConfig: jest.fn(() => ({
      classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
      filename: { maxLength: 60, haikuWordRange: [4, 8] },
    })),
    loadTemplatesConfig: jest.fn(() => ({ 'domain-templates': {}, 'memory-categories': {} })),
  }));
}

describe('rerouteFile', () => {
  test('returns error if file not found', async () => {
    setupMocks();
    const { rerouteFile } = require('../src/reroute');
    const result = await rerouteFile(path.join(tmpDir, 'proposals', 'unrouted', 'nonexistent.md'));
    expect(result.rerouted).toBe(false);
    expect(result.reason).toMatch(/not found|does not exist/i);
  });

  test('re-runs Stage 0 — BLOCK causes reroute failure', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent('Blocked ISPN content.'), 'utf8');

    setupMocks({ stage0Result: { blocked: true, reason: 'excluded content' } });
    const { rerouteFile } = require('../src/reroute');
    const result = await rerouteFile(dlPath);
    expect(result.rerouted).toBe(false);
    expect(result.reason).toMatch(/blocked/i);
    // File should remain in place
    expect(fs.existsSync(dlPath)).toBe(true);
  });

  test('runs full classification pipeline on dead-letter content', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent('Research notes about AI systems.'), 'utf8');

    setupMocks({ classifyResult: { correlationId: 'c1', blocked: false, side: 'RIGHT', directory: 'research', confidence: 0.9 } });
    const mockClassifyInput = require('../src/classifier').classifyInput;
    const { rerouteFile } = require('../src/reroute');
    await rerouteFile(dlPath);
    expect(mockClassifyInput).toHaveBeenCalled();
  });

  test('on success moves original to proposals/unrouted/rerouted/ with metadata', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent(), 'utf8');

    setupMocks({ classifyResult: { correlationId: 'c1', blocked: false, side: 'RIGHT', directory: 'research', confidence: 0.9 } });
    const { rerouteFile } = require('../src/reroute');
    const result = await rerouteFile(dlPath);
    expect(result.rerouted).toBe(true);

    // Original file moved to rerouted/
    expect(fs.existsSync(dlPath)).toBe(false);
    const reroutedPath = path.join(tmpDir, 'proposals', 'unrouted', 'rerouted', filename);
    expect(fs.existsSync(reroutedPath)).toBe(true);

    const reroutedContent = fs.readFileSync(reroutedPath, 'utf8');
    expect(reroutedContent).toMatch(/rerouted-at:/);
    expect(reroutedContent).toMatch(/rerouted-from:/);
    expect(reroutedContent).toMatch(/rerouted-to:/);
  });

  test('LEFT classification routes to proposals/left-proposals/ not directly to LEFT', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent('Personal journal entry content.'), 'utf8');

    const mockVaultWrite = jest.fn().mockResolvedValue({ path: 'proposals/left-proposals/rerouted-note.md' });
    setupMocks({
      classifyResult: { correlationId: 'c1', blocked: false, side: 'LEFT', directory: 'proposals/left-proposals', suggestedLeftPath: 'Daily/', confidence: 0.9 },
      vaultWriteMock: mockVaultWrite,
    });
    const { rerouteFile } = require('../src/reroute');
    const result = await rerouteFile(dlPath);
    expect(result.rerouted).toBe(true);

    const writeCalls = mockVaultWrite.mock.calls.map(c => c[0]);
    const wentToLeftProposals = writeCalls.some(p => p.includes('left-proposals'));
    expect(wentToLeftProposals).toBe(true);
    const wentDirectlyToLeft = writeCalls.some(p => /^(ABOUT ME|Daily|Relationships|Drafts)\//.test(p));
    expect(wentDirectlyToLeft).toBe(false);
  });

  test('status transition: unrouted → rerouted on success', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent(), 'utf8');

    setupMocks();
    const { rerouteFile } = require('../src/reroute');
    const result = await rerouteFile(dlPath);
    expect(result.rerouted).toBe(true);

    // File moved to rerouted/; check its status field
    const reroutedPath = path.join(tmpDir, 'proposals', 'unrouted', 'rerouted', filename);
    const content = fs.readFileSync(reroutedPath, 'utf8');
    expect(content).toMatch(/status: rerouted/);
  });

  test('on failure, original file is left unchanged', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    const originalContent = buildDeadLetterContent();
    fs.writeFileSync(dlPath, originalContent, 'utf8');

    setupMocks({ stage0Result: { blocked: true, reason: 'blocked' } });
    const { rerouteFile } = require('../src/reroute');
    await rerouteFile(dlPath);

    // File still exists unchanged
    expect(fs.existsSync(dlPath)).toBe(true);
    expect(fs.readFileSync(dlPath, 'utf8')).toBe(originalContent);
  });

  test('returns { rerouted: true, from, to } on success', async () => {
    const filename = 'unrouted-20260422-100000-abcd1234.md';
    const dlPath = path.join(tmpDir, 'proposals', 'unrouted', filename);
    fs.writeFileSync(dlPath, buildDeadLetterContent(), 'utf8');

    setupMocks();
    const { rerouteFile } = require('../src/reroute');
    const result = await rerouteFile(dlPath);
    expect(result.rerouted).toBe(true);
    expect(result.from).toBeDefined();
    expect(result.to).toBeDefined();
  });

  test('reroutes left-proposal file from proposals/left-proposals/', async () => {
    const filename = 'left-proposal-20260422-100000-abcd1234.md';
    const lpPath = path.join(tmpDir, 'proposals', 'left-proposals', filename);
    fs.writeFileSync(lpPath, buildLeftProposalContent(), 'utf8');

    setupMocks({ classifyResult: { correlationId: 'c1', blocked: false, side: 'RIGHT', directory: 'ideas', confidence: 0.9 } });
    const { rerouteFile } = require('../src/reroute');
    const result = await rerouteFile(lpPath);
    expect(result.rerouted).toBe(true);

    // Original file moved to proposals/left-proposals/rerouted/
    expect(fs.existsSync(lpPath)).toBe(false);
    const reroutedPath = path.join(tmpDir, 'proposals', 'left-proposals', 'rerouted', filename);
    expect(fs.existsSync(reroutedPath)).toBe(true);
  });
});

'use strict';

/**
 * integration-pipeline.test.js
 *
 * End-to-end integration tests for the /new pipeline.
 * Tests: input → classify → format → write → wikilinks → index update
 *
 * Phase 15 (B-07): migrated from mocking individual Stage 0/1/2 to mocking
 * classifier.classifyInput, matching the new-command refactor.
 */

const path = require('path');

// ── Mock factory helpers ─────────────────────────────────────────────────────

function successRight(directory = 'research', confidence = 0.9) {
  return {
    correlationId: 'integration-corr-id',
    blocked: false,
    side: 'RIGHT',
    directory,
    confidence,
    sonnetEscalated: false,
    stage1: { side: 'RIGHT', confidence: 0.9 },
    stage2: { directory, confidence, sonnetEscalated: false },
  };
}

function successLeft(stage2Directory = 'Daily', confidence = 0.87) {
  return {
    correlationId: 'integration-corr-id',
    blocked: false,
    side: 'LEFT',
    directory: 'proposals/left-proposals',
    suggestedLeftPath: `${stage2Directory}/`,
    confidence,
    sonnetEscalated: false,
    stage1: { side: 'LEFT', confidence: 0.92 },
    stage2: { directory: stage2Directory, confidence, sonnetEscalated: false },
  };
}

function blocked(reason) {
  return {
    correlationId: 'integration-corr-id',
    blocked: true,
    reason,
  };
}

function deadLettered(failureMode) {
  return {
    correlationId: 'integration-corr-id',
    blocked: false,
    deadLettered: true,
    failureMode,
  };
}

// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock('../src/classifier', () => ({
  classifyInput: jest.fn(),
}));

jest.mock('../src/vault-gateway', () => ({
  vaultWrite: jest.fn(),
  logDecision: jest.fn(),
  normalizePath: jest.fn(p => p),
  getConfig: jest.fn(() => ({ left: [], right: [], excludedTerms: [] })),
  configEvents: { on: jest.fn() },
}));

jest.mock('../src/note-formatter', () => ({
  formatNote: jest.fn(),
  formatLeftProposal: jest.fn(),
  generateFilename: jest.fn(),
  extractTemplateFields: jest.fn(),
}));

jest.mock('../src/pipeline-infra', () => ({
  generateCorrelationId: jest.fn(() => 'integration-corr-id'),
  createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
  writeDeadLetter: jest.fn(),
}));

jest.mock('../src/wikilink-engine', () => ({
  suggestWikilinks: jest.fn(),
  refreshIndexEntry: jest.fn(),
  buildVaultIndex: jest.fn(),
  loadVaultIndex: jest.fn(),
}));

process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');
process.env.VAULT_ROOT = '/tmp/test-vault-integration';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Integration: /new pipeline (Stage 4 wikilink wiring)', () => {
  let runNew;
  let mockClassifyInput;
  let mockVaultWrite;
  let mockFormatNote, mockFormatLeftProposal, mockGenerateFilename;
  let mockSuggestWikilinks, mockRefreshIndexEntry;
  let mockWriteDeadLetter;

  beforeEach(() => {
    jest.resetModules();

    jest.mock('../src/classifier', () => ({
      classifyInput: jest.fn(),
    }));

    jest.mock('../src/vault-gateway', () => ({
      vaultWrite: jest.fn(),
      logDecision: jest.fn(),
      normalizePath: jest.fn(p => p),
      getConfig: jest.fn(() => ({ left: [], right: [], excludedTerms: [] })),
      configEvents: { on: jest.fn() },
    }));

    jest.mock('../src/note-formatter', () => ({
      formatNote: jest.fn(),
      formatLeftProposal: jest.fn(),
      generateFilename: jest.fn(),
      extractTemplateFields: jest.fn(),
    }));

    jest.mock('../src/pipeline-infra', () => ({
      generateCorrelationId: jest.fn(() => 'integration-corr-id'),
      createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
      writeDeadLetter: jest.fn(),
    }));

    jest.mock('../src/wikilink-engine', () => ({
      suggestWikilinks: jest.fn(),
      refreshIndexEntry: jest.fn(),
      buildVaultIndex: jest.fn(),
      loadVaultIndex: jest.fn(),
    }));

    const classifier = require('../src/classifier');
    const vaultGateway = require('../src/vault-gateway');
    const noteFormatter = require('../src/note-formatter');
    const pipelineInfra = require('../src/pipeline-infra');
    const wikilinkEngine = require('../src/wikilink-engine');

    mockClassifyInput = classifier.classifyInput;
    mockVaultWrite = vaultGateway.vaultWrite;
    mockFormatNote = noteFormatter.formatNote;
    mockFormatLeftProposal = noteFormatter.formatLeftProposal;
    mockGenerateFilename = noteFormatter.generateFilename;
    mockSuggestWikilinks = wikilinkEngine.suggestWikilinks;
    mockRefreshIndexEntry = wikilinkEngine.refreshIndexEntry;
    mockWriteDeadLetter = pipelineInfra.writeDeadLetter;

    // Default: successful RIGHT classification
    mockClassifyInput.mockResolvedValue(successRight('research', 0.9));
    mockVaultWrite.mockResolvedValue({ path: 'research/test-note.md' });
    mockFormatNote.mockResolvedValue('---\ncreated: 2026-04-22\ndomain: research\n---\nResearch content here');
    mockFormatLeftProposal.mockResolvedValue('---\ntype: left-proposal\nstatus: pending\n---\nPersonal content');
    mockGenerateFilename.mockResolvedValue({ filename: 'test-note.md', filenameBasis: 'first-line' });
    mockSuggestWikilinks.mockResolvedValue({
      section: '## Related\n- [[Related Note]]',
      links: [{ path: 'research/related.md', title: 'Related Note', relevance: 0.8 }],
    });
    mockRefreshIndexEntry.mockResolvedValue(undefined);
    mockWriteDeadLetter.mockResolvedValue({ path: 'proposals/unrouted/test.md' });

    runNew = require('../src/new-command').runNew;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('full pipeline: RIGHT input → classify → format → write → wikilinks called', async () => {
    const result = await runNew('Research notes about machine learning systems and neural architectures.', {
      interactive: true,
      source: 'cli',
    });

    expect(result.blocked).toBeFalsy();
    expect(result.deadLettered).toBeFalsy();
    expect(result.destination).toBeDefined();

    // Classifier delegated via single entry point
    expect(mockClassifyInput).toHaveBeenCalled();
    expect(mockFormatNote).toHaveBeenCalled();
    expect(mockVaultWrite).toHaveBeenCalled();

    // Stage 4 wikilinks called (per plan requirement)
    expect(mockSuggestWikilinks).toHaveBeenCalled();

    // Index refreshed after write (D-18)
    expect(mockRefreshIndexEntry).toHaveBeenCalled();
  });

  test('LEFT classification: routes to proposals/left-proposals/', async () => {
    mockClassifyInput.mockResolvedValue(successLeft('Daily', 0.87));

    const result = await runNew('I feel like today was particularly productive.', {
      interactive: true,
      source: 'cli',
    });

    expect(result.blocked).toBeFalsy();
    expect(result.deadLettered).toBeFalsy();
    expect(result.side).toBe('LEFT');

    const writeCall = mockVaultWrite.mock.calls[0];
    expect(writeCall[0]).toMatch(/proposals\/left-proposals\//);

    expect(mockFormatLeftProposal).toHaveBeenCalled();
  });

  test('Stage 0 BLOCK: no dead-letter, no write, immediately returns blocked', async () => {
    mockClassifyInput.mockResolvedValue(blocked('ISPN content'));

    const result = await runNew('Blocked content example here.', { interactive: true });

    expect(result.blocked).toBe(true);
    expect(mockVaultWrite).not.toHaveBeenCalled();
    // classifyInput handles Stage 0 BLOCK; new-command never calls writeDeadLetter
    // for Stage 0 internals (the dead-letter stays inside classifyInput for non-BLOCK modes).
    expect(mockWriteDeadLetter).not.toHaveBeenCalled();
  });

  test('wikilink failure does not block write (D-39 non-blocking enrichment)', async () => {
    mockSuggestWikilinks.mockRejectedValue(new Error('Haiku API timeout'));

    const result = await runNew('Research content that has wikilink issues.', { interactive: true });

    expect(result.blocked).toBeFalsy();
    expect(result.deadLettered).toBeFalsy();
    expect(mockVaultWrite).toHaveBeenCalled();
  });

  test('wikilink section with links appended to note before write', async () => {
    mockSuggestWikilinks.mockResolvedValue({
      section: '## Related\n- [[Related Note]] — relevant concept here',
      links: [{ path: 'research/related.md', title: 'Related Note', relevance: 0.8, reason: 'relevant concept here' }],
    });

    await runNew('Research about AI systems and memory architectures.', { interactive: true });

    expect(mockSuggestWikilinks).toHaveBeenCalled();
    expect(mockVaultWrite).toHaveBeenCalled();
  });

  test('refreshIndexEntry called with the target path after write', async () => {
    mockVaultWrite.mockResolvedValue({ path: 'research/test-note.md' });

    await runNew('Research content for index refresh test.', { interactive: true });

    expect(mockRefreshIndexEntry).toHaveBeenCalledWith(expect.stringContaining('research'));
  });

  test('non-interactive ambiguous classification surfaces dead-letter envelope', async () => {
    // classifyInput owns the actual writeDeadLetter call for ambiguous Stage 1;
    // new-command just surfaces the envelope.
    mockClassifyInput.mockResolvedValue(deadLettered('non-interactive-ambiguous'));

    const result = await runNew('Ambiguous content that is hard to classify.', { interactive: false });

    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('non-interactive-ambiguous');
    // writeDeadLetter for ambiguous mode lives inside classifyInput (mocked out
    // here); new-command does not double-dead-letter.
    expect(mockWriteDeadLetter).not.toHaveBeenCalled();
  });
});

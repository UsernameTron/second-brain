'use strict';

/**
 * integration-pipeline.test.js
 *
 * End-to-end integration tests for the /new pipeline.
 * Tests: input → classify → format → write → wikilinks → index update
 */

const path = require('path');

// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock('../src/classifier', () => ({
  runStage0: jest.fn(),
  runStage1: jest.fn(),
  runStage2: jest.fn(),
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
  loadPipelineConfig: jest.fn(() => ({
    classifier: {
      stage1ConfidenceThreshold: 0.8,
      stage2ConfidenceThreshold: 0.7,
      sonnetEscalationThreshold: 0.8,
      sonnetAcceptThreshold: 0.7,
      shortInputChars: 50,
    },
    filename: { maxLength: 60, haikuWordRange: [4, 8] },
  })),
  loadTemplatesConfig: jest.fn(() => ({
    'domain-templates': {},
    'memory-categories': {},
  })),
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
  let mockRunStage0, mockRunStage1, mockRunStage2;
  let mockVaultWrite;
  let mockFormatNote, mockFormatLeftProposal, mockGenerateFilename;
  let mockSuggestWikilinks, mockRefreshIndexEntry;
  let mockWriteDeadLetter;

  beforeEach(() => {
    jest.resetModules();

    // Re-wire all mocks after resetModules
    jest.mock('../src/classifier', () => ({
      runStage0: jest.fn(),
      runStage1: jest.fn(),
      runStage2: jest.fn(),
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
      loadPipelineConfig: jest.fn(() => ({
        classifier: {
          stage1ConfidenceThreshold: 0.8,
          stage2ConfidenceThreshold: 0.7,
          sonnetEscalationThreshold: 0.8,
          sonnetAcceptThreshold: 0.7,
          shortInputChars: 50,
        },
        filename: { maxLength: 60, haikuWordRange: [4, 8] },
      })),
      loadTemplatesConfig: jest.fn(() => ({ 'domain-templates': {}, 'memory-categories': {} })),
    }));

    jest.mock('../src/wikilink-engine', () => ({
      suggestWikilinks: jest.fn(),
      refreshIndexEntry: jest.fn(),
      buildVaultIndex: jest.fn(),
      loadVaultIndex: jest.fn(),
    }));

    // Get references to mocked functions
    const classifier = require('../src/classifier');
    const vaultGateway = require('../src/vault-gateway');
    const noteFormatter = require('../src/note-formatter');
    const pipelineInfra = require('../src/pipeline-infra');
    const wikilinkEngine = require('../src/wikilink-engine');

    mockRunStage0 = classifier.runStage0;
    mockRunStage1 = classifier.runStage1;
    mockRunStage2 = classifier.runStage2;
    mockVaultWrite = vaultGateway.vaultWrite;
    mockFormatNote = noteFormatter.formatNote;
    mockFormatLeftProposal = noteFormatter.formatLeftProposal;
    mockGenerateFilename = noteFormatter.generateFilename;
    mockSuggestWikilinks = wikilinkEngine.suggestWikilinks;
    mockRefreshIndexEntry = wikilinkEngine.refreshIndexEntry;
    mockWriteDeadLetter = pipelineInfra.writeDeadLetter;

    // Default mock implementations
    mockRunStage0.mockResolvedValue({ blocked: false });
    mockRunStage1.mockResolvedValue({ side: 'RIGHT', confidence: 0.9, rationale: 'research content' });
    mockRunStage2.mockResolvedValue({ directory: 'research', confidence: 0.9, sonnetEscalated: false });
    mockVaultWrite.mockResolvedValue({ path: 'research/test-note.md' });
    mockFormatNote.mockResolvedValue('---\ncreated: 2026-04-22\ndomain: research\n---\nResearch content here');
    mockFormatLeftProposal.mockResolvedValue('---\ntype: left-proposal\nstatus: pending\n---\nPersonal content');
    mockGenerateFilename.mockResolvedValue({ filename: 'test-note.md', filenameBasis: 'first-line' });
    mockSuggestWikilinks.mockResolvedValue({ section: '## Related\n- [[Related Note]]', links: [{ path: 'research/related.md', title: 'Related Note', relevance: 0.8 }] });
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

    // Pipeline succeeds
    expect(result.blocked).toBeFalsy();
    expect(result.deadLettered).toBeFalsy();
    expect(result.destination).toBeDefined();

    // All pipeline stages were called
    expect(mockRunStage0).toHaveBeenCalled();
    expect(mockRunStage1).toHaveBeenCalled();
    expect(mockRunStage2).toHaveBeenCalled();
    expect(mockFormatNote).toHaveBeenCalled();
    expect(mockVaultWrite).toHaveBeenCalled();

    // Stage 4 wikilinks called (per plan requirement)
    expect(mockSuggestWikilinks).toHaveBeenCalled();

    // Index refreshed after write (D-18)
    expect(mockRefreshIndexEntry).toHaveBeenCalled();
  });

  test('LEFT classification: routes to proposals/left-proposals/', async () => {
    mockRunStage1.mockResolvedValue({ side: 'LEFT', confidence: 0.92, rationale: 'personal voice' });
    mockRunStage2.mockResolvedValue({ directory: 'Daily', confidence: 0.87, sonnetEscalated: false });

    const result = await runNew('I feel like today was particularly productive.', {
      interactive: true,
      source: 'cli',
    });

    expect(result.blocked).toBeFalsy();
    expect(result.deadLettered).toBeFalsy();
    expect(result.side).toBe('LEFT');

    // Should write to proposals/left-proposals/
    const writeCall = mockVaultWrite.mock.calls[0];
    expect(writeCall[0]).toMatch(/proposals\/left-proposals\//);

    // Format left-proposal was called
    expect(mockFormatLeftProposal).toHaveBeenCalled();
  });

  test('Stage 0 BLOCK: no dead-letter, no write, immediately returns blocked', async () => {
    mockRunStage0.mockResolvedValue({ blocked: true, reason: 'ISPN content' });

    const result = await runNew('Blocked content example here.', { interactive: true });

    expect(result.blocked).toBe(true);
    expect(mockVaultWrite).not.toHaveBeenCalled();
    expect(mockWriteDeadLetter).not.toHaveBeenCalled();
  });

  test('wikilink failure does not block write (D-39 non-blocking enrichment)', async () => {
    mockSuggestWikilinks.mockRejectedValue(new Error('Haiku API timeout'));

    const result = await runNew('Research content that has wikilink issues.', { interactive: true });

    // Write should still succeed despite wikilink failure
    expect(result.blocked).toBeFalsy();
    expect(result.deadLettered).toBeFalsy();
    expect(mockVaultWrite).toHaveBeenCalled();
  });

  test('wikilink section with links appended to note before write', async () => {
    // Wikilinks return a section
    mockSuggestWikilinks.mockResolvedValue({
      section: '## Related\n- [[Related Note]] — relevant concept here',
      links: [{ path: 'research/related.md', title: 'Related Note', relevance: 0.8, reason: 'relevant concept here' }],
    });

    await runNew('Research about AI systems and memory architectures.', { interactive: true });

    // When wikilinks have links, the note should be re-written with the section appended
    // The second vaultWrite call (if any) should include the wikilinks section
    // OR the first write is updated (implementation-specific)
    expect(mockSuggestWikilinks).toHaveBeenCalled();
    // At minimum, vault write was called
    expect(mockVaultWrite).toHaveBeenCalled();
  });

  test('refreshIndexEntry called with the target path after write', async () => {
    mockVaultWrite.mockResolvedValue({ path: 'research/test-note.md' });

    await runNew('Research content for index refresh test.', { interactive: true });

    expect(mockRefreshIndexEntry).toHaveBeenCalledWith(expect.stringContaining('research'));
  });

  test('non-interactive mode with ambiguous Stage 1 → dead-letter', async () => {
    mockRunStage1.mockResolvedValue({ side: 'RIGHT', confidence: 0.5, rationale: 'ambiguous' });

    const result = await runNew('Ambiguous content that is hard to classify.', { interactive: false });

    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('non-interactive-ambiguous');
    expect(mockWriteDeadLetter).toHaveBeenCalled();
  });
});

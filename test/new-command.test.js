'use strict';

/**
 * new-command.test.js
 *
 * Tests for src/new-command.js (/new command orchestration)
 * All LLM calls, vault writes, and classifier calls are mocked.
 */

const path = require('path');

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/classifier', () => ({
  runStage0: jest.fn(),
  runStage1: jest.fn(),
  runStage2: jest.fn(),
  classifyInput: jest.fn(),
}));

jest.mock('../src/vault-gateway', () => ({
  vaultWrite: jest.fn().mockResolvedValue({ path: 'research/test-note.md' }),
  logDecision: jest.fn(),
  normalizePath: jest.fn(p => p),
  getConfig: jest.fn(() => ({ left: [], right: [], excludedTerms: [] })),
  configEvents: { on: jest.fn() },
}));

jest.mock('../src/note-formatter', () => ({
  formatNote: jest.fn().mockResolvedValue('---\ncreated: 2026-04-22\n---\nBody text'),
  formatLeftProposal: jest.fn().mockResolvedValue('---\ntype: left-proposal\nstatus: pending\n---\nBody text'),
  generateFilename: jest.fn().mockResolvedValue({ filename: 'test-note.md', filenameBasis: 'first-line' }),
  extractTemplateFields: jest.fn().mockResolvedValue({}),
}));

jest.mock('../src/pipeline-infra', () => ({
  generateCorrelationId: jest.fn(() => 'test-corr-id-new'),
  createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
  writeDeadLetter: jest.fn().mockResolvedValue({ path: 'proposals/unrouted/test.md' }),
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
    'domain-templates': {
      briefings: { fields: ['attendees', 'meeting-date', 'decisions', 'follow-ups'] },
      'job-hunt': { fields: ['company', 'role-title'] },
    },
    'memory-categories': {},
  })),
}));

process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');
process.env.VAULT_ROOT = '/tmp/test-vault';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runNew', () => {
  let runNew;
  let mockRunStage0;
  let mockRunStage1;
  let mockRunStage2;
  let mockVaultWrite;
  let mockFormatNote;
  let mockFormatLeftProposal;
  let mockGenerateFilename;
  let mockWriteDeadLetter;

  beforeEach(() => {
    jest.resetModules();

    // Re-declare mocks after resetModules
    jest.mock('../src/classifier', () => ({
      runStage0: jest.fn(),
      runStage1: jest.fn(),
      runStage2: jest.fn(),
      classifyInput: jest.fn(),
    }));

    jest.mock('../src/vault-gateway', () => ({
      vaultWrite: jest.fn().mockResolvedValue({ path: 'research/test-note.md' }),
      logDecision: jest.fn(),
      normalizePath: jest.fn(p => p),
      getConfig: jest.fn(() => ({ left: [], right: [], excludedTerms: [] })),
      configEvents: { on: jest.fn() },
    }));

    jest.mock('../src/note-formatter', () => ({
      formatNote: jest.fn().mockResolvedValue('---\ncreated: 2026-04-22\n---\nBody text'),
      formatLeftProposal: jest.fn().mockResolvedValue('---\ntype: left-proposal\nstatus: pending\n---\nBody text'),
      generateFilename: jest.fn().mockResolvedValue({ filename: 'test-note.md', filenameBasis: 'first-line' }),
      extractTemplateFields: jest.fn().mockResolvedValue({}),
    }));

    jest.mock('../src/pipeline-infra', () => ({
      generateCorrelationId: jest.fn(() => 'test-corr-id-new'),
      createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
      writeDeadLetter: jest.fn().mockResolvedValue({ path: 'proposals/unrouted/test.md' }),
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
        'domain-templates': {
          briefings: { fields: ['attendees', 'meeting-date', 'decisions', 'follow-ups'] },
          'job-hunt': { fields: ['company', 'role-title'] },
        },
        'memory-categories': {},
      })),
    }));

    ({ runNew } = require('../src/new-command'));
    ({ runStage0: mockRunStage0, runStage1: mockRunStage1, runStage2: mockRunStage2 } = require('../src/classifier'));
    ({ vaultWrite: mockVaultWrite } = require('../src/vault-gateway'));
    ({ formatNote: mockFormatNote, formatLeftProposal: mockFormatLeftProposal, generateFilename: mockGenerateFilename } = require('../src/note-formatter'));
    ({ writeDeadLetter: mockWriteDeadLetter } = require('../src/pipeline-infra'));
  });

  test('with clean RIGHT input writes to classified directory', async () => {
    mockRunStage0.mockResolvedValue({ blocked: false });
    mockRunStage1.mockResolvedValue({ side: 'RIGHT', confidence: 0.9, rationale: 'structured data' });
    mockRunStage2.mockResolvedValue({
      directory: 'research',
      confidence: 0.88,
      sonnetEscalated: false,
    });

    const result = await runNew('An analysis of AI market trends.', {
      interactive: false,
      source: 'cli',
    });

    expect(mockVaultWrite).toHaveBeenCalled();
    // The path argument should contain 'research'
    const callArg = mockVaultWrite.mock.calls[0][0];
    expect(callArg).toContain('research');
    expect(result.deadLettered).toBeFalsy();
  });

  test('with LEFT input writes to proposals/left-proposals/', async () => {
    mockRunStage0.mockResolvedValue({ blocked: false });
    mockRunStage1.mockResolvedValue({ side: 'LEFT', confidence: 0.92, rationale: 'first-person voice' });
    mockRunStage2.mockResolvedValue({
      directory: 'Daily',
      confidence: 0.88,
      sonnetEscalated: false,
    });

    const result = await runNew(
      'I reflected on my leadership style and realized I need to listen more.',
      { interactive: false, source: 'cli' }
    );

    expect(mockFormatLeftProposal).toHaveBeenCalled();
    const callArg = mockVaultWrite.mock.calls[0][0];
    expect(callArg).toContain('proposals/left-proposals');
    expect(result.deadLettered).toBeFalsy();
  });

  test('with excluded content exits immediately with BLOCK — no vaultWrite', async () => {
    mockRunStage0.mockResolvedValue({
      blocked: true,
      reason: 'Excluded content detected (term: ISPN)',
    });

    const result = await runNew('ISPN queue routing configuration details.', {
      interactive: false,
      source: 'cli',
    });

    expect(result.blocked).toBe(true);
    expect(mockVaultWrite).not.toHaveBeenCalled();
    expect(mockRunStage1).not.toHaveBeenCalled();
  });

  test('returns correlation ID and destination path in output', async () => {
    mockRunStage0.mockResolvedValue({ blocked: false });
    mockRunStage1.mockResolvedValue({ side: 'RIGHT', confidence: 0.9 });
    mockRunStage2.mockResolvedValue({ directory: 'ideas', confidence: 0.85, sonnetEscalated: false });

    const result = await runNew('A cool new idea about distributed systems.', {
      interactive: false,
      source: 'cli',
    });

    expect(result.correlationId).toBeDefined();
    expect(result.destination).toBeDefined();
  });

  test('with Stage 0 internal failure dead-letters (exclusion-unavailable)', async () => {
    mockRunStage0.mockResolvedValue({
      blocked: false,
      deadLetter: true,
      failureMode: 'exclusion-unavailable',
    });

    const result = await runNew('Some content that triggers policy failure.', {
      interactive: false,
      source: 'cli',
    });

    expect(mockWriteDeadLetter).toHaveBeenCalledWith(
      expect.any(String),
      'exclusion-unavailable',
      expect.any(String),
      expect.any(Object)
    );
    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('exclusion-unavailable');
    expect(mockVaultWrite).not.toHaveBeenCalled();
  });
});

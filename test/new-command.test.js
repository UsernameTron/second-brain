'use strict';

/**
 * new-command.test.js
 *
 * Tests for src/new-command.js (/new command orchestration).
 *
 * Phase 15 (B-07) migrated these tests from mocking individual Stage 0/1/2
 * entry points to mocking classifier.classifyInput directly, matching the
 * refactor that dedups stage orchestration in new-command.js.
 *
 * All LLM calls, vault writes, and classifier calls are mocked.
 */

const path = require('path');

// ── Mock factory helpers ─────────────────────────────────────────────────────

function successRight(directory = 'research', confidence = 0.88) {
  return {
    correlationId: 'test-corr-id-new',
    blocked: false,
    side: 'RIGHT',
    directory,
    confidence,
    sonnetEscalated: false,
    stage1: { side: 'RIGHT', confidence: 0.9 },
    stage2: { directory, confidence, sonnetEscalated: false },
  };
}

function successLeft(stage2Directory = 'Daily', confidence = 0.88) {
  return {
    correlationId: 'test-corr-id-new',
    blocked: false,
    side: 'LEFT',
    directory: 'proposals/left-proposals',
    suggestedLeftPath: stage2Directory ? `${stage2Directory}/` : 'Drafts/',
    confidence,
    sonnetEscalated: false,
    stage1: { side: 'LEFT', confidence: 0.92 },
    stage2: { directory: stage2Directory, confidence, sonnetEscalated: false },
  };
}

function blocked(reason = 'Excluded content detected (term: ISPN)') {
  return {
    correlationId: 'test-corr-id-new',
    blocked: true,
    reason,
  };
}

function deadLettered(failureMode) {
  return {
    correlationId: 'test-corr-id-new',
    blocked: false,
    deadLettered: true,
    failureMode,
  };
}

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/classifier', () => ({
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
}));

jest.mock('../src/wikilink-engine', () => ({
  suggestWikilinks: jest.fn().mockResolvedValue({ section: null, links: [] }),
  refreshIndexEntry: jest.fn().mockResolvedValue(undefined),
  buildIndex: jest.fn(),
}));

process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');
process.env.VAULT_ROOT = '/tmp/test-vault';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runNew', () => {
  let runNew;
  let mockClassifyInput;
  let mockVaultWrite;
  let mockFormatNote;
  let mockFormatLeftProposal;
  let mockGenerateFilename;
  let mockWriteDeadLetter;
  let mockSuggestWikilinks;

  beforeEach(() => {
    jest.resetModules();

    jest.mock('../src/classifier', () => ({
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
    }));

    jest.mock('../src/wikilink-engine', () => ({
      suggestWikilinks: jest.fn().mockResolvedValue({ section: null, links: [] }),
      refreshIndexEntry: jest.fn().mockResolvedValue(undefined),
      buildIndex: jest.fn(),
    }));

    ({ runNew } = require('../src/new-command'));
    ({ classifyInput: mockClassifyInput } = require('../src/classifier'));
    ({ vaultWrite: mockVaultWrite } = require('../src/vault-gateway'));
    ({ formatNote: mockFormatNote, formatLeftProposal: mockFormatLeftProposal, generateFilename: mockGenerateFilename } = require('../src/note-formatter'));
    ({ writeDeadLetter: mockWriteDeadLetter } = require('../src/pipeline-infra'));
    ({ suggestWikilinks: mockSuggestWikilinks } = require('../src/wikilink-engine'));
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  test('with clean RIGHT input writes to classified directory', async () => {
    mockClassifyInput.mockResolvedValue(successRight('research', 0.88));

    const result = await runNew('An analysis of AI market trends.', {
      interactive: false,
      source: 'cli',
    });

    expect(mockVaultWrite).toHaveBeenCalled();
    const callArg = mockVaultWrite.mock.calls[0][0];
    expect(callArg).toContain('research');
    expect(result.deadLettered).toBeFalsy();
    expect(result.side).toBe('RIGHT');
  });

  test('with LEFT input writes to proposals/left-proposals/', async () => {
    mockClassifyInput.mockResolvedValue(successLeft('Daily', 0.88));

    const result = await runNew(
      'I reflected on my leadership style and realized I need to listen more.',
      { interactive: false, source: 'cli' }
    );

    expect(mockFormatLeftProposal).toHaveBeenCalled();
    const callArg = mockVaultWrite.mock.calls[0][0];
    expect(callArg).toContain('proposals/left-proposals');
    expect(result.deadLettered).toBeFalsy();
  });

  test('returns correlation ID and destination path in output', async () => {
    mockClassifyInput.mockResolvedValue(successRight('ideas', 0.85));

    const result = await runNew('A cool new idea about distributed systems.', {
      interactive: false,
      source: 'cli',
    });

    expect(result.correlationId).toBeDefined();
    expect(result.destination).toBeDefined();
  });

  // ── Blocked path ─────────────────────────────────────────────────────────

  test('with excluded content exits immediately with BLOCK — no vaultWrite', async () => {
    mockClassifyInput.mockResolvedValue(blocked('Excluded content detected (term: ISPN)'));

    const result = await runNew('ISPN queue routing configuration details.', {
      interactive: false,
      source: 'cli',
    });

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('ISPN');
    expect(mockVaultWrite).not.toHaveBeenCalled();
  });

  // ── Dead-letter paths surfaced from classifyInput ────────────────────────
  // classifyInput owns the actual writeDeadLetter call for Stage 0-2 failures;
  // new-command just surfaces the envelope. writeDeadLetter coverage for those
  // modes lives in classifier.test.js.

  test('Stage 0 internal failure surfaces deadLettered + exclusion-unavailable', async () => {
    mockClassifyInput.mockResolvedValue(deadLettered('exclusion-unavailable'));

    const result = await runNew('Some content that triggers policy failure.', {
      interactive: false,
      source: 'cli',
    });

    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('exclusion-unavailable');
    expect(mockVaultWrite).not.toHaveBeenCalled();
  });

  test('Stage 2 failure surfaces deadLettered + api-error', async () => {
    mockClassifyInput.mockResolvedValue(deadLettered('api-error'));

    const result = await runNew('Some perfectly good content.', {
      interactive: false,
      source: 'cli',
    });

    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('api-error');
    expect(mockVaultWrite).not.toHaveBeenCalled();
  });

  test('config-error is surfaced with error envelope', async () => {
    mockClassifyInput.mockResolvedValue({
      correlationId: 'test-corr-id-new',
      success: false,
      failureMode: 'config-error',
    });

    const result = await runNew('Any content', { interactive: false });

    expect(result.error).toMatch(/Config load failed/);
  });

  // ── Empty input handled by new-command, not classifier ───────────────────

  test('empty input in non-interactive mode returns failureMode empty-input', async () => {
    const result = await runNew('', { interactive: false });
    expect(result.failureMode).toBe('empty-input');
    expect(result.deadLettered).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.correlationId).toBeDefined();
    expect(mockClassifyInput).not.toHaveBeenCalled();
  });

  test('whitespace-only input in non-interactive mode returns failureMode empty-input', async () => {
    const result = await runNew('   ', { interactive: false });
    expect(result.failureMode).toBe('empty-input');
    expect(result.deadLettered).toBe(false);
  });

  test('empty input in interactive mode returns error message', async () => {
    const result = await runNew('', { interactive: true });
    expect(result.error).toBe('No input provided');
    expect(result.correlationId).toBeDefined();
  });

  // ── Stage 3-5 catch block still owned by new-command ─────────────────────

  test('Stage 3-5 catch with STYLE_VIOLATION error code returns gate-rejection failureMode', async () => {
    mockClassifyInput.mockResolvedValue(successRight('research'));
    const err = Object.assign(new Error('style violation'), { code: 'STYLE_VIOLATION' });
    mockGenerateFilename.mockRejectedValue(err);

    const result = await runNew('Content that triggers a style gate.', {
      interactive: false,
      source: 'cli',
    });

    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('gate-rejection');
    expect(mockWriteDeadLetter).toHaveBeenCalledWith(
      expect.any(String),
      'gate-rejection',
      expect.any(String),
      expect.any(Object)
    );
  });

  test('Stage 3-5 catch with PATH_BLOCKED error code returns gate-rejection failureMode', async () => {
    mockClassifyInput.mockResolvedValue(successRight('research'));
    const err = Object.assign(new Error('path blocked'), { code: 'PATH_BLOCKED' });
    mockGenerateFilename.mockRejectedValue(err);

    const result = await runNew('Content that hits a blocked path.', {
      interactive: false,
      source: 'cli',
    });

    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('gate-rejection');
  });

  test('Stage 3-5 catch with generic error returns api-error failureMode', async () => {
    mockClassifyInput.mockResolvedValue(successRight('research'));
    mockGenerateFilename.mockRejectedValue(new Error('unexpected failure'));

    const result = await runNew('Content that hits an unexpected error.', {
      interactive: false,
      source: 'cli',
    });

    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('api-error');
  });

  // ── Wikilink enrichment non-blocking ─────────────────────────────────────

  test('wikilink enrichment failure is non-blocking — pipeline still succeeds', async () => {
    mockClassifyInput.mockResolvedValue(successRight('research'));
    mockSuggestWikilinks.mockRejectedValue(new Error('wikilink service unavailable'));

    const result = await runNew('Valid content that succeeds all stages.', {
      interactive: false,
      source: 'cli',
    });

    expect(result.deadLettered).toBeFalsy();
    expect(result.blocked).toBe(false);
    expect(result.destination).toBeDefined();
    expect(result.side).toBe('RIGHT');
  });

  // ── LEFT side full routing path ──────────────────────────────────────────

  test('LEFT side routing uses formatLeftProposal and writes to proposals/left-proposals/', async () => {
    mockClassifyInput.mockResolvedValue(successLeft('Reflections', 0.9));

    const result = await runNew(
      'I realized today that I need to invest more in deep work practices.',
      { interactive: false, source: 'cli' }
    );

    expect(mockFormatLeftProposal).toHaveBeenCalled();
    expect(mockFormatNote).not.toHaveBeenCalled();
    const writeCallArg = mockVaultWrite.mock.calls[0][0];
    expect(writeCallArg).toContain('proposals/left-proposals/');
    expect(result.side).toBe('LEFT');
    expect(result.deadLettered).toBeFalsy();
  });
});

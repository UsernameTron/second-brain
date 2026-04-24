'use strict';

/**
 * test/classifier-integration.test.js
 *
 * Phase 16 (D-01): integration tests for classifier.classifyInput().
 *
 * Unlike test/classifier.test.js which mocks each stage function individually,
 * this file mocks ONLY the LLM client (createHaikuClient / createSonnetClient)
 * and content-policy for Stage 0, then runs real Stage 0 / Stage 1 / Stage 2
 * code through classifyInput. Catches integration bugs that per-stage mocks
 * would miss — schema drift between stages, instrumentation regressions,
 * threshold logic, fallback paths.
 *
 * Targets the classifier.js uncovered branches:
 *   L266       Stage 2 Haiku failure path
 *   L294-295   Sonnet failure → needsInteractive fallback
 *   L359       config-error early return
 *   L385-390   Stage 0 internal failure (deadLetter = true) path
 *   L444-450   Stage 2 failureMode + writeDeadLetter path
 */

const path = require('path');

process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

describe('classifier.classifyInput — integration', () => {
  let classifyInput;
  let mockHaiku;
  let mockSonnet;
  let mockCheckContent;
  let mockWriteDeadLetter;

  beforeEach(() => {
    jest.resetModules();

    // Mock only the LLM clients + content-policy + writeDeadLetter.
    // runStage0/1/2 code paths execute for real.
    mockHaiku = { classify: jest.fn() };
    mockSonnet = { classify: jest.fn() };
    mockCheckContent = jest.fn();
    mockWriteDeadLetter = jest.fn().mockResolvedValue({ path: 'proposals/unrouted/x.md' });

    jest.doMock('../src/pipeline-infra', () => {
      const actual = jest.requireActual('../src/pipeline-infra');
      return {
        ...actual,
        createHaikuClient: jest.fn(() => mockHaiku),
        createSonnetClient: jest.fn(() => mockSonnet),
        writeDeadLetter: mockWriteDeadLetter,
      };
    });

    jest.doMock('../src/content-policy', () => {
      const actual = jest.requireActual('../src/content-policy');
      return {
        ...actual,
        checkContent: mockCheckContent,
      };
    });

    ({ classifyInput } = require('../src/classifier'));
  });

  // ── config-error branch (L359) ───────────────────────────────────────────

  test('returns config-error when safeLoadPipelineConfig fails (L359)', async () => {
    jest.resetModules();
    jest.doMock('../src/pipeline-infra', () => {
      const actual = jest.requireActual('../src/pipeline-infra');
      return {
        ...actual,
        safeLoadPipelineConfig: () => ({ config: null, error: new Error('config missing') }),
        createHaikuClient: jest.fn(() => mockHaiku),
      };
    });
    ({ classifyInput } = require('../src/classifier'));

    const result = await classifyInput('Any content', { interactive: false });

    expect(result.success).toBe(false);
    expect(result.failureMode).toBe('config-error');
    expect(result.correlationId).toBeDefined();
  });

  // ── Stage 0 blocked (hard BLOCK) ─────────────────────────────────────────

  test('returns blocked=true when content-policy blocks (Stage 0 BLOCK)', async () => {
    mockCheckContent.mockResolvedValue({
      decision: 'BLOCK',
      reason: 'Term matched excluded list',
    });

    const result = await classifyInput('ISPN queue config details.', { interactive: false });

    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/excluded/i);
    expect(mockHaiku.classify).not.toHaveBeenCalled();
    expect(mockWriteDeadLetter).not.toHaveBeenCalled(); // D-41: no dead-letter on BLOCK
  });

  // ── Stage 0 internal failure (L385-390) ──────────────────────────────────

  test('returns deadLettered + exclusion-unavailable when Stage 0 throws (L385-390)', async () => {
    mockCheckContent.mockRejectedValue(new Error('content-policy internal failure'));

    const result = await classifyInput('Normal content.', { interactive: false });

    expect(result.blocked).toBe(false);
    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('exclusion-unavailable');
    expect(mockWriteDeadLetter).toHaveBeenCalledWith(
      'Normal content.',
      'exclusion-unavailable',
      expect.any(String),
      expect.objectContaining({ source: 'cli' })
    );
  });

  // ── Stage 1 API failure ──────────────────────────────────────────────────

  test('returns deadLettered + api-error when Stage 1 Haiku fails', async () => {
    mockCheckContent.mockResolvedValue({ decision: 'PASS' });
    mockHaiku.classify.mockResolvedValue({
      success: false,
      error: 'timeout',
      failureMode: 'api-error',
    });

    const result = await classifyInput('Normal content here.', { interactive: false });

    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('api-error');
    expect(mockWriteDeadLetter).toHaveBeenCalled();
  });

  // ── Stage 1 low confidence in non-interactive mode ───────────────────────

  test('returns deadLettered + non-interactive-ambiguous when Stage 1 low confidence', async () => {
    mockCheckContent.mockResolvedValue({ decision: 'PASS' });
    // Stage 1 Haiku returns below stage1ConfidenceThreshold (0.8)
    mockHaiku.classify.mockResolvedValueOnce({
      success: true,
      data: { side: 'RIGHT', confidence: 0.5, rationale: 'uncertain' },
    });

    const result = await classifyInput('Ambiguous content here.', { interactive: false });

    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('non-interactive-ambiguous');
    expect(result.stage1).toBeDefined();
    expect(mockWriteDeadLetter).toHaveBeenCalledWith(
      expect.any(String),
      'non-interactive-ambiguous',
      expect.any(String),
      expect.any(Object)
    );
  });

  // ── Stage 2 api-error path (L266, L444-450) ──────────────────────────────

  test('returns deadLettered when Stage 2 Haiku fails (L266, L444-450)', async () => {
    mockCheckContent.mockResolvedValue({ decision: 'PASS' });
    mockHaiku.classify
      // Stage 1: high confidence RIGHT
      .mockResolvedValueOnce({
        success: true,
        data: { side: 'RIGHT', confidence: 0.95, rationale: 'research' },
      })
      // Stage 2: API failure
      .mockResolvedValueOnce({
        success: false,
        error: 'rate-limited',
        failureMode: 'api-error',
      });

    const result = await classifyInput('Research content that fails Stage 2.', { interactive: false });

    expect(result.deadLettered).toBe(true);
    expect(result.failureMode).toBe('api-error');
  });

  // ── Stage 2 Sonnet escalation + Sonnet failure (L294-295) ────────────────

  test('falls back to needsInteractive when Sonnet escalation fails (L294-295)', async () => {
    mockCheckContent.mockResolvedValue({ decision: 'PASS' });
    mockHaiku.classify
      .mockResolvedValueOnce({
        success: true,
        data: { side: 'RIGHT', confidence: 0.95, rationale: 'research' },
      })
      // Stage 2 Haiku: low confidence → triggers Sonnet escalation
      .mockResolvedValueOnce({
        success: true,
        data: {
          directory: 'research',
          confidence: 0.55,
          rationale: 'unsure',
          topCandidates: ['research', 'ideas'],
        },
      });
    // Sonnet fails
    mockSonnet.classify.mockResolvedValue({
      success: false,
      error: 'sonnet-down',
    });

    // Interactive mode so we can reach the escalation+fallback path
    const result = await classifyInput('Borderline content for Sonnet.', { interactive: true });

    // needsInteractive flag + topCandidates + sonnetEscalated: true
    expect(result.needsInteractive).toBe(true);
    expect(result.topCandidates).toBeDefined();
    expect(result.sonnetEscalated).toBe(true);
  });

  // ── Happy path RIGHT: full pipeline success ──────────────────────────────

  test('RIGHT success path returns stage1/stage2 nested objects', async () => {
    mockCheckContent.mockResolvedValue({ decision: 'PASS' });
    mockHaiku.classify
      .mockResolvedValueOnce({
        success: true,
        data: { side: 'RIGHT', confidence: 0.95, rationale: 'research' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { directory: 'research', confidence: 0.9, rationale: 'clear fit' },
      });

    const result = await classifyInput('Research content that succeeds cleanly.', { interactive: false });

    expect(result.blocked).toBe(false);
    expect(result.deadLettered).toBeUndefined();
    expect(result.side).toBe('RIGHT');
    expect(result.directory).toBe('research');
    expect(result.stage1).toEqual({ side: 'RIGHT', confidence: 0.95 });
    expect(result.stage2).toEqual(expect.objectContaining({
      directory: 'research',
      confidence: 0.9,
      sonnetEscalated: false,
    }));
  });

  // ── Happy path LEFT: success with suggestedLeftPath ──────────────────────

  test('LEFT success path returns suggestedLeftPath and routes to proposals/left-proposals', async () => {
    mockCheckContent.mockResolvedValue({ decision: 'PASS' });
    mockHaiku.classify
      .mockResolvedValueOnce({
        success: true,
        data: { side: 'LEFT', confidence: 0.92, rationale: 'first-person' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { directory: 'Daily', confidence: 0.88, rationale: 'reflection' },
      });

    const result = await classifyInput('I reflected on my leadership style today.', { interactive: false });

    expect(result.side).toBe('LEFT');
    expect(result.directory).toBe('proposals/left-proposals');
    expect(result.suggestedLeftPath).toBe('Daily/');
    expect(result.stage1.side).toBe('LEFT');
    expect(result.stage2.directory).toBe('Daily');
  });

  test('LEFT success with null stage2.directory uses Drafts/ suggestedLeftPath', async () => {
    mockCheckContent.mockResolvedValue({ decision: 'PASS' });
    mockHaiku.classify
      .mockResolvedValueOnce({
        success: true,
        data: { side: 'LEFT', confidence: 0.92, rationale: 'first-person' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { directory: null, confidence: 0.8, rationale: 'no clear fit' },
      });

    const result = await classifyInput('A personal reflection without a clear category.', { interactive: false });

    expect(result.side).toBe('LEFT');
    expect(result.suggestedLeftPath).toBe('Drafts/');
  });

  // ── source option propagation ────────────────────────────────────────────

  test('propagates source option to dead-letter calls', async () => {
    mockCheckContent.mockResolvedValue({ decision: 'PASS' });
    mockHaiku.classify.mockResolvedValue({
      success: false,
      error: 'timeout',
      failureMode: 'api-error',
    });

    await classifyInput('Content from a custom source.', {
      interactive: false,
      source: 'custom-tool',
    });

    expect(mockWriteDeadLetter).toHaveBeenCalledWith(
      expect.any(String),
      'api-error',
      expect.any(String),
      expect.objectContaining({ source: 'custom-tool' })
    );
  });
});

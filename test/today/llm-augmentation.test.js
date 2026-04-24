'use strict';

/**
 * test/today/llm-augmentation.test.js
 *
 * Unit tests for src/today/llm-augmentation.js extracted in Phase 15.
 * Covers: diagnostic checklist (degradedCount >= 4), LLM success (string data),
 * LLM success (object data with synthesis key), LLM failure → static fallback,
 * context part assembly under mixed degraded states.
 */

const {
  generateSynthesis,
  renderDiagnosticChecklist,
} = require('../../src/today/llm-augmentation');

function mockHaiku(resultData) {
  return {
    classify: jest.fn().mockResolvedValue(resultData),
  };
}

function healthyContext(overrides = {}) {
  return {
    connectorResults: {
      calendar: { success: true, data: [{ id: 1 }, { id: 2 }] },
      gmail: { success: true, data: [{ id: 1 }] },
      github: { success: true, data: { repos: [{ name: 'r1' }] } },
    },
    pipelineState: {
      ok: true,
      proposalCount: 3,
      deadLetter: { pending: 1, frozen: 0, total: 1 },
    },
    slippage: { projects: [], warnings: [] },
    frog: { frog: null, reasoning: 'none' },
    degradedCount: 0,
    ...overrides,
  };
}

describe('renderDiagnosticChecklist', () => {
  test('returns blockquoted checklist with 3 diagnostic steps', () => {
    const out = renderDiagnosticChecklist();

    expect(out.split('\n')).toHaveLength(4); // header + 3 steps
    expect(out).toMatch(/All data sources unavailable/);
    expect(out).toMatch(/Docker Desktop/);
    expect(out).toMatch(/Local REST API/);
    expect(out).toMatch(/Network/);
    out.split('\n').forEach(line => expect(line).toMatch(/^>/));
  });
});

describe('generateSynthesis', () => {
  test('returns diagnostic checklist when degradedCount >= 4 without calling LLM', async () => {
    const haiku = mockHaiku({ success: true, data: 'should not be used' });
    const ctx = healthyContext({ degradedCount: 4 });

    const result = await generateSynthesis(ctx, haiku);

    expect(result).toBe(renderDiagnosticChecklist());
    expect(haiku.classify).not.toHaveBeenCalled();
  });

  test('returns LLM synthesis as blockquote when data is a string', async () => {
    const haiku = mockHaiku({ success: true, data: 'Focus on the API migration today.' });

    const result = await generateSynthesis(healthyContext(), haiku);

    expect(result).toBe('> Focus on the API migration today.');
    expect(haiku.classify).toHaveBeenCalledTimes(1);
  });

  test('returns LLM synthesis as blockquote when data.synthesis is set (object shape)', async () => {
    const haiku = mockHaiku({ success: true, data: { synthesis: 'Clear the dead-letter queue.' } });

    const result = await generateSynthesis(healthyContext(), haiku);

    expect(result).toBe('> Clear the dead-letter queue.');
  });

  test('returns static fallback when LLM call fails', async () => {
    const haiku = mockHaiku({ success: false, error: 'API_DOWN' });
    const ctx = healthyContext({ degradedCount: 1 });

    const result = await generateSynthesis(ctx, haiku);

    expect(result).toMatch(/^> Briefing generated with 1 degraded source/);
  });

  test('returns static fallback when LLM data is malformed (no string, no synthesis)', async () => {
    const haiku = mockHaiku({ success: true, data: { unexpected: 'shape' } });
    const ctx = healthyContext({ degradedCount: 2 });

    const result = await generateSynthesis(ctx, haiku);

    expect(result).toMatch(/^> Briefing generated with 2 degraded source/);
  });

  test('feeds degraded connector errors into context prompt', async () => {
    const haiku = mockHaiku({ success: true, data: 'ok' });
    const ctx = healthyContext({
      connectorResults: {
        calendar: { success: false, error: 'MCP_ERROR: timeout' },
        gmail: { success: false, error: 'MCP_ERROR: auth' },
        github: { success: true, data: { repos: [] } },
      },
      degradedCount: 2,
    });

    await generateSynthesis(ctx, haiku);

    const userPrompt = haiku.classify.mock.calls[0][1];
    expect(userPrompt).toMatch(/Calendar: degraded.*timeout/);
    expect(userPrompt).toMatch(/Gmail: degraded.*auth/);
    expect(userPrompt).toMatch(/GitHub repos with activity: 0/);
    expect(userPrompt).toMatch(/Degraded sources: 2/);
  });

  test('includes frog in context prompt when present', async () => {
    const haiku = mockHaiku({ success: true, data: 'ok' });
    const ctx = healthyContext({
      frog: { frog: 'alpha: finish Phase 2', reasoning: 'r' },
    });

    await generateSynthesis(ctx, haiku);

    const userPrompt = haiku.classify.mock.calls[0][1];
    expect(userPrompt).toMatch(/Frog: alpha: finish Phase 2/);
  });

  test('includes stalled project count', async () => {
    const haiku = mockHaiku({ success: true, data: 'ok' });
    const ctx = healthyContext({
      slippage: {
        projects: [
          { stalled: true, name: 'a' },
          { stalled: true, name: 'b' },
          { stalled: false, name: 'c' },
        ],
        warnings: [],
      },
    });

    await generateSynthesis(ctx, haiku);

    const userPrompt = haiku.classify.mock.calls[0][1];
    expect(userPrompt).toMatch(/Stalled projects: 2/);
  });

  test('reports pipeline degraded when pipelineState.ok is false', async () => {
    const haiku = mockHaiku({ success: true, data: 'ok' });
    const ctx = healthyContext({
      pipelineState: { ok: false, proposalCount: 0, deadLetter: { total: 0 } },
      degradedCount: 1,
    });

    await generateSynthesis(ctx, haiku);

    const userPrompt = haiku.classify.mock.calls[0][1];
    expect(userPrompt).toMatch(/Pipeline: degraded/);
  });
});

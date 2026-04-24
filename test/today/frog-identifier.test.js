'use strict';

/**
 * test/today/frog-identifier.test.js
 *
 * Unit tests for src/today/frog-identifier.js extracted in Phase 15.
 * Covers: no stalled projects, LLM success, LLM failure → heuristic fallback,
 * candidate list shape, reasoning propagation.
 */

const { identifyFrog } = require('../../src/today/frog-identifier');

function mockHaikuSuccess(frog, reasoning = 'Because of reasons.') {
  return {
    classify: jest.fn().mockResolvedValue({
      success: true,
      data: { frog, reasoning },
    }),
  };
}

function mockHaikuFailure() {
  return {
    classify: jest.fn().mockResolvedValue({
      success: false,
      error: 'LLM_ERROR',
    }),
  };
}

const STALLED_A = {
  name: 'alpha', status: 'active', phase: 'Phase 2/5',
  percent: 40, daysSinceActivity: 10, stalled: true,
};
const STALLED_B = {
  name: 'beta', status: 'paused', phase: 'Phase 1/3',
  percent: 33, daysSinceActivity: 14, stalled: true,
};
const NOT_STALLED = {
  name: 'gamma', status: 'active', phase: 'Phase 3/5',
  percent: 60, daysSinceActivity: 2, stalled: false,
};

describe('identifyFrog', () => {
  test('returns null frog when no projects are stalled', async () => {
    const result = await identifyFrog(
      { projects: [NOT_STALLED], warnings: [] },
      mockHaikuSuccess('unused', 'unused')
    );

    expect(result.frog).toBeNull();
    expect(result.reasoning).toMatch(/No stalled projects/);
  });

  test('returns null frog when projects array is empty', async () => {
    const result = await identifyFrog(
      { projects: [], warnings: [] },
      mockHaikuSuccess('unused', 'unused')
    );

    expect(result.frog).toBeNull();
  });

  test('returns LLM-identified frog when Haiku succeeds', async () => {
    const haiku = mockHaikuSuccess('alpha: finish Phase 2', 'longest stalled');
    const result = await identifyFrog(
      { projects: [STALLED_A, STALLED_B], warnings: [] },
      haiku
    );

    expect(result.frog).toBe('alpha: finish Phase 2');
    expect(result.reasoning).toBe('longest stalled');
    expect(haiku.classify).toHaveBeenCalledTimes(1);
  });

  test('propagates default reasoning when LLM omits it', async () => {
    const haiku = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: { frog: 'alpha: do the thing' },
      }),
    };

    const result = await identifyFrog(
      { projects: [STALLED_A], warnings: [] },
      haiku
    );

    expect(result.frog).toBe('alpha: do the thing');
    expect(result.reasoning).toMatch(/No reasoning provided/);
  });

  test('falls back to heuristic when LLM call fails', async () => {
    const result = await identifyFrog(
      { projects: [STALLED_A, STALLED_B], warnings: [] },
      mockHaikuFailure()
    );

    // beta has 14 days stalled > alpha's 10 → beta picked
    expect(result.frog).toBe('beta');
    expect(result.reasoning).toMatch(/Heuristic fallback/);
    expect(result.reasoning).toMatch(/14 days/);
  });

  test('falls back to heuristic when LLM returns malformed data (no frog key)', async () => {
    const haiku = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: { reasoning: 'missing frog field' },
      }),
    };

    const result = await identifyFrog(
      { projects: [STALLED_A], warnings: [] },
      haiku
    );

    expect(result.frog).toBe('alpha');
    expect(result.reasoning).toMatch(/Heuristic fallback/);
  });

  test('passes only stalled projects to LLM', async () => {
    const haiku = mockHaikuSuccess('alpha', 'r');
    await identifyFrog(
      { projects: [STALLED_A, NOT_STALLED, STALLED_B], warnings: [] },
      haiku
    );

    const userPayload = JSON.parse(haiku.classify.mock.calls[0][1]);
    expect(userPayload).toHaveLength(2);
    expect(userPayload.map(p => p.project)).toEqual(['alpha', 'beta']);
    // gamma (not stalled) filtered out
    expect(userPayload.map(p => p.project)).not.toContain('gamma');
  });
});

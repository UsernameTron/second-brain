'use strict';

/**
 * session-memory-inject.test.js
 *
 * Pure-function tests for .claude/hooks/session-memory-inject.js — Phase 35
 * (INJECT-HOOK-01/EGRESS-01/KILL-01). All deps are injected fakes; no
 * network, no real recall/voyage calls.
 */

const { buildSessionMemoryContext } = require('../../.claude/hooks/session-memory-inject');

function makeResults(n, snippetLength = 20) {
  return Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    category: `category-${i}`,
    snippet: 'x'.repeat(snippetLength) + `-${i}`,
    date: '2026-07-20',
    score: 0.9,
  }));
}

function baseConfig(overrides = {}) {
  return {
    enabled: true,
    topN: 5,
    tokenCap: 750,
    latencyUpMs: 1000,
    latencyDegradedMs: 250,
    ...overrides,
  };
}

function baseDeps(overrides = {}) {
  return {
    runRecall: jest.fn(async () => ({ results: makeResults(3), blocked: false, empty: false })),
    checkContent: jest.fn(async () => ({ decision: 'PASS' })),
    loadExcludedTerms: jest.fn(() => []),
    isDegraded: jest.fn(() => false),
    config: baseConfig(),
    query: 'second-brain',
    env: {},
    ...overrides,
  };
}

describe('buildSessionMemoryContext', () => {
  test('env SB_SESSION_INJECT=0 disables injection without calling runRecall', async () => {
    const deps = baseDeps({ env: { SB_SESSION_INJECT: '0' } });
    const out = await buildSessionMemoryContext(deps);
    expect(out).toEqual({ text: '', skipped: true, reason: 'env override' });
    expect(deps.runRecall).not.toHaveBeenCalled();
  });

  test('config.enabled=false disables injection without calling runRecall', async () => {
    const deps = baseDeps({ config: baseConfig({ enabled: false }) });
    const out = await buildSessionMemoryContext(deps);
    expect(out).toEqual({ text: '', skipped: true, reason: 'config disabled' });
    expect(deps.runRecall).not.toHaveBeenCalled();
  });

  test('3 PASS results produce 3 markdown bullets', async () => {
    const deps = baseDeps();
    const out = await buildSessionMemoryContext(deps);
    expect(out.skipped).toBe(false);
    expect(out.count).toBe(3);
    expect(out.text).toContain('## Recalled memory (proactive)');
    for (let i = 0; i < 3; i++) {
      expect(out.text).toContain(`- **2026-07-20 · category-${i}** — ${'x'.repeat(20)}-${i}`);
    }
  });

  test('one BLOCK verdict drops that entry, keeps the rest (fail-closed)', async () => {
    const deps = baseDeps({
      checkContent: jest.fn(async (content) => {
        if (content.includes('category-1')) return { decision: 'BLOCK' };
        return { decision: 'PASS' };
      }),
    });
    const out = await buildSessionMemoryContext(deps);
    expect(out.count).toBe(2);
    expect(out.text).not.toContain('category-1');
    expect(out.text).toContain('category-0');
    expect(out.text).toContain('category-2');
  });

  test('checkContent throwing for one entry drops it, hook does not throw (fail-closed)', async () => {
    const deps = baseDeps({
      checkContent: jest.fn(async (content) => {
        if (content.includes('category-2')) throw new Error('haiku down');
        return { decision: 'PASS' };
      }),
    });
    const out = await buildSessionMemoryContext(deps);
    expect(out.count).toBe(2);
    expect(out.text).not.toContain('category-2');
  });

  test('token cap emits only whole entries that fit, never truncates mid-entry', async () => {
    const results = makeResults(5, 100);
    const deps = baseDeps({
      runRecall: jest.fn(async () => ({ results, blocked: false, empty: false })),
      config: baseConfig({ tokenCap: 70 }), // capChars = 280; each bullet ~135 chars -> 2 fit, 3rd doesn't
    });
    const out = await buildSessionMemoryContext(deps);
    expect(out.count).toBe(2);
    expect(out.text).toContain(`- **2026-07-20 · category-0** — ${'x'.repeat(100)}-0`);
    expect(out.text).toContain(`- **2026-07-20 · category-1** — ${'x'.repeat(100)}-1`);
    expect(out.text).not.toContain('category-2');
    // No bullet is a truncated substring of an original snippet.
    for (const r of results.slice(0, 2)) {
      const bulletLine = out.text.split('\n').find((l) => l.includes(r.category));
      expect(bulletLine).toContain(r.snippet);
    }
  });

  test('runRecall rejecting returns skipped without throwing (fail-open)', async () => {
    const deps = baseDeps({
      runRecall: jest.fn(async () => { throw new Error('network down'); }),
    });
    const out = await buildSessionMemoryContext(deps);
    expect(out).toEqual({ text: '', skipped: true, reason: 'recall error' });
  });

  test('runRecall never settling within the latency budget skips with reason latency', async () => {
    const deps = baseDeps({
      runRecall: jest.fn(() => new Promise(() => {})), // never resolves
      config: baseConfig({ latencyUpMs: 20 }),
    });
    const out = await buildSessionMemoryContext(deps);
    expect(out).toEqual({ text: '', skipped: true, reason: 'latency' });
  });

  test('isDegraded=true uses latencyDegradedMs budget', async () => {
    const deps = baseDeps({
      runRecall: jest.fn(() => new Promise(() => {})), // never resolves
      isDegraded: jest.fn(() => true),
      config: baseConfig({ latencyUpMs: 5000, latencyDegradedMs: 20 }),
    });
    const start = Date.now();
    const out = await buildSessionMemoryContext(deps);
    const elapsed = Date.now() - start;
    expect(out).toEqual({ text: '', skipped: true, reason: 'latency' });
    expect(elapsed).toBeLessThan(500);
  });

  test('blocked recall result returns skipped, no crash', async () => {
    const deps = baseDeps({
      runRecall: jest.fn(async () => ({ blocked: true, results: [] })),
    });
    const out = await buildSessionMemoryContext(deps);
    expect(out.skipped).toBe(true);
    expect(out.text).toBe('');
  });

  test('empty recall result returns skipped, no crash', async () => {
    const deps = baseDeps({
      runRecall: jest.fn(async () => ({ empty: true, results: [] })),
    });
    const out = await buildSessionMemoryContext(deps);
    expect(out.skipped).toBe(true);
    expect(out.text).toBe('');
  });

  test('zero results returns skipped, no crash', async () => {
    const deps = baseDeps({
      runRecall: jest.fn(async () => ({ results: [], blocked: false, empty: false })),
    });
    const out = await buildSessionMemoryContext(deps);
    expect(out.skipped).toBe(true);
  });

  test('all entries excluded returns skipped with reason all excluded', async () => {
    const deps = baseDeps({
      checkContent: jest.fn(async () => ({ decision: 'BLOCK' })),
    });
    const out = await buildSessionMemoryContext(deps);
    expect(out).toEqual({ text: '', skipped: true, reason: 'all excluded' });
  });

  test('runRecall is called with query, --hybrid, --top, topN, and { _internal: true }', async () => {
    const deps = baseDeps();
    await buildSessionMemoryContext(deps);
    expect(deps.runRecall).toHaveBeenCalledWith(
      ['second-brain', '--hybrid', '--top', '5'],
      { _internal: true }
    );
  });
});

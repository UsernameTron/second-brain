'use strict';

/**
 * recall-command.test.js
 *
 * Tests for src/recall-command.js.
 * Phase 20: counter instrumentation emit points.
 */

const path = require('path');

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSearchMemoryKeyword = jest.fn();
const mockSemanticSearch = jest.fn();
const mockHybridSearch = jest.fn();
const mockRecordRecallInvocation = jest.fn();
const mockRecordTopRrf = jest.fn();

jest.mock('../src/memory-reader', () => ({
  searchMemoryKeyword: (...args) => mockSearchMemoryKeyword(...args),
}));

jest.mock('../src/utils/memory-utils', () => ({
  sourceRefShort: (ref) => ref || 'unknown',
}));

jest.mock('../src/semantic-index', () => ({
  semanticSearch: (...args) => mockSemanticSearch(...args),
  hybridSearch: (...args) => mockHybridSearch(...args),
}));

jest.mock('../src/daily-stats', () => ({
  recordRecallInvocation: (...args) => mockRecordRecallInvocation(...args),
  recordTopRrf: (...args) => mockRecordTopRrf(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHit(overrides = {}) {
  return {
    id: 'e1',
    category: 'work',
    content: 'test content',
    snippet: 'test snippet',
    sourceRef: 'memory/memory.md#1',
    date: '2026-04-24',
    score: 0.9,
    ...overrides,
  };
}

// ── parseRecallArgs ───────────────────────────────────────────────────────────

describe('parseRecallArgs()', () => {
  let parseRecallArgs;

  beforeEach(() => {
    jest.resetModules();
    // Re-mock after resetModules
    jest.mock('../src/memory-reader', () => ({ searchMemoryKeyword: mockSearchMemoryKeyword }));
    jest.mock('../src/utils/memory-utils', () => ({ sourceRefShort: (ref) => ref || 'unknown' }));
    jest.mock('../src/semantic-index', () => ({ semanticSearch: mockSemanticSearch, hybridSearch: mockHybridSearch }));
    jest.mock('../src/daily-stats', () => ({ recordRecallInvocation: mockRecordRecallInvocation, recordTopRrf: mockRecordTopRrf }));
    ({ parseRecallArgs } = require('../src/recall-command'));
  });

  it('parses a plain query', () => {
    const { query, flags } = parseRecallArgs(['hello world']);
    expect(query).toBe('hello world');
    expect(flags.semantic).toBe(false);
    expect(flags.hybrid).toBe(false);
  });

  it('parses --semantic flag', () => {
    const { flags } = parseRecallArgs(['test', '--semantic']);
    expect(flags.semantic).toBe(true);
  });

  it('parses --hybrid flag', () => {
    const { flags } = parseRecallArgs(['test', '--hybrid']);
    expect(flags.hybrid).toBe(true);
  });

  it('parses --category and --top flags', () => {
    const { flags } = parseRecallArgs(['test', '--category', 'work', '--top', '10']);
    expect(flags.category).toBe('work');
    expect(flags.top).toBe(10);
  });
});

// ── Phase 20: recall_count instrumentation ────────────────────────────────────

describe('Phase 20: recall_count instrumentation', () => {
  let runRecall;

  beforeEach(() => {
    jest.resetModules();
    mockRecordRecallInvocation.mockClear();
    mockRecordTopRrf.mockClear();
    mockSearchMemoryKeyword.mockClear();
    mockSemanticSearch.mockClear();
    mockHybridSearch.mockClear();

    // Re-apply mocks after resetModules
    jest.mock('../src/memory-reader', () => ({ searchMemoryKeyword: mockSearchMemoryKeyword }));
    jest.mock('../src/utils/memory-utils', () => ({ sourceRefShort: (ref) => ref || 'unknown' }));
    jest.mock('../src/semantic-index', () => ({ semanticSearch: mockSemanticSearch, hybridSearch: mockHybridSearch }));
    jest.mock('../src/daily-stats', () => ({ recordRecallInvocation: mockRecordRecallInvocation, recordTopRrf: mockRecordTopRrf }));

    ({ runRecall } = require('../src/recall-command'));
  });

  it('increments recall_count once per /recall invocation (default mode)', async () => {
    mockSearchMemoryKeyword.mockResolvedValue([]);
    await runRecall(['test query']);
    expect(mockRecordRecallInvocation).toHaveBeenCalledTimes(1);
  });

  it('increments recall_count for --keyword mode', async () => {
    mockSearchMemoryKeyword.mockResolvedValue([]);
    await runRecall(['test query', '--keyword']);
    expect(mockRecordRecallInvocation).toHaveBeenCalledTimes(1);
  });

  it('increments recall_count for --semantic mode (mocked Voyage)', async () => {
    mockSemanticSearch.mockResolvedValue({ results: [], degraded: false });
    await runRecall(['test query', '--semantic']);
    expect(mockRecordRecallInvocation).toHaveBeenCalledTimes(1);
  });

  it('increments recall_count for --hybrid mode', async () => {
    mockHybridSearch.mockResolvedValue({ results: [], degraded: false, mode: 'hybrid' });
    await runRecall(['test query', '--hybrid']);
    expect(mockRecordRecallInvocation).toHaveBeenCalledTimes(1);
  });

  it('does NOT increment recall_count when called with options._internal: true', async () => {
    mockSearchMemoryKeyword.mockResolvedValue([]);
    await runRecall(['test query'], { _internal: true });
    expect(mockRecordRecallInvocation).not.toHaveBeenCalled();
  });

  it('--hybrid emits top-1 RRF score on non-empty results', async () => {
    const hit = makeHit({ rrfScore: 0.042 });
    mockHybridSearch.mockResolvedValue({ results: [hit], degraded: false, mode: 'hybrid' });
    await runRecall(['test', '--hybrid']);
    expect(mockRecordTopRrf).toHaveBeenCalledTimes(1);
    expect(mockRecordTopRrf).toHaveBeenCalledWith(0.042);
  });

  it('--hybrid does NOT emit RRF score on empty results', async () => {
    mockHybridSearch.mockResolvedValue({ results: [], degraded: false, mode: 'hybrid' });
    await runRecall(['test', '--hybrid']);
    expect(mockRecordTopRrf).not.toHaveBeenCalled();
  });

  it('runRecall does not throw if recordRecallInvocation throws', async () => {
    mockRecordRecallInvocation.mockImplementation(() => { throw new Error('disk full'); });
    mockSearchMemoryKeyword.mockResolvedValue([]);
    const result = await runRecall(['test query']);
    expect(result).toBeDefined();
    expect(result.query).toBe('test query');
  });
});

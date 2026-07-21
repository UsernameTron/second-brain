'use strict';

describe('contradiction-check', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../src/semantic-index');
    jest.dontMock('../src/pipeline-infra');
  });

  test('clearly contradictory pair returns contradicts:true with the against hash', async () => {
    jest.doMock('../src/semantic-index', () => ({
      hybridSearch: jest.fn().mockResolvedValue({
        results: [
          { id: 'hash-never', content: 'never use X' },
          { id: 'hash-other', content: 'unrelated entry' },
        ],
      }),
    }));
    jest.doMock('../src/pipeline-infra', () => ({
      createHaikuClient: () => ({
        classify: jest.fn().mockResolvedValue({
          success: true,
          data: { contradicts: true, againstIndex: 0, confidence: 0.92 },
        }),
      }),
    }));

    const { checkContradiction } = require('../src/contradiction-check');
    const result = await checkContradiction({ content: 'always use X', contentHash: 'hash-always' });

    expect(result).toEqual({ contradicts: true, against: 'hash-never', confidence: 0.92 });
  });

  test('non-contradicting candidate returns contradicts:false', async () => {
    jest.doMock('../src/semantic-index', () => ({
      hybridSearch: jest.fn().mockResolvedValue({
        results: [{ id: 'hash-other', content: 'something unrelated' }],
      }),
    }));
    jest.doMock('../src/pipeline-infra', () => ({
      createHaikuClient: () => ({
        classify: jest.fn().mockResolvedValue({
          success: true,
          data: { contradicts: false, againstIndex: null, confidence: 0 },
        }),
      }),
    }));

    const { checkContradiction } = require('../src/contradiction-check');
    const result = await checkContradiction({ content: 'candidate text', contentHash: 'hash-candidate' });

    expect(result).toEqual({ contradicts: false, against: null, confidence: 0 });
  });

  test('Haiku unavailable degrades to no-contradiction, never throws', async () => {
    jest.doMock('../src/semantic-index', () => ({
      hybridSearch: jest.fn().mockResolvedValue({
        results: [{ id: 'hash-other', content: 'something' }],
      }),
    }));
    jest.doMock('../src/pipeline-infra', () => ({
      createHaikuClient: () => ({
        classify: jest.fn().mockResolvedValue({ success: false, error: 'api-error' }),
      }),
    }));

    const { checkContradiction } = require('../src/contradiction-check');
    const result = await checkContradiction({ content: 'candidate text', contentHash: 'hash-candidate' });

    expect(result).toEqual({ contradicts: false, against: null, confidence: 0 });
  });

  test('hybridSearch returning nothing degrades to no-contradiction', async () => {
    jest.doMock('../src/semantic-index', () => ({
      hybridSearch: jest.fn().mockResolvedValue({ results: [] }),
    }));
    jest.doMock('../src/pipeline-infra', () => ({
      createHaikuClient: () => ({ classify: jest.fn() }),
    }));

    const { checkContradiction } = require('../src/contradiction-check');
    const result = await checkContradiction({ content: 'candidate text', contentHash: 'hash-candidate' });

    expect(result).toEqual({ contradicts: false, against: null, confidence: 0 });
  });

  test('hybridSearch throwing degrades to no-contradiction, never throws', async () => {
    jest.doMock('../src/semantic-index', () => ({
      hybridSearch: jest.fn().mockRejectedValue(new Error('voyage down')),
    }));
    jest.doMock('../src/pipeline-infra', () => ({
      createHaikuClient: () => ({ classify: jest.fn() }),
    }));

    const { checkContradiction } = require('../src/contradiction-check');
    const result = await checkContradiction({ content: 'candidate text', contentHash: 'hash-candidate' });

    expect(result).toEqual({ contradicts: false, against: null, confidence: 0 });
  });
});

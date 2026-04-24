'use strict';

/**
 * test/note-formatter-coverage.test.js
 *
 * Phase 16 branch coverage lift for src/note-formatter.js.
 * Baseline branch coverage before this file: 62.24%.
 * Target: >= 80%.
 *
 * Covers the uncovered branches identified by `jest --coverage`:
 *   L114          extractTemplateFields: loadTemplatesConfig throws → return {}
 *   L120          extractTemplateFields: no domain template → return {}
 *   L145-147     extractTemplateFields: Haiku response.success=false → empty fields
 *   L159-161     extractTemplateFields: Haiku throw → empty fields
 *   L392-395     generateFilename: Haiku non-success/throw → slice fallback
 *   L403-404     generateFilename: empty baseFilename → timestamp fallback
 */

const path = require('path');

process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

describe('note-formatter coverage lift', () => {
  let noteFormatter;

  function mockHaikuSuccess(data) {
    return { classify: jest.fn().mockResolvedValue({ success: true, data }) };
  }

  function mockHaikuFailure(error = 'timeout') {
    return { classify: jest.fn().mockResolvedValue({ success: false, error }) };
  }

  function mockHaikuThrows(message = 'boom') {
    return { classify: jest.fn().mockRejectedValue(new Error(message)) };
  }

  // ── extractTemplateFields ────────────────────────────────────────────────

  describe('extractTemplateFields', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    test('returns {} when loadTemplatesConfig throws (L114)', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          loadTemplatesConfig: () => { throw new Error('config missing'); },
          createHaikuClient: () => mockHaikuSuccess({}),
        };
      });
      noteFormatter = require('../src/note-formatter');

      const result = await noteFormatter.extractTemplateFields('input', 'briefings');

      expect(result).toEqual({});
    });

    test('returns {} when domain template is missing from config (L120)', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          loadTemplatesConfig: () => ({ 'domain-templates': {}, 'memory-categories': {} }),
          createHaikuClient: () => mockHaikuSuccess({}),
        };
      });
      const { extractTemplateFields } = require('../src/note-formatter');

      const result = await extractTemplateFields('input body', 'unknown-domain');

      expect(result).toEqual({});
    });

    test('returns {} when template exists but fields is not an array', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          loadTemplatesConfig: () => ({
            'domain-templates': { foo: { fields: 'not-an-array' } },
            'memory-categories': {},
          }),
          createHaikuClient: () => mockHaikuSuccess({}),
        };
      });
      const { extractTemplateFields } = require('../src/note-formatter');

      const result = await extractTemplateFields('input body', 'foo');

      expect(result).toEqual({});
    });

    test('returns all-empty fields when Haiku response.success=false (L145-147)', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          loadTemplatesConfig: () => ({
            'domain-templates': {
              briefings: { fields: ['attendees', 'decisions'] },
            },
            'memory-categories': {},
          }),
          createHaikuClient: () => mockHaikuFailure('rate-limited'),
        };
      });
      const { extractTemplateFields } = require('../src/note-formatter');

      const result = await extractTemplateFields('input body', 'briefings');

      expect(result).toEqual({ attendees: '', decisions: '' });
    });

    test('returns all-empty fields when Haiku throws (L159-161)', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          loadTemplatesConfig: () => ({
            'domain-templates': {
              briefings: { fields: ['attendees', 'decisions'] },
            },
            'memory-categories': {},
          }),
          createHaikuClient: () => mockHaikuThrows('API down'),
        };
      });
      const { extractTemplateFields } = require('../src/note-formatter');

      const result = await extractTemplateFields('input body', 'briefings');

      expect(result).toEqual({ attendees: '', decisions: '' });
    });

    test('fills fields with extracted values when Haiku succeeds', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          loadTemplatesConfig: () => ({
            'domain-templates': {
              briefings: { fields: ['attendees', 'decisions'] },
            },
            'memory-categories': {},
          }),
          createHaikuClient: () => mockHaikuSuccess({
            attendees: 'Alice, Bob',
            decisions: 'Ship Friday',
          }),
        };
      });
      const { extractTemplateFields } = require('../src/note-formatter');

      const result = await extractTemplateFields('Meeting notes here.', 'briefings');

      expect(result.attendees).toBe('Alice, Bob');
      expect(result.decisions).toBe('Ship Friday');
    });

    test('defaults non-string field values to empty string', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          loadTemplatesConfig: () => ({
            'domain-templates': {
              briefings: { fields: ['attendees', 'decisions'] },
            },
            'memory-categories': {},
          }),
          createHaikuClient: () => mockHaikuSuccess({
            attendees: ['Alice', 'Bob'], // array, not string
            decisions: null,              // null
          }),
        };
      });
      const { extractTemplateFields } = require('../src/note-formatter');

      const result = await extractTemplateFields('input', 'briefings');

      expect(result.attendees).toBe('');
      expect(result.decisions).toBe('');
    });
  });

  // ── generateFilename ─────────────────────────────────────────────────────

  describe('generateFilename', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    test('uses --name option verbatim when provided (sanitized)', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          createHaikuClient: () => mockHaikuSuccess({}),
        };
      });
      const { generateFilename } = require('../src/note-formatter');

      const result = await generateFilename('any input body here', { name: 'my-note' });

      expect(result.filename).toBe('my-note.md');
      expect(result.filenameBasis).toBe('user-provided');
    });

    test('falls back to input slice when Haiku response.success=false (L392-395)', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          createHaikuClient: () => mockHaikuFailure('rate-limited'),
        };
      });
      const { generateFilename } = require('../src/note-formatter');

      const result = await generateFilename('Some meaningful input to slice.', {});

      // Haiku failed → fallback to sanitized slice
      expect(result.filename).toMatch(/\.md$/);
      expect(result.filenameBasis).toBe('haiku-generated');
    });

    test('falls back to input slice when Haiku throws (L394-395)', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          createHaikuClient: () => mockHaikuThrows('network error'),
        };
      });
      const { generateFilename } = require('../src/note-formatter');

      const result = await generateFilename('Another meaningful input.', {});

      expect(result.filename).toMatch(/\.md$/);
      expect(result.filenameBasis).toBe('haiku-generated');
    });

    test('falls back to timestamped filename when baseFilename is empty (L403-404)', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          createHaikuClient: () => mockHaikuSuccess({ filename: '!!!@@@' }),
        };
      });
      const { generateFilename } = require('../src/note-formatter');

      // Haiku returns an all-non-word filename which sanitizes to empty,
      // and the inputBody slice is also all punctuation → baseFilename empty
      // → timestamp fallback
      const result = await generateFilename('!!!@@@###$$$', {});

      expect(result.filename).toMatch(/^note-\d+\.md$/);
    });

    test('uses Haiku-generated filename when response includes filename', async () => {
      jest.doMock('../src/pipeline-infra', () => {
        const actual = jest.requireActual('../src/pipeline-infra');
        return {
          ...actual,
          createHaikuClient: () => mockHaikuSuccess({ filename: 'generated-title' }),
        };
      });
      const { generateFilename } = require('../src/note-formatter');

      const result = await generateFilename('A great piece of text to summarize.', {});

      expect(result.filename).toBe('generated-title.md');
      expect(result.filenameBasis).toBe('haiku-generated');
    });
  });
});

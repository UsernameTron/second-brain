'use strict';

/**
 * note-formatter.test.js
 *
 * Tests for src/note-formatter.js
 * Covers: formatNote, formatLeftProposal, generateFilename, extractTemplateFields
 *
 * All LLM calls are mocked — no real API calls.
 */

const path = require('path');

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/pipeline-infra', () => ({
  generateCorrelationId: jest.fn(() => 'test-corr-id'),
  createHaikuClient: jest.fn(),
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
  safeLoadPipelineConfig: jest.fn(() => ({
    config: {
      classifier: {
        stage1ConfidenceThreshold: 0.8,
        stage2ConfidenceThreshold: 0.7,
        sonnetEscalationThreshold: 0.8,
        sonnetAcceptThreshold: 0.7,
        shortInputChars: 50,
      },
      filename: { maxLength: 60, haikuWordRange: [4, 8] },
    },
    error: null,
  })),
  loadTemplatesConfig: jest.fn(() => ({
    'domain-templates': {
      briefings: {
        fields: ['attendees', 'meeting-date', 'decisions', 'follow-ups'],
      },
      'job-hunt': {
        fields: ['company', 'role-title', 'stage', 'next-step-date', 'source-url'],
      },
      'interview-prep': {
        fields: ['company', 'role', 'interview-date', 'interviewer', 'stories-selected', 'risk-questions'],
      },
    },
    'memory-categories': {},
  })),
}));

process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');
process.env.VAULT_ROOT = '/tmp/test-vault';

describe('formatNote', () => {
  let formatNote;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../src/pipeline-infra', () => ({
      generateCorrelationId: jest.fn(() => 'test-corr-id'),
      createHaikuClient: jest.fn(() => ({
        classify: jest.fn().mockResolvedValue({
          success: true,
          data: { attendees: 'Alice, Bob', 'meeting-date': '2026-04-22', decisions: 'go ahead', 'follow-ups': 'send email' },
        }),
      })),
      loadPipelineConfig: jest.fn(() => ({
        classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
        filename: { maxLength: 60, haikuWordRange: [4, 8] },
      })),
      safeLoadPipelineConfig: jest.fn(() => ({
        config: {
          classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
          filename: { maxLength: 60, haikuWordRange: [4, 8] },
        },
        error: null,
      })),
      loadTemplatesConfig: jest.fn(() => ({
        'domain-templates': {
          briefings: { fields: ['attendees', 'meeting-date', 'decisions', 'follow-ups'] },
          'job-hunt': { fields: ['company', 'role-title', 'stage', 'next-step-date', 'source-url'] },
          'interview-prep': { fields: ['company', 'role', 'interview-date', 'interviewer', 'stories-selected', 'risk-questions'] },
        },
        'memory-categories': {},
      })),
    }));
    ({ formatNote } = require('../src/note-formatter'));
  });

  test('produces YAML frontmatter with created, source, domain, routed-by, filename-basis, tags', async () => {
    const classificationResult = {
      side: 'RIGHT',
      directory: 'research',
      confidence: 0.88,
      stage1: { side: 'RIGHT', confidence: 0.9 },
      stage2: { directory: 'research', confidence: 0.88, sonnetEscalated: false },
    };

    const result = await formatNote('Some research notes about AI trends.', classificationResult, {
      source: 'cli',
      filenameBasis: 'first-line',
    });

    expect(result).toMatch(/^---/);
    expect(result).toMatch(/created:/);
    expect(result).toMatch(/source: cli/);
    expect(result).toMatch(/domain: research/);
    expect(result).toMatch(/routed-by:/);
    expect(result).toMatch(/stage-1:/);
    expect(result).toMatch(/stage-2:/);
    expect(result).toMatch(/filename-basis:/);
    expect(result).toMatch(/tags:/);
  });

  test('preserves raw input body verbatim after frontmatter', async () => {
    const classificationResult = {
      side: 'RIGHT',
      directory: 'ideas',
      confidence: 0.85,
      stage1: { side: 'RIGHT', confidence: 0.9 },
      stage2: { directory: 'ideas', confidence: 0.85, sonnetEscalated: false },
    };
    const inputBody = 'This is the raw input body — with special chars: & < > "quotes"';

    const result = await formatNote(inputBody, classificationResult, {
      source: 'cli',
      filenameBasis: 'first-line',
    });

    // Body must appear verbatim after closing ---
    expect(result).toContain(inputBody);
  });

  test('adds briefings template overlay fields for briefings domain', async () => {
    const classificationResult = {
      side: 'RIGHT',
      directory: 'briefings',
      confidence: 0.9,
      stage1: { side: 'RIGHT', confidence: 0.9 },
      stage2: { directory: 'briefings', confidence: 0.9, sonnetEscalated: false },
    };

    const result = await formatNote(
      'Meeting with Alice and Bob on 2026-04-22. Decision: proceed with MVP.',
      classificationResult,
      { source: 'cli', filenameBasis: 'haiku-generated', domain: 'briefings' }
    );

    // Template overlay fields for briefings
    expect(result).toMatch(/attendees/);
    expect(result).toMatch(/meeting-date/);
    expect(result).toMatch(/decisions/);
    expect(result).toMatch(/follow-ups/);
  });

  test('adds job-hunt template overlay fields for job-hunt domain', async () => {
    const classificationResult = {
      side: 'RIGHT',
      directory: 'job-hunt',
      confidence: 0.87,
      stage1: { side: 'RIGHT', confidence: 0.9 },
      stage2: { directory: 'job-hunt', confidence: 0.87, sonnetEscalated: false },
    };

    const { createHaikuClient } = require('../src/pipeline-infra');
    createHaikuClient.mockReturnValue({
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: { company: 'Acme Corp', 'role-title': 'Senior PM', stage: 'applied', 'next-step-date': '', 'source-url': '' },
      }),
    });

    const result = await formatNote(
      'Senior PM role at Acme Corp — fintech, $180k + equity',
      classificationResult,
      { source: 'cli', filenameBasis: 'first-line', domain: 'job-hunt' }
    );

    expect(result).toMatch(/company/);
    expect(result).toMatch(/role-title/);
    expect(result).toMatch(/stage/);
  });
});

describe('formatLeftProposal', () => {
  let formatLeftProposal;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../src/pipeline-infra', () => ({
      generateCorrelationId: jest.fn(() => 'test-corr-id'),
      createHaikuClient: jest.fn(() => ({ classify: jest.fn() })),
      loadPipelineConfig: jest.fn(() => ({
        classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
        filename: { maxLength: 60, haikuWordRange: [4, 8] },
      })),
      safeLoadPipelineConfig: jest.fn(() => ({
        config: {
          classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
          filename: { maxLength: 60, haikuWordRange: [4, 8] },
        },
        error: null,
      })),
      loadTemplatesConfig: jest.fn(() => ({
        'domain-templates': { briefings: { fields: ['attendees'] } },
        'memory-categories': {},
      })),
    }));
    ({ formatLeftProposal } = require('../src/note-formatter'));
  });

  test('produces frontmatter with type: left-proposal, suggested-left-path, proposal-action, status: pending', async () => {
    const classificationResult = {
      side: 'LEFT',
      suggestedLeftPath: 'ABOUT ME/',
      directory: 'proposals/left-proposals',
      confidence: 0.9,
      stage1: { side: 'LEFT', confidence: 0.92 },
      stage2: { directory: 'ABOUT ME', confidence: 0.88, sonnetEscalated: false },
    };

    const result = await formatLeftProposal(
      'I believe my core strength is empathy and systems thinking.',
      classificationResult,
      { source: 'cli' }
    );

    expect(result).toMatch(/type: left-proposal/);
    expect(result).toMatch(/suggested-left-path:/);
    expect(result).toMatch(/proposal-action:/);
    expect(result).toMatch(/status: pending/);
  });

  test('sets suggested-left-path to Daily/{today}.md and proposal-action: append for Daily note', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const classificationResult = {
      side: 'LEFT',
      suggestedLeftPath: 'Daily/',
      directory: 'proposals/left-proposals',
      confidence: 0.88,
      stage1: { side: 'LEFT', confidence: 0.88 },
      stage2: { directory: 'Daily', confidence: 0.85, sonnetEscalated: false },
    };

    const result = await formatLeftProposal(
      'Today I felt proud of how I navigated that difficult conversation.',
      classificationResult,
      { source: 'cli' }
    );

    expect(result).toMatch(new RegExp(`Daily/${today}\\.md`));
    expect(result).toMatch(/proposal-action: (append|create)/);
  });

  test('appends review checklist with accept, edit, reject, re-route options', async () => {
    const classificationResult = {
      side: 'LEFT',
      suggestedLeftPath: 'Drafts/',
      directory: 'proposals/left-proposals',
      confidence: 0.85,
      stage1: { side: 'LEFT', confidence: 0.9 },
      stage2: { directory: 'Drafts', confidence: 0.85, sonnetEscalated: false },
    };

    const result = await formatLeftProposal(
      'Draft blog post about AI transformation.',
      classificationResult,
      { source: 'cli' }
    );

    expect(result).toMatch(/## Review/);
    expect(result).toMatch(/Accept/i);
    expect(result).toMatch(/Edit/i);
    expect(result).toMatch(/Reject/i);
    expect(result).toMatch(/Re-route/i);
  });
});

describe('generateFilename', () => {
  let generateFilename;
  let mockHaikuClient;

  beforeEach(() => {
    jest.resetModules();
    mockHaikuClient = {
      classify: jest.fn().mockResolvedValue({
        success: true,
        data: { filename: 'ai-market-trends-2025-analysis' },
      }),
    };
    jest.mock('../src/pipeline-infra', () => ({
      generateCorrelationId: jest.fn(() => 'test-corr-id'),
      createHaikuClient: jest.fn(() => mockHaikuClient),
      loadPipelineConfig: jest.fn(() => ({
        classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
        filename: { maxLength: 60, haikuWordRange: [4, 8] },
      })),
      safeLoadPipelineConfig: jest.fn(() => ({
        config: {
          classifier: { stage1ConfidenceThreshold: 0.8, sonnetEscalationThreshold: 0.8, sonnetAcceptThreshold: 0.7, shortInputChars: 50 },
          filename: { maxLength: 60, haikuWordRange: [4, 8] },
        },
        error: null,
      })),
      loadTemplatesConfig: jest.fn(() => ({
        'domain-templates': {},
        'memory-categories': {},
      })),
    }));
    ({ generateFilename } = require('../src/note-formatter'));
  });

  test('uses input as filename for short title-like input (< 60 chars)', async () => {
    const result = await generateFilename('Senior PM at Acme Corp', {});
    // Should be derived from the input title, not Haiku
    expect(mockHaikuClient.classify).not.toHaveBeenCalled();
    expect(result.filename).toMatch(/senior-pm-at-acme-corp/i);
    expect(result.filenameBasis).toBe('first-line');
  });

  test('calls Haiku for 4-8 word name for long input', async () => {
    const longInput = 'This is a very long piece of content that spans multiple sentences. It goes on and on with lots of detail about various topics including AI transformation and enterprise operations.';

    const result = await generateFilename(longInput, {});

    expect(mockHaikuClient.classify).toHaveBeenCalled();
    expect(result.filenameBasis).toBe('haiku-generated');
  });

  test('uses user-provided name when --name flag is set', async () => {
    const result = await generateFilename('Some content here.', { name: 'my custom filename' });

    expect(result.filename).toContain('my-custom-filename');
    expect(result.filenameBasis).toBe('user-provided');
    // Haiku should NOT be called
    expect(mockHaikuClient.classify).not.toHaveBeenCalled();
  });

  test('handles filename collision by appending -2, -3', async () => {
    const fs = require('fs');
    // Mock fs.existsSync to simulate a collision on first name, then allow
    const existsSpy = jest.spyOn(fs, 'existsSync')
      .mockReturnValueOnce(true)  // first attempt exists
      .mockReturnValueOnce(false); // second attempt is free

    const result = await generateFilename('Short title', { targetDir: '/tmp/vault/ideas' });

    // Should have tried and incremented
    expect(result.filename).toMatch(/-2\.md$/);

    existsSpy.mockRestore();
  });
});

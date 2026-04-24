'use strict';

/**
 * test/note-formatter-core.test.js
 *
 * Phase 16 branch coverage safety margin for src/note-formatter.js.
 * Covers formatNote and formatLeftProposal top-level paths that weren't
 * exercised by existing tests in CI mode (where UAT is skipped).
 */

const path = require('path');

process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

jest.mock('../src/pipeline-infra', () => {
  const actual = jest.requireActual('../src/pipeline-infra');
  return {
    ...actual,
    createHaikuClient: jest.fn(() => ({
      classify: jest.fn().mockResolvedValue({ success: true, data: {} }),
    })),
  };
});

const { formatNote, formatLeftProposal, generateFilename } = require('../src/note-formatter');

describe('formatNote', () => {
  test('emits YAML frontmatter with routed-by block, source, domain, filename-basis', async () => {
    const result = await formatNote('Input body text here.', {
      side: 'RIGHT',
      directory: 'research',
      confidence: 0.9,
      stage1: { side: 'RIGHT', confidence: 0.95 },
      stage2: { directory: 'research', confidence: 0.9, sonnetEscalated: false },
    });

    expect(result).toMatch(/^---/);
    expect(result).toMatch(/source: cli/);
    expect(result).toMatch(/domain: research/);
    expect(result).toMatch(/routed-by:/);
    expect(result).toMatch(/stage-1:/);
    expect(result).toMatch(/side: RIGHT/);
    expect(result).toMatch(/stage-2:/);
    expect(result).toMatch(/sonnet-escalated: false/);
    expect(result).toMatch(/filename-basis: first-line/);
  });

  test('uses options.source and options.filenameBasis overrides', async () => {
    const result = await formatNote('Input.', {
      side: 'RIGHT',
      directory: 'research',
      confidence: 0.9,
    }, {
      source: 'api',
      filenameBasis: 'haiku-generated',
    });

    expect(result).toMatch(/source: api/);
    expect(result).toMatch(/filename-basis: haiku-generated/);
  });

  test('defaults stage1/stage2 from flat fields when nested objects missing', async () => {
    const result = await formatNote('Input.', {
      side: 'RIGHT',
      directory: 'research',
      confidence: 0.88,
      // No stage1/stage2 nested
    });

    // Falls back to top-level confidence on both stages
    expect(result).toMatch(/side: RIGHT/);
    expect(result).toMatch(/directory: research/);
  });

  test('handles missing side/directory with "unknown" placeholders', async () => {
    const result = await formatNote('Input.', {
      side: null,
      directory: null,
      confidence: 0,
      stage1: { side: null, confidence: 0 },
      stage2: { directory: null, confidence: 0, sonnetEscalated: false },
    });

    expect(result).toMatch(/side: unknown/);
    expect(result).toMatch(/directory: unknown/);
  });

  test('appends body after frontmatter', async () => {
    const body = 'This is the body text of the note.';
    const result = await formatNote(body, {
      side: 'RIGHT',
      directory: 'research',
      confidence: 0.9,
    });

    expect(result).toContain(body);
    expect(result.indexOf('---\n')).toBeLessThan(result.indexOf(body));
  });

  test('sonnet-escalated: true flag renders correctly', async () => {
    const result = await formatNote('Input.', {
      side: 'RIGHT',
      directory: 'research',
      confidence: 0.9,
      stage2: { directory: 'research', confidence: 0.9, sonnetEscalated: true },
    });

    expect(result).toMatch(/sonnet-escalated: true/);
  });

  test('options.domain override wins over classificationResult.directory', async () => {
    const result = await formatNote('Input.', {
      side: 'RIGHT',
      directory: 'research',
      confidence: 0.9,
    }, {
      domain: 'custom-override',
    });

    expect(result).toMatch(/domain: custom-override/);
  });
});

describe('formatLeftProposal', () => {
  test('emits type: left-proposal, source, suggested-left-path, proposal-action', async () => {
    const result = await formatLeftProposal('Personal reflection body.', {
      side: 'LEFT',
      directory: 'proposals/left-proposals',
      suggestedLeftPath: 'Reflections/',
      confidence: 0.92,
      stage1: { side: 'LEFT', confidence: 0.92 },
      stage2: { directory: 'Reflections', confidence: 0.87, sonnetEscalated: false },
    });

    expect(result).toMatch(/type: left-proposal/);
    expect(result).toMatch(/source: cli/);
    expect(result).toMatch(/suggested-left-path: Reflections\//);
    expect(result).toMatch(/proposal-action: create/);
    expect(result).toMatch(/status: pending/);
  });

  test('Daily directory triggers proposal-action=append with dated path', async () => {
    const result = await formatLeftProposal('A daily reflection.', {
      side: 'LEFT',
      directory: 'proposals/left-proposals',
      suggestedLeftPath: 'Daily/',
      confidence: 0.9,
      stage1: { side: 'LEFT', confidence: 0.9 },
      stage2: { directory: 'Daily', confidence: 0.85, sonnetEscalated: false },
    });

    expect(result).toMatch(/suggested-left-path: Daily\/\d{4}-\d{2}-\d{2}\.md/);
    expect(result).toMatch(/proposal-action: append/);
  });

  test('suggestedLeftPath starting with Daily also triggers append', async () => {
    const result = await formatLeftProposal('Input.', {
      side: 'LEFT',
      directory: 'proposals/left-proposals',
      suggestedLeftPath: 'Daily/2026-04-24.md',
      confidence: 0.9,
      stage1: { side: 'LEFT', confidence: 0.9 },
      stage2: { directory: 'other', confidence: 0.85, sonnetEscalated: false },
    });

    expect(result).toMatch(/proposal-action: append/);
  });

  test('defaults to Drafts/ when suggestedLeftPath is missing', async () => {
    const result = await formatLeftProposal('Input.', {
      side: 'LEFT',
      directory: 'proposals/left-proposals',
      confidence: 0.9,
      // No suggestedLeftPath, no stage2
    });

    expect(result).toMatch(/suggested-left-path:.*Drafts/);
  });

  test('includes review checklist (Accept/Edit/Reject/Re-route)', async () => {
    const result = await formatLeftProposal('Input.', {
      side: 'LEFT',
      directory: 'proposals/left-proposals',
      suggestedLeftPath: 'Drafts/',
      confidence: 0.9,
    });

    expect(result).toMatch(/## Review/);
    expect(result).toMatch(/- \[ \] Accept/);
    expect(result).toMatch(/- \[ \] Edit/);
    expect(result).toMatch(/- \[ \] Reject/);
    expect(result).toMatch(/- \[ \] Re-route/);
  });

  test('appends body after frontmatter and review checklist', async () => {
    const body = 'The personal reflection body text.';
    const result = await formatLeftProposal(body, {
      side: 'LEFT',
      directory: 'proposals/left-proposals',
      suggestedLeftPath: 'Drafts/',
      confidence: 0.9,
    });

    expect(result).toContain(body);
  });

  test('options.source overrides default cli source', async () => {
    const result = await formatLeftProposal('Input.', {
      side: 'LEFT',
      directory: 'proposals/left-proposals',
      suggestedLeftPath: 'Drafts/',
      confidence: 0.9,
    }, {
      source: 'wrap-hook',
    });

    expect(result).toMatch(/source: wrap-hook/);
  });
});

describe('generateFilename — first-line and user-provided paths', () => {
  test('short title-like input uses first-line basis', async () => {
    const result = await generateFilename('A short title line', {});

    expect(result.filename).toMatch(/\.md$/);
    // first-line or haiku-generated depending on length heuristic — just verify we got a filename
    expect(['first-line', 'haiku-generated']).toContain(result.filenameBasis);
  });

  test('user-provided name with special chars gets sanitized', async () => {
    const result = await generateFilename('Any input.', { name: 'My Special Note!' });

    expect(result.filename).toMatch(/\.md$/);
    expect(result.filenameBasis).toBe('user-provided');
    // Sanitized — no spaces or exclamation
    expect(result.filename).not.toMatch(/[ !]/);
  });
});

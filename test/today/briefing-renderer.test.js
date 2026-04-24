'use strict';

/**
 * test/today/briefing-renderer.test.js
 *
 * Unit tests for src/today/briefing-renderer.js extracted in Phase 15.
 * Covers: frontmatter shape, section assembly, degraded-section format,
 * source-health map, date formatters, each section's empty/populated/degraded states.
 */

jest.mock('../../src/briefing-helpers', () => ({
  formatBriefingSection: jest.fn((kind, data) => {
    if (kind === 'proposals') return data.count ? `Proposals pending: ${data.count}` : '';
    if (kind === 'deadletter') return data.total ? `Dead-letter: ${data.total}` : '';
    return '';
  }),
}));

const {
  renderBriefing,
  buildSourceHealth,
  renderDegradedSection,
  formatDateYMD,
  formatDateHeading,
} = require('../../src/today/briefing-renderer');

const FIXED_DATE = new Date('2026-04-23T09:00:00Z');

function baseData(overrides = {}) {
  return {
    date: FIXED_DATE,
    sourceHealth: {
      sources: { calendar: 'ok', gmail: 'ok', github: 'ok', pipeline: 'ok' },
      degradedCount: 0,
    },
    connectorResults: {
      calendar: { success: true, data: [] },
      gmail: { success: true, data: [] },
      github: { success: true, data: { repos: [] } },
    },
    pipelineState: {
      ok: true,
      proposalCount: 0,
      deadLetter: { pending: 0, frozen: 0, total: 0 },
    },
    slippage: { projects: [], warnings: [] },
    frog: { frog: null, reasoning: 'none' },
    mode: 'interactive',
    synthesis: '> Synthesis placeholder',
    ...overrides,
  };
}

describe('formatDateYMD', () => {
  test('formats date as YYYY-MM-DD with zero-padding', () => {
    expect(formatDateYMD(new Date('2026-01-05T00:00:00'))).toBe('2026-01-05');
    expect(formatDateYMD(new Date('2026-12-31T23:00:00'))).toBe('2026-12-31');
  });
});

describe('formatDateHeading', () => {
  test('formats date as "DayOfWeek, Mon DD"', () => {
    const thursday = new Date('2026-04-23T12:00:00');
    expect(formatDateHeading(thursday)).toMatch(/Thursday, Apr 23/);
  });
});

describe('buildSourceHealth', () => {
  test('marks all sources ok when all succeeded', () => {
    const result = buildSourceHealth(
      {
        calendar: { success: true },
        gmail: { success: true },
        github: { success: true },
      },
      true
    );
    expect(result.sources).toEqual({
      calendar: 'ok', gmail: 'ok', github: 'ok', pipeline: 'ok',
    });
    expect(result.degradedCount).toBe(0);
  });

  test('marks degraded and counts correctly when some fail', () => {
    const result = buildSourceHealth(
      {
        calendar: { success: false },
        gmail: { success: true },
        github: { success: false },
      },
      false
    );
    expect(result.sources).toEqual({
      calendar: 'degraded', gmail: 'ok', github: 'degraded', pipeline: 'degraded',
    });
    expect(result.degradedCount).toBe(3);
  });
});

describe('renderDegradedSection', () => {
  test('uses error verbatim when it already has ERROR_CODE: prefix', () => {
    const out = renderDegradedSection('calendar', 'AUTH_ERROR: token expired');
    expect(out).toBe('\u26a0\ufe0f [calendar] AUTH_ERROR: token expired');
  });

  test('prefixes with MCP_ERROR when error has no recognizable code', () => {
    const out = renderDegradedSection('gmail', 'something broke');
    expect(out).toBe('\u26a0\ufe0f [gmail] MCP_ERROR: something broke');
  });

  test('falls back to unknown error when error is undefined', () => {
    const out = renderDegradedSection('github', undefined);
    expect(out).toBe('\u26a0\ufe0f [github] MCP_ERROR: unknown error');
  });
});

describe('renderBriefing', () => {
  test('emits YAML frontmatter with sources map and degraded count', () => {
    const doc = renderBriefing(baseData());

    expect(doc).toMatch(/^---\n/);
    expect(doc).toMatch(/date: 2026-04-23/);
    expect(doc).toMatch(/sources:\n {2}calendar: ok\n {2}gmail: ok\n {2}github: ok\n {2}pipeline: ok/);
    expect(doc).toMatch(/degraded: 0/);
    expect(doc).toMatch(/mode: interactive/);
  });

  test('emits heading and synthesis blockquote', () => {
    const doc = renderBriefing(baseData({ synthesis: '> Test synthesis here.' }));

    expect(doc).toMatch(/# Daily Briefing —/);
    expect(doc).toMatch(/> Test synthesis here\./);
  });

  test('emits all 6 sections in decay-rate order (D-03)', () => {
    const doc = renderBriefing(baseData());

    const sectionOrder = ['## Meetings', '## VIP Emails', '## Slippage', '## Frog', '## GitHub', '## Pipeline'];
    let lastIdx = -1;
    for (const heading of sectionOrder) {
      const idx = doc.indexOf(heading);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  test('renders empty-state copy when no data per section', () => {
    const doc = renderBriefing(baseData());

    expect(doc).toMatch(/_No meetings scheduled today\._/);
    expect(doc).toMatch(/_No VIP emails in the last window\._/);
    expect(doc).toMatch(/_No stalled projects\._/);
    expect(doc).toMatch(/_No frog identified today\._/);
    expect(doc).toMatch(/_No GitHub activity in the last window\._/);
    expect(doc).toMatch(/_Pipeline clear\._/);
  });

  test('renders populated meetings with time, title, attendees', () => {
    const doc = renderBriefing(baseData({
      connectorResults: {
        calendar: {
          success: true,
          data: [{
            start: { dateTime: '2026-04-23T09:00:00' },
            summary: 'Standup',
            attendees: [{ email: 'alice@example.com' }, { self: true }],
          }],
        },
        gmail: { success: true, data: [] },
        github: { success: true, data: { repos: [] } },
      },
    }));

    expect(doc).toMatch(/\*\*Standup\*\*/);
    expect(doc).toMatch(/alice@example\.com/);
  });

  test('renders all-day meetings with "All day" label', () => {
    const doc = renderBriefing(baseData({
      connectorResults: {
        calendar: {
          success: true,
          data: [{ start: { date: '2026-04-23' }, summary: 'Conference' }],
        },
        gmail: { success: true, data: [] },
        github: { success: true, data: { repos: [] } },
      },
    }));

    expect(doc).toMatch(/All day.*\*\*Conference\*\*/);
  });

  test('renders degraded section when calendar fails', () => {
    const doc = renderBriefing(baseData({
      sourceHealth: {
        sources: { calendar: 'degraded', gmail: 'ok', github: 'ok', pipeline: 'ok' },
        degradedCount: 1,
      },
      connectorResults: {
        calendar: { success: false, error: 'MCP_ERROR: timeout' },
        gmail: { success: true, data: [] },
        github: { success: true, data: { repos: [] } },
      },
    }));

    expect(doc).toMatch(/\u26a0\ufe0f \[calendar\] MCP_ERROR: timeout/);
  });

  test('renders stalled projects as wikilinks with progress and days stalled', () => {
    const doc = renderBriefing(baseData({
      slippage: {
        projects: [
          { name: 'alpha', phase: 'Phase 2/5', percent: 40, daysSinceActivity: 10, stalled: true },
          { name: 'gamma', phase: 'Phase 1/3', percent: null, daysSinceActivity: null, stalled: false },
        ],
        warnings: [],
      },
    }));

    expect(doc).toMatch(/\[\[alpha\]\] — Phase 2\/5, 40% complete, 10d stalled/);
    expect(doc).not.toMatch(/\[\[gamma\]\]/);
  });

  test('appends scanner warnings when present', () => {
    const doc = renderBriefing(baseData({
      slippage: {
        projects: [],
        warnings: ['PARSE_SKIP: bad-project/.planning/STATE.md'],
      },
    }));

    expect(doc).toMatch(/Scanner warnings: PARSE_SKIP/);
  });

  test('renders frog section with name and reasoning', () => {
    const doc = renderBriefing(baseData({
      frog: { frog: 'alpha: finish Phase 2', reasoning: 'Longest stalled.' },
    }));

    expect(doc).toMatch(/\*\*alpha: finish Phase 2\*\*/);
    expect(doc).toMatch(/Longest stalled\./);
  });

  test('renders GitHub repos with commit/PR/issue counts', () => {
    const doc = renderBriefing(baseData({
      connectorResults: {
        calendar: { success: true, data: [] },
        gmail: { success: true, data: [] },
        github: {
          success: true,
          data: {
            repos: [{
              name: 'sb',
              commits: [{ sha: 'a' }, { sha: 'b' }],
              pullRequests: [{ number: 1 }],
              issues: [],
            }],
            warnings: [],
          },
        },
      },
    }));

    expect(doc).toMatch(/\*\*sb\*\*: 2 commit\(s\), 1 PR\(s\)/);
  });

  test('appends GitHub partial-data warnings when present', () => {
    const doc = renderBriefing(baseData({
      connectorResults: {
        calendar: { success: true, data: [] },
        gmail: { success: true, data: [] },
        github: {
          success: true,
          data: {
            repos: [{ name: 'sb', commits: [], pullRequests: [], issues: [] }],
            warnings: ['Some repo inaccessible'],
          },
        },
      },
    }));

    expect(doc).toMatch(/Partial data: Some repo inaccessible/);
  });

  test('renders pipeline section with proposals + deadletter when ok and has data', () => {
    const doc = renderBriefing(baseData({
      pipelineState: {
        ok: true,
        proposalCount: 5,
        deadLetter: { pending: 2, frozen: 1, total: 3 },
      },
    }));

    expect(doc).toMatch(/Proposals pending: 5/);
    expect(doc).toMatch(/Dead-letter: 3/);
  });
});

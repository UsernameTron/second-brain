'use strict';

/**
 * test/today/briefing-renderer.test.js
 *
 * Unit tests for src/today/briefing-renderer.js extracted in Phase 15.
 * Covers: frontmatter shape, section assembly, degraded-section format,
 * source-health map, date formatters, each section's empty/populated/degraded states.
 *
 * Phase 20 additions: yesterday summary line prepend (TODAY-SUMMARY-01, D-05/D-06).
 */

// Top-level mocks for lazy-required modules used inside renderBriefing's summary-line block.
// These are hoisted so they apply to every require of these modules in the renderer.
jest.mock('../../src/pipeline-infra', () => ({
  loadConfigWithOverlay: jest.fn(() => ({
    stats: { enabled: true, summaryLineEnabled: true, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago' },
  })),
}));

jest.mock('../../src/daily-stats', () => ({
  readDailyStats: jest.fn(() => ({ frontmatter: null, rows: [] })),
  dateKey: jest.fn(() => '2026-04-25'),
}));

jest.mock('../../src/vault-gateway', () => ({
  VAULT_ROOT: '/fake/vault',
}));

jest.mock('../../src/briefing-helpers', () => ({
  formatBriefingSection: jest.fn((kind, data) => {
    if (kind === 'proposals') return data.count ? `Proposals pending: ${data.count}` : '';
    if (kind === 'deadletter') return data.total ? `Dead-letter: ${data.total}` : '';
    return '';
  }),
  buildYesterdaySummaryLine: jest.fn(() => ''),
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

// ── Phase 20: yesterday summary line (TODAY-SUMMARY-01) ──────────────────────
//
// These tests control mock return values via mockReturnValue / mockImplementation
// on the top-level jest.mock() stubs. The renderer lazily requires pipeline-infra,
// daily-stats, vault-gateway, and briefing-helpers inside its try/catch block;
// because those modules are already mocked at the file level, the mocked versions
// are returned by every require() call inside renderBriefing at test time.

// Grab references to the mocked modules so we can reconfigure per-test.
const mockPipelineInfra = require('../../src/pipeline-infra');
const mockDailyStats = require('../../src/daily-stats');
const mockBriefingHelpers = require('../../src/briefing-helpers');

describe('Phase 20: yesterday summary line', () => {
  const TODAY = new Date('2026-04-25T14:00:00Z');
  const TODAY_KEY = '2026-04-25';
  const YESTERDAY_KEY = '2026-04-24';
  const DAY_BEFORE_KEY = '2026-04-23';

  const PRIOR_ROW = {
    date: YESTERDAY_KEY,
    proposals: '3', promotions: '2', total_entries: '47',
    memory_kb: '14.6', recall_count: '5',
  };
  const DAY_BEFORE_ROW = {
    date: DAY_BEFORE_KEY,
    proposals: '1', promotions: '0', total_entries: '45',
    memory_kb: '13.2', recall_count: '2',
  };

  function baseDataPhase20(overrides = {}) {
    return {
      date: TODAY,
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
        ok: true, proposalCount: 0,
        deadLetter: { pending: 0, frozen: 0, total: 0 },
      },
      slippage: { projects: [], warnings: [] },
      frog: { frog: null, reasoning: 'none' },
      mode: 'interactive',
      synthesis: '> Synthesis.',
      ...overrides,
    };
  }

  // Default happy-path config returned by loadConfigWithOverlay in all tests unless overridden.
  const happyConfig = {
    stats: { enabled: true, summaryLineEnabled: true, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: summaryLineEnabled true, stats path set.
    mockPipelineInfra.loadConfigWithOverlay.mockReturnValue(happyConfig);
    // Default: empty rows (no prior row) — suppresses summary line unless overridden.
    mockDailyStats.readDailyStats.mockReturnValue({ frontmatter: null, rows: [] });
    mockDailyStats.dateKey.mockReturnValue(TODAY_KEY);
    // Default: buildYesterdaySummaryLine returns '' — no prepend.
    mockBriefingHelpers.buildYesterdaySummaryLine.mockReturnValue('');
    // formatBriefingSection default (same as outer suite top-level impl).
    mockBriefingHelpers.formatBriefingSection.mockImplementation((kind, data) => {
      if (kind === 'proposals') return data.count ? `Proposals pending: ${data.count}` : '';
      if (kind === 'deadletter') return data.total ? `Dead-letter: ${data.total}` : '';
      return '';
    });
  });

  it('prepends summary line when daily-stats.md has a prior-day row and summaryLineEnabled is true', () => {
    mockDailyStats.readDailyStats.mockReturnValue({
      frontmatter: {}, rows: [DAY_BEFORE_ROW, PRIOR_ROW],
    });
    mockBriefingHelpers.buildYesterdaySummaryLine.mockReturnValue(
      'Yesterday: +3 proposals, +2 promotions, +1.4 KB memory, +2 entries, 5 recalls'
    );

    const doc = renderBriefing(baseDataPhase20());
    expect(doc).toMatch(/^Yesterday: /);
  });

  it('does NOT prepend when summaryLineEnabled is false', () => {
    mockPipelineInfra.loadConfigWithOverlay.mockReturnValue({
      stats: { enabled: true, summaryLineEnabled: false, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago' },
    });
    mockDailyStats.readDailyStats.mockReturnValue({
      frontmatter: {}, rows: [DAY_BEFORE_ROW, PRIOR_ROW],
    });
    // buildYesterdaySummaryLine should NOT be called, but even if it is, return ''.

    const doc = renderBriefing(baseDataPhase20());
    expect(doc).not.toMatch(/^Yesterday:/);
  });

  it('does NOT prepend when daily-stats.md is missing (readDailyStats returns empty rows)', () => {
    // Default mock already returns empty rows — no override needed.
    const doc = renderBriefing(baseDataPhase20());
    expect(doc).not.toMatch(/^Yesterday:/);
  });

  it('does NOT prepend when readDailyStats throws (corrupt file)', () => {
    mockDailyStats.readDailyStats.mockImplementation(() => {
      throw new Error('Corrupt frontmatter');
    });

    let doc;
    expect(() => { doc = renderBriefing(baseDataPhase20()); }).not.toThrow();
    expect(doc).not.toMatch(/^Yesterday:/);
  });

  it('does NOT prepend on day 1 (no row earlier than today)', () => {
    // Only row is today — filter for date < todayKey yields nothing.
    mockDailyStats.readDailyStats.mockReturnValue({
      frontmatter: {},
      rows: [{ date: TODAY_KEY, proposals: '1', promotions: '0', total_entries: '5', memory_kb: '3.0', recall_count: '0' }],
    });

    const doc = renderBriefing(baseDataPhase20());
    expect(doc).not.toMatch(/^Yesterday:/);
  });

  it('uses the latest row strictly before today as priorRow even with history gaps', () => {
    // Rows for [2026-04-20, 2026-04-22, 2026-04-23]; today = 2026-04-25.
    // Largest-date-less-than-today rule → priorRow = 2026-04-23, dayBefore = 2026-04-22.
    const gappedRows = [
      { date: '2026-04-20', proposals: '1', promotions: '0', total_entries: '10', memory_kb: '5.0', recall_count: '0' },
      { date: '2026-04-22', proposals: '2', promotions: '1', total_entries: '15', memory_kb: '6.0', recall_count: '1' },
      { date: '2026-04-23', proposals: '7', promotions: '4', total_entries: '20', memory_kb: '7.2', recall_count: '3' },
    ];
    mockDailyStats.readDailyStats.mockReturnValue({ frontmatter: {}, rows: gappedRows });

    let capturedPrior = null;
    let capturedDayBefore = null;
    mockBriefingHelpers.buildYesterdaySummaryLine.mockImplementation((pr, db) => {
      capturedPrior = pr;
      capturedDayBefore = db;
      return `Yesterday: +${pr.proposals} proposals, +${pr.promotions} promotions, +0.0 KB memory, +0 entries, ${pr.recall_count} recalls`;
    });

    const doc = renderBriefing(baseDataPhase20());

    expect(capturedPrior).toBeTruthy();
    expect(capturedPrior.date).toBe('2026-04-23');
    expect(capturedDayBefore).toBeTruthy();
    expect(capturedDayBefore.date).toBe('2026-04-22');
    expect(doc).toMatch(/^Yesterday: /);
  });

  it('briefing body content is unchanged when summary line is prepended', () => {
    const SUMMARY = 'Yesterday: +3 proposals, +2 promotions, +1.4 KB memory, +2 entries, 5 recalls';

    // Render WITH summary line.
    mockDailyStats.readDailyStats.mockReturnValue({
      frontmatter: {}, rows: [DAY_BEFORE_ROW, PRIOR_ROW],
    });
    mockBriefingHelpers.buildYesterdaySummaryLine.mockReturnValue(SUMMARY);
    const docWith = renderBriefing(baseDataPhase20());

    // Render WITHOUT summary line (suppress via empty rows).
    mockDailyStats.readDailyStats.mockReturnValue({ frontmatter: null, rows: [] });
    mockBriefingHelpers.buildYesterdaySummaryLine.mockReturnValue('');
    const docWithout = renderBriefing(baseDataPhase20());

    // Stripping "Yesterday: ...\n\n" from docWith must equal docWithout.
    const bodyFromWith = docWith.replace(/^Yesterday:.*?\n\n/, '');
    expect(bodyFromWith).toBe(docWithout);
  });
});

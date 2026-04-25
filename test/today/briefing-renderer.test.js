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
// These tests use jest.isolateModules() + jest.doMock() so each test can set up
// its own module mock registry independently. jest.doMock() is not hoisted, so it
// can reference test-local variables. The summary line is built inside a try/catch
// with lazy requires inside renderBriefing.

describe('Phase 20: yesterday summary line', () => {
  // Fixed dates for deterministic tests. Today = 2026-04-25; yesterday = 2026-04-24.
  const TODAY = new Date('2026-04-25T14:00:00Z');
  const TODAY_KEY = '2026-04-25';
  const YESTERDAY_KEY = '2026-04-24';
  const DAY_BEFORE_KEY = '2026-04-23';

  const PRIOR_ROW = {
    date: YESTERDAY_KEY,
    proposals: '3', promotions: '2', total_entries: '47',
    memory_kb: '14.6', recall_count: '5', avg_latency_ms: '1240', avg_confidence: '0.83',
  };
  const DAY_BEFORE_ROW = {
    date: DAY_BEFORE_KEY,
    proposals: '1', promotions: '0', total_entries: '45',
    memory_kb: '13.2', recall_count: '2', avg_latency_ms: '1100', avg_confidence: '0.80',
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
        ok: true,
        proposalCount: 0,
        deadLetter: { pending: 0, frozen: 0, total: 0 },
      },
      slippage: { projects: [], warnings: [] },
      frog: { frog: null, reasoning: 'none' },
      mode: 'interactive',
      synthesis: '> Synthesis.',
      ...overrides,
    };
  }

  afterEach(() => {
    jest.resetModules();
  });

  it('prepends summary line when daily-stats.md has a prior-day row and summaryLineEnabled is true', () => {
    let doc;
    jest.isolateModules(() => {
      const priorRow = { ...PRIOR_ROW };
      const dayBeforeRow = { ...DAY_BEFORE_ROW };
      jest.doMock('../../src/briefing-helpers', () => ({
        formatBriefingSection: jest.fn(() => ''),
        buildYesterdaySummaryLine: jest.fn(() => 'Yesterday: +3 proposals, +2 promotions, +1.4 KB memory, +2 entries, 5 recalls'),
      }));
      jest.doMock('../../src/pipeline-infra', () => ({
        loadConfigWithOverlay: jest.fn(() => ({
          stats: { enabled: true, summaryLineEnabled: true, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago' },
        })),
      }));
      const rowsRef = [dayBeforeRow, priorRow];
      jest.doMock('../../src/daily-stats', () => ({
        readDailyStats: jest.fn(() => ({ frontmatter: {}, rows: rowsRef })),
        dateKey: jest.fn(() => TODAY_KEY),
      }));
      jest.doMock('../../src/vault-gateway', () => ({ VAULT_ROOT: '/fake/vault' }));

      const { renderBriefing: render } = require('../../src/today/briefing-renderer');
      doc = render(baseDataPhase20());
    });
    expect(doc).toMatch(/^Yesterday: /);
  });

  it('does NOT prepend when summaryLineEnabled is false', () => {
    let doc;
    jest.isolateModules(() => {
      jest.doMock('../../src/briefing-helpers', () => ({
        formatBriefingSection: jest.fn(() => ''),
        buildYesterdaySummaryLine: jest.fn(() => ''),
      }));
      jest.doMock('../../src/pipeline-infra', () => ({
        loadConfigWithOverlay: jest.fn(() => ({
          stats: { enabled: true, summaryLineEnabled: false, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago' },
        })),
      }));
      jest.doMock('../../src/daily-stats', () => ({
        readDailyStats: jest.fn(() => ({ frontmatter: {}, rows: [{ date: YESTERDAY_KEY }] })),
        dateKey: jest.fn(() => TODAY_KEY),
      }));
      jest.doMock('../../src/vault-gateway', () => ({ VAULT_ROOT: '/fake/vault' }));

      const { renderBriefing: render } = require('../../src/today/briefing-renderer');
      doc = render(baseDataPhase20());
    });
    expect(doc).not.toMatch(/^Yesterday:/);
  });

  it('does NOT prepend when daily-stats.md is missing (readDailyStats returns empty rows)', () => {
    let doc;
    jest.isolateModules(() => {
      jest.doMock('../../src/briefing-helpers', () => ({
        formatBriefingSection: jest.fn(() => ''),
        buildYesterdaySummaryLine: jest.fn(() => ''),
      }));
      jest.doMock('../../src/pipeline-infra', () => ({
        loadConfigWithOverlay: jest.fn(() => ({
          stats: { enabled: true, summaryLineEnabled: true, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago' },
        })),
      }));
      jest.doMock('../../src/daily-stats', () => ({
        readDailyStats: jest.fn(() => ({ frontmatter: null, rows: [] })),
        dateKey: jest.fn(() => TODAY_KEY),
      }));
      jest.doMock('../../src/vault-gateway', () => ({ VAULT_ROOT: '/fake/vault' }));

      const { renderBriefing: render } = require('../../src/today/briefing-renderer');
      doc = render(baseDataPhase20());
    });
    expect(doc).not.toMatch(/^Yesterday:/);
  });

  it('does NOT prepend when readDailyStats throws (corrupt file)', () => {
    let doc;
    let threwError = false;
    jest.isolateModules(() => {
      jest.doMock('../../src/briefing-helpers', () => ({
        formatBriefingSection: jest.fn(() => ''),
        buildYesterdaySummaryLine: jest.fn(() => ''),
      }));
      jest.doMock('../../src/pipeline-infra', () => ({
        loadConfigWithOverlay: jest.fn(() => ({
          stats: { enabled: true, summaryLineEnabled: true, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago' },
        })),
      }));
      jest.doMock('../../src/daily-stats', () => ({
        readDailyStats: jest.fn(() => { throw new Error('Corrupt frontmatter'); }),
        dateKey: jest.fn(() => TODAY_KEY),
      }));
      jest.doMock('../../src/vault-gateway', () => ({ VAULT_ROOT: '/fake/vault' }));

      const { renderBriefing: render } = require('../../src/today/briefing-renderer');
      try {
        doc = render(baseDataPhase20());
      } catch (_) {
        threwError = true;
      }
    });
    expect(threwError).toBe(false);
    expect(doc).not.toMatch(/^Yesterday:/);
  });

  it('does NOT prepend on day 1 (no row earlier than today)', () => {
    let doc;
    jest.isolateModules(() => {
      jest.doMock('../../src/briefing-helpers', () => ({
        formatBriefingSection: jest.fn(() => ''),
        buildYesterdaySummaryLine: jest.fn(() => ''),
      }));
      jest.doMock('../../src/pipeline-infra', () => ({
        loadConfigWithOverlay: jest.fn(() => ({
          stats: { enabled: true, summaryLineEnabled: true, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago' },
        })),
      }));
      // Only row is today — no row strictly before today
      jest.doMock('../../src/daily-stats', () => ({
        readDailyStats: jest.fn(() => ({
          frontmatter: {},
          rows: [{ date: TODAY_KEY, proposals: '1', promotions: '0', total_entries: '5', memory_kb: '3.0', recall_count: '0' }],
        })),
        dateKey: jest.fn(() => TODAY_KEY),
      }));
      jest.doMock('../../src/vault-gateway', () => ({ VAULT_ROOT: '/fake/vault' }));

      const { renderBriefing: render } = require('../../src/today/briefing-renderer');
      doc = render(baseDataPhase20());
    });
    expect(doc).not.toMatch(/^Yesterday:/);
  });

  it('uses the latest row strictly before today as priorRow even with history gaps', () => {
    // Rows for [2026-04-20, 2026-04-22, 2026-04-23]; today = 2026-04-25
    // priorRow should be 2026-04-23 (largest date < today)
    let capturedPriorRow = null;
    let capturedDayBefore = null;
    let doc;

    jest.isolateModules(() => {
      jest.doMock('../../src/briefing-helpers', () => ({
        formatBriefingSection: jest.fn(() => ''),
        buildYesterdaySummaryLine: jest.fn((pr, db) => {
          capturedPriorRow = pr;
          capturedDayBefore = db;
          return `Yesterday: +${pr.proposals} proposals, +${pr.promotions} promotions, +0.0 KB memory, +0 entries, ${pr.recall_count} recalls`;
        }),
      }));
      jest.doMock('../../src/pipeline-infra', () => ({
        loadConfigWithOverlay: jest.fn(() => ({
          stats: { enabled: true, summaryLineEnabled: true, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago' },
        })),
      }));
      jest.doMock('../../src/daily-stats', () => ({
        readDailyStats: jest.fn(() => ({
          frontmatter: {},
          rows: [
            { date: '2026-04-20', proposals: '1', promotions: '0', total_entries: '10', memory_kb: '5.0', recall_count: '0' },
            { date: '2026-04-22', proposals: '2', promotions: '1', total_entries: '15', memory_kb: '6.0', recall_count: '1' },
            { date: '2026-04-23', proposals: '7', promotions: '4', total_entries: '20', memory_kb: '7.2', recall_count: '3' },
          ],
        })),
        dateKey: jest.fn(() => TODAY_KEY),
      }));
      jest.doMock('../../src/vault-gateway', () => ({ VAULT_ROOT: '/fake/vault' }));

      const { renderBriefing: render } = require('../../src/today/briefing-renderer');
      doc = render(baseDataPhase20());
    });

    // priorRow must be 2026-04-23 (largest strictly before 2026-04-25)
    expect(capturedPriorRow).toBeTruthy();
    expect(capturedPriorRow.date).toBe('2026-04-23');
    // dayBeforePrior must be 2026-04-22
    expect(capturedDayBefore).toBeTruthy();
    expect(capturedDayBefore.date).toBe('2026-04-22');
    // briefing starts with Yesterday:
    expect(doc).toMatch(/^Yesterday: /);
  });

  it('briefing body content is unchanged when summary line is prepended', () => {
    let docWith;
    let docWithout;

    jest.isolateModules(() => {
      jest.doMock('../../src/briefing-helpers', () => ({
        formatBriefingSection: jest.fn(() => ''),
        buildYesterdaySummaryLine: jest.fn(() => 'Yesterday: +3 proposals, +2 promotions, +1.4 KB memory, +2 entries, 5 recalls'),
      }));
      jest.doMock('../../src/pipeline-infra', () => ({
        loadConfigWithOverlay: jest.fn(() => ({
          stats: { enabled: true, summaryLineEnabled: true, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago' },
        })),
      }));
      jest.doMock('../../src/daily-stats', () => ({
        readDailyStats: jest.fn(() => ({ frontmatter: {}, rows: [
          { date: DAY_BEFORE_KEY, proposals: '1', promotions: '0', total_entries: '45', memory_kb: '13.2', recall_count: '2' },
          { date: YESTERDAY_KEY, proposals: '3', promotions: '2', total_entries: '47', memory_kb: '14.6', recall_count: '5' },
        ] })),
        dateKey: jest.fn(() => TODAY_KEY),
      }));
      jest.doMock('../../src/vault-gateway', () => ({ VAULT_ROOT: '/fake/vault' }));

      const { renderBriefing: renderWith } = require('../../src/today/briefing-renderer');
      docWith = renderWith(baseDataPhase20());
    });

    jest.isolateModules(() => {
      jest.doMock('../../src/briefing-helpers', () => ({
        formatBriefingSection: jest.fn(() => ''),
        buildYesterdaySummaryLine: jest.fn(() => ''),
      }));
      jest.doMock('../../src/pipeline-infra', () => ({
        loadConfigWithOverlay: jest.fn(() => ({
          stats: { enabled: true, summaryLineEnabled: false, path: 'RIGHT/daily-stats.md', timezone: 'America/Chicago' },
        })),
      }));
      jest.doMock('../../src/daily-stats', () => ({
        readDailyStats: jest.fn(() => ({ frontmatter: null, rows: [] })),
        dateKey: jest.fn(() => TODAY_KEY),
      }));
      jest.doMock('../../src/vault-gateway', () => ({ VAULT_ROOT: '/fake/vault' }));

      const { renderBriefing: renderWithout } = require('../../src/today/briefing-renderer');
      docWithout = renderWithout(baseDataPhase20());
    });

    // Strip "Yesterday: ...\n\n" prefix from docWith and compare with docWithout
    const bodyFromWith = docWith.replace(/^Yesterday:.*?\n\n/, '');
    expect(bodyFromWith).toBe(docWithout);
  });
});

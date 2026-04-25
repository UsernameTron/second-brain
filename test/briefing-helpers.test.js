'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-test-'));
  const proposalsDir = path.join(tmpDir, 'proposals');
  const unroutedDir = path.join(proposalsDir, 'unrouted');
  fs.mkdirSync(unroutedDir, { recursive: true });

  process.env.VAULT_ROOT = tmpDir;
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');
  jest.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
  delete process.env.CONFIG_DIR_OVERRIDE;
  jest.restoreAllMocks();
});

describe('getProposalsPendingCount', () => {
  test('returns 0 when memory-proposals.md does not exist', async () => {
    const { getProposalsPendingCount } = require('../src/briefing-helpers');
    const count = await getProposalsPendingCount();
    expect(count).toBe(0);
  });

  test('returns 0 when no pending candidates exist', async () => {
    const proposalsFile = path.join(tmpDir, 'proposals', 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, [
      '---',
      'updated: 2026-04-22',
      '---',
      '',
      '### mem-20260422-001 | accepted | Decision pattern',
      'status:: accepted',
      'category:: decision',
      '',
    ].join('\n'));

    const { getProposalsPendingCount } = require('../src/briefing-helpers');
    const count = await getProposalsPendingCount();
    expect(count).toBe(0);
  });

  test('returns count of pending candidates', async () => {
    const proposalsFile = path.join(tmpDir, 'proposals', 'memory-proposals.md');
    fs.writeFileSync(proposalsFile, [
      '---',
      'updated: 2026-04-22',
      '---',
      '',
      '### mem-20260422-001 | pending | Decision pattern',
      'status:: pending',
      'category:: decision',
      'content_hash:: abc123',
      '',
      '### mem-20260422-002 | pending | Another insight',
      'status:: pending',
      'category:: insight',
      'content_hash:: def456',
      '',
      '### mem-20260422-003 | accepted | Already accepted',
      'status:: accepted',
      'category:: rule',
      'content_hash:: ghi789',
      '',
    ].join('\n'));

    const { getProposalsPendingCount } = require('../src/briefing-helpers');
    const count = await getProposalsPendingCount();
    expect(count).toBe(2);
  });
});

describe('getDeadLetterSummary', () => {
  test('returns zeros when proposals/unrouted/ is empty', async () => {
    const { getDeadLetterSummary } = require('../src/briefing-helpers');
    const summary = await getDeadLetterSummary();
    expect(summary).toEqual({ pending: 0, frozen: 0, total: 0, warning: false });
  });

  test('counts pending (unrouted) and frozen files', async () => {
    const unroutedDir = path.join(tmpDir, 'proposals', 'unrouted');
    fs.writeFileSync(path.join(unroutedDir, 'dl-1.md'), '---\nstatus: unrouted\n---\nBody 1');
    fs.writeFileSync(path.join(unroutedDir, 'dl-2.md'), '---\nstatus: frozen\n---\nBody 2');
    fs.writeFileSync(path.join(unroutedDir, 'dl-3.md'), '---\nstatus: unrouted\n---\nBody 3');

    const { getDeadLetterSummary } = require('../src/briefing-helpers');
    const summary = await getDeadLetterSummary();
    expect(summary.pending).toBe(2);
    expect(summary.frozen).toBe(1);
    expect(summary.total).toBe(3);
    expect(summary.warning).toBe(false);
  });

  test('sets warning when total > 10 (D-38)', async () => {
    const unroutedDir = path.join(tmpDir, 'proposals', 'unrouted');
    for (let i = 0; i < 11; i++) {
      fs.writeFileSync(path.join(unroutedDir, `dl-${i}.md`), '---\nstatus: unrouted\n---\nBody');
    }

    const { getDeadLetterSummary } = require('../src/briefing-helpers');
    const summary = await getDeadLetterSummary();
    expect(summary.total).toBe(11);
    expect(summary.warning).toBe(true);
  });

  test('returns zeros when proposals/unrouted/ does not exist', async () => {
    fs.rmSync(path.join(tmpDir, 'proposals', 'unrouted'), { recursive: true });

    const { getDeadLetterSummary } = require('../src/briefing-helpers');
    const summary = await getDeadLetterSummary();
    expect(summary).toEqual({ pending: 0, frozen: 0, total: 0, warning: false });
  });
});

describe('formatBriefingSection', () => {
  test('proposals: returns empty string when count is 0', () => {
    const { formatBriefingSection } = require('../src/briefing-helpers');
    expect(formatBriefingSection('proposals', { count: 0 })).toBe('');
  });

  test('proposals: returns formatted string when count > 0', () => {
    const { formatBriefingSection } = require('../src/briefing-helpers');
    const result = formatBriefingSection('proposals', { count: 5 });
    expect(result).toBe('Memory proposals pending: 5 awaiting review');
  });

  test('deadletter: returns empty string when total is 0', () => {
    const { formatBriefingSection } = require('../src/briefing-helpers');
    expect(formatBriefingSection('deadletter', { pending: 0, frozen: 0, total: 0 })).toBe('');
  });

  test('deadletter: returns formatted string with counts', () => {
    const { formatBriefingSection } = require('../src/briefing-helpers');
    const result = formatBriefingSection('deadletter', { pending: 3, frozen: 1, total: 4, warning: false });
    expect(result).toContain('3 pending');
    expect(result).toContain('1 frozen');
  });

  test('deadletter: includes WARNING prefix when warning is true', () => {
    const { formatBriefingSection } = require('../src/briefing-helpers');
    const result = formatBriefingSection('deadletter', { pending: 12, frozen: 0, total: 12, warning: true });
    expect(result).toContain('WARNING');
    expect(result).toContain('12 unrouted captures need attention');
  });
});

describe('buildYesterdaySummaryLine', () => {
  it('returns empty string when priorRow is null', () => {
    const { buildYesterdaySummaryLine } = require('../src/briefing-helpers');
    expect(buildYesterdaySummaryLine(null)).toBe('');
  });

  it('returns empty string when priorRow is undefined', () => {
    const { buildYesterdaySummaryLine } = require('../src/briefing-helpers');
    expect(buildYesterdaySummaryLine(undefined)).toBe('');
  });

  it('formats the 5-delta line verbatim when both rows present (positive case)', () => {
    const { buildYesterdaySummaryLine } = require('../src/briefing-helpers');
    const prior = { proposals: 3, promotions: 2, total_entries: 47, memory_kb: 14.6, recall_count: 5 };
    const dayBefore = { proposals: 1, promotions: 0, total_entries: 45, memory_kb: 13.2, recall_count: 2 };
    expect(buildYesterdaySummaryLine(prior, dayBefore)).toBe(
      'Yesterday: +3 proposals, +2 promotions, +1.4 KB memory, +2 entries, 5 recalls'
    );
  });

  it('renders +0 for zero-activity day (zero is signal, not shame, per D-06)', () => {
    const { buildYesterdaySummaryLine } = require('../src/briefing-helpers');
    const prior = { proposals: 0, promotions: 0, total_entries: 47, memory_kb: 14.6, recall_count: 0 };
    const dayBefore = { proposals: 0, promotions: 0, total_entries: 47, memory_kb: 14.6, recall_count: 0 };
    expect(buildYesterdaySummaryLine(prior, dayBefore)).toBe(
      'Yesterday: +0 proposals, +0 promotions, +0.0 KB memory, +0 entries, 0 recalls'
    );
  });

  it('renders negative entry delta when memory was pruned', () => {
    const { buildYesterdaySummaryLine } = require('../src/briefing-helpers');
    const prior = { proposals: 0, promotions: 0, total_entries: 45, memory_kb: 13.0, recall_count: 0 };
    const dayBefore = { proposals: 0, promotions: 0, total_entries: 47, memory_kb: 14.6, recall_count: 0 };
    expect(buildYesterdaySummaryLine(prior, dayBefore)).toBe(
      'Yesterday: +0 proposals, +0 promotions, -1.6 KB memory, -2 entries, 0 recalls'
    );
  });

  it('falls back to priorRow values (signed +) when dayBeforePrior is null — day 2 case', () => {
    const { buildYesterdaySummaryLine } = require('../src/briefing-helpers');
    const prior = { proposals: 5, promotions: 3, total_entries: 10, memory_kb: 4.2, recall_count: 1 };
    expect(buildYesterdaySummaryLine(prior, null)).toBe(
      'Yesterday: +5 proposals, +3 promotions, +4.2 KB memory, +10 entries, 1 recalls'
    );
  });

  it('rounds memory_kb to 1 decimal place', () => {
    const { buildYesterdaySummaryLine } = require('../src/briefing-helpers');
    const prior = { proposals: 0, promotions: 0, total_entries: 0, memory_kb: 14.678, recall_count: 0 };
    const dayBefore = { proposals: 0, promotions: 0, total_entries: 0, memory_kb: 13.234, recall_count: 0 };
    const result = buildYesterdaySummaryLine(prior, dayBefore);
    expect(result).toContain('+1.4 KB memory');
    expect(result).not.toContain('+1.444');
    expect(result).not.toContain('+1 KB');
  });

  it('handles missing fields on priorRow gracefully (treats as 0)', () => {
    const { buildYesterdaySummaryLine } = require('../src/briefing-helpers');
    const prior = { memory_kb: 5.0 };
    expect(buildYesterdaySummaryLine(prior, null)).toBe(
      'Yesterday: +0 proposals, +0 promotions, +5.0 KB memory, +0 entries, 0 recalls'
    );
  });

  it('output format matches the verbatim CONTEXT.md D-05 wording exactly', () => {
    const { buildYesterdaySummaryLine } = require('../src/briefing-helpers');
    const prior = { proposals: 3, promotions: 2, total_entries: 47, memory_kb: 14.6, recall_count: 5 };
    const dayBefore = { proposals: 1, promotions: 0, total_entries: 45, memory_kb: 13.2, recall_count: 2 };
    const result = buildYesterdaySummaryLine(prior, dayBefore);
    expect(result).toMatch(/^Yesterday: /);
    expect(result).toContain(' proposals, ');
    expect(result).toContain(' promotions, ');
    expect(result).toContain(' KB memory, ');
    expect(result).toContain(' entries, ');
    expect(result).toContain(' recalls');
    expect(result).not.toContain(', and ');
  });
});

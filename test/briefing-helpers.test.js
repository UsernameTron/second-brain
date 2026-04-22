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

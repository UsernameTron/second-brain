'use strict';

/**
 * memory-dashboard.test.js
 *
 * Unit tests for src/memory-dashboard.js — the human-readable view of memory.md
 * regenerated on every promotion (2026-07-26 vault restructure).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderDashboard } = require('../src/memory-dashboard');

function entry(over = {}) {
  return {
    id: 'abc123',
    heading: '2026-07-21 · LEARNING · session-61',
    category: 'LEARNING',
    content: 'Batch-limited promotion strands overflow candidates.',
    date: '2026-07-21',
    sourceRef: 'session-61',
    contentHash: 'deadbeefcafe',
    tags: '',
    related: '',
    addedAt: '2026-07-21T10:00:00-05:00',
    ...over,
  };
}

describe('renderDashboard()', () => {
  it('counts entries per category, most populous first', () => {
    const md = renderDashboard([
      entry({ category: 'LEARNING' }),
      entry({ category: 'LEARNING' }),
      entry({ category: 'DECISION' }),
    ], { pendingProposals: 4 });

    expect(md).toMatch(/\| LEARNING \| 2 \|/);
    expect(md).toMatch(/\| DECISION \| 1 \|/);
    expect(md.indexOf('| LEARNING |')).toBeLessThan(md.indexOf('| DECISION |'));
    expect(md).toMatch(/\*\*Entries:\*\* 3/);
    expect(md).toMatch(/\*\*Pending proposals:\*\* 4/);
  });

  it('lists the 10 most recently promoted entries, newest first', () => {
    const entries = [];
    for (let i = 1; i <= 14; i++) {
      const day = String(i).padStart(2, '0');
      entries.push(entry({ addedAt: `2026-07-${day}T10:00:00-05:00`, content: `entry number ${i}` }));
    }

    const md = renderDashboard(entries, { pendingProposals: 0 });
    const listed = md.split('\n').filter(l => l.startsWith('- **2026-'));

    expect(listed).toHaveLength(10);
    expect(listed[0]).toContain('2026-07-14');   // newest
    expect(listed[9]).toContain('2026-07-05');   // 10th newest
    expect(md).not.toContain('entry number 4');  // 14 - 10 = falls off the list
    expect(md).toMatch(/\*\*Last promotion:\*\* 2026-07-14/);
  });

  it('carries no content_hash or block-anchor noise', () => {
    const md = renderDashboard([entry()], { pendingProposals: 0 });
    expect(md).not.toContain('content_hash');
    expect(md).not.toContain('deadbeefcafe');
    expect(md).not.toContain('^');
  });

  it('falls back to the entry date when added:: is absent', () => {
    const md = renderDashboard([entry({ addedAt: '' })], { pendingProposals: 0 });
    expect(md).toMatch(/\*\*2026-07-21\*\* · LEARNING/);
  });

  it('renders an empty store without throwing', () => {
    const md = renderDashboard([], { pendingProposals: 0 });
    expect(md).toMatch(/\*\*Entries:\*\* 0/);
    expect(md).toMatch(/\*\*Last promotion:\*\* never/);
    expect(md).toMatch(/_No entries yet\._/);
  });

  it('truncates long entries to one capped line', () => {
    const long = 'x'.repeat(400) + '\n\nsecond paragraph';
    const md = renderDashboard([entry({ content: long })], { pendingProposals: 0 });
    const line = md.split('\n').find(l => l.startsWith('- **2026-'));
    expect(line.length).toBeLessThan(200);
    expect(line).toContain('…');
  });
});

describe('writeMemoryDashboard()', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-dashboard-'));
    fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
    process.env.VAULT_ROOT = tmpDir;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.VAULT_ROOT;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
    jest.restoreAllMocks();
  });

  it('writes memory/dashboard.md through the vault gateway', async () => {
    const { writeMemoryDashboard } = require('../src/memory-dashboard');
    const result = await writeMemoryDashboard({
      entries: [entry(), entry({ category: 'DECISION' })],
      pendingProposals: 2,
      now: new Date('2026-07-26T12:00:00.000Z'),
    });

    expect(result).toEqual({ success: true, path: 'memory/dashboard.md', entries: 2 });

    const written = fs.readFileSync(path.join(tmpDir, 'memory', 'dashboard.md'), 'utf8');
    expect(written).toMatch(/# Memory Dashboard/);
    expect(written).toMatch(/2026-07-26T12:00:00\.000Z/);
    expect(fs.existsSync(path.join(tmpDir, 'memory', 'dashboard.md.tmp'))).toBe(false);
  });

  it('regenerates the file whole — a stale render never survives', async () => {
    const { writeMemoryDashboard } = require('../src/memory-dashboard');
    const dashboardPath = path.join(tmpDir, 'memory', 'dashboard.md');

    await writeMemoryDashboard({ entries: [entry({ content: 'first render only' })], pendingProposals: 0 });
    expect(fs.readFileSync(dashboardPath, 'utf8')).toContain('first render only');

    await writeMemoryDashboard({ entries: [entry({ content: 'second render' })], pendingProposals: 0 });
    const after = fs.readFileSync(dashboardPath, 'utf8');
    expect(after).toContain('second render');
    expect(after).not.toContain('first render only');
  });
});

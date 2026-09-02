'use strict';
const { pulsePlan, pulseText, trimQuote } = require('../src/pulse');

const E = (o) => ({ id: o.hash, heading: '', category: 'LEARNING', content: 'x', date: o.addedAt.slice(0, 10), sourceRef: '', contentHash: o.hash, tags: '', related: '', supersededBy: null, stale: null, ...o });

const NOW = '2026-09-07', SINCE = '2026-08-31';
const entries = [
  E({ hash: 'new1', category: 'DECISION', addedAt: '2026-09-03T10:00:00Z', content: 'Chose Haiku for all extraction. Second sentence.' }),
  E({ hash: 'new2', category: 'LEARNING', addedAt: '2026-09-05T10:00:00Z', content: 'Learned a thing.' }),
  E({ hash: 'old1', category: 'DECISION', addedAt: '2026-06-01T10:00:00Z', content: 'Old decision one.' }),
  E({ hash: 'old2', category: 'CONSTRAINT', addedAt: '2026-07-01T10:00:00Z', content: 'Old constraint two.' }),
  E({ hash: 'dead', category: 'DECISION', addedAt: '2026-05-01T10:00:00Z', content: 'Retired.', stale: '2026-08-01' }),
  E({ hash: 'young', category: 'DECISION', addedAt: '2026-08-20T10:00:00Z', content: 'Too young to ask.' }),
];

describe('pulsePlan', () => {
  test('counts the week, samples decisions first, ignores stale entries', () => {
    const p = pulsePlan(entries, { now: NOW, since: SINCE });
    expect(p.added).toBe(2);
    expect(p.byCategory).toEqual({ DECISION: 1, LEARNING: 1 });
    expect(p.sample[0].contentHash).toBe('new1');
    expect(p.total).toBe(5);
  });
  test('asks the oldest askable entry that was never asked, never a stale or young one', () => {
    expect(pulsePlan(entries, { now: NOW, since: SINCE }).ask.contentHash).toBe('old1');
    const p = pulsePlan(entries, { now: NOW, since: SINCE, asked: [{ hash: 'old1', pulse: '2026-08-31' }] });
    expect(p.ask.contentHash).toBe('old2');
    expect(p.quiet.map(e => e.contentHash)).toEqual(['old2']);
  });
  test('quiet window is 45 days; young decisions are not standing', () => {
    const p = pulsePlan(entries, { now: NOW, since: SINCE });
    expect(p.standing).toBe(2);
  });
  test('falls back to the oldest entry when nothing else applies', () => {
    const p = pulsePlan([E({ hash: 'only', category: 'LEARNING', addedAt: '2026-09-06T00:00:00Z', content: 'Solo.' })], { now: NOW, since: '2026-09-07' });
    expect(p.added).toBe(0);
    expect(p.ask).toBeNull();
    expect(p.fallback.contentHash).toBe('only');
  });
});

describe('pulseText', () => {
  test('is templated, second person, quotes the entry and names the hash', () => {
    const p = pulsePlan(entries, { now: NOW, since: SINCE });
    const t = pulseText(p, { now: NOW, since: SINCE });
    expect(t).toContain('# Memory pulse, week of September 7');
    expect(t).toContain('**2 entries entered memory this week**');
    expect(t).toContain('> Old decision one.');
    expect(t).toContain('Entry `old1`');
    expect(t).toContain('/pulse yes');
    expect(t).not.toMatch(/[—–]/);
  });
  test('trimQuote keeps the first sentence and caps at 40 words', () => {
    expect(trimQuote('Chose Haiku for all extraction. Second sentence.')).toBe('Chose Haiku for all extraction.');
    expect(trimQuote(Array(60).fill('w').join(' ')).split(' ').length).toBe(41);
  });
});

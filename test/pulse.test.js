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
    // The answer command must carry the hash: pulse-answer refuses to guess
    // between open questions, so the brief has to name the entry it asked about.
    expect(t).toContain('/pulse yes old1');
    expect(t).toContain('/pulse no old1');
    expect(t).not.toMatch(/[—–]/);
  });
  test('trimQuote keeps the first sentence and caps at 40 words', () => {
    expect(trimQuote('Chose Haiku for all extraction. Second sentence.')).toBe('Chose Haiku for all extraction.');
    expect(trimQuote(Array(60).fill('w').join(' ')).split(' ').length).toBe(41);
  });
});

describe('pulsePlan week boundary', () => {
  test('the previous pulse date is excluded, so entries are not counted twice', () => {
    // Promotion runs 00:45 and the pulse 07:00, so entries dated `since` were
    // already reported in that pulse. An inclusive bound re-counted them.
    const onBoundary = [E({ hash: 'b', category: 'LEARNING', addedAt: '2026-08-31T10:00:00Z', content: 'On the boundary.' })];
    expect(pulsePlan(onBoundary, { now: NOW, since: SINCE }).added).toBe(0);
    expect(pulsePlan(onBoundary, { now: NOW, since: '2026-08-30' }).added).toBe(1);
  });
});

describe('pulse answer selection', () => {
  const { selectOpen } = require('../scripts/pulse-answer');

  test('picks the single open question when only one is open', () => {
    const ledger = [{ hash: 'a', answer: 'yes' }, { hash: 'b' }];
    expect(selectOpen(ledger, '').entry.hash).toBe('b');
  });

  test('refuses to guess when more than one question is open', () => {
    const ledger = [{ hash: 'a' }, { hash: 'b' }];
    const r = selectOpen(ledger, '');
    expect(r.entry).toBeUndefined();
    expect(r.error).toMatch(/2 pulse questions are open/);
    expect(r.error).toContain('a');
    expect(r.error).toContain('b');
  });

  test('an explicit hash selects that entry even with several open', () => {
    const ledger = [{ hash: 'a' }, { hash: 'b' }];
    expect(selectOpen(ledger, 'a').entry.hash).toBe('a');
  });

  test('an unknown or already-answered hash is an error, not a fallback', () => {
    expect(selectOpen([{ hash: 'a' }], 'zz').error).toMatch(/No open pulse question for entry zz/);
    expect(selectOpen([{ hash: 'a', answer: 'yes' }], 'a').error).toBe('No open pulse question.');
  });
});

describe('promote-scheduled argument handling', () => {
  test('rejects an unknown flag instead of running a real promotion', async () => {
    const { main } = require('../scripts/promote-scheduled');
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main(['--dryrun'])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(2);
    expect(err.mock.calls.flat().join(' ')).toMatch(/unknown argument/);
    exit.mockRestore(); err.mockRestore();
  });
});

describe('pulse ledger reading', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { readLedger } = require('../scripts/pulse-answer');
  let dir, ledger, prev;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-ledger-'));
    ledger = path.join(dir, 'pulse-asked.json');
    prev = process.env.PULSE_LEDGER;
    process.env.PULSE_LEDGER = ledger;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.PULSE_LEDGER; else process.env.PULSE_LEDGER = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a missing ledger is a first run, not an error', () => {
    expect(readLedger()).toEqual([]);
  });

  test('a valid ledger round-trips', () => {
    fs.writeFileSync(ledger, JSON.stringify([{ hash: 'a', pulse: '2026-09-01' }]));
    expect(readLedger()).toEqual([{ hash: 'a', pulse: '2026-09-01' }]);
  });

  test('a truncated ledger aborts instead of being treated as empty', () => {
    // Silently returning [] here would re-ask an answered entry and then
    // overwrite the file, discarding every prior question and answer.
    fs.writeFileSync(ledger, '[{"hash":"a"');
    expect(() => readLedger()).toThrow(/malformed/);
  });

  test('a ledger that is not an array aborts', () => {
    fs.writeFileSync(ledger, '{"hash":"a"}');
    expect(() => readLedger()).toThrow(/not an array/);
  });
});

describe('pulse retirement writes memory.md', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { markStale } = require('../scripts/pulse-answer');
  let dir, prevVault;

  const MEMORY = [
    '### 2026-06-01 · DECISION · ref',
    '',
    'Old decision one.',
    '',
    'category:: DECISION',
    'content_hash:: old1',
    '',
  ].join('\n');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mem-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'memory', 'memory.md'), MEMORY);
    prevVault = process.env.VAULT_ROOT;
    process.env.VAULT_ROOT = dir;
  });
  afterEach(() => {
    if (prevVault === undefined) delete process.env.VAULT_ROOT; else process.env.VAULT_ROOT = prevVault;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('appends a stale:: lifecycle field to the named entry, deleting nothing', () => {
    markStale('old1', 'superseded by the nightly job');
    const out = fs.readFileSync(path.join(dir, 'memory', 'memory.md'), 'utf8');
    expect(out).toMatch(/stale:: \d{4}-\d{2}-\d{2} · retired via pulse · superseded by the nightly job/);
    expect(out).toContain('Old decision one.');
    expect(out).toContain('content_hash:: old1');
  });

  test('omits the reason when none is given', () => {
    markStale('old1');
    const out = fs.readFileSync(path.join(dir, 'memory', 'memory.md'), 'utf8');
    expect(out).toMatch(/retired via pulse\n/);
  });

  test('an unknown hash throws rather than editing the wrong entry', () => {
    expect(() => markStale('nope')).toThrow(/entry nope not found/);
  });
});

describe('pulse answer end to end', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { answer } = require('../scripts/pulse-answer');
  let dir, ledgerPath, prevVault, prevLedger, log;

  const MEMORY = ['### 2026-06-01 · DECISION · ref', '', 'Old decision one.', '', 'content_hash:: old1', '', '### 2026-07-01 · CONSTRAINT · ref', '', 'Old constraint two.', '', 'content_hash:: old2', ''].join('\n');

  const writeLedger = (rows) => fs.writeFileSync(ledgerPath, JSON.stringify(rows));
  const readLedgerFile = () => JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const memory = () => fs.readFileSync(path.join(dir, 'memory', 'memory.md'), 'utf8');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-answer-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'proposals'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'memory', 'memory.md'), MEMORY);
    ledgerPath = path.join(dir, 'pulse-asked.json');
    prevVault = process.env.VAULT_ROOT; prevLedger = process.env.PULSE_LEDGER;
    process.env.VAULT_ROOT = dir; process.env.PULSE_LEDGER = ledgerPath;
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    if (prevVault === undefined) delete process.env.VAULT_ROOT; else process.env.VAULT_ROOT = prevVault;
    if (prevLedger === undefined) delete process.env.PULSE_LEDGER; else process.env.PULSE_LEDGER = prevLedger;
    log.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('yes records the answer and leaves memory.md alone', async () => {
    writeLedger([{ hash: 'old1', pulse: '2026-09-01' }]);
    const r = await answer('yes');
    expect(r.hash).toBe('old1');
    expect(readLedgerFile()[0].answer).toBe('yes');
    expect(memory()).not.toContain('stale::');
  });

  test('no retires the entry and stores the reason', async () => {
    writeLedger([{ hash: 'old1', pulse: '2026-09-01' }]);
    await answer('no', 'no longer how we do it');
    expect(memory()).toContain('retired via pulse · no longer how we do it');
    expect(readLedgerFile()[0].reason).toBe('no longer how we do it');
  });

  test('a hash-shaped first argument is the hash, not the reason', async () => {
    writeLedger([{ hash: 'abc123', pulse: '2026-09-01' }, { hash: 'def456', pulse: '2026-09-08' }]);
    fs.writeFileSync(path.join(dir, 'memory', 'memory.md'), 'content_hash:: abc123\n');
    await answer('no', 'abc123', 'stale now');
    const rows = readLedgerFile();
    expect(rows.find(r => r.hash === 'abc123').answer).toBe('no');
    expect(rows.find(r => r.hash === 'def456').answer).toBeUndefined();
  });

  test('two open questions and no hash refuses rather than retiring the wrong entry', async () => {
    writeLedger([{ hash: 'old1', pulse: '2026-09-01' }, { hash: 'old2', pulse: '2026-09-08' }]);
    const r = await answer('no', 'guessing is not allowed');
    expect(r.error).toMatch(/2 pulse questions are open/);
    expect(memory()).not.toContain('stale::');
    expect(readLedgerFile().every(row => !row.answer)).toBe(true);
  });

  test('answering with nothing open is a no-op', async () => {
    writeLedger([{ hash: 'old1', pulse: '2026-09-01', answer: 'yes' }]);
    const r = await answer('yes');
    expect(r.error).toBe('No open pulse question.');
  });
});

describe('pulse.js entry point', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  let dir, prevVault, prevLedger, log, out;

  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-cli-'));
    prevVault = process.env.VAULT_ROOT; prevLedger = process.env.PULSE_LEDGER;
    process.env.VAULT_ROOT = dir;
    process.env.PULSE_LEDGER = path.join(dir, 'pulse-asked.json');
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    if (prevVault === undefined) delete process.env.VAULT_ROOT; else process.env.VAULT_ROOT = prevVault;
    if (prevLedger === undefined) delete process.env.PULSE_LEDGER; else process.env.PULSE_LEDGER = prevLedger;
    log.mockRestore(); out.mockRestore();
    jest.dontMock('../scripts/pulse-answer');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('--show says so when no pulse has been written yet', async () => {
    const { main } = require('../scripts/pulse');
    await main(['--show']);
    expect(log.mock.calls.flat().join(' ')).toMatch(/No pulse written yet/);
  });

  test('--show prints the most recent brief', async () => {
    fs.mkdirSync(path.join(dir, 'briefings', 'pulse'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'briefings', 'pulse', '2026-09-01.md'), 'older\n');
    fs.writeFileSync(path.join(dir, 'briefings', 'pulse', '2026-09-08.md'), 'newest\n');
    const { main } = require('../scripts/pulse');
    await main(['--show']);
    expect(out.mock.calls.flat().join('')).toContain('newest');
  });

  test('yes/no is delegated to pulse-answer with the hash intact', async () => {
    const answer = jest.fn().mockResolvedValue({});
    jest.doMock('../scripts/pulse-answer', () => ({ answer, readLedger: () => [] }));
    const { main } = require('../scripts/pulse');
    await main(['no', 'abc123', 'not', 'true', 'anymore']);
    expect(answer).toHaveBeenCalledWith('no', 'abc123', 'not true anymore');
  });
});

describe('pulse.js write path', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  let dir, ledgerPath, prevVault, prevLedger, log, out, vaultWrite;

  const ENTRY = {
    id: 'old1', heading: '', category: 'DECISION', content: 'Old decision one.',
    date: '2026-06-01', addedAt: '2026-06-01T10:00:00Z', sourceRef: '', contentHash: 'old1',
    tags: '', related: '', supersededBy: null, stale: null,
  };

  const load = () => {
    jest.doMock('../src/memory-reader', () => ({ readMemory: jest.fn().mockResolvedValue([ENTRY]) }));
    vaultWrite = jest.fn().mockResolvedValue({ decision: 'WRITTEN', path: 'x' });
    jest.doMock('../src/vault-gateway', () => ({ vaultWrite, vaultWriteAtomic: jest.fn() }));
    jest.doMock('child_process', () => ({ execFileSync: jest.fn() }));
    return require('../scripts/pulse');
  };

  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-write-'));
    ledgerPath = path.join(dir, 'pulse-asked.json');
    prevVault = process.env.VAULT_ROOT; prevLedger = process.env.PULSE_LEDGER;
    process.env.VAULT_ROOT = dir; process.env.PULSE_LEDGER = ledgerPath;
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    if (prevVault === undefined) delete process.env.VAULT_ROOT; else process.env.VAULT_ROOT = prevVault;
    if (prevLedger === undefined) delete process.env.PULSE_LEDGER; else process.env.PULSE_LEDGER = prevLedger;
    log.mockRestore(); out.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('--dry-run prints the brief and writes nothing', async () => {
    const { main } = load();
    await main(['--dry-run']);
    expect(out.mock.calls.flat().join('')).toContain('# Memory pulse, week of');
    expect(vaultWrite).not.toHaveBeenCalled();
    expect(fs.existsSync(ledgerPath)).toBe(false);
  });

  test('a real run writes the brief through the gateway and ledgers the question', async () => {
    const { main } = load();
    await main(['--no-open']);
    expect(vaultWrite).toHaveBeenCalledTimes(1);
    const [rel, text] = vaultWrite.mock.calls[0];
    expect(rel).toMatch(/^briefings\/pulse\/\d{4}-\d{2}-\d{2}\.md$/);
    expect(text).toContain('# Memory pulse, week of');
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].hash).toBe('old1');
  });

  test('a week with no askable entry still ledgers the run, so the window advances', async () => {
    jest.resetModules();
    jest.doMock('../src/memory-reader', () => ({ readMemory: jest.fn().mockResolvedValue([]) }));
    jest.doMock('../src/vault-gateway', () => ({ vaultWrite: jest.fn().mockResolvedValue({ decision: 'WRITTEN' }), vaultWriteAtomic: jest.fn() }));
    jest.doMock('child_process', () => ({ execFileSync: jest.fn() }));
    const { main } = require('../scripts/pulse');
    await main(['--no-open']);
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    expect(ledger[0].hash).toBeNull();
  });

  test('a style-lint rejection falls back to an atomic write rather than dropping the week', async () => {
    jest.resetModules();
    const err = Object.assign(new Error('banned term'), { code: 'STYLE_VIOLATION' });
    const vaultWriteAtomic = jest.fn();
    jest.doMock('../src/memory-reader', () => ({ readMemory: jest.fn().mockResolvedValue([ENTRY]) }));
    jest.doMock('../src/vault-gateway', () => ({ vaultWrite: jest.fn().mockRejectedValue(err), vaultWriteAtomic }));
    jest.doMock('child_process', () => ({ execFileSync: jest.fn() }));
    const errLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { main } = require('../scripts/pulse');
    await main(['--no-open']);
    expect(vaultWriteAtomic).toHaveBeenCalledTimes(1);
    errLog.mockRestore();
  });

  test('a non-STYLE_VIOLATION gateway error is not swallowed', async () => {
    jest.resetModules();
    jest.doMock('../src/memory-reader', () => ({ readMemory: jest.fn().mockResolvedValue([ENTRY]) }));
    jest.doMock('../src/vault-gateway', () => ({ vaultWrite: jest.fn().mockRejectedValue(new Error('disk full')), vaultWriteAtomic: jest.fn() }));
    jest.doMock('child_process', () => ({ execFileSync: jest.fn() }));
    const { main } = require('../scripts/pulse');
    await expect(main(['--no-open'])).rejects.toThrow('disk full');
  });
});

describe('pulse safety branches', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  test('an unreadable ledger surfaces the real error, not an empty history', () => {
    // Only a genuinely absent file (ENOENT) may be treated as a first run;
    // a permissions or I/O failure must not silently reset the history.
    jest.resetModules();
    const { readLedger } = require('../scripts/pulse-answer');
    const spy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });
    try {
      expect(() => readLedger()).toThrow(/permission denied/);
    } finally {
      spy.mockRestore();
    }
  });

  test('a held lock refuses the answer rather than racing the promotion job', async () => {
    jest.resetModules();
    jest.doMock('../src/memory-proposals', () => ({
      acquireLock: jest.fn().mockResolvedValue({ acquired: false }),
      releaseLock: jest.fn(),
    }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-lock-'));
    const ledgerPath = path.join(dir, 'pulse-asked.json');
    fs.writeFileSync(ledgerPath, JSON.stringify([{ hash: 'old1', pulse: '2026-09-01' }]));
    const prevL = process.env.PULSE_LEDGER, prevV = process.env.VAULT_ROOT;
    process.env.PULSE_LEDGER = ledgerPath; process.env.VAULT_ROOT = dir;
    const errLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { answer } = require('../scripts/pulse-answer');
      const r = await answer('no');
      expect(r.error).toMatch(/Could not acquire/);
      // The ledger must be untouched, so the question is still answerable.
      expect(JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))[0].answer).toBeUndefined();
    } finally {
      errLog.mockRestore();
      if (prevL === undefined) delete process.env.PULSE_LEDGER; else process.env.PULSE_LEDGER = prevL;
      if (prevV === undefined) delete process.env.VAULT_ROOT; else process.env.VAULT_ROOT = prevV;
      fs.rmSync(dir, { recursive: true, force: true });
      jest.resetModules();
    }
  });

  test('the fallback entry is rendered when there is nothing new and nothing to ask', () => {
    const solo = [E({ hash: 'only', category: 'LEARNING', addedAt: '2026-09-06T00:00:00Z', content: 'Solo entry.' })];
    const p = pulsePlan(solo, { now: NOW, since: '2026-09-07' });
    const t = pulseText(p, { now: NOW, since: '2026-09-07' });
    expect(t).toContain('Nothing new entered memory this week.');
    expect(t).toContain('## Worth hearing again');
    expect(t).toContain('> Solo entry.');
    expect(t).not.toContain('## One question');
  });
});

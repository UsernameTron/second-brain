'use strict';

/**
 * daily-sweep.test.js
 *
 * Tests for scripts/daily-sweep.js — transcript sweep + inbox ingest steps
 * added by quick-260719-lfn (audit items 6-7).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// The sweep calls the Haiku-backed extractor. Left live, these tests make real
// Anthropic calls — and with no key the SDK's retry backoff blows Jest's 5s
// limit, so the suite was red locally and green only where a key happened to be
// set. The sweep's own contract (ledger bookkeeping, archive moves, counts) is
// what is under test here; extraction quality is memory-extractor's own suite.
jest.mock('../src/memory-extractor', () => ({
  extractFromTranscript: jest.fn(async () => [{ content: 'stub candidate' }]),
  extractMemories: jest.fn(async () => [{ content: 'stub candidate' }]),
}));

// daily-sweep destructures lifecycle at module load, so a late spy on the exports
// object cannot reach the captured reference — it has to be mocked at the module.
jest.mock('../src/lifecycle', () => ({
  retryDeadLetters: jest.fn(async () => ({ retried: 0 })),
  archiveStaleLeftProposals: jest.fn(async () => ({ archived: 0 })),
}));

// jest.resetModules() in beforeEach re-runs the factories above, so these must be
// re-acquired per test — a reference captured here would point at a dead instance.
let extractFromTranscript;
let extractMemories;
let retryDeadLetters;

let tmpRoot;
let transcriptsRoot;
let vaultRoot;
let ledgerPath;
let sweep;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-test-'));
  transcriptsRoot = path.join(tmpRoot, 'claude-projects');
  vaultRoot = path.join(tmpRoot, 'vault');
  ledgerPath = path.join(tmpRoot, 'state', 'transcripts-swept.json');

  fs.mkdirSync(transcriptsRoot, { recursive: true });
  fs.mkdirSync(vaultRoot, { recursive: true });

  process.env.TRANSCRIPTS_ROOT_OVERRIDE = transcriptsRoot;
  process.env.LEDGER_PATH_OVERRIDE = ledgerPath;
  process.env.VAULT_ROOT = vaultRoot;
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

  jest.resetModules();
  sweep = require('../scripts/daily-sweep');
  ({ extractFromTranscript, extractMemories } = require('../src/memory-extractor'));
  ({ retryDeadLetters } = require('../src/lifecycle'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.TRANSCRIPTS_ROOT_OVERRIDE;
  delete process.env.LEDGER_PATH_OVERRIDE;
  delete process.env.VAULT_ROOT;
  delete process.env.CONFIG_DIR_OVERRIDE;
  jest.restoreAllMocks();
});

function writeTranscript(dirName, fileName, lines) {
  const dir = path.join(transcriptsRoot, dirName);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return filePath;
}

describe('findRecentTranscripts', () => {
  test('skips directories whose name contains "worktrees"', () => {
    writeTranscript('-Users-cpconnor-projects-foo', 'a.jsonl', [{ role: 'user', content: 'hello' }]);
    writeTranscript('-Users-cpconnor-projects-foo.claude-worktrees-bar', 'b.jsonl', [{ role: 'user', content: 'hello' }]);

    const found = sweep.findRecentTranscripts();
    const paths = found.map((f) => f.path);
    expect(paths.some((p) => p.includes('a.jsonl'))).toBe(true);
    expect(paths.some((p) => p.includes('b.jsonl'))).toBe(false);
  });

  test('excludes files older than 24h', () => {
    const filePath = writeTranscript('-Users-cpconnor-projects-foo', 'old.jsonl', [{ role: 'user', content: 'hello' }]);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(filePath, old, old);

    const found = sweep.findRecentTranscripts();
    expect(found.some((f) => f.path === filePath)).toBe(false);
  });
});

describe('hasSignal (stream-grep)', () => {
  test('returns true when a line matches the signal heuristic', async () => {
    const filePath = writeTranscript('-Users-cpconnor-projects-foo', 'sig.jsonl', [
      { role: 'user', content: 'just chatting, nothing much' },
      { role: 'assistant', content: 'We decided to use JWT for auth after weighing alternatives' },
    ]);
    await expect(sweep.hasSignal(filePath)).resolves.toBe(true);
  });

  test('returns false when no line matches', async () => {
    const filePath = writeTranscript('-Users-cpconnor-projects-foo', 'nosig.jsonl', [
      { role: 'user', content: 'just chatting, nothing much' },
      { role: 'assistant', content: 'sure, sounds fine' },
    ]);
    await expect(sweep.hasSignal(filePath)).resolves.toBe(false);
  });
});

describe('sweepTranscripts ledger dedup', () => {
  test('does not re-extract a file whose path+mtime is already in the ledger', async () => {
    const filePath = writeTranscript('-Users-cpconnor-projects-foo', 'once.jsonl', [
      { role: 'assistant', content: 'We decided to use JWT for auth after weighing alternatives' },
    ]);
    const stat = fs.statSync(filePath);
    sweep.saveLedger([{ path: filePath, mtime: stat.mtimeMs }]);

    const result = await sweep.sweepTranscripts();
    expect(result.swept).toBe(0);
  });

  test('sweeps an unswept file with signal and records it in the ledger', async () => {
    const filePath = writeTranscript('-Users-cpconnor-projects-foo', 'fresh.jsonl', [
      { role: 'assistant', content: 'We decided to use JWT for auth after weighing alternatives' },
    ]);

    const result = await sweep.sweepTranscripts();
    expect(result.swept).toBe(1);

    const ledger = sweep.loadLedger();
    expect(ledger.some((e) => e.path === filePath)).toBe(true);
  });
});

describe('sweepInbox', () => {
  test('creates inbox/ and inbox/archive/ if absent, processes files, moves them to archive', async () => {
    const inboxDir = path.join(vaultRoot, 'inbox');
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, 'note.md'), '# A note\n\nSome content here.\n', 'utf8');

    const result = await sweep.sweepInbox();

    expect(result.processed).toBe(1);
    expect(fs.existsSync(path.join(inboxDir, 'archive', 'note.md'))).toBe(true);
    expect(fs.existsSync(path.join(inboxDir, 'note.md'))).toBe(false);
  });

  test('is a no-op with no error when inbox/ is empty', async () => {
    const result = await sweep.sweepInbox();
    expect(result.processed).toBe(0);
  });

  test('reports extracted count from the extractor and archives every .md', async () => {
    const inboxDir = path.join(vaultRoot, 'inbox');
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, 'a.md'), '# A\n', 'utf8');
    fs.writeFileSync(path.join(inboxDir, 'b.md'), '# B\n', 'utf8');
    fs.writeFileSync(path.join(inboxDir, 'skip.txt'), 'not markdown\n', 'utf8');
    extractMemories.mockResolvedValueOnce([{ content: 'one' }, { content: 'two' }]);

    const result = await sweep.sweepInbox();

    expect(result.processed).toBe(2);
    expect(result.extracted).toBe(2);
    expect(fs.existsSync(path.join(inboxDir, 'skip.txt'))).toBe(true); // non-.md left alone
  });

  test('survives a failed archive move and still returns a count', async () => {
    const inboxDir = path.join(vaultRoot, 'inbox');
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, 'note.md'), '# A note\n', 'utf8');
    jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('EPERM: archive move blocked');
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await sweep.sweepInbox();

    expect(result.processed).toBe(1);
    expect(fs.existsSync(path.join(inboxDir, 'note.md'))).toBe(true); // move failed, file stays
  });

  test('non-array extractor result coerces extracted to 0', async () => {
    const inboxDir = path.join(vaultRoot, 'inbox');
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(path.join(inboxDir, 'a.md'), '# A\n', 'utf8');
    extractMemories.mockResolvedValueOnce(null);

    const result = await sweep.sweepInbox();

    expect(result.extracted).toBe(0);
  });
});

describe('sweepTranscripts resilience', () => {
  test('skips extraction for a transcript with no signal keywords', async () => {
    writeTranscript('-Users-cpconnor-projects-foo', 'quiet.jsonl', [
      { role: 'user', content: 'what time is the meeting' },
    ]);

    const result = await sweep.sweepTranscripts();

    expect(result.swept).toBe(1);
    expect(result.extracted).toBe(0);
    expect(extractFromTranscript).not.toHaveBeenCalled();
  });

  test('a throwing extractor is logged, not fatal, and the file is still ledgered', async () => {
    const filePath = writeTranscript('-Users-cpconnor-projects-foo', 'boom.jsonl', [
      { role: 'assistant', content: 'We decided to use JWT for auth' },
    ]);
    extractFromTranscript.mockRejectedValueOnce(new Error('haiku exploded'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await sweep.sweepTranscripts();

    expect(result.swept).toBe(1);
    expect(result.extracted).toBe(0);
    expect(sweep.loadLedger().some((e) => e.path === filePath)).toBe(true);
  });

  test('re-sweeping a changed file updates its ledger entry in place', async () => {
    const filePath = writeTranscript('-Users-cpconnor-projects-foo', 'changed.jsonl', [
      { role: 'assistant', content: 'We decided to use JWT for auth' },
    ]);
    sweep.saveLedger([{ path: filePath, mtime: 1 }]); // stale mtime → counts as unswept

    await sweep.sweepTranscripts();
    const ledger = sweep.loadLedger();

    expect(ledger.filter((e) => e.path === filePath)).toHaveLength(1);
    expect(ledger.find((e) => e.path === filePath).mtime).not.toBe(1);
  });

  test('an unreadable transcripts root yields no candidates', () => {
    fs.rmSync(transcriptsRoot, { recursive: true, force: true });
    expect(sweep.findRecentTranscripts()).toEqual([]);
  });

  test('a transcript older than the 24h window is not a candidate', () => {
    const filePath = writeTranscript('-Users-cpconnor-projects-foo', 'old.jsonl', [
      { role: 'assistant', content: 'We decided something long ago' },
    ]);
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
    fs.utimesSync(filePath, twoDaysAgo / 1000, twoDaysAgo / 1000);

    expect(sweep.findRecentTranscripts().some((c) => c.path === filePath)).toBe(false);
  });

  test('a corrupt ledger file reads as empty rather than throwing', () => {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, '{ not json', 'utf8');

    expect(sweep.loadLedger()).toEqual([]);
  });
});

describe('main orchestration', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('runs all five steps and returns a result per step', async () => {
    const results = await sweep.main();

    expect(Object.keys(results)).toEqual(
      ['extraction', 'retry', 'archive', 'transcriptSweep', 'inboxSweep']
    );
    for (const key of Object.keys(results)) {
      expect(results[key]).not.toBeNull();
    }
  });

  test('a failing step is captured as {error} and never aborts the rest', async () => {
    extractMemories.mockRejectedValueOnce(new Error('extraction exploded'));

    const results = await sweep.main();

    expect(results.extraction).toEqual({ error: 'extraction exploded' });
    expect(results.transcriptSweep).not.toBeNull(); // later steps still ran
    expect(results.inboxSweep).not.toBeNull();
  });

  test('lifecycle failures are isolated to their own step', async () => {
    retryDeadLetters.mockRejectedValueOnce(new Error('retry broke'));

    const results = await sweep.main();

    expect(results.retry).toEqual({ error: 'retry broke' });
    expect(results.archive).not.toBeNull();
  });
});

describe('--dry-run mode', () => {
  let dryRunSweep;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const origArgv = process.argv;
    process.argv = [...origArgv, '--dry-run'];
    jest.resetModules();
    dryRunSweep = require('../scripts/daily-sweep');
    process.argv = origArgv;
  });

  test('sweepTranscripts reports counts without writing the ledger', async () => {
    writeTranscript('-Users-cpconnor-projects-foo', 'a.jsonl', [
      { role: 'assistant', content: 'We decided to use JWT' },
    ]);

    const result = await dryRunSweep.sweepTranscripts();

    expect(result.dryRun).toBe(true);
    expect(result.candidates).toBe(1);
    expect(result.unswept).toBe(1);
    expect(fs.existsSync(ledgerPath)).toBe(false);
  });

  test('sweepInbox does not create or archive anything', async () => {
    const result = await dryRunSweep.sweepInbox();

    expect(result.dryRun).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'inbox'))).toBe(false);
  });

  test('main reports dryRun markers for every step it would take', async () => {
    const results = await dryRunSweep.main();

    expect(results.extraction).toEqual({ dryRun: true });
    expect(results.retry).toEqual({ dryRun: true });
    expect(results.archive).toEqual({ dryRun: true });
    expect(results.transcriptSweep.dryRun).toBe(true);
    expect(results.inboxSweep.dryRun).toBe(true);
  });
});

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
});

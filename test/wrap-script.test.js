'use strict';

/**
 * wrap-script.test.js
 *
 * Tests for scripts/wrap.js — transcript resolution and flag parsing.
 * The resolver is the load-bearing bit: a bare `/wrap` stages nothing if it
 * picks the wrong file (or none), which is the defect this script fixes.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Extraction classifies via Haiku. Left live these tests would make real API
// calls (and hang on retry backoff without a key) — same trap as daily-sweep.
jest.mock('../src/memory-extractor', () => ({
  extractFromTranscript: jest.fn(async () => [{ content: 'from transcript' }]),
  extractMemories: jest.fn(async () => [{ content: 'from vault' }, { content: 'second' }]),
}));

let tmpRoot;
let transcriptsRoot;
let wrap;
let extractFromTranscript;
let extractMemories;

const PROJECT = '/Users/someone/projects/demo';
const SLUG = '-Users-someone-projects-demo';

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-test-'));
  transcriptsRoot = path.join(tmpRoot, 'projects');
  fs.mkdirSync(transcriptsRoot, { recursive: true });
  process.env.TRANSCRIPTS_ROOT_OVERRIDE = transcriptsRoot;

  jest.resetModules();
  wrap = require('../scripts/wrap');
  // resetModules re-runs the mock factory, so these must be re-acquired per test.
  ({ extractFromTranscript, extractMemories } = require('../src/memory-extractor'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.TRANSCRIPTS_ROOT_OVERRIDE;
});

function writeTranscript(name, mtimeMs, slug = SLUG) {
  const dir = path.join(transcriptsRoot, slug);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, '{"role":"user","content":"hi"}\n', 'utf8');
  if (mtimeMs) fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
  return p;
}

// main() resolves against the real repo root, so its fixtures need that slug.
const REPO_SLUG = path.resolve(__dirname, '..').replace(/\//g, '-');
const writeRepoTranscript = (name, mtimeMs) => writeTranscript(name, mtimeMs, REPO_SLUG);

describe('resolveLatestTranscript', () => {
  test('derives the project slug by replacing path separators with dashes', () => {
    const expected = writeTranscript('only.jsonl');
    expect(wrap.resolveLatestTranscript(PROJECT)).toBe(expected);
  });

  test('picks the newest transcript when several exist', () => {
    const now = Date.now();
    writeTranscript('old.jsonl', now - 60 * 60 * 1000);
    const newest = writeTranscript('new.jsonl', now);
    writeTranscript('older.jsonl', now - 24 * 60 * 60 * 1000);

    expect(wrap.resolveLatestTranscript(PROJECT)).toBe(newest);
  });

  test('ignores non-.jsonl files', () => {
    const dir = path.join(transcriptsRoot, SLUG);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'notes.md'), 'not a transcript', 'utf8');
    const real = writeTranscript('session.jsonl');

    expect(wrap.resolveLatestTranscript(PROJECT)).toBe(real);
  });

  test('returns null when the project has no transcript directory', () => {
    expect(wrap.resolveLatestTranscript('/Users/someone/projects/never-used')).toBeNull();
  });

  test('returns null when the directory exists but holds no transcripts', () => {
    fs.mkdirSync(path.join(transcriptsRoot, SLUG), { recursive: true });
    expect(wrap.resolveLatestTranscript(PROJECT)).toBeNull();
  });
});

describe('parseArgs', () => {
  test('bare invocation yields no options, which selects the transcript path', () => {
    expect(wrap.parseArgs([])).toEqual({});
  });

  test('parses each flag with its value', () => {
    expect(wrap.parseArgs(['--file', 'Daily/2026-07-19.md'])).toEqual({ file: 'Daily/2026-07-19.md' });
    expect(wrap.parseArgs(['--dir', 'inbox'])).toEqual({ dir: 'inbox' });
    expect(wrap.parseArgs(['--since', '2026-07-01'])).toEqual({ since: '2026-07-01' });
    expect(wrap.parseArgs(['--transcript', '/tmp/a.jsonl'])).toEqual({ transcript: '/tmp/a.jsonl' });
  });

  test('a flag missing its value is ignored rather than swallowing the next flag', () => {
    expect(wrap.parseArgs(['--file'])).toEqual({});
    expect(wrap.parseArgs(['--dir', 'inbox', '--since'])).toEqual({ dir: 'inbox' });
  });
});

describe('main', () => {
  let out;
  let err;
  let exitSpy;
  const origArgv = process.argv;

  beforeEach(() => {
    out = [];
    err = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(s); return true; });
    jest.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(s); return true; });
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('__exit__'); // stop main where the real process would
    });
  });

  afterEach(() => {
    process.argv = origArgv;
    jest.restoreAllMocks();
  });

  test('bare invocation extracts from the newest transcript', async () => {
    const newest = writeRepoTranscript('session.jsonl');
    process.argv = ['node', 'wrap.js'];
    jest.spyOn(wrap, 'resolveLatestTranscript'); // real impl, just observed

    await wrap.main();

    expect(extractFromTranscript).toHaveBeenCalledWith(newest, 'session');
    expect(extractMemories).not.toHaveBeenCalled();
    expect(out.join('')).toContain('Extracted 1 memory candidate(s)');
    expect(out.join('')).toContain('/promote-memories');
  });

  test('--transcript overrides the newest-transcript default', async () => {
    writeRepoTranscript('newest.jsonl');
    const explicit = writeRepoTranscript('older.jsonl', Date.now() - 86400000);
    process.argv = ['node', 'wrap.js', '--transcript', explicit];

    await wrap.main();

    expect(extractFromTranscript).toHaveBeenCalledWith(explicit, 'older');
  });

  test('--file routes to extractMemories, not the transcript path', async () => {
    process.argv = ['node', 'wrap.js', '--file', 'Daily/2026-07-19.md'];

    await wrap.main();

    expect(extractMemories).toHaveBeenCalledWith({ file: 'Daily/2026-07-19.md' });
    expect(extractFromTranscript).not.toHaveBeenCalled();
    expect(out.join('')).toContain('Extracted 2 memory candidate(s)');
  });

  test('--since reports the Daily range as the source', async () => {
    process.argv = ['node', 'wrap.js', '--since', '2026-07-01'];

    await wrap.main();

    expect(extractMemories).toHaveBeenCalledWith({ since: '2026-07-01' });
    expect(out.join('')).toContain('Daily/ since 2026-07-01');
  });

  test('exits 1 with guidance when no transcript exists', async () => {
    process.argv = ['node', 'wrap.js'];
    process.env.TRANSCRIPTS_ROOT_OVERRIDE = path.join(tmpRoot, 'empty');

    await expect(wrap.main()).rejects.toThrow('__exit__');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err.join('')).toContain('no transcript found');
  });

  test('exits 1 when an explicit --transcript path does not exist', async () => {
    process.argv = ['node', 'wrap.js', '--transcript', path.join(tmpRoot, 'ghost.jsonl')];

    await expect(wrap.main()).rejects.toThrow('__exit__');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(err.join('')).toContain('transcript not found');
  });

  test('a non-array extractor result reports 0 rather than crashing', async () => {
    writeRepoTranscript('session.jsonl');
    process.argv = ['node', 'wrap.js'];
    extractFromTranscript.mockResolvedValueOnce(null);

    await wrap.main();

    expect(out.join('')).toContain('Extracted 0 memory candidate(s)');
  });
});

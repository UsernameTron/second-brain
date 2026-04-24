'use strict';

/**
 * recall-command.test.js
 *
 * Unit tests for src/recall-command.js
 * Covers parseRecallArgs (P1-P9) and runRecall (R1-R9).
 */

const fs = require('fs');
const path = require('path');

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'memory-sample.md');
const MODULE_PATH = path.resolve(__dirname, '..', '..', 'src', 'recall-command');

let tmpRoot;
let tmpEmptyRoot;
let originalVaultRoot;
let parseRecallArgs;
let runRecall;

beforeAll(() => {
  originalVaultRoot = process.env.VAULT_ROOT;

  // Create a tmp vault with the fixture for positive tests
  tmpRoot = path.join(__dirname, '..', 'fixtures', `_recall-tmp-${Date.now()}`);
  fs.mkdirSync(path.join(tmpRoot, 'memory'), { recursive: true });
  fs.copyFileSync(FIXTURE_PATH, path.join(tmpRoot, 'memory', 'memory.md'));

  // Create an empty vault root (NO memory/ subdir) for missing-file test
  tmpEmptyRoot = path.join(__dirname, '..', 'fixtures', `_recall-empty-${Date.now()}`);
  fs.mkdirSync(tmpEmptyRoot, { recursive: true });

  // Load module with tmpRoot as the vault
  process.env.VAULT_ROOT = tmpRoot;
  jest.resetModules();
  ({ parseRecallArgs, runRecall } = require(MODULE_PATH));
});

afterAll(() => {
  if (originalVaultRoot === undefined) {
    delete process.env.VAULT_ROOT;
  } else {
    process.env.VAULT_ROOT = originalVaultRoot;
  }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* ignore cleanup errors */ }
  try { fs.rmSync(tmpEmptyRoot, { recursive: true, force: true }); } catch (_) { /* ignore cleanup errors */ }
});

// ── parseRecallArgs ───────────────────────────────────────────────────────────

describe('parseRecallArgs()', () => {
  test('P1: single positional sets query, defaults flags', () => {
    const { query, flags } = parseRecallArgs(['leadership']);
    expect(query).toBe('leadership');
    expect(flags).toEqual({ category: null, since: null, top: 5 });
  });

  test('P2: --top N sets flags.top', () => {
    const { flags } = parseRecallArgs(['leadership', '--top', '3']);
    expect(flags.top).toBe(3);
  });

  test('P3: --category sets flags.category', () => {
    const { flags } = parseRecallArgs(['leadership', '--category', 'DECISION']);
    expect(flags.category).toBe('DECISION');
  });

  test('P4: --since sets flags.since', () => {
    const { flags } = parseRecallArgs(['leadership', '--since', '2026-04-01']);
    expect(flags.since).toBe('2026-04-01');
  });

  test('P5: outer double-quotes are stripped from single-token query', () => {
    const { query, flags } = parseRecallArgs(['"exact phrase"', '--top', '2']);
    expect(query).toBe('exact phrase');
    expect(flags.top).toBe(2);
  });

  test('P6: inner phrase preserved exactly after outer-quote strip', () => {
    const { query } = parseRecallArgs(['"left right split"']);
    expect(query).toBe('left right split');
  });

  test('P7: empty argv returns empty query and defaults', () => {
    const { query, flags } = parseRecallArgs([]);
    expect(query).toBe('');
    expect(flags).toEqual({ category: null, since: null, top: 5 });
  });

  test('P8: non-numeric --top falls back to default 5', () => {
    const { flags } = parseRecallArgs(['leadership', '--top', 'abc']);
    expect(flags.top).toBe(5);
  });

  test('P9: multi-word positional tokens are joined', () => {
    const { query } = parseRecallArgs(['strong', 'leadership']);
    expect(query).toBe('strong leadership');
  });
});

// ── runRecall ─────────────────────────────────────────────────────────────────

describe('runRecall()', () => {
  test('R1: leadership query returns >=2 results from fixture, empty=false', async () => {
    const result = await runRecall(['leadership']);
    expect(result.empty).toBe(false);
    expect(result.results.length).toBeGreaterThanOrEqual(2);
  });

  test('R2: lines[0] matches numbered-list format', async () => {
    const result = await runRecall(['leadership']);
    expect(result.lines[0]).toMatch(/^1\. \[[A-Z]+\] .+ \(.+\)$/);
  });

  test('R3: missing memory.md returns empty-result shape, no throw', async () => {
    // Temporarily redirect VAULT_ROOT to empty dir, reload module
    process.env.VAULT_ROOT = tmpEmptyRoot;
    jest.resetModules();
    const { runRecall: runRecallEmpty } = require(MODULE_PATH);

    const result = await runRecallEmpty(['anything']);
    expect(result.empty).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.lines).toEqual(['No results matching "anything".']);

    // Restore to tmpRoot for subsequent tests
    process.env.VAULT_ROOT = tmpRoot;
    jest.resetModules();
    ({ parseRecallArgs: parseRecallArgs, runRecall: runRecall } = require(MODULE_PATH));
  });

  test('R4: impossible query returns empty-result shape', async () => {
    const result = await runRecall(['nomatch-zzz-impossible']);
    expect(result.empty).toBe(true);
    expect(result.lines).toEqual(['No results matching "nomatch-zzz-impossible".']);
  });

  test('R5: --top 1 truncates to 1 result', async () => {
    const result = await runRecall(['leadership', '--top', '1']);
    expect(result.results.length).toBe(1);
    expect(result.lines.length).toBe(1);
  });

  test('R6: --category DECISION returns only DECISION entries', async () => {
    const result = await runRecall(['leadership', '--category', 'DECISION']);
    expect(result.empty).toBe(false);
    for (const r of result.results) {
      expect(r.category).toBe('DECISION');
    }
  });

  test('R7: --since 2026-04-01 returns only April entries', async () => {
    const result = await runRecall(['leadership', '--since', '2026-04-01']);
    expect(result.empty).toBe(false);
    for (const r of result.results) {
      expect(r.date >= '2026-04-01').toBe(true);
    }
  });

  test('R8: source refs use sourceRefShort form', async () => {
    const result = await runRecall(['leadership']);
    // Lines should contain short form e.g. "session:abc123de" not full hash
    for (const line of result.lines) {
      // Must not contain a raw session: reference longer than 8 hex chars
      expect(line).not.toMatch(/session:[a-f0-9]{9,}/);
    }
  });

  test('R9: snippets in lines are <=100 characters', async () => {
    const result = await runRecall(['leadership']);
    for (const r of result.results) {
      expect(r.snippet.length).toBeLessThanOrEqual(100);
    }
  });
});

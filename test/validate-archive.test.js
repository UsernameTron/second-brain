'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateArchive } = require('../scripts/validate-archive');

const ENTRY = ({ hash, reason, supersededBy }) => `### 2026-07-01 · LEARNING · file:test

Body text.

category:: LEARNING
content_hash:: ${hash}
archived:: 2026-07-19 · ${reason}
${supersededBy === undefined ? '' : `superseded_by:: ${supersededBy}\n`}`;

function makeVault({ archiveEntries, liveHashes }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'va-test-'));
  fs.mkdirSync(path.join(root, 'memory-archive'), { recursive: true });
  fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(root, 'memory-archive', '2026-07.md'), archiveEntries.map(ENTRY).join('\n'));
  fs.writeFileSync(
    path.join(root, 'memory', 'memory.md'),
    liveHashes.map((h) => `### live\n\nx\n\ncontent_hash:: ${h}\n`).join('\n')
  );
  return root;
}

function withVault(vault, fn) {
  const prev = process.env.VAULT_ROOT;
  process.env.VAULT_ROOT = vault;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.VAULT_ROOT;
    else process.env.VAULT_ROOT = prev;
    fs.rmSync(vault, { recursive: true, force: true });
  }
}

describe('validate-archive', () => {
  test('dangling superseded_by hash fails and names the hash', () => {
    const vault = makeVault({
      archiveEntries: [{ hash: 'aaa111', reason: 'duplicate', supersededBy: 'deadbeef0000' }],
      liveHashes: ['bbb222'],
    });
    const r = withVault(vault, validateArchive);
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toContain('deadbeef0000');
    expect(r.violations[0]).toContain('not found');
  });

  test('missing superseded_by field fails', () => {
    const vault = makeVault({
      archiveEntries: [{ hash: 'aaa111', reason: 'duplicate', supersededBy: undefined }],
      liveHashes: [],
    });
    const r = withVault(vault, validateArchive);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('field missing');
  });

  test("archived as duplicate with superseded_by 'none' fails", () => {
    const vault = makeVault({
      archiveEntries: [{ hash: 'aaa111', reason: 'duplicate', supersededBy: 'none' }],
      liveHashes: [],
    });
    const r = withVault(vault, validateArchive);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain('duplicate but superseded_by:: none');
  });

  test("non-duplicate (seed-data) with 'none' passes; resolving duplicate passes", () => {
    const vault = makeVault({
      archiveEntries: [
        { hash: 'aaa111', reason: 'seed-data', supersededBy: 'none' },
        { hash: 'ccc333', reason: 'duplicate', supersededBy: 'bbb222' },
      ],
      liveHashes: ['bbb222'],
    });
    const r = withVault(vault, validateArchive);
    expect(r.ok).toBe(true);
    expect(r.entries).toBe(2);
  });

  const realArchive = path.join(process.env.HOME, 'Claude Cowork', 'memory-archive');
  // Conditional describe (not a conditional test): jest/no-standalone-expect does not
  // recognize `(cond ? test : test.skip)(...)` as a test block. Same pattern as
  // test/uat/semantic-search.uat.test.js.
  const describeMaybe = fs.existsSync(realArchive) ? describe : describe.skip;
  describeMaybe('live archive', () => {
    test('the current real archive passes', () => {
      const prev = process.env.VAULT_ROOT;
      delete process.env.VAULT_ROOT;
      try {
        const r = validateArchive();
        expect(r.ok).toBe(true);
        expect(r.entries).toBeGreaterThan(0);
      } finally {
        if (prev !== undefined) process.env.VAULT_ROOT = prev;
      }
    });
  });
});

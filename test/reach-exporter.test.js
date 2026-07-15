'use strict';

/**
 * reach-exporter.test.js
 *
 * Tests for src/reach-exporter.js — v1.6 SURFACE-REACH-01 cross-surface reach.
 * Covers: rendering, digest cap + recency, fail-closed exclusion gating,
 * MEMORY.md idempotency, per-target failure isolation, config handling.
 *
 * content-policy is mocked for determinism: BLOCK on the literal marker
 * "BLOCKED-TERM", throw on "GATE-ERROR", PASS otherwise. No network calls.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/content-policy', () => ({
  checkContent: jest.fn(async (content) => {
    if (content.includes('GATE-ERROR')) throw new Error('classifier unavailable');
    if (content.includes('BLOCKED-TERM')) return { decision: 'BLOCK', reason: 'Excluded content detected (term: BLOCKED-TERM)' };
    return { decision: 'PASS' };
  }),
}));

let tmpDir;
let memoryDir;
let targetDir;
let reachExporter;

/** Write a memory.md in the real promoted-entry format. */
function writeMemoryFile(entries) {
  const body = entries
    .map(e => `### ${e.date} · ${e.category} · session:abc\n\n${e.content}\n\ncategory:: ${e.category}\nsource-ref:: session:abc12345\ntags:: test\nadded:: ${e.addedAt || `${e.date}T10:00:00-05:00`}\nrelated:: \ncontent_hash:: hash-${e.date}-${e.category}\n`)
    .join('\n');
  fs.writeFileSync(path.join(memoryDir, 'memory.md'), `## 2026-07\n\n${body}`, 'utf8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-test-'));
  memoryDir = path.join(tmpDir, 'memory');
  targetDir = path.join(tmpDir, 'auto-memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  process.env.VAULT_ROOT = tmpDir;
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');

  jest.resetModules();
  reachExporter = require('../src/reach-exporter');
});

afterEach(() => {
  fs.chmodSync(targetDir, 0o755);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
  delete process.env.CONFIG_DIR_OVERRIDE;
  delete process.env.REACH_TARGETS_OVERRIDE;
  jest.restoreAllMocks();
});

// ── renderReachFile ──────────────────────────────────────────────────────────

describe('renderReachFile', () => {
  const meta = { generatedAt: '2026-07-15T12:00:00.000Z', vaultRoot: '/vault', repoPath: '/repo' };

  test('renders frontmatter, canonical pointer, cache banner, stamp, and query command', () => {
    const out = reachExporter.renderReachFile(
      [{ date: '2026-07-14', category: 'LEARNING', content: 'A promoted fact.' }],
      meta
    );
    expect(out).toMatch(/^---\nname: second-brain-reach\n/);
    expect(out).toContain('metadata:\n  type: reference');
    expect(out).toContain('generated cache');
    expect(out).toContain('the canonical store wins');
    expect(out).toContain('Generated: 2026-07-15T12:00:00.000Z');
    expect(out).toContain('/vault/memory/memory.md');
    expect(out).toContain('node /repo/scripts/recall.js');
    expect(out).toContain('ADR-018');
    expect(out).toContain('- **2026-07-14 · LEARNING** — A promoted fact.');
  });

  test('empty digest renders a placeholder instead of an empty section', () => {
    const out = reachExporter.renderReachFile([], meta);
    expect(out).toContain('(no entries passed the exclusion gate)');
  });
});

// ── updateIndexFile ──────────────────────────────────────────────────────────

describe('updateIndexFile', () => {
  test('creates MEMORY.md with header when absent', () => {
    reachExporter.updateIndexFile(targetDir);
    const index = fs.readFileSync(path.join(targetDir, 'MEMORY.md'), 'utf8');
    expect(index).toMatch(/^# Memory Index\n/);
    expect(index).toContain('](second-brain.md)');
  });

  test('appends to an existing index, preserving other lines', () => {
    fs.writeFileSync(path.join(targetDir, 'MEMORY.md'), '# Memory Index\n\n- [Other](other.md) — unrelated\n', 'utf8');
    reachExporter.updateIndexFile(targetDir);
    const index = fs.readFileSync(path.join(targetDir, 'MEMORY.md'), 'utf8');
    expect(index).toContain('- [Other](other.md) — unrelated');
    expect(index.match(/\]\(second-brain\.md\)/g)).toHaveLength(1);
  });

  test('is idempotent: repeated calls keep exactly one reach line', () => {
    reachExporter.updateIndexFile(targetDir);
    reachExporter.updateIndexFile(targetDir);
    reachExporter.updateIndexFile(targetDir);
    const index = fs.readFileSync(path.join(targetDir, 'MEMORY.md'), 'utf8');
    expect(index.match(/\]\(second-brain\.md\)/g)).toHaveLength(1);
  });

  test('replaces a stale reach line in place', () => {
    fs.writeFileSync(
      path.join(targetDir, 'MEMORY.md'),
      '# Memory Index\n- [Old title](second-brain.md) — stale hook\n- [Other](other.md) — keep\n',
      'utf8'
    );
    reachExporter.updateIndexFile(targetDir);
    const index = fs.readFileSync(path.join(targetDir, 'MEMORY.md'), 'utf8');
    expect(index).not.toContain('stale hook');
    expect(index).toContain('- [Other](other.md) — keep');
    expect(index.match(/\]\(second-brain\.md\)/g)).toHaveLength(1);
  });
});

// ── runReachExport ───────────────────────────────────────────────────────────

describe('runReachExport', () => {
  test('writes the reach file and index line into an existing target', async () => {
    writeMemoryFile([{ date: '2026-07-14', category: 'LEARNING', content: 'A clean promoted fact.' }]);

    const result = await reachExporter.runReachExport({ targets: [targetDir] });

    expect(result.success).toBe(true);
    expect(result.targets).toEqual([{ dir: targetDir, status: 'written' }]);
    expect(result.included).toBe(1);
    expect(result.excluded).toBe(0);

    const reach = fs.readFileSync(path.join(targetDir, 'second-brain.md'), 'utf8');
    expect(reach).toContain('A clean promoted fact.');
    expect(reach).toContain(path.join(tmpDir, 'memory', 'memory.md'));
    expect(fs.readFileSync(path.join(targetDir, 'MEMORY.md'), 'utf8')).toContain('](second-brain.md)');
  });

  test('missing target dir is skipped with a reason, not created', async () => {
    writeMemoryFile([{ date: '2026-07-14', category: 'LEARNING', content: 'Fact.' }]);
    const missing = path.join(tmpDir, 'does-not-exist');

    const result = await reachExporter.runReachExport({ targets: [missing, targetDir] });

    expect(result.success).toBe(true);
    expect(result.targets[0]).toEqual({ dir: missing, status: 'skipped', reason: 'target directory does not exist' });
    expect(result.targets[1].status).toBe('written');
    expect(fs.existsSync(missing)).toBe(false);
  });

  test('unwritable target is skipped non-fatally, other targets still written', async () => {
    writeMemoryFile([{ date: '2026-07-14', category: 'LEARNING', content: 'Fact.' }]);
    const lockedDir = path.join(tmpDir, 'locked');
    fs.mkdirSync(lockedDir);
    fs.chmodSync(lockedDir, 0o555);

    const result = await reachExporter.runReachExport({ targets: [lockedDir, targetDir] });
    fs.chmodSync(lockedDir, 0o755);

    expect(result.success).toBe(true);
    expect(result.targets[0].status).toBe('skipped');
    expect(result.targets[0].reason).toBeTruthy();
    expect(result.targets[1].status).toBe('written');
  });

  test('digest is capped at digestMax, newest entries first', async () => {
    writeMemoryFile([
      { date: '2026-07-10', category: 'LEARNING', content: 'Oldest fact.' },
      { date: '2026-07-12', category: 'DECISION', content: 'Middle fact.' },
      { date: '2026-07-14', category: 'LEARNING', content: 'Newest fact.' },
    ]);

    const result = await reachExporter.runReachExport({ targets: [targetDir], digestMax: 2 });

    expect(result.included).toBe(2);
    const reach = fs.readFileSync(path.join(targetDir, 'second-brain.md'), 'utf8');
    expect(reach).toContain('Newest fact.');
    expect(reach).toContain('Middle fact.');
    expect(reach).not.toContain('Oldest fact.');
    expect(reach.indexOf('Newest fact.')).toBeLessThan(reach.indexOf('Middle fact.'));
  });

  test('exclusion gate: BLOCK verdict excludes the entry (fail-closed)', async () => {
    writeMemoryFile([
      { date: '2026-07-14', category: 'LEARNING', content: 'Contains BLOCKED-TERM architecture details.' },
      { date: '2026-07-13', category: 'LEARNING', content: 'A clean fact.' },
    ]);

    const result = await reachExporter.runReachExport({ targets: [targetDir] });

    expect(result.included).toBe(1);
    expect(result.excluded).toBe(1);
    const reach = fs.readFileSync(path.join(targetDir, 'second-brain.md'), 'utf8');
    expect(reach).not.toContain('BLOCKED-TERM');
    expect(reach).toContain('A clean fact.');
  });

  test('exclusion gate: a thrown gate error excludes the entry (fail-closed)', async () => {
    writeMemoryFile([
      { date: '2026-07-14', category: 'LEARNING', content: 'Triggers GATE-ERROR in the classifier.' },
      { date: '2026-07-13', category: 'LEARNING', content: 'A clean fact.' },
    ]);

    const result = await reachExporter.runReachExport({ targets: [targetDir] });

    expect(result.included).toBe(1);
    expect(result.excluded).toBe(1);
    expect(fs.readFileSync(path.join(targetDir, 'second-brain.md'), 'utf8')).not.toContain('GATE-ERROR');
  });

  test('regenerates wholesale: stale digest content is replaced, not appended', async () => {
    writeMemoryFile([{ date: '2026-07-10', category: 'LEARNING', content: 'First-generation fact.' }]);
    await reachExporter.runReachExport({ targets: [targetDir] });

    writeMemoryFile([{ date: '2026-07-15', category: 'DECISION', content: 'Second-generation fact.' }]);
    await reachExporter.runReachExport({ targets: [targetDir] });

    const reach = fs.readFileSync(path.join(targetDir, 'second-brain.md'), 'utf8');
    expect(reach).toContain('Second-generation fact.');
    expect(reach).not.toContain('First-generation fact.');
  });

  test('missing memory.md yields an empty digest, export still succeeds', async () => {
    const result = await reachExporter.runReachExport({ targets: [targetDir] });
    expect(result.success).toBe(true);
    expect(result.included).toBe(0);
    expect(fs.readFileSync(path.join(targetDir, 'second-brain.md'), 'utf8')).toContain('(no entries passed the exclusion gate)');
  });

  test('REACH_TARGETS_OVERRIDE env is honored when options.targets is absent', async () => {
    writeMemoryFile([{ date: '2026-07-14', category: 'LEARNING', content: 'Env-target fact.' }]);
    process.env.REACH_TARGETS_OVERRIDE = targetDir;

    const result = await reachExporter.runReachExport();

    expect(result.targets).toEqual([{ dir: targetDir, status: 'written' }]);
  });

  test('enabled:false config disables the export', async () => {
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(configDir, 'reach-targets.json'), JSON.stringify({ enabled: false, digestMax: 10, targets: [] }), 'utf8');
    fs.copyFileSync(path.join(__dirname, '..', 'config', 'excluded-terms.json'), path.join(configDir, 'excluded-terms.json'));
    process.env.CONFIG_DIR_OVERRIDE = configDir;
    jest.resetModules();
    const exporter = require('../src/reach-exporter');

    const result = await exporter.runReachExport({ targets: [targetDir] });

    expect(result.disabled).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'second-brain.md'))).toBe(false);
  });

  test('unreadable config returns a non-fatal error result', async () => {
    const emptyConfigDir = path.join(tmpDir, 'empty-config');
    fs.mkdirSync(emptyConfigDir);
    process.env.CONFIG_DIR_OVERRIDE = emptyConfigDir;
    jest.resetModules();
    const exporter = require('../src/reach-exporter');

    const result = await exporter.runReachExport({ targets: [targetDir] });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/reach-targets config/);
    expect(result.targets).toEqual([]);
  });
});

// ── Branch coverage: failure paths, env override edge cases, ordering ────────

describe('runReachExport edge cases', () => {
  test('unreadable memory.md (a directory) returns a non-fatal error result', async () => {
    fs.mkdirSync(path.join(memoryDir, 'memory.md')); // read → EISDIR
    const result = await reachExporter.runReachExport({ targets: [targetDir] });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to read memory\.md/);
    expect(result.targets).toEqual([]);
  });

  test('empty REACH_TARGETS_OVERRIDE means zero targets (test-isolation hatch)', async () => {
    writeMemoryFile([{ date: '2026-07-14', category: 'LEARNING', content: 'Fact.' }]);
    process.env.REACH_TARGETS_OVERRIDE = '';

    const result = await reachExporter.runReachExport();

    expect(result.success).toBe(true);
    expect(result.targets).toEqual([]);
    expect(fs.existsSync(path.join(targetDir, 'second-brain.md'))).toBe(false);
  });

  test('~ and ~/ target paths are expanded against the home directory', async () => {
    writeMemoryFile([{ date: '2026-07-14', category: 'LEARNING', content: 'Fact.' }]);
    const bogus = '~/nonexistent-reach-test-dir-xyz';

    const result = await reachExporter.runReachExport({ targets: ['~', bogus] });

    // '~' expands to the real home dir — assert expansion only, then confirm
    // nothing was written there (no MEMORY.md/second-brain.md at $HOME root
    // is not guaranteed, so use a throwaway existing dir instead for writes).
    expect(result.targets[1].dir).toBe(path.join(os.homedir(), 'nonexistent-reach-test-dir-xyz'));
    expect(result.targets[1].status).toBe('skipped');
    expect(result.targets[0].dir).toBe(os.homedir());
  });

  test('same-date entries order by added timestamp, identical stamps keep file order', async () => {
    writeMemoryFile([
      { date: '2026-07-14', category: 'A', content: 'Same-stamp first.', addedAt: '2026-07-14T09:00:00-05:00' },
      { date: '2026-07-14', category: 'B', content: 'Same-stamp second.', addedAt: '2026-07-14T09:00:00-05:00' },
      { date: '2026-07-14', category: 'C', content: 'Later add wins.', addedAt: '2026-07-14T18:00:00-05:00' },
    ]);

    await reachExporter.runReachExport({ targets: [targetDir], digestMax: 3 });

    const reach = fs.readFileSync(path.join(targetDir, 'second-brain.md'), 'utf8');
    expect(reach.indexOf('Later add wins.')).toBeLessThan(reach.indexOf('Same-stamp first.'));
    expect(reach.indexOf('Same-stamp first.')).toBeLessThan(reach.indexOf('Same-stamp second.'));
  });
});

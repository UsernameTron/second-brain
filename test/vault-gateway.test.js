'use strict';

/**
 * vault-gateway.test.js
 *
 * Unit tests for src/vault-gateway.js.
 * Write/mkdir operations are mocked via jest.spyOn after module load.
 * Config files loaded from real config/ directory (project files, not vault files).
 */

const path = require('path');

// ── Load module under test ──────────────────────────────────────────────────
// Load BEFORE mocking fs.promises to allow synchronous readFileSync in loadConfig()
const gateway = require('../src/vault-gateway');
const fs = require('fs');

const {
  VaultWriteError,
  normalizePath,
  checkPath,
  vaultWrite,
  vaultRead,
  quarantine,
  toWikilink,
  toQualifiedWikilink,
  bootstrapVault,
  getConfig,
  validateConfig,
  logDecision,
  VAULT_ROOT,
} = gateway;

// ── Setup fs.promises mocks ──────────────────────────────────────────────────
let writeFileMock;
let mkdirMock;
let readFileMock;
let realpathSyncMock;

beforeEach(() => {
  writeFileMock = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
  mkdirMock = jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
  readFileMock = jest.spyOn(fs.promises, 'readFile').mockResolvedValue('mock file content');
  // realpathSync: default returns path unchanged (no symlink escape)
  realpathSyncMock = jest.spyOn(fs, 'realpathSync').mockImplementation((p) => p);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── 1. Config loading ────────────────────────────────────────────────────────
describe('1. Config loading', () => {
  test('getConfig() returns object with left, right, excludedTerms arrays', () => {
    const config = getConfig();
    expect(config).toHaveProperty('left');
    expect(config).toHaveProperty('right');
    expect(config).toHaveProperty('excludedTerms');
    expect(Array.isArray(config.left)).toBe(true);
    expect(Array.isArray(config.right)).toBe(true);
    expect(Array.isArray(config.excludedTerms)).toBe(true);
  });

  test('config.left includes "ABOUT ME"', () => {
    expect(getConfig().left).toContain('ABOUT ME');
  });

  test('config.right includes "proposals"', () => {
    expect(getConfig().right).toContain('proposals');
  });

  test('config.excludedTerms includes "ISPN"', () => {
    expect(getConfig().excludedTerms).toContain('ISPN');
  });
});

// ── 2. Config validation ─────────────────────────────────────────────────────
describe('2. Config validation', () => {
  test('validateConfig throws on empty right array', () => {
    expect(() => {
      validateConfig({ left: ['ABOUT ME'], right: [], excludedTerms: ['ISPN'] });
    }).toThrow(/right.*non-empty/);
  });

  test('validateConfig throws on non-array left', () => {
    expect(() => {
      validateConfig({ left: 'ABOUT ME', right: ['memory'], excludedTerms: ['ISPN'] });
    }).toThrow();
  });

  test('validateConfig throws when entry appears in both left and right arrays', () => {
    expect(() => {
      validateConfig({
        left: ['ABOUT ME', 'memory'],
        right: ['memory', 'briefings'],
        excludedTerms: ['ISPN'],
      });
    }).toThrow(/appears in both left and right/);
  });

  test('validateConfig passes for valid config', () => {
    expect(() => {
      validateConfig({
        left: ['ABOUT ME', 'Daily'],
        right: ['memory', 'briefings'],
        excludedTerms: ['ISPN'],
      });
    }).not.toThrow();
  });
});

// ── 3. Path normalization — valid paths ──────────────────────────────────────
describe('3. Path normalization — valid paths', () => {
  test('normalizePath("memory/test.md") returns "memory/test.md"', () => {
    expect(normalizePath('memory/test.md')).toBe('memory/test.md');
  });

  test('normalizePath("memory/sub/test.md") returns "memory/sub/test.md"', () => {
    expect(normalizePath('memory/sub/test.md')).toBe('memory/sub/test.md');
  });
});

// ── 4. Path normalization — absolute path rejection ──────────────────────────
describe('4. Path normalization — absolute path rejection', () => {
  test('normalizePath("/memory/test.md") throws VaultWriteError with code INVALID_PATH', () => {
    let caught;
    try { normalizePath('/memory/test.md'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(VaultWriteError);
    expect(caught.code).toBe('INVALID_PATH');
    expect(caught.message).toMatch(/Absolute paths are not allowed/);
  });

  test('normalizePath("/etc/passwd") throws VaultWriteError with code INVALID_PATH', () => {
    let caught;
    try { normalizePath('/etc/passwd'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(VaultWriteError);
    expect(caught.code).toBe('INVALID_PATH');
  });
});

// ── 5. Path normalization — traversal rejection ──────────────────────────────
describe('5. Path normalization — traversal rejection', () => {
  test('normalizePath("memory/../ABOUT ME/secret.md") throws INVALID_PATH', () => {
    let caught;
    try { normalizePath('memory/../ABOUT ME/secret.md'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(VaultWriteError);
    expect(caught.code).toBe('INVALID_PATH');
  });

  test('normalizePath("../outside-vault.md") throws INVALID_PATH', () => {
    let caught;
    try { normalizePath('../outside-vault.md'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(VaultWriteError);
    expect(caught.code).toBe('INVALID_PATH');
  });
});

// ── 6. Path guard (checkPath) ────────────────────────────────────────────────
describe('6. Path guard (checkPath)', () => {
  let config;
  beforeAll(() => { config = getConfig(); });

  test('checkPath("memory/note.md") returns PASS', () => {
    expect(checkPath('memory/note.md', config)).toMatchObject({ decision: 'PASS' });
  });

  test('checkPath("proposals/quarantine-2026.md") returns PASS', () => {
    expect(checkPath('proposals/quarantine-2026.md', config)).toMatchObject({ decision: 'PASS' });
  });

  test('checkPath("ABOUT ME/about-me.md") returns BLOCK (LEFT side — no writes)', () => {
    const result = checkPath('ABOUT ME/about-me.md', config);
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBeTruthy();
  });

  test('checkPath("random-folder/file.md") returns BLOCK (unknown path per D-04)', () => {
    const result = checkPath('random-folder/file.md', config);
    expect(result.decision).toBe('BLOCK');
  });

  test('checkPath("Memory/note.md") returns BLOCK — case-variant fail-safe on case-insensitive FS', () => {
    // macOS APFS is case-insensitive but case-preserving.
    // "Memory/" does NOT match "memory" in config.right — intentionally fail-safe.
    // A case-variant path will never accidentally gain write access.
    const result = checkPath('Memory/note.md', config);
    expect(result.decision).toBe('BLOCK');
  });

  test('checkPath("MEMORY/note.md") returns BLOCK — uppercase case-variant blocked', () => {
    const result = checkPath('MEMORY/note.md', config);
    expect(result.decision).toBe('BLOCK');
  });
});

// ── 7. vaultWrite path enforcement ──────────────────────────────────────────
describe('7. vaultWrite path enforcement', () => {
  test('vaultWrite("memory/test.md", ...) succeeds for RIGHT-side path', async () => {
    const result = await vaultWrite('memory/test.md', 'Hello vault');
    expect(result.decision).toBe('WRITTEN');
    expect(result.path).toBe('memory/test.md');
    expect(writeFileMock).toHaveBeenCalled();
  });

  test('vaultWrite("ABOUT ME/test.md", ...) throws VaultWriteError PATH_BLOCKED', async () => {
    let caught;
    try { await vaultWrite('ABOUT ME/test.md', 'content'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(VaultWriteError);
    expect(caught.code).toBe('PATH_BLOCKED');
  });

  test('vaultWrite("unknown/test.md", ...) throws VaultWriteError PATH_BLOCKED', async () => {
    let caught;
    try { await vaultWrite('unknown/test.md', 'content'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(VaultWriteError);
    expect(caught.code).toBe('PATH_BLOCKED');
  });
});

// ── 8. vaultRead three-tier enforcement (D-04) ───────────────────────────────
describe('8. vaultRead three-tier enforcement (D-04)', () => {
  test('vaultRead("memory/test.md") succeeds — RIGHT side read allowed', async () => {
    readFileMock.mockResolvedValue('file content');
    const content = await vaultRead('memory/test.md');
    expect(content).toBe('file content');
    expect(readFileMock).toHaveBeenCalled();
  });

  test('vaultRead("ABOUT ME/about-me.md") succeeds — LEFT side read allowed', async () => {
    readFileMock.mockResolvedValue('about me content');
    const content = await vaultRead('ABOUT ME/about-me.md');
    expect(content).toBe('about me content');
  });

  test('vaultRead("random-folder/file.md") throws — unknown path blocked', async () => {
    let caught;
    try { await vaultRead('random-folder/file.md'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(VaultWriteError);
    expect(caught.code).toBe('PATH_BLOCKED');
  });
});

// ── 9. Redacted quarantine ───────────────────────────────────────────────────
describe('9. Redacted quarantine', () => {
  test('quarantine writes metadata-only file to proposals/', async () => {
    const result = await quarantine('memory/note.md', 'test reason');
    expect(result.decision).toBe('QUARANTINED');
    expect(result.quarantinePath).toMatch(/proposals[/\\]quarantine-/);
    expect(writeFileMock).toHaveBeenCalled();
  });

  test('quarantine file contains required frontmatter fields', async () => {
    await quarantine('memory/note.md', 'excluded content detected');
    const [, content] = writeFileMock.mock.calls[0];
    expect(content).toMatch(/quarantine: true/);
    expect(content).toMatch(/original_path: memory\/note\.md/);
    expect(content).toMatch(/reason: excluded content detected/);
  });

  test('quarantine file does NOT store blocked content — metadata only', async () => {
    // quarantine() takes (originalPath, reason) — no content parameter
    // The function should ONLY write metadata, never any blocked content payload
    await quarantine('memory/note.md', 'blocked');
    const [, writtenContent] = writeFileMock.mock.calls[0];
    // Verify the human-readable notice is present (confirms metadata-only design)
    expect(writtenContent).toContain('Content was blocked and not written to disk');
    // Verify no unexpected content beyond what quarantine itself generates
    expect(writtenContent).toMatch(/quarantine: true/);
  });

  test('quarantine function accepts 2 parameters (originalPath, reason) — no content param', () => {
    // Verify function signature has at most 2 named parameters
    expect(quarantine.length).toBeLessThanOrEqual(2);
  });
});

// ── 10. Wikilink utility ─────────────────────────────────────────────────────
describe('10. Wikilink utility', () => {
  test('toWikilink("Daily Note") returns "[[Daily Note]]"', () => {
    expect(toWikilink('Daily Note')).toBe('[[Daily Note]]');
  });

  test('toWikilink("Daily Note", "today") returns "[[Daily Note|today]]"', () => {
    expect(toWikilink('Daily Note', 'today')).toBe('[[Daily Note|today]]');
  });

  test('toQualifiedWikilink("memory", "Daily Note") returns "[[memory/Daily Note]]"', () => {
    expect(toQualifiedWikilink('memory', 'Daily Note')).toBe('[[memory/Daily Note]]');
  });

  test('toQualifiedWikilink("memory", "Daily Note", "today") returns "[[memory/Daily Note|today]]"', () => {
    expect(toQualifiedWikilink('memory', 'Daily Note', 'today')).toBe('[[memory/Daily Note|today]]');
  });
});

// ── 11. Config-driven bootstrap ──────────────────────────────────────────────
describe('11. Config-driven bootstrap', () => {
  test('bootstrapVault creates directories for each entry in config.right', async () => {
    const config = getConfig();
    await bootstrapVault();
    expect(mkdirMock.mock.calls.length).toBeGreaterThanOrEqual(config.right.length);
  });

  test('bootstrapVault does NOT create LEFT-side directories', async () => {
    await bootstrapVault();
    const dirPaths = mkdirMock.mock.calls.map(([p]) => p);
    // LEFT-side directories should NOT be created
    const leftDirs = ['ABOUT ME', 'Daily', 'Relationships', 'Drafts'];
    for (const leftDir of leftDirs) {
      expect(dirPaths.some(p => p.includes(path.sep + leftDir))).toBe(false);
    }
  });

  test('bootstrapVault reads directories from config.right, not a hardcoded list', async () => {
    const config = getConfig();
    await bootstrapVault();
    // Exactly one mkdir call per right-side directory (config-driven, not hardcoded)
    expect(mkdirMock.mock.calls.length).toBe(config.right.length);
  });
});

// ── 12. VAULT_ROOT env override ──────────────────────────────────────────────
describe('12. VAULT_ROOT env override', () => {
  test('VAULT_ROOT falls back to ~/Claude Cowork when env var not set', () => {
    const expectedDefault = path.join(process.env.HOME, 'Claude Cowork');
    expect(VAULT_ROOT).toBe(expectedDefault);
  });

  test('VAULT_ROOT env override is documented in module source', () => {
    // Verify the module source contains the env var override logic
    const source = fs.readFileSync(
      path.join(__dirname, '../src/vault-gateway.js'), 'utf8'
    );
    expect(source).toMatch(/process\.env\.VAULT_ROOT/);
  });
});

// ── 13. Audit logging ────────────────────────────────────────────────────────
describe('13. Audit logging', () => {
  test('logDecision is a function exported from vault-gateway', () => {
    expect(typeof logDecision).toBe('function');
  });

  test('logDecision writes structured JSON to stderr via console.error', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    logDecision('WRITE', 'memory/test.md', 'WRITTEN', null);

    expect(consoleSpy).toHaveBeenCalled();
    const [logArg] = consoleSpy.mock.calls[0];
    const parsed = JSON.parse(logArg);
    expect(parsed).toHaveProperty('ts');
    expect(parsed).toHaveProperty('action', 'WRITE');
    expect(parsed).toHaveProperty('path', 'memory/test.md');
    expect(parsed).toHaveProperty('decision', 'WRITTEN');
    expect(parsed).not.toHaveProperty('content');

    consoleSpy.mockRestore();
  });

  test('audit log does not include content payload on BLOCK decisions', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Trigger a BLOCK decision (LEFT-side write) — should log metadata, not content
    try {
      await vaultWrite('ABOUT ME/secret.md', 'THIS SECRET MUST NOT APPEAR IN LOGS');
    } catch (_) {}

    const allLogOutput = consoleSpy.mock.calls.map(([s]) => s).join(' ');
    expect(allLogOutput).not.toContain('THIS SECRET MUST NOT APPEAR IN LOGS');

    consoleSpy.mockRestore();
  });
});

'use strict';

/**
 * integration.test.js
 *
 * Real-filesystem integration tests for the full three-gate vault pipeline.
 * Writes to a temp directory via VAULT_ROOT env var override (Plan 01).
 * Only the Anthropic SDK is mocked — all fs operations are real.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Mock only the Anthropic SDK ───────────────────────────────────────────────
jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn().mockResolvedValue({
    content: [{ text: 'ALLOW' }],
  });
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

// ── Integration test suite ────────────────────────────────────────────────────
describe('Integration: real-filesystem three-gate pipeline', () => {
  let tempDir;
  let originalVaultRoot;

  beforeAll(() => {
    // Save original VAULT_ROOT
    originalVaultRoot = process.env.VAULT_ROOT;

    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));

    // Set VAULT_ROOT to temp directory BEFORE requiring the gateway
    process.env.VAULT_ROOT = tempDir;

    // Create RIGHT-side subdirectories
    fs.mkdirSync(path.join(tempDir, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'proposals'), { recursive: true });

    // Create LEFT-side ABOUT ME directory with mock style guide
    fs.mkdirSync(path.join(tempDir, 'ABOUT ME'), { recursive: true });
    const mockStyleGuide = `# Anti-AI Writing Style Guide

## Banned Words — Never Use These

| Word/Phrase | Why Banned |
|---|---|
| genuinely | Filler |
| synergy | Corporate rot |
`;
    fs.writeFileSync(
      path.join(tempDir, 'ABOUT ME', 'anti-ai-writing-style.md'),
      mockStyleGuide,
      'utf8'
    );
  });

  afterAll(() => {
    // Restore VAULT_ROOT
    if (originalVaultRoot !== undefined) {
      process.env.VAULT_ROOT = originalVaultRoot;
    } else {
      delete process.env.VAULT_ROOT;
    }

    // Remove temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  // We must require AFTER setting VAULT_ROOT
  // Jest module cache means we need to use jest.isolateModules or require inline
  // Use a lazy require pattern with jest.resetModules
  let vaultWrite, VaultWriteError;

  beforeAll(() => {
    // Reset module cache so VAULT_ROOT env var takes effect
    jest.resetModules();

    // Re-mock SDK after resetModules
    jest.mock('@anthropic-ai/sdk', () => {
      const mockCreate = jest.fn().mockResolvedValue({
        content: [{ text: 'ALLOW' }],
      });
      return jest.fn().mockImplementation(() => ({
        messages: { create: mockCreate },
      }));
    });

    // Now require gateway with new VAULT_ROOT in effect
    const gateway = require('../src/vault-gateway');
    vaultWrite = gateway.vaultWrite;
    VaultWriteError = gateway.VaultWriteError;
  });

  // Test A: Write clean content to RIGHT side
  test('A: writes clean content to memory/ on real filesystem', async () => {
    const targetPath = path.join(tempDir, 'memory', 'test-clean.md');

    const result = await vaultWrite('memory/test-clean.md', '# Clean Note\n\nThis is direct, clear content.');
    expect(result.decision).toBe('WRITTEN');

    // Verify file actually exists on disk
    expect(fs.existsSync(targetPath)).toBe(true);
    const written = fs.readFileSync(targetPath, 'utf8');
    expect(written).toContain('Clean Note');
  });

  // Test B: Write content with banned word — must throw, file must not exist
  test('B: rejects content with banned word — file does NOT exist on disk', async () => {
    const targetPath = path.join(tempDir, 'memory', 'test-banned.md');

    // Ensure file doesn't exist before test
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);

    let caught;
    try {
      await vaultWrite('memory/test-banned.md', 'This is genuinely great content', { attemptCount: 0 });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(caught).toBeInstanceOf(VaultWriteError);
    expect(caught.code).toBe('STYLE_VIOLATION');

    // File must NOT exist on disk
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  // Test C: Attempt write to LEFT path — must throw, file must not exist
  test('C: blocks write to LEFT-side ABOUT ME/ — file does NOT exist on disk', async () => {
    const targetPath = path.join(tempDir, 'ABOUT ME', 'test.md');

    let caught;
    try {
      await vaultWrite('ABOUT ME/test.md', 'This should be blocked');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(caught).toBeInstanceOf(VaultWriteError);
    expect(caught.code).toBe('PATH_BLOCKED');

    // File must NOT exist on disk (the pre-existing style guide should not be overwritten)
    expect(fs.existsSync(targetPath)).toBe(false);
  });
});

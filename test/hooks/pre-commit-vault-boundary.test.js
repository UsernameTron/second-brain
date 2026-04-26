'use strict';

/**
 * pre-commit-vault-boundary.test.js
 *
 * Tests for hooks/pre-commit-vault-boundary.js
 *
 * Tests the boundary checking logic by importing the core function directly.
 * Uses config/vault-paths.json LEFT/RIGHT arrays.
 */

const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

const { checkVaultBoundary } = require('../../hooks/pre-commit-vault-boundary');

// Load actual vault-paths.json for reference
const vaultPaths = require(path.join(PROJECT_ROOT, 'config', 'vault-paths.json'));

// ── Test 1: RIGHT-side paths pass ─────────────────────────────────────────────

describe('pre-commit-vault-boundary: RIGHT-side paths', () => {
  test('passes for a file in a RIGHT-side directory', () => {
    // 'RIGHT' is in the right array
    const result = checkVaultBoundary(['RIGHT/daily-stats.md'], vaultPaths);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  test('passes for a nested file in a RIGHT-side directory', () => {
    const result = checkVaultBoundary(['memory/notes.md'], vaultPaths);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });
});

// ── Test 2: LEFT-side paths are blocked ───────────────────────────────────────

describe('pre-commit-vault-boundary: LEFT-side paths are blocked', () => {
  test('blocks a file in the ABOUT ME directory', () => {
    const result = checkVaultBoundary(['ABOUT ME/identity.md'], vaultPaths);
    expect(result.exitCode).toBe(1);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatch(/ABOUT ME/);
    expect(result.violations[0]).toMatch(/vault boundary violation/i);
  });

  test('blocks multiple LEFT-side files', () => {
    const files = ['ABOUT ME/bio.md', 'Daily/2026-04-26.md'];
    const result = checkVaultBoundary(files, vaultPaths);
    expect(result.exitCode).toBe(1);
    expect(result.violations).toHaveLength(2);
  });

  test('error message contains the LEFT path segment name', () => {
    const result = checkVaultBoundary(['Relationships/contacts.md'], vaultPaths);
    expect(result.exitCode).toBe(1);
    expect(result.violations[0]).toMatch(/Relationships/);
  });
});

// ── Test 3: Non-vault repo files are ignored ──────────────────────────────────

describe('pre-commit-vault-boundary: non-vault files pass through', () => {
  test('ignores src/ files', () => {
    const result = checkVaultBoundary(['src/vault-gateway.js'], vaultPaths);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  test('ignores .planning/ files', () => {
    const result = checkVaultBoundary(['.planning/STATE.md'], vaultPaths);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  test('ignores config/ files', () => {
    const result = checkVaultBoundary(['config/pipeline.json'], vaultPaths);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  test('returns exitCode 0 for empty file list', () => {
    const result = checkVaultBoundary([], vaultPaths);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });
});

// ── Test 4: Missing vault-paths or empty config is a no-op ───────────────────

describe('pre-commit-vault-boundary: graceful degradation', () => {
  test('passes all files when vaultPaths is empty/null', () => {
    // When vault config is unavailable, the hook should be a no-op
    const result = checkVaultBoundary(['ABOUT ME/identity.md'], { left: [], right: [] });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  test('passes all files when left array is missing', () => {
    const result = checkVaultBoundary(['ABOUT ME/identity.md'], { right: ['RIGHT'] });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });
});

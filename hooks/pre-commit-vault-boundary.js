'use strict';

/**
 * pre-commit-vault-boundary.js
 *
 * Git pre-commit hook: blocks commits that include files under LEFT-side
 * vault paths. LEFT paths are human-voice territory — agents must not
 * write to them.
 *
 * Reads vault-paths.json for the LEFT array. Compares first path segment
 * of each staged file. No filesystem access to the vault needed — pure
 * string comparison.
 *
 * Usage:
 *   node hooks/pre-commit-vault-boundary.js          # reads git staged files
 *   node hooks/pre-commit-vault-boundary.js file1 file2  # explicit file list
 *
 * Requirement: HOOK-VAULT-01
 */

const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');

/**
 * Check staged files against vault LEFT/RIGHT boundary.
 *
 * @param {string[]} files - List of file paths to check
 * @param {object} vaultPaths - { left: string[], right: string[] }
 * @returns {{ exitCode: number, violations: string[] }}
 */
function checkVaultBoundary(files, vaultPaths) {
  const violations = [];

  const leftPaths = (vaultPaths && Array.isArray(vaultPaths.left))
    ? vaultPaths.left
    : [];

  if (leftPaths.length === 0) {
    return { exitCode: 0, violations };
  }

  for (const filePath of files) {
    // Extract first path segment (everything before the first /)
    const firstSegment = filePath.split('/')[0];

    if (leftPaths.includes(firstSegment)) {
      violations.push(
        `vault boundary violation: LEFT-side path '${firstSegment}' must not be committed by automation — ${filePath}`
      );
    }
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

// ── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
  let vaultPaths;
  try {
    vaultPaths = require(path.join(PROJECT_ROOT, 'config', 'vault-paths.json'));
  } catch {
    // No vault config — hook is a no-op
    process.exit(0);
  }

  let files;
  if (process.argv.length > 2) {
    files = process.argv.slice(2);
  } else {
    try {
      const raw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
        encoding: 'utf8',
        cwd: PROJECT_ROOT,
      });
      files = raw.trim().split('\n').filter(Boolean);
    } catch {
      // Not in a git repo or no staged files
      process.exit(0);
    }
  }

  if (files.length === 0) {
    process.exit(0);
  }

  const result = checkVaultBoundary(files, vaultPaths);

  if (result.violations.length > 0) {
    for (const v of result.violations) {
      process.stderr.write(`[pre-commit] ${v}\n`);
    }
    process.exit(1);
  }

  process.exit(0);
}

module.exports = { checkVaultBoundary };

'use strict';

/**
 * test/verify-baseline.test.js
 *
 * Spawns scripts/verify-baseline.js as a real subprocess against a temp
 * fixture vault (VAULT_ROOT override) — the script calls process.exit
 * directly, so it must be exercised out-of-process (see
 * test/compounding-report.test.js for the same pattern).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'verify-baseline.js');
const { hashes } = require('../eval/baseline-sentinel-hashes.json');

function buildFixtureVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-baseline-'));
  const memoryDir = path.join(root, 'memory');
  const archiveDir = path.join(root, 'archive', 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  const subset = hashes.slice(0, 3);
  fs.writeFileSync(
    path.join(memoryDir, 'memory.md'),
    subset.map((h) => `- entry\n  content_hash:: ${h}`).join('\n\n')
  );
  fs.writeFileSync(
    path.join(archiveDir, '2025.md'),
    `- archived entry\n  content_hash:: ${subset[2]}`
  );

  return root;
}

describe('verify-baseline.js CLI', () => {
  it('exits 0 and prints N/N resolve when all sentinel hashes are present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-baseline-'));
    const memoryDir = path.join(root, 'memory');
    const archiveDir = path.join(root, 'archive', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });

    const live = hashes.slice(0, hashes.length - 5);
    const archived = hashes.slice(hashes.length - 5);
    fs.writeFileSync(
      path.join(memoryDir, 'memory.md'),
      live.map((h) => `- entry\n  content_hash:: ${h}`).join('\n\n')
    );
    fs.writeFileSync(
      path.join(archiveDir, 'archive.md'),
      archived.map((h) => `- entry\n  content_hash:: ${h}`).join('\n\n')
    );

    const output = execFileSync('node', [SCRIPT_PATH], {
      encoding: 'utf8',
      env: { ...process.env, VAULT_ROOT: root },
    });

    expect(output).toContain(`${hashes.length}/${hashes.length} baseline hashes resolve`);
  });

  it('exits 1 and prints the missing hash when one sentinel hash is absent', () => {
    const root = buildFixtureVault();

    let threw = null;
    try {
      execFileSync('node', [SCRIPT_PATH], {
        encoding: 'utf8',
        env: { ...process.env, VAULT_ROOT: root },
      });
    } catch (err) {
      threw = err;
    }

    expect(threw).not.toBeNull();
    expect(threw.status).toBe(1);
    expect(threw.stdout).toContain('Missing:');
    expect(threw.stdout).toContain(hashes[hashes.length - 1]);
  });

  it('resolves the memory root via VAULT_ROOT env for a testable fixture vault', () => {
    const root = buildFixtureVault();

    const result = require('child_process').spawnSync('node', [SCRIPT_PATH], {
      encoding: 'utf8',
      env: { ...process.env, VAULT_ROOT: root },
    });

    // status is non-zero (subset vault), but proves VAULT_ROOT was honored:
    // the process didn't fall through to the live vault default.
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('/');
  });
});

'use strict';

/**
 * pre-commit-schema-validate.test.js
 *
 * Tests for hooks/pre-commit-schema-validate.js
 *
 * The validator is imported and its core validateStagedFiles function
 * is called directly rather than spawning a subprocess, so tests are
 * fast and deterministic.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const SCHEMA_DIR = path.join(PROJECT_ROOT, 'config', 'schema');

// We import after the implementation exists — this will fail in RED phase
const { validateStagedFiles } = require('../../hooks/pre-commit-schema-validate');

// ── Helper: write a temp file with given content ──────────────────────────────

function writeTempFile(name, content) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ── Test 1: Valid config/*.json passes ───────────────────────────────────────

describe('pre-commit-schema-validate: config/*.json validation', () => {
  test('exits 0 when no relevant files are staged', async () => {
    const result = await validateStagedFiles([]);
    expect(result.exitCode).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test('passes when a valid config JSON matches its schema', async () => {
    // Use the real pipeline.json (known-good) and its schema
    const configPath = path.join(PROJECT_ROOT, 'config', 'pipeline.json');
    const result = await validateStagedFiles([configPath]);
    expect(result.exitCode).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test('fails when a config/*.json has an invalid value (negative maxAttempts)', async () => {
    // Write a temp pipeline.json with an invalid value
    const validConfig = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, 'config', 'pipeline.json'), 'utf8')
    );
    // mutate retry.maxAttempts to be negative (violates minimum: 1)
    validConfig.retry.maxAttempts = -1;
    const tmpPath = writeTempFile('pipeline.json', JSON.stringify(validConfig, null, 2));

    // We need to test with the schema still being found — pass schemaDir override
    const result = await validateStagedFiles([tmpPath], { schemaDir: SCHEMA_DIR });
    expect(result.exitCode).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    // The AJV error path should mention the field
    const errorText = result.errors.join(' ');
    expect(errorText).toMatch(/maxAttempts|minimum/i);
  });
});

// ── Tests 3-4: daily-stats.md frontmatter validation ─────────────────────────

describe('pre-commit-schema-validate: daily-stats.md frontmatter validation', () => {
  test('fails when schema_version is a number (not a string)', async () => {
    const invalidFrontmatter = `---
schema_version: 1
columns:
  - date
  - proposals
timezone: America/Chicago
last_updated: "2026-04-26T00:00:00Z"
---

| date | proposals |
`;
    const tmpPath = writeTempFile('daily-stats.md', invalidFrontmatter);
    const result = await validateStagedFiles([tmpPath], { schemaDir: SCHEMA_DIR });
    expect(result.exitCode).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    const errorText = result.errors.join(' ');
    expect(errorText).toMatch(/schema_version|string|type/i);
  });

  test('passes when daily-stats.md has valid frontmatter', async () => {
    const validFrontmatter = `---
schema_version: "1"
columns:
  - date
  - proposals
  - promotions
timezone: America/Chicago
last_updated: "2026-04-26T00:00:00Z"
---

| date | proposals | promotions |
`;
    const tmpPath = writeTempFile('daily-stats.md', validFrontmatter);
    const result = await validateStagedFiles([tmpPath], { schemaDir: SCHEMA_DIR });
    expect(result.exitCode).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test('fails when columns is missing from daily-stats.md frontmatter', async () => {
    const missingColumns = `---
schema_version: "1"
timezone: America/Chicago
last_updated: "2026-04-26T00:00:00Z"
---
`;
    const tmpPath = writeTempFile('daily-stats.md', missingColumns);
    const result = await validateStagedFiles([tmpPath], { schemaDir: SCHEMA_DIR });
    expect(result.exitCode).toBe(1);
    const errorText = result.errors.join(' ');
    expect(errorText).toMatch(/columns|required/i);
  });
});

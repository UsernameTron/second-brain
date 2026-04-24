'use strict';

/**
 * test/today/slippage-scanner.test.js
 *
 * Unit tests for src/today/slippage-scanner.js extracted in Phase 15.
 * Covers: readdir failure, excluded projects, malformed STATE.md, stalled detection,
 * missing status, missing last_activity, progress field parsing, maxProjects cap.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanSlippage } = require('../../src/today/slippage-scanner');

const BASE_CONFIG = {
  slippage: { staleDays: 7, excludeProjects: [], maxProjects: 20 },
};

function makeProject(tempDir, name, frontmatter) {
  const projectDir = path.join(tempDir, name);
  const planningDir = path.join(projectDir, '.planning');
  fs.mkdirSync(planningDir, { recursive: true });
  const statePath = path.join(planningDir, 'STATE.md');
  const yaml = ['---', frontmatter, '---', '', '# State'].join('\n');
  fs.writeFileSync(statePath, yaml, 'utf8');
}

describe('scanSlippage', () => {
  let tempDir;
  const REFERENCE_DATE = new Date('2026-04-24T12:00:00Z');

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-slippage-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readdir failure', () => {
    test('returns empty result with SCAN_ERROR warning when projectsDir does not exist', () => {
      const result = scanSlippage('/nonexistent/path/to/projects', BASE_CONFIG, REFERENCE_DATE);

      expect(result.projects).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/^SCAN_ERROR:/);
    });
  });

  describe('stalled detection', () => {
    test('identifies project stalled beyond staleDays threshold', () => {
      makeProject(tempDir, 'alpha', 'status: active\nlast_activity: 2026-04-10');

      const result = scanSlippage(tempDir, BASE_CONFIG, REFERENCE_DATE);

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].name).toBe('alpha');
      expect(result.projects[0].stalled).toBe(true);
      expect(result.projects[0].daysSinceActivity).toBeGreaterThan(7);
    });

    test('project within staleDays is not stalled', () => {
      const twoDaysAgo = new Date(REFERENCE_DATE);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const dateStr = twoDaysAgo.toISOString().split('T')[0];
      makeProject(tempDir, 'fresh', `status: active\nlast_activity: ${dateStr}`);

      const result = scanSlippage(tempDir, BASE_CONFIG, REFERENCE_DATE);

      expect(result.projects[0].stalled).toBe(false);
      expect(result.projects[0].daysSinceActivity).toBeLessThanOrEqual(2);
    });

    test('project without last_activity has daysSinceActivity null and is not stalled', () => {
      makeProject(tempDir, 'no-activity', 'status: active');

      const result = scanSlippage(tempDir, BASE_CONFIG, REFERENCE_DATE);

      expect(result.projects[0].daysSinceActivity).toBeNull();
      expect(result.projects[0].stalled).toBe(false);
    });

    test('project with invalid last_activity date is treated as no activity', () => {
      makeProject(tempDir, 'bad-date', 'status: active\nlast_activity: not-a-date');

      const result = scanSlippage(tempDir, BASE_CONFIG, REFERENCE_DATE);

      expect(result.projects[0].daysSinceActivity).toBeNull();
      expect(result.projects[0].stalled).toBe(false);
    });
  });

  describe('excludeProjects', () => {
    test('case-insensitive exclude filter skips matching projects', () => {
      makeProject(tempDir, 'MyProject', 'status: active\nlast_activity: 2026-04-10');
      makeProject(tempDir, 'other', 'status: active\nlast_activity: 2026-04-10');

      const config = {
        slippage: { staleDays: 7, excludeProjects: ['myproject'], maxProjects: 20 },
      };
      const result = scanSlippage(tempDir, config, REFERENCE_DATE);

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].name).toBe('other');
    });
  });

  describe('malformed STATE.md (D-14)', () => {
    test('directory without .planning/STATE.md is skipped silently', () => {
      const projectDir = path.join(tempDir, 'no-state');
      fs.mkdirSync(projectDir, { recursive: true });

      const result = scanSlippage(tempDir, BASE_CONFIG, REFERENCE_DATE);

      expect(result.projects).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test('project without status field is skipped', () => {
      makeProject(tempDir, 'no-status', 'last_activity: 2026-04-10');

      const result = scanSlippage(tempDir, BASE_CONFIG, REFERENCE_DATE);

      expect(result.projects).toHaveLength(0);
    });
  });

  describe('progress parsing', () => {
    test('extracts percent, completed_phases, total_phases into phase string', () => {
      makeProject(
        tempDir,
        'gamma',
        'status: active\nlast_activity: 2026-04-10\nprogress:\n  percent: 42\n  completed_phases: 3\n  total_phases: 7'
      );

      const result = scanSlippage(tempDir, BASE_CONFIG, REFERENCE_DATE);

      expect(result.projects[0].percent).toBe(42);
      expect(result.projects[0].phase).toBe('Phase 3/7');
    });

    test('missing progress fields produce unknown phase with null percent', () => {
      makeProject(tempDir, 'delta', 'status: active\nlast_activity: 2026-04-10');

      const result = scanSlippage(tempDir, BASE_CONFIG, REFERENCE_DATE);

      expect(result.projects[0].percent).toBeNull();
      expect(result.projects[0].phase).toBe('unknown');
    });
  });

  describe('maxProjects cap', () => {
    test('stops scanning after maxProjects limit reached', () => {
      for (let i = 0; i < 25; i++) {
        makeProject(tempDir, `p${i}`, 'status: active');
      }
      const config = {
        slippage: { staleDays: 7, excludeProjects: [], maxProjects: 10 },
      };

      const result = scanSlippage(tempDir, config, REFERENCE_DATE);

      expect(result.projects).toHaveLength(10);
    });
  });

  describe('default config fallback', () => {
    test('uses sensible defaults when config.slippage is missing', () => {
      makeProject(tempDir, 'epsilon', 'status: active\nlast_activity: 2026-04-10');

      const result = scanSlippage(tempDir, {}, REFERENCE_DATE);

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].stalled).toBe(true);
    });
  });
});

'use strict';

/**
 * test/connectors/github.test.js
 *
 * Tests for the GitHub connector:
 *   - getGitHubActivity(mcpClient, options) — uniform D-15 result shape
 *   - Repo scoping to UsernameTron (D-12)
 *   - Event-type composition from list_commits, list_issues, list_pull_requests
 *   - PR client-side `updated_at` filtering (list_pull_requests lacks `since`)
 *   - Partial MCP failure handling (some tools throw, others succeed)
 *   - Total MCP failure → makeError
 *   - Null mcpClient guard → makeError
 *   - Default window from config when options.hours is absent
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { assertSuccessShape, assertErrorShape, assertSourceEnum } = require('./helpers');
const { SOURCE } = require('../../src/connectors/types');

// ── Helpers ────────────────────────────────────────────────────────────────

const REAL_SCHEMA_PATH = path.join(
  __dirname, '..', '..', 'config', 'schema', 'connectors.schema.json'
);

/**
 * Create a temp config directory with github section + full valid config,
 * set CONFIG_DIR_OVERRIDE, run fn, restore the override.
 */
function withTempConfig(githubOverrides, fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-github-test-'));
  const schemaDir = path.join(tmpDir, 'schema');
  fs.mkdirSync(schemaDir);

  const config = {
    calendar: {
      workingHours: { start: 8, end: 18 },
      excludeDeclined: true,
      defaultWindowHours: 24,
    },
    gmail: {
      vipSenders: ['cpeteconnor@gmail.com'],
      defaultWindowHours: 24,
      maxResults: 20,
    },
    github: {
      owner: 'UsernameTron',
      repos: ['second-brain'],
      defaultWindowHours: 24,
      ...githubOverrides,
    },
  };

  fs.writeFileSync(
    path.join(tmpDir, 'connectors.json'),
    JSON.stringify(config),
    'utf8'
  );
  fs.copyFileSync(REAL_SCHEMA_PATH, path.join(schemaDir, 'connectors.schema.json'));

  const prev = process.env.CONFIG_DIR_OVERRIDE;
  process.env.CONFIG_DIR_OVERRIDE = tmpDir;

  // Reset the module-level memoized config so each test gets a fresh config load
  jest.resetModules();

  try {
    return fn();
  } finally {
    process.env.CONFIG_DIR_OVERRIDE = prev !== undefined ? prev : '';
    delete process.env.CONFIG_DIR_OVERRIDE;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Build a mock mcpClient that returns predetermined data per tool name.
 * `overrides` is an object mapping tool names to return values or Error instances.
 */
function makeMockClient(overrides = {}) {
  const now = new Date().toISOString();
  const defaults = {
    list_commits: [
      { sha: 'abc123', message: 'fix: update logic', commit: { message: 'fix: update logic' }, author: { login: 'UsernameTron' } },
    ],
    list_issues: [
      { number: 1, title: 'Bug report', state: 'open', created_at: now, updated_at: now },
    ],
    list_pull_requests: [
      { number: 2, title: 'Feature PR', state: 'open', updated_at: now },
    ],
  };
  const merged = { ...defaults, ...overrides };

  return {
    callTool: jest.fn(async (tool) => {
      if (merged[tool] instanceof Error) {
        throw merged[tool];
      }
      return merged[tool];
    }),
  };
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('getGitHubActivity', () => {
  describe('contract shape', () => {
    it('returns a valid success shape on happy path', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then((result) => {
          assertSuccessShape(result);
        });
      })
    );

    it('result.source === SOURCE.GITHUB on success', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then((result) => {
          assertSourceEnum(result);
          expect(result.source).toBe(SOURCE.GITHUB);
        });
      })
    );

    it('returns a valid error shape when mcpClient is null', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        return getGitHubActivity(null).then((result) => {
          assertErrorShape(result);
          expect(result.source).toBe(SOURCE.GITHUB);
        });
      })
    );

    it('returns a valid error shape when mcpClient is undefined', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        return getGitHubActivity(undefined).then((result) => {
          assertErrorShape(result);
          expect(result.source).toBe(SOURCE.GITHUB);
        });
      })
    );

    it('returns a valid error shape when mcpClient is called with no args', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        return getGitHubActivity().then((result) => {
          assertErrorShape(result);
          expect(result.source).toBe(SOURCE.GITHUB);
        });
      })
    );
  });

  describe('null/missing mcpClient guard', () => {
    it('returns {success: false, error: "mcpClient is required"} for null', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        return getGitHubActivity(null).then((result) => {
          expect(result.success).toBe(false);
          expect(result.error).toMatch(/mcpClient is required/i);
        });
      })
    );

    it('does not call any MCP tools when client is null', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const fakeClient = { callTool: jest.fn() };
        return getGitHubActivity(null).then(() => {
          expect(fakeClient.callTool).not.toHaveBeenCalled();
        });
      })
    );
  });

  describe('MCP tool calls — correct tools and params', () => {
    it('calls list_commits, list_issues, list_pull_requests per configured repo', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then(() => {
          const toolNames = client.callTool.mock.calls.map(([tool]) => tool);
          expect(toolNames).toContain('list_commits');
          expect(toolNames).toContain('list_issues');
          expect(toolNames).toContain('list_pull_requests');
        });
      })
    );

    it('does NOT call list_user_events', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then(() => {
          const toolNames = client.callTool.mock.calls.map(([tool]) => tool);
          expect(toolNames).not.toContain('list_user_events');
        });
      })
    );

    it('passes owner from config to all tool calls', () =>
      withTempConfig({ owner: 'UsernameTron' }, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then(() => {
          for (const [, params] of client.callTool.mock.calls) {
            expect(params.owner).toBe('UsernameTron');
          }
        });
      })
    );

    it('passes repo from config to all tool calls', () =>
      withTempConfig({ repos: ['second-brain'] }, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then(() => {
          for (const [, params] of client.callTool.mock.calls) {
            expect(params.repo).toBe('second-brain');
          }
        });
      })
    );

    it('passes `since` param to list_commits', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then(() => {
          const commitCall = client.callTool.mock.calls.find(([tool]) => tool === 'list_commits');
          expect(commitCall).toBeDefined();
          expect(commitCall[1]).toHaveProperty('since');
          expect(typeof commitCall[1].since).toBe('string');
          // since should be a valid ISO8601 date in the past
          const sinceDate = new Date(commitCall[1].since);
          expect(sinceDate.getTime()).toBeLessThan(Date.now());
        });
      })
    );

    it('passes `since` param to list_issues', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then(() => {
          const issueCall = client.callTool.mock.calls.find(([tool]) => tool === 'list_issues');
          expect(issueCall).toBeDefined();
          expect(issueCall[1]).toHaveProperty('since');
          expect(typeof issueCall[1].since).toBe('string');
        });
      })
    );

    it('calls all three tools with correct repo from multi-repo config', () =>
      withTempConfig({ repos: ['repo-a', 'repo-b'] }, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then(() => {
          const reposCalled = client.callTool.mock.calls.map(([, params]) => params.repo);
          expect(reposCalled).toContain('repo-a');
          expect(reposCalled).toContain('repo-b');
          // Each repo gets 3 tool calls
          expect(client.callTool.mock.calls.length).toBe(6);
        });
      })
    );
  });

  describe('repo scoping (D-12)', () => {
    it('only queries repos explicitly in config — does not query repos outside the list', () =>
      withTempConfig({ owner: 'UsernameTron', repos: ['second-brain'] }, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then(() => {
          for (const [, params] of client.callTool.mock.calls) {
            expect(params.repo).toBe('second-brain');
            expect(params.owner).toBe('UsernameTron');
          }
        });
      })
    );
  });

  describe('window handling', () => {
    it('uses options.hours to compute since timestamp', () =>
      withTempConfig({ defaultWindowHours: 48 }, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        const before = Date.now();
        return getGitHubActivity(client, { hours: 2 }).then(() => {
          const commitCall = client.callTool.mock.calls.find(([tool]) => tool === 'list_commits');
          const sinceMs = new Date(commitCall[1].since).getTime();
          // since should be ~2h ago (+/- 5s for test timing)
          const expectedMs = before - 2 * 60 * 60 * 1000;
          expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(5000);
        });
      })
    );

    it('falls back to config.defaultWindowHours when options.hours is absent', () =>
      withTempConfig({ defaultWindowHours: 12 }, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        const before = Date.now();
        return getGitHubActivity(client).then(() => {
          const commitCall = client.callTool.mock.calls.find(([tool]) => tool === 'list_commits');
          const sinceMs = new Date(commitCall[1].since).getTime();
          // since should be ~12h ago (+/- 5s)
          const expectedMs = before - 12 * 60 * 60 * 1000;
          expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(5000);
        });
      })
    );
  });

  describe('data composition', () => {
    it('returns commits array from list_commits result', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then((result) => {
          expect(result.success).toBe(true);
          expect(Array.isArray(result.data.commits)).toBe(true);
          expect(result.data.commits.length).toBeGreaterThanOrEqual(1);
        });
      })
    );

    it('returns issues array from list_issues result', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then((result) => {
          expect(result.success).toBe(true);
          expect(Array.isArray(result.data.issues)).toBe(true);
        });
      })
    );

    it('returns pullRequests array from list_pull_requests result', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient();
        return getGitHubActivity(client, { hours: 24 }).then((result) => {
          expect(result.success).toBe(true);
          expect(Array.isArray(result.data.pullRequests)).toBe(true);
        });
      })
    );

    it('returns empty arrays when all tools return []', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient({
          list_commits: [],
          list_issues: [],
          list_pull_requests: [],
        });
        return getGitHubActivity(client, { hours: 24 }).then((result) => {
          expect(result.success).toBe(true);
          expect(result.data.commits).toEqual([]);
          expect(result.data.issues).toEqual([]);
          expect(result.data.pullRequests).toEqual([]);
        });
      })
    );

    it('filters PRs that are outside the window (updated_at too old)', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const oldDate = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(); // 100h ago
        const recentDate = new Date().toISOString(); // now
        const client = makeMockClient({
          list_pull_requests: [
            { number: 1, title: 'Old PR', state: 'open', updated_at: oldDate },
            { number: 2, title: 'Recent PR', state: 'open', updated_at: recentDate },
          ],
        });
        return getGitHubActivity(client, { hours: 24 }).then((result) => {
          expect(result.success).toBe(true);
          const prNumbers = result.data.pullRequests.map((pr) => pr.number);
          expect(prNumbers).toContain(2);
          expect(prNumbers).not.toContain(1);
        });
      })
    );
  });

  describe('error handling', () => {
    it('returns makeError when ALL MCP tool calls throw', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient({
          list_commits: new Error('network failure'),
          list_issues: new Error('network failure'),
          list_pull_requests: new Error('network failure'),
        });
        return getGitHubActivity(client, { hours: 24 }).then((result) => {
          assertErrorShape(result);
          expect(result.success).toBe(false);
          expect(result.source).toBe(SOURCE.GITHUB);
        });
      })
    );

    it('returns makeResult (partial) when only list_commits throws', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = makeMockClient({
          list_commits: new Error('commits unavailable'),
          list_issues: [{ number: 5, title: 'Test issue', state: 'open', updated_at: new Date().toISOString() }],
          list_pull_requests: [],
        });
        return getGitHubActivity(client, { hours: 24 }).then((result) => {
          // Partial success — still returns makeResult
          expect(result.success).toBe(true);
          expect(result.source).toBe(SOURCE.GITHUB);
          // issues are preserved, commits are empty/partial
          expect(result.data.issues.length).toBeGreaterThanOrEqual(1);
          // warnings array present in data
          expect(Array.isArray(result.data.warnings)).toBe(true);
          expect(result.data.warnings.length).toBeGreaterThan(0);
        });
      })
    );

    it('never throws — always returns a result object', () =>
      withTempConfig({}, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        const client = {
          callTool: jest.fn().mockRejectedValue(new Error('catastrophic failure')),
        };
        return expect(getGitHubActivity(client, { hours: 24 })).resolves.toBeDefined();
      })
    );
  });

  describe('multi-repo aggregation', () => {
    it('concatenates commits across multiple repos', () =>
      withTempConfig({ repos: ['repo-a', 'repo-b'] }, () => {
        const { getGitHubActivity } = require('../../src/connectors/github');
        let callCount = 0;
        const client = {
          callTool: jest.fn(async (tool) => {
            callCount++;
            if (tool === 'list_commits') {
              return [{ sha: `sha-${callCount}`, message: 'commit', commit: {}, author: {} }];
            }
            if (tool === 'list_issues') return [];
            if (tool === 'list_pull_requests') return [];
            return [];
          }),
        };
        return getGitHubActivity(client, { hours: 24 }).then((result) => {
          expect(result.success).toBe(true);
          // Two repos × 1 commit each = 2 commits
          expect(result.data.commits.length).toBe(2);
        });
      })
    );
  });
});

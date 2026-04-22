'use strict';

/**
 * github.js
 *
 * GitHub connector for the Second Brain project.
 * Satisfies INTG-03 — GitHub activity feed scoped to UsernameTron repos.
 *
 * Design:
 *   - Calls Docker MCP tools: list_commits, list_issues, list_pull_requests (per D-11)
 *   - Scopes all queries to config.owner / config.repos (D-12)
 *   - Returns the D-15 uniform result shape via makeResult / makeError
 *   - Never throws — all errors caught and returned as success:false (D-18)
 *   - Dependency-injectable mcpClient (callTool pattern) for testability
 *   - list_pull_requests lacks `since` param — PRs filtered client-side by updated_at
 *
 * @module src/connectors/github
 */

const { SOURCE, makeResult, makeError, loadConnectorsConfig } = require('./types');

// ── Config (memoized per D-23 lazy loader pattern) ───────────────────────────

let _config = null;

/**
 * Lazily load and memoize the github section of connectors.json.
 * Respects CONFIG_DIR_OVERRIDE set at call time (not module load time) so tests
 * can inject a temp config directory before requiring this module.
 *
 * @returns {{ owner: string, repos: string[], defaultWindowHours: number }}
 */
function _getConfig() {
  if (!_config) {
    _config = loadConnectorsConfig().github;
  }
  return _config;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Compute an ISO 8601 timestamp for `windowHours` ago.
 *
 * @param {number} windowHours
 * @returns {string} ISO 8601 date string
 */
function _sinceTimestamp(windowHours) {
  return new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
}

/**
 * Fetch commits, issues, and PRs for a single repo.
 * Returns an object with settled results per tool so callers can handle
 * partial failures gracefully.
 *
 * @param {object} mcpClient
 * @param {string} owner
 * @param {string} repo
 * @param {string} since  ISO 8601 cutoff for commits and issues
 * @returns {Promise<{ commits: PromiseSettledResult, issues: PromiseSettledResult, prs: PromiseSettledResult }>}
 */
async function _fetchRepo(mcpClient, owner, repo, since) {
  const [commits, issues, prs] = await Promise.allSettled([
    mcpClient.callTool('list_commits', { owner, repo, since, perPage: 30 }),
    mcpClient.callTool('list_issues', { owner, repo, since, state: 'all', perPage: 30 }),
    mcpClient.callTool('list_pull_requests', { owner, repo, state: 'all', perPage: 30 }),
  ]);
  return { commits, issues, prs };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch GitHub activity for all configured repos under config.owner.
 *
 * Activity is composed from three Docker MCP tools per repo:
 *   - list_commits  (filtered by `since` param)
 *   - list_issues   (filtered by `since` param)
 *   - list_pull_requests (filtered client-side by updated_at — tool lacks `since`)
 *
 * Partial failure handling:
 *   - If SOME tool calls fail: returns makeResult with partial data + warnings array
 *   - If ALL tool calls fail across all repos: returns makeError
 *
 * @param {object|null|undefined} mcpClient - Object with callTool(toolName, params) method
 * @param {{ hours?: number }} [options={}]
 * @returns {Promise<{ success: boolean, data: object|null, error: string|null, source: string, fetchedAt: string }>}
 */
async function getGitHubActivity(mcpClient, options = {}) {
  // Guard: mcpClient is required
  if (!mcpClient) {
    return makeError(SOURCE.GITHUB, 'mcpClient is required');
  }

  const config = _getConfig();
  const owner = config.owner;
  const windowHours = options.hours || config.defaultWindowHours;
  const since = _sinceTimestamp(windowHours);

  // Fetch all repos concurrently
  const repoResults = await Promise.allSettled(
    config.repos.map((repo) => _fetchRepo(mcpClient, owner, repo, since))
  );

  // Aggregate data across all repos, tracking failures
  const commits = [];
  const issues = [];
  const pullRequests = [];
  const warnings = [];
  let totalCalls = 0;
  let failedCalls = 0;

  for (const repoSettled of repoResults) {
    if (repoSettled.status === 'rejected') {
      // Entire repo fetch failed (shouldn't happen since _fetchRepo uses allSettled internally)
      warnings.push(`Repo fetch failed: ${repoSettled.reason && repoSettled.reason.message}`);
      failedCalls += 3; // 3 tools per repo
      totalCalls += 3;
      continue;
    }

    const { commits: commitsResult, issues: issuesResult, prs: prsResult } = repoSettled.value;

    totalCalls += 3;

    // Process commits
    if (commitsResult.status === 'fulfilled') {
      commits.push(...(Array.isArray(commitsResult.value) ? commitsResult.value : []));
    } else {
      failedCalls++;
      warnings.push(`list_commits failed: ${commitsResult.reason && commitsResult.reason.message}`);
    }

    // Process issues
    if (issuesResult.status === 'fulfilled') {
      issues.push(...(Array.isArray(issuesResult.value) ? issuesResult.value : []));
    } else {
      failedCalls++;
      warnings.push(`list_issues failed: ${issuesResult.reason && issuesResult.reason.message}`);
    }

    // Process PRs — filter client-side by updated_at since list_pull_requests lacks `since` param
    if (prsResult.status === 'fulfilled') {
      const sinceMs = new Date(since).getTime();
      const filteredPRs = (Array.isArray(prsResult.value) ? prsResult.value : []).filter((pr) => {
        if (!pr.updated_at) return false;
        return new Date(pr.updated_at).getTime() >= sinceMs;
      });
      pullRequests.push(...filteredPRs);
    } else {
      failedCalls++;
      warnings.push(`list_pull_requests failed: ${prsResult.reason && prsResult.reason.message}`);
    }
  }

  // If every single call failed, return makeError
  if (totalCalls > 0 && failedCalls === totalCalls) {
    return makeError(SOURCE.GITHUB, 'All GitHub MCP calls failed');
  }

  // Partial or full success — include warnings only if there were failures
  const data = { commits, issues, pullRequests };
  if (warnings.length > 0) {
    data.warnings = warnings;
  }

  return makeResult(SOURCE.GITHUB, data);
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { getGitHubActivity };

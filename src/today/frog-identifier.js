'use strict';

/**
 * src/today/frog-identifier.js
 *
 * Identifies the "daily frog" — the single hardest or most-avoided task —
 * from the stalled projects surfaced by slippage-scanner. Uses one Haiku call
 * over heuristic-scored candidates and falls back to "most days stalled" on
 * LLM failure.
 *
 * Extracted from today-command.js during Phase 15 architecture refactor (B-07).
 *
 * Per CONTEXT decision D-15 from Phase 4:
 *   D-15: One Haiku call over heuristic candidates, heuristic fallback if LLM fails
 *
 * @module today/frog-identifier
 */

/**
 * Identify the daily frog from slippage scanner output.
 *
 * @param {{ projects: Array, warnings: string[] }} slippageData - Output of scanSlippage
 * @param {object} haikuClient - LLM client exposing classify(system, user, opts)
 * @returns {Promise<{ frog: string|null, reasoning: string }>}
 */
async function identifyFrog(slippageData, haikuClient) {
  const stalledProjects = slippageData.projects.filter((p) => p.stalled);

  if (stalledProjects.length === 0) {
    return { frog: null, reasoning: 'No stalled projects or overdue tasks found.' };
  }

  // Build candidate list for LLM
  const candidates = stalledProjects.map((p) => ({
    project: p.name,
    status: p.status,
    phase: p.phase,
    percentComplete: p.percent,
    daysSinceActivity: p.daysSinceActivity,
  }));

  const systemPrompt = [
    'You identify the single hardest or most-avoided task from a list of project statuses.',
    'Return JSON: {"frog": string, "reasoning": string}.',
    'The frog is the task the user is most likely avoiding or that will cause the most damage if delayed further.',
    'Be specific: name the project and what action is needed.',
    'reasoning should be 1-2 sentences explaining why this is the frog.',
  ].join(' ');

  const result = await haikuClient.classify(systemPrompt, JSON.stringify(candidates), {
    maxTokens: 256,
  });

  if (result.success && result.data && result.data.frog) {
    return {
      frog: result.data.frog,
      reasoning: result.data.reasoning || 'No reasoning provided.',
    };
  }

  // Heuristic fallback: pick the project with most days stalled
  const sorted = [...stalledProjects].sort(
    (a, b) => (b.daysSinceActivity || 0) - (a.daysSinceActivity || 0)
  );
  const top = sorted[0];
  return {
    frog: top.name,
    reasoning: `Heuristic fallback: ${top.name} has been stalled for ${top.daysSinceActivity} days (${top.phase}).`,
  };
}

module.exports = { identifyFrog };

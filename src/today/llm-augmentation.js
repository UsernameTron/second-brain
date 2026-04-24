'use strict';

/**
 * src/today/llm-augmentation.js
 *
 * Generates the LLM-authored synthesis paragraph that appears near the top of
 * the /today briefing. Extracted from _renderBriefing() during Phase 15
 * architecture refactor (B-07) so the renderer can stay synchronous and the
 * LLM call can be tested independently.
 *
 * Per CONTEXT decisions from Phase 4:
 *   D-04: Two Haiku calls max per briefing (frog + synthesis)
 *   D-11: Diagnostic checklist when all sources unavailable (no LLM call)
 *
 * @module today/llm-augmentation
 */

/**
 * Render the static diagnostic checklist shown when every source is degraded.
 * Kept separate from the main happy path so the renderer can request either
 * variant without touching the LLM.
 *
 * @returns {string} Blockquoted checklist
 */
function renderDiagnosticChecklist() {
  return [
    '> All data sources unavailable. Check:',
    '> (1) Docker Desktop running?',
    '> (2) Obsidian Local REST API plugin enabled?',
    '> (3) Network?',
  ].join('\n');
}

/**
 * Build the context summary lines that feed the synthesis prompt.
 *
 * @param {{ connectorResults: object, pipelineState: object, slippage: object, frog: object, degradedCount: number }} ctx
 * @returns {string[]} Array of context lines (caller joins with newlines)
 */
function _buildContextParts(ctx) {
  const { connectorResults, pipelineState, slippage, frog, degradedCount } = ctx;
  const parts = [];

  if (connectorResults.calendar.success) {
    const events = connectorResults.calendar.data || [];
    parts.push(`Meetings today: ${events.length}`);
  } else {
    parts.push(`Calendar: degraded (${connectorResults.calendar.error})`);
  }

  if (connectorResults.gmail.success) {
    const emails = connectorResults.gmail.data || [];
    parts.push(`VIP emails: ${emails.length}`);
  } else {
    parts.push(`Gmail: degraded (${connectorResults.gmail.error})`);
  }

  if (connectorResults.github.success) {
    const gh = connectorResults.github.data || {};
    const repos = gh.repos || [];
    parts.push(`GitHub repos with activity: ${repos.length}`);
  } else {
    parts.push(`GitHub: degraded (${connectorResults.github.error})`);
  }

  if (pipelineState.ok) {
    parts.push(`Pipeline proposals pending: ${pipelineState.proposalCount}`);
    parts.push(`Dead-letter files: ${pipelineState.deadLetter.total}`);
  } else {
    parts.push(`Pipeline: degraded`);
  }

  const stalledProjects = slippage.projects.filter((p) => p.stalled);
  parts.push(`Stalled projects: ${stalledProjects.length}`);

  if (frog && frog.frog) {
    parts.push(`Frog: ${frog.frog}`);
  }

  if (degradedCount > 0) {
    parts.push(`Degraded sources: ${degradedCount}`);
  }

  return parts;
}

/**
 * Produce the synthesis blockquote for the briefing.
 *
 * When every source is degraded (degradedCount >= 4), returns the static
 * diagnostic checklist and skips the LLM call entirely. Otherwise, calls the
 * Haiku client with a compact context summary and returns the blockquoted
 * result — falling back to a static one-liner if the call fails.
 *
 * The returned string always starts with "> " so the caller can drop it into
 * the markdown document without extra formatting.
 *
 * @param {object} context
 * @param {{ calendar: object, gmail: object, github: object }} context.connectorResults
 * @param {{ proposalCount: number, deadLetter: object, ok: boolean, error?: string }} context.pipelineState
 * @param {{ projects: Array, warnings: string[] }} context.slippage
 * @param {{ frog: string|null, reasoning: string }} context.frog
 * @param {number} context.degradedCount
 * @param {object} haikuClient - LLM client exposing classify(system, user, opts)
 * @returns {Promise<string>} Blockquoted synthesis or diagnostic checklist
 */
async function generateSynthesis(context, haikuClient) {
  const { degradedCount } = context;

  // D-11: Total failure — render diagnostic checklist, skip LLM call
  if (degradedCount >= 4) {
    return renderDiagnosticChecklist();
  }

  const contextParts = _buildContextParts(context);

  const synthSystemPrompt = [
    'You write a concise 3-4 sentence daily briefing synthesis.',
    'Be direct and actionable. Flag degraded sources by name.',
    'Focus on what needs attention today.',
  ].join(' ');

  const synthResult = await haikuClient.classify(
    synthSystemPrompt,
    contextParts.join('\n'),
    { maxTokens: 200 }
  );

  if (synthResult.success && typeof synthResult.data === 'string') {
    return `> ${synthResult.data}`;
  }
  if (synthResult.success && synthResult.data && synthResult.data.synthesis) {
    return `> ${synthResult.data.synthesis}`;
  }

  // Static fallback when LLM call fails or returns unexpected shape
  return `> Briefing generated with ${degradedCount} degraded source(s). Review sections below for details.`;
}

module.exports = {
  generateSynthesis,
  renderDiagnosticChecklist,
};

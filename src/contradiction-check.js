'use strict';

/**
 * contradiction-check.js
 *
 * Shared, never-throws contradiction detector: hybrid top-5 retrieval +
 * Haiku confirm. FLAG-ONLY — callers must never block or auto-resolve on
 * the result. Used by promote-memories.js at promotion and (Wave 3) by
 * dream.js STALE detection.
 *
 * @module contradiction-check
 */

const NO_CONTRADICTION = { contradicts: false, against: null, confidence: 0 };

/**
 * Check whether a candidate entry contradicts any of its nearest existing
 * memory entries. Never throws — any failure (missing search results, LLM
 * unavailable, malformed response) degrades to NO_CONTRADICTION.
 *
 * @param {{content: string, contentHash: string}} entry
 * @param {object} [options={}]
 * @returns {Promise<{contradicts: boolean, against: string|null, confidence: number}>}
 */
async function checkContradiction(entry, options = {}) {
  try {
    const { hybridSearch } = require('./semantic-index');
    const { createHaikuClient } = require('./pipeline-infra');

    const searchResult = await hybridSearch(entry.content, { top: 5 });
    const neighbors = (searchResult.results || []).filter(r => r.id !== entry.contentHash);
    if (neighbors.length === 0) return NO_CONTRADICTION;

    const haiku = (options.haikuClient) || createHaikuClient();

    const systemPrompt = [
      'You compare a candidate memory entry against existing memory entries for direct contradiction.',
      'Return ONLY strict JSON: { "contradicts": boolean, "againstIndex": integer|null, "confidence": 0.0-1.0 }',
      '"againstIndex" is the 0-based index into the numbered list of existing entries, or null if no contradiction.',
    ].join('\n');

    const userContent = [
      `Candidate: ${entry.content}`,
      '',
      'Existing entries:',
      ...neighbors.map((n, i) => `${i}. ${n.content}`),
    ].join('\n');

    const result = await haiku.classify(systemPrompt, userContent, options.classifyOptions || {});
    if (!result || !result.success || !result.data) return NO_CONTRADICTION;

    const { contradicts, againstIndex, confidence } = result.data;
    if (contradicts !== true) return NO_CONTRADICTION;
    if (typeof againstIndex !== 'number' || !neighbors[againstIndex]) return NO_CONTRADICTION;

    return {
      contradicts: true,
      against: neighbors[againstIndex].id,
      confidence: typeof confidence === 'number' ? confidence : 0,
    };
  } catch (_) {
    return NO_CONTRADICTION;
  }
}

module.exports = { checkContradiction };

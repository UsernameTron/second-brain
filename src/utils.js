'use strict';

/**
 * Escape regex metacharacters in a string for safe use in new RegExp().
 * Used by content-policy.js and style-policy.js — extracted here to avoid
 * coupling between policy modules.
 *
 * @param {string} term - The string to escape
 * @returns {string} The escaped string safe for use in new RegExp()
 */
function escapeRegex(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegex };

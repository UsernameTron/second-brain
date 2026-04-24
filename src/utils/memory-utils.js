'use strict';

/**
 * memory-utils.js
 *
 * Shared helpers for memory-related modules (promote-memories,
 * memory-extractor, memory-reader, recall-command).
 *
 * @module utils/memory-utils
 */

const crypto = require('crypto');
const path = require('path');

/**
 * Compute a 12-character content hash for dedup.
 * Normalizes by trim + lowercase so whitespace and case do not cause misses.
 * @param {string} content
 * @returns {string} 12-char hex digest
 */
function computeHash(content) {
  const normalized = (content || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/**
 * Produce a short, user-facing form of a source reference.
 * @param {string} sourceRef
 * @returns {string}
 */
function sourceRefShort(sourceRef) {
  if (!sourceRef) return 'unknown';
  if (sourceRef.startsWith('session:')) return 'session:' + sourceRef.slice(8, 16);
  if (sourceRef.startsWith('file:')) {
    const base = path.basename(sourceRef.slice(5));
    const ext = path.extname(base);
    return 'file:' + base.slice(0, base.length - ext.length);
  }
  if (sourceRef.startsWith('daily:')) return sourceRef;
  return sourceRef.slice(0, 20);
}

module.exports = { computeHash, sourceRefShort };

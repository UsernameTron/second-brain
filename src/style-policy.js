'use strict';

/**
 * style-policy.js
 *
 * Guard 3: Anti-AI style lint for the vault-gateway.
 * Extracts banned words from the real style guide, performs regex-only lint,
 * and provides createVaultWriter() wrapper enforcing style guide injection.
 *
 * Security design:
 *   - escapeRegex imported from ./utils (no cross-module coupling with content-policy)
 *   - VAULT_ROOT imported from vault-gateway for style guide path resolution
 *   - Style guide hot-reloads on file change (50ms debounce, per D-13)
 *   - attemptCount is a required caller contract — gateway does not track retry state
 *
 * @module style-policy
 */

const fs = require('fs');
const path = require('path');
const { escapeRegex } = require('./utils');

// VAULT_ROOT — imported here to resolve style guide path
// We require vault-gateway lazily to avoid circular dependency
// (vault-gateway requires style-policy, style-policy should not require vault-gateway at module level)
// Instead we use process.env.VAULT_ROOT directly, matching vault-gateway's own logic.
const VAULT_ROOT = process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');

// ── Style guide loading and caching ──────────────────────────────────────────

/** @type {{ fullText: string, bannedWords: string[] } | null} */
let _styleGuideCache = null;

/** Debounce flag to prevent macOS double-fire on fs.watch */
let _styleGuideReloading = false;

/**
 * Extract banned words from style guide markdown content.
 * Looks for a table in a section with "Banned" in the heading.
 * Extracts entries from the first column (skip header and separator rows).
 *
 * @param {string} styleGuideContent - Raw markdown from anti-ai-writing-style.md
 * @returns {string[]} Lowercase array of banned words/phrases
 */
function extractBannedWords(styleGuideContent) {
  const bannedWords = [];
  let inBannedSection = false;
  let inTable = false;
  let headerSkipped = false;

  const lines = styleGuideContent.split('\n');

  for (const line of lines) {
    // Detect a heading containing "Banned"
    if (/^#+\s+.*[Bb]anned/i.test(line)) {
      inBannedSection = true;
      inTable = false;
      headerSkipped = false;
      continue;
    }

    // Stop if we hit a new heading (## or higher) that doesn't contain "Banned"
    if (/^#+\s/.test(line) && !/[Bb]anned/i.test(line)) {
      if (inBannedSection) {
        inBannedSection = false;
        inTable = false;
      }
      continue;
    }

    if (!inBannedSection) continue;

    // Detect table rows (start with |)
    if (line.startsWith('|')) {
      inTable = true;

      // Skip header row (contains "Word" or "Phrase")
      if (/^\|\s*word\/phrase/i.test(line) || /^\|\s*word\s*\|/i.test(line)) {
        headerSkipped = true;
        continue;
      }

      // Skip separator rows (|---|---|)
      if (/^\|[-\s|]+$/.test(line)) {
        continue;
      }

      // Extract first column — the banned word/phrase
      const columns = line.split('|').filter(c => c.trim() !== '');
      if (columns.length > 0) {
        const word = columns[0]
          .trim()
          .toLowerCase()
          // Remove parenthetical clarifications like "(as a verb)", "(your potential, etc.)"
          .replace(/\s*\([^)]*\)/g, '')
          // Remove trailing clarifications like "/ let's dive deep"
          // Keep only the first form if multiple are listed with /
          // Actually keep full phrase including slashes for now — test will determine
          .trim();

        if (word && !word.match(/^-+$/) && word !== 'word/phrase') {
          bannedWords.push(word);
        }
      }
    } else if (inTable && !line.startsWith('|') && line.trim() !== '') {
      // Non-pipe line after table — table ended
      inTable = false;
    }
  }

  return bannedWords;
}

/**
 * Load and cache the style guide from disk.
 * Watches the file for changes with 50ms debounce (same pattern as config watcher).
 * On parse error during hot-reload, keeps old cache and logs warning.
 *
 * @returns {{ fullText: string, bannedWords: string[] }}
 */
function loadStyleGuide() {
  const styleGuidePath = path.join(VAULT_ROOT, 'ABOUT ME', 'anti-ai-writing-style.md');

  let fullText;
  try {
    fullText = fs.readFileSync(styleGuidePath, 'utf8');
  } catch (err) {
    // If style guide doesn't exist (e.g., first run before vault setup), use empty cache
    console.error(`[style-policy] Could not load style guide: ${err.message}. Style lint will be disabled.`);
    fullText = '';
  }

  const bannedWords = extractBannedWords(fullText);

  _styleGuideCache = { fullText, bannedWords };

  // Watch for changes (hot-reload, per D-13)
  if (fullText) {
    try {
      fs.watch(styleGuidePath, { persistent: false }, (eventType) => {
        if (eventType === 'change' && !_styleGuideReloading) {
          _styleGuideReloading = true;
          setTimeout(() => {
            try {
              const updatedText = fs.readFileSync(styleGuidePath, 'utf8');
              _styleGuideCache = {
                fullText: updatedText,
                bannedWords: extractBannedWords(updatedText),
              };
            } catch (e) {
              console.error(`[style-policy] Style guide reload failed: ${e.message}. Keeping previous cache.`);
            }
            _styleGuideReloading = false;
          }, 50);
        }
      });
    } catch (watchErr) {
      // Non-fatal: watch failure means no hot-reload but style lint still works
      console.error(`[style-policy] Could not watch style guide for changes: ${watchErr.message}`);
    }
  }

  return _styleGuideCache;
}

/**
 * Get cached style guide, loading on first call.
 * @returns {{ fullText: string, bannedWords: string[] }}
 */
function getStyleGuideCache() {
  if (!_styleGuideCache) {
    loadStyleGuide();
  }
  return _styleGuideCache;
}

/**
 * Get the style guide full text for system prompt injection.
 * Per D-12: full content injected into agent system prompts.
 *
 * @returns {string} Full style guide markdown content
 */
function getStyleGuideForPrompt() {
  return getStyleGuideCache().fullText;
}

/**
 * Get the cached banned words array.
 * Used by checkStyle to perform regex lint.
 *
 * @returns {string[]} Lowercase banned words from style guide
 */
function getBannedWords() {
  return getStyleGuideCache().bannedWords;
}

// ── Style lint ────────────────────────────────────────────────────────────────

/**
 * Check content against banned words list.
 * Per D-13: regex-only (<10ms latency target), case-insensitive, word-boundary match.
 * Per D-14: 1st violation → REJECT (regenerate); 2nd+ violation → QUARANTINE.
 *
 * attemptCount contract: caller MUST pass 0 for first attempt, 1+ for retries.
 * Gateway does NOT track internal state. TypeError on undefined.
 *
 * @param {string} content - Note content to lint
 * @param {string[]} bannedWords - Extracted banned words from style guide
 * @param {number} attemptCount - 0 for first attempt, 1+ for retries (caller-tracked)
 * @returns {{ decision: 'PASS' } | { decision: 'REJECT', reason: string, violation: string } | { decision: 'QUARANTINE', reason: string, violation: string }}
 * @throws {TypeError} When attemptCount is not a number
 */
function checkStyle(content, bannedWords, attemptCount) {
  // Validate attemptCount — caller contract enforced here
  if (typeof attemptCount !== 'number') {
    throw new TypeError('attemptCount must be a number — caller must track retry state');
  }

  // Regex lint: check each banned word
  for (const word of bannedWords) {
    const regex = new RegExp('\\b' + escapeRegex(word) + '\\b', 'i');
    if (regex.test(content)) {
      if (attemptCount === 0) {
        return {
          decision: 'REJECT',
          reason: `Banned word detected: '${word}' -- regenerate without it`,
          violation: word,
        };
      } else {
        return {
          decision: 'QUARANTINE',
          reason: `Repeated style violation: '${word}'`,
          violation: word,
        };
      }
    }
  }

  return { decision: 'PASS' };
}

// ── createVaultWriter — VAULT-04 enforcement ──────────────────────────────────

/**
 * Create a vault writer wrapper that enforces style guide injection.
 * Per VAULT-04/D-12: any LLM agent producing vault content MUST use this wrapper.
 * The returned getSystemPromptPrefix() ensures style guide is pre-injected.
 *
 * @param {string} agentName - Name of the agent (for audit and prompt context)
 * @returns {{ write: Function, getSystemPromptPrefix: Function }}
 */
function createVaultWriter(agentName) {
  return {
    /**
     * Get style guide system prompt prefix for injection into agent system prompts.
     * @returns {string} Full prefix with style guide and agent identification
     */
    getSystemPromptPrefix() {
      const styleGuide = getStyleGuideForPrompt();
      return `[STYLE GUIDE — All vault content MUST follow these rules]\n\n${styleGuide}\n\n[END STYLE GUIDE]\n\nYou are writing as agent '${agentName}'. All output destined for the vault must follow the style guide above.`;
    },

    /**
     * Write content to the vault. Calls through to vault-gateway's vaultWrite.
     * Lazy-requires vault-gateway to avoid circular dependency.
     *
     * @param {string} relativePath - Vault-relative path
     * @param {string} content - Content to write
     * @param {object} [options] - Options passed to vaultWrite
     * @returns {Promise<{ decision: 'WRITTEN', path: string }>}
     */
    write(relativePath, content, options) {
      // Lazy require to avoid circular dependency (vault-gateway requires style-policy)
      const { vaultWrite } = require('./vault-gateway');
      return vaultWrite(relativePath, content, { ...options, _agentName: agentName });
    },
  };
}

// ── Initialize on module load ─────────────────────────────────────────────────

// Load style guide eagerly so banned words are ready before first request
loadStyleGuide();

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  checkStyle,
  extractBannedWords,
  getStyleGuideForPrompt,
  getBannedWords,
  loadStyleGuide,
  createVaultWriter,
};

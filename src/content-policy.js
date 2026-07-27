'use strict';

/**
 * content-policy.js
 *
 * Guard 2: Content filtering for the vault-gateway.
 * Two-stage detection: keyword scan (Stage 1) + Haiku classification (Stage 2).
 * Sanitization: paragraph-level stripping with contamination radius.
 * Prompt injection defense: excluded terms sanitized before Haiku prompt interpolation.
 *
 * Security design:
 *   - escapeRegex imported from ./utils (no cross-module coupling)
 *   - Haiku receives only context windows, not full note body (privacy)
 *   - Haiku timeout/unavailability triggers BLOCK, never silent bypass (D-08)
 *   - Excluded terms sanitized before prompt interpolation (prompt injection defense)
 *   - Paragraph-level contamination radius: entire paragraph stripped when any term hits
 *
 * @module content-policy
 */

const Anthropic = require('@anthropic-ai/sdk');
const { escapeRegex } = require('./utils');
const { safeLoadPipelineConfig } = require('./pipeline-infra');

// Lazy singleton — SDK 0.112+ constructors start an async credential-resolution
// chain at construction time; a module-scope client makes every importer pay
// that side effect (and it collides with other SDK loads under jest). Construct
// on first Haiku call instead, matching pipeline-infra's lazy pattern.
let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

// ── Unicode-aware matching helper ────────────────────────────────────────────

/**
 * Normalize a string for excluded-term matching using NFKD decomposition.
 *
 * Steps applied in order:
 *   1. Strip soft hyphens (U+00AD) — zero-width word-break hints
 *   2. NFKD normalization — decomposes full-width Latin (U+FF01–U+FF60) to ASCII
 *      equivalents, and converts U+00A0 NBSP to a regular space
 *   3. Strip combining marks (U+0300–U+036F) — removes diacritical residue after NFKD
 *   4. Strip zero-width characters (U+2000–U+200B hair/zero-width spaces, U+FEFF BOM)
 *   5. Lowercase — case-insensitive matching
 *
 * Prevents Unicode-variant bypass attempts (e.g., full-width "ＩＳＰＮ" or
 * soft-hyphen "I­S­P­N" slipping past an ASCII-only matcher).
 *
 * Whitespace is deliberately PRESERVED. Collapsing it here did make injected-space
 * bypasses ("Asa na") match, but it also fused unrelated words: "main index" became
 * "mainindex", in which the four-character term ININ appears. Whitespace tolerance
 * now lives in buildTermRegex, which permits it inside a term while still requiring
 * the match to occupy a whole token.
 *
 * @param {string} str - Input string (content paragraph or excluded term)
 * @returns {string} Normalized, lowercased string ready for buildTermRegex
 */
function normalizeForMatch(str) {
  return str
    // Strip soft hyphens (U+00AD) — zero-width word-break hints used as bypass
    .replace(/\u00AD/g, '')
    // NFKD normalization — decomposes full-width Latin (U+FF01–U+FF60) to ASCII,
    // also converts U+00A0 NBSP → U+0020 regular space
    .normalize('NFKD')
    // Strip combining marks (diacritical residue after NFKD decomposition)
    .replace(/[\u0300-\u036F]/g, '')
    // Strip zero-width characters (U+2000–U+200B range, U+FEFF BOM).
    // U+00A0 is already a regular space after NFKD and is left as one.
    .replace(/[\u2000-\u200B\uFEFF]/g, '')
    .toLowerCase();
}

// ── Excluded-term matching ───────────────────────────────────────────────────

/** @type {Map<string, RegExp>} Compiled term matchers, keyed by `${flags}:${term}`. */
const _termRegexCache = new Map();

/**
 * Build (and cache) the matcher for one excluded term.
 *
 * The pattern tolerates whitespace between every character, so injected-space
 * bypasses ("Asa na", "A s a n a") and multi-word terms ("Interactive
 * Intelligence" vs "InteractiveIntelligence") all resolve to the same term.
 *
 * Both ends are anchored to a non-alphanumeric boundary, which is what stops
 * that tolerance from spanning unrelated words — an unanchored ININ matches the
 * middle of "ma[in in]dex". Lookarounds rather than \b, because \b counts the
 * underscore as a word character and would stop "ispn_notes.md" matching.
 *
 * Trade-off: a suffixed form ("ISPNs") no longer matches, since the trailing
 * anchor requires a token end. Possessives and slugs ("ISPN's", "ispn_notes")
 * still do. Whole-token matching is worth losing plurals of a proper noun.
 *
 * @param {string} term - Raw excluded term from config
 * @param {string} [flags='i'] - RegExp flags; 'gi' for repeated context extraction
 * @returns {RegExp} Matcher to run against normalizeForMatch() output
 */
function buildTermRegex(term, flags = 'i') {
  const key = `${flags}:${term}`;
  const cached = _termRegexCache.get(key);
  if (cached) return cached;

  // Whitespace inside the configured term is not significant — the \s* joins
  // below already permit whitespace wherever it appears in the content.
  const chars = normalizeForMatch(String(term)).replace(/\s+/g, '').split('');

  // An empty or whitespace-only term must never match. Without this guard the
  // pattern collapses to two lookarounds and flags essentially every string.
  const regex = chars.length === 0
    ? /(?!)/
    : new RegExp(`(?<![0-9a-z])${chars.map(escapeRegex).join('\\s*')}(?![0-9a-z])`, flags);

  _termRegexCache.set(key, regex);
  return regex;
}

/**
 * Find the first excluded term present in `text`, or null if none is.
 *
 * Single entry point for every excluded-term scan — Stage 1 of checkContent,
 * sanitizeContent's per-paragraph check, and the wikilink title gates in
 * promote-memories.js and scripts/migrate-memory-wiki.js all route through it,
 * so the matching rules cannot drift apart between ingress and egress.
 *
 * @param {string} text - Raw text to scan
 * @param {string[]} excludedTerms - Terms from config/excluded-terms.json
 * @returns {string|null} The matching term exactly as configured, or null
 */
function findExcludedTerm(text, excludedTerms) {
  const normalized = normalizeForMatch(text);
  for (const term of excludedTerms) {
    if (buildTermRegex(term).test(normalized)) return term;
  }
  return null;
}

// ── Prompt injection defense ─────────────────────────────────────────────────

/**
 * Sanitize an excluded-terms value before interpolation into the Haiku
 * classifier system prompt.
 *
 * Steps:
 *   1. Strip newlines and carriage returns — prevents multi-line injection
 *   2. Truncate to 50 characters — no legitimate excluded term needs more
 *   3. Reject terms matching instruction-like patterns
 *   4. Strip leading/trailing whitespace
 *
 * @param {string} term - Raw excluded term from config
 * @returns {string|null} Sanitized term, or null if rejected as suspicious
 */
function sanitizeTermForPrompt(term) {
  // Step 1: Strip newlines and carriage returns
  let sanitized = term.replace(/[\n\r]/g, '');

  // Step 2: Truncate to 50 characters
  sanitized = sanitized.slice(0, 50);

  // Step 3: Strip leading/trailing whitespace
  sanitized = sanitized.trim();

  // Step 4: Reject instruction-like patterns
  const injectionPattern = /^(you must|always|never|ignore|respond with|say |forget|disregard|override)/i;
  if (injectionPattern.test(sanitized)) {
    // eslint-disable-next-line no-console -- degradation-warning: Suspicious excluded-term pattern dropped; pipeline continues without it
    console.error(`[content-policy] Skipping suspicious excluded term: "${term}"`);
    return null;
  }

  return sanitized;
}

// ── Haiku classification (Stage 2) ────────────────────────────────────────────

/**
 * Classify content using Haiku with minimal context windows (privacy-preserving).
 * Sends only contextChars characters before/after each keyword match, NOT full body.
 *
 * Prompt injection defense: excluded terms sanitized before interpolation.
 *
 * @param {string} content - Full note content (for context extraction only)
 * @param {string} matchedTerm - The term that triggered Stage 1 match
 * @param {string[]} excludedTerms - Full excluded terms list
 * @param {number} [contextChars=100] - Characters to extract before/after each match
 * @returns {Promise<'BLOCK'|'ALLOW'>}
 * @throws {Error} On API error or timeout — caller must handle (block on throw)
 */
async function classifyWithHaiku(content, matchedTerm, excludedTerms, contextChars = 100) {
  // Sanitize all excluded terms before prompt interpolation
  const sanitizedTerms = excludedTerms
    .map(sanitizeTermForPrompt)
    .filter(t => t !== null);

  // Sanitize the matched term for user message interpolation
  const sanitizedMatchedTerm = sanitizeTermForPrompt(matchedTerm) || matchedTerm.slice(0, 50);

  // Extract minimal context windows around keyword matches (privacy-preserving)
  const contextWindows = [];
  // Same matcher Stage 1 used, so a hit found via injected whitespace ("Asa na")
  // can still be located here rather than yielding an empty excerpt list.
  const termRegex = buildTermRegex(matchedTerm, 'gi');
  termRegex.lastIndex = 0;
  let match;
  let windowCount = 0;

  while ((match = termRegex.exec(content)) !== null && windowCount < 3) {
    const start = Math.max(0, match.index - contextChars);
    const end = Math.min(content.length, match.index + match[0].length + contextChars);
    const window = content.slice(start, end);
    contextWindows.push(`...${window}...`);
    windowCount++;
  }

  const systemPrompt = `You are a content filter. Classify the following content excerpt as BLOCK or ALLOW.
BLOCK: content that is about or from these organizations — their architecture, internal processes, client data, confidential strategy, or internal people: ${sanitizedTerms.join(', ')}
ALLOW: neutral tool references ("tracked in Asana"), career narrative ("led a team at Genesys"), generic industry mentions.

BLOCK examples:
- "The Genesys Cloud routing configuration for ISPN queue handling..." (architecture/operations)
- "Asana project ID 12345 with client Acme..." (client data)

ALLOW examples:
- "I led a 12-person contact center team at Genesys." (career narrative)
- "Tracked in Asana" (neutral tool reference)
- "Genesys is a common CCaaS vendor in the enterprise market." (generic industry mention)

Respond with only the word BLOCK or ALLOW.`;

  const userMessage = `Classify these excerpts around the term '${sanitizedMatchedTerm}':\n\n${contextWindows.join('\n\n')}`;

  const { config: pipelineConfig } = safeLoadPipelineConfig();
  const haikuTimeout = (pipelineConfig && pipelineConfig.thresholds && pipelineConfig.thresholds.haikuTimeoutMs) || 2000;

  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 10,
    timeout: haikuTimeout,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].text.trim().toUpperCase();
  // Positively assert ALLOW (D-08). Testing for BLOCK instead would fail OPEN on any
  // unrecognized reply — "BLOCKED", "BLOCK.", prose, or an empty string would all read as
  // permission to pass. Only the exact word ALLOW allows; everything else blocks.
  return text === 'ALLOW' ? 'ALLOW' : 'BLOCK';
}

// ── Content sanitization (paragraph-level, contamination radius) ──────────────

/**
 * Sanitize content by removing paragraphs that contain excluded terms.
 * Uses paragraph-level stripping with contamination radius: entire paragraph
 * replaced when ANY excluded term appears (adjacent sentences share context).
 *
 * [REDACTED] marker behavior:
 *   - Each redacted paragraph replaced with literal "[REDACTED]" on its own line
 *   - No information about what was redacted included in the marker
 *   - Quarantine metadata file (from Plan 01) records reason and original path
 *   - Consumers treat [REDACTED] as compliance redaction; check proposals/ for quarantine record
 *
 * Threshold: if redactedCount > totalParagraphs / 2, content is primarily excluded —
 * gateway should quarantine instead of writing sanitized version.
 *
 * @param {string} content - Note content to sanitize
 * @param {string[]} excludedTerms - Terms to check for
 * @returns {{ sanitized: string, redactedCount: number, markers: string[] }}
 */
function sanitizeContent(content, excludedTerms) {
  // Split on double-newline (paragraph boundary)
  const paragraphs = content.split('\n\n');
  let redactedCount = 0;
  const markers = [];

  const sanitizedParagraphs = paragraphs.map((paragraph, idx) => {
    // Whole-token, Unicode- and whitespace-tolerant match (see buildTermRegex)
    if (findExcludedTerm(paragraph, excludedTerms) !== null) {
      redactedCount++;
      markers.push(`[REDACTED] (paragraph ${idx + 1} of ${paragraphs.length})`);
      return '[REDACTED]';
    }

    return paragraph;
  });

  return {
    sanitized: sanitizedParagraphs.join('\n\n'),
    redactedCount,
    markers,
  };
}

// ── Two-stage content check ───────────────────────────────────────────────────

/**
 * Two-stage content filter.
 * Stage 1: Keyword scan (zero-latency common case — most content passes here).
 * Stage 2: Haiku classification (fires only on Stage 1 match).
 *
 * Haiku context window size is configurable — pass via contextChars parameter.
 *
 * @param {string} content - Note content to check
 * @param {string[]} excludedTerms - Keyword list from config/excluded-terms.json
 * @param {number} [contextChars=100] - Chars to extract for Haiku context windows
 * @returns {Promise<{ decision: 'PASS' } | { decision: 'BLOCK', reason: string, matchedTerm: string }>}
 */
async function checkContent(content, excludedTerms, contextChars = 100) {
  // Stage 1: Keyword scan (whole-token match; content normalized once inside)
  const matchedTerm = findExcludedTerm(content, excludedTerms);

  // No match — immediate PASS (zero-latency common case per D-06)
  if (matchedTerm === null) {
    return { decision: 'PASS' };
  }

  // Stage 2: Haiku classification
  try {
    const classification = await classifyWithHaiku(content, matchedTerm, excludedTerms, contextChars);

    if (classification === 'BLOCK') {
      return {
        decision: 'BLOCK',
        reason: `Excluded content detected (term: ${matchedTerm})`,
        matchedTerm,
      };
    }

    // Haiku says ALLOW — career narrative or neutral reference
    return { decision: 'PASS' };
  } catch (err) {
    // Haiku unavailable or error — fail closed (BLOCK), never silent bypass (D-08)
    return {
      decision: 'BLOCK',
      reason: `Haiku unavailable, queued for review (${err.message})`,
      matchedTerm,
    };
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  buildTermRegex,
  checkContent,
  classifyWithHaiku,
  findExcludedTerm,
  normalizeForMatch,
  sanitizeContent,
  sanitizeTermForPrompt,
};

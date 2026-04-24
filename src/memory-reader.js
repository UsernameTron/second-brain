'use strict';

/**
 * memory-reader.js
 *
 * Read-path module for the compounding memory layer (Phase 18).
 *
 * Exports:
 *   - readMemory(): parse memory/memory.md into structured entries
 *   - searchMemoryKeyword(query, options): ranked keyword search via minisearch
 *   - getMemoryEcho(connectorResults, options): relevance-scored entries for /today
 *
 * @module memory-reader
 */

const fs = require('fs');
const path = require('path');
const MiniSearch = require('minisearch');
const { computeHash } = require('./utils/memory-utils');

// ── Constants ─────────────────────────────────────────────────────────────────

const VAULT_ROOT = () => process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');
const MEMORY_FILE = () => path.join(VAULT_ROOT(), 'memory', 'memory.md');

const DEFAULT_ECHO_THRESHOLD = 0.65;
const SNIPPET_MAX = 100;
const MAX_ECHO_ENTRIES = 5;

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Extract a snippet from content centered around the first occurrence of a term.
 * Falls back to the first SNIPPET_MAX characters if no term position found.
 *
 * @param {string} content
 * @param {string} [term]
 * @returns {string} Snippet of at most SNIPPET_MAX characters
 */
function _snippet(content, term) {
  if (!content) return '';
  if (term) {
    const lc = content.toLowerCase();
    const idx = lc.indexOf(term.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(content.length, idx + 60);
      const raw = content.slice(start, end).trim();
      return raw.slice(0, SNIPPET_MAX);
    }
  }
  return content.slice(0, SNIPPET_MAX);
}

/**
 * Parse inline `key:: value` fields from body lines.
 * Lines before the first `::` are content; lines with `::` are fields.
 *
 * @param {string[]} lines
 * @returns {{ fields: Object<string, string>, contentLines: string[] }}
 */
function _parseFields(lines) {
  const fields = {};
  const contentLines = [];
  let inFields = false;

  for (const line of lines) {
    if (!inFields && line.includes('::')) {
      inFields = true;
    }
    if (inFields) {
      const colonIdx = line.indexOf('::');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 2).trim();
        fields[key] = value;
      }
    } else {
      contentLines.push(line);
    }
  }

  return { fields, contentLines };
}

// ── readMemory() ──────────────────────────────────────────────────────────────

/**
 * Parse memory/memory.md into structured entry objects.
 *
 * Returns an empty array (no throw) when memory.md does not exist.
 * Skips entries with malformed headers (missing ' · ' separators),
 * emitting a warning to stderr for each skipped entry.
 *
 * @returns {Promise<Array<{
 *   id: string,
 *   category: string,
 *   content: string,
 *   date: string,
 *   sourceRef: string,
 *   contentHash: string,
 *   tags: string,
 *   related: string,
 *   addedAt: string
 * }>>}
 */
async function readMemory() {
  let raw;
  try {
    raw = await fs.promises.readFile(MEMORY_FILE(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const entries = [];
  let index = 0;

  // Split file on entry boundaries (lines beginning with "### ")
  const chunks = raw.split(/\n(?=### )/);

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith('### ')) {
      // Month header or preamble — skip
      continue;
    }

    // First line is the entry header line
    const newlineIdx = trimmed.indexOf('\n');
    const headerLine = newlineIdx >= 0
      ? trimmed.slice(4, newlineIdx).trim()
      : trimmed.slice(4).trim();
    const bodyText = newlineIdx >= 0 ? trimmed.slice(newlineIdx + 1) : '';

    // Validate: header must split into at least 3 segments on ' · '
    const segments = headerLine.split(' · ');
    if (segments.length < 3) {
      process.stderr.write(
        `[memory-reader] Skipping malformed entry header: "${headerLine}"\n`
      );
      continue;
    }

    const date = segments[0].trim();
    const categoryFromHeader = segments[1].trim();

    // Parse body into content + inline fields
    const bodyLines = bodyText.split('\n');
    const { fields, contentLines } = _parseFields(bodyLines);

    const content = contentLines.join('\n').trim();
    const category = fields['category'] || categoryFromHeader;
    const sourceRef = fields['source-ref'] || segments[2].trim();
    const contentHash = fields['content_hash'] || computeHash(content);
    const tags = fields['tags'] || '';
    const related = fields['related'] || '';
    const addedAt = fields['added'] || '';
    const id = contentHash || `mem-${date}-${String(index).padStart(3, '0')}`;

    index++;

    entries.push({ id, category, content, date, sourceRef, contentHash, tags, related, addedAt });
  }

  return entries;
}

// ── searchMemoryKeyword() ─────────────────────────────────────────────────────

/**
 * Ranked keyword search over the memory file using minisearch.
 *
 * Supports AND semantics, quoted phrases, negation tokens (-term),
 * category filter, and date-range filter (since/until).
 * Each result includes a `snippet` field of at most 100 characters.
 *
 * @param {string} query
 * @param {{ category?: string, since?: string, until?: string }} [options={}]
 * @returns {Promise<Array<Object>>} Results sorted by score descending
 */
async function searchMemoryKeyword(query, options = {}) {
  const entries = await readMemory();
  if (entries.length === 0 || !query) return [];

  // ── Query preprocessing ───────────────────────────────────────────────────

  const negationTokens = [];
  const quotedPhrases = [];
  let cleanQuery = query;

  // Extract quoted phrases
  const phraseRegex = /"([^"]+)"/g;
  let phraseMatch;
  while ((phraseMatch = phraseRegex.exec(query)) !== null) {
    quotedPhrases.push(phraseMatch[1].toLowerCase());
  }
  cleanQuery = cleanQuery.replace(/"[^"]*"/g, '').trim();

  // Extract negation tokens and positive tokens
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  const positiveTokens = [];
  for (const token of tokens) {
    if (token.startsWith('-') && token.length > 1) {
      negationTokens.push(token.slice(1).toLowerCase());
    } else {
      positiveTokens.push(token);
    }
  }
  cleanQuery = positiveTokens.join(' ').trim();

  // ── Build minisearch index ────────────────────────────────────────────────

  const index = new MiniSearch({
    fields: ['content', 'category', 'sourceRef', 'tags'],
    storeFields: ['id', 'category', 'content', 'date', 'sourceRef', 'contentHash', 'tags'],
    searchOptions: {
      combineWith: 'AND',
      prefix: true,
      fuzzy: 0.2,
    },
  });

  index.addAll(entries);

  // ── Execute search ────────────────────────────────────────────────────────

  let results = [];

  if (cleanQuery) {
    results = index.search(cleanQuery);
  } else if (quotedPhrases.length > 0) {
    // Phrase-only query: evaluate all entries as candidates
    results = entries.map(e => ({ ...e, score: 1.0, match: {} }));
  }

  // ── Post-filtering ────────────────────────────────────────────────────────

  results = results.filter(r => {
    const contentLc = (r.content || '').toLowerCase();

    // Negation: exclude entries whose content contains any negation token
    for (const neg of negationTokens) {
      if (contentLc.includes(neg)) return false;
    }

    // Quoted phrases: entry must contain every phrase as a substring
    for (const phrase of quotedPhrases) {
      if (!contentLc.includes(phrase)) return false;
    }

    // Category filter (exact match)
    if (options.category && r.category !== options.category) return false;

    // Date-range filters
    if (options.since && r.date < options.since) return false;
    if (options.until && r.date > options.until) return false;

    return true;
  });

  // ── Add snippets, sort by score descending ────────────────────────────────

  const anchorTerm = positiveTokens[0] || (quotedPhrases.length > 0 ? quotedPhrases[0].split(' ')[0] : null);

  results = results.map(r => ({
    ...r,
    snippet: _snippet(r.content, anchorTerm),
  }));

  results.sort((a, b) => (b.score || 0) - (a.score || 0));

  return results;
}

// ── getMemoryEcho() ───────────────────────────────────────────────────────────

/**
 * Score memory entries for relevance to today's calendar/email context.
 *
 * Extracts topics from connectorResults (calendar summaries + gmail subjects),
 * scores each memory entry by how many topic tokens appear in its content/tags,
 * and returns entries exceeding the threshold (top MAX_ECHO_ENTRIES).
 *
 * @param {Object|null|undefined} connectorResults
 * @param {{ threshold?: number }} [options={}]
 * @returns {Promise<{ entries: Array<Object>, score: number }>}
 */
async function getMemoryEcho(connectorResults, options = {}) {
  // Guard: null/undefined connectorResults
  if (connectorResults === null || connectorResults === undefined) {
    return { entries: [], score: 0 };
  }

  const threshold = options.threshold !== null && options.threshold !== undefined ? options.threshold : DEFAULT_ECHO_THRESHOLD;

  // ── Extract topic bag from connectors ─────────────────────────────────────

  const topicStrings = [];

  if (connectorResults.calendar && connectorResults.calendar.success) {
    for (const evt of (connectorResults.calendar.data || [])) {
      if (evt && evt.summary) topicStrings.push(evt.summary);
    }
  }

  if (connectorResults.gmail && connectorResults.gmail.success) {
    for (const em of (connectorResults.gmail.data || [])) {
      if (em && em.subject) topicStrings.push(em.subject);
    }
  }

  if (topicStrings.length === 0) {
    return { entries: [], score: 0 };
  }

  // Tokenize: lowercase, strip punctuation, split, dedupe
  const allTokens = topicStrings
    .join(' ')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const topicTokens = [...new Set(allTokens)];

  if (topicTokens.length === 0) {
    return { entries: [], score: 0 };
  }

  // ── Score each entry ──────────────────────────────────────────────────────

  const entries = await readMemory();

  const scored = entries.map(entry => {
    const haystack = [
      entry.content || '',
      entry.category || '',
      entry.tags || '',
    ].join(' ').toLowerCase();

    let matches = 0;
    for (const token of topicTokens) {
      if (haystack.includes(token)) matches++;
    }

    const score = matches / topicTokens.length;
    return { entry, score };
  });

  // Filter by threshold, sort desc, take top MAX_ECHO_ENTRIES
  const qualifying = scored
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ECHO_ENTRIES);

  if (qualifying.length === 0) {
    return { entries: [], score: 0 };
  }

  const maxScore = qualifying[0].score;
  const firstToken = topicTokens[0] || null;

  const resultEntries = qualifying.map(s => ({
    ...s.entry,
    snippet: _snippet(s.entry.content, firstToken),
    score: s.score,
  }));

  return { entries: resultEntries, score: maxScore };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { readMemory, searchMemoryKeyword, getMemoryEcho };

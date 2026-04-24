'use strict';

/**
 * wikilink-engine.js
 *
 * Vault index cache and hybrid wikilink suggestion pipeline for Stage 4 enrichment.
 *
 * Pipeline (D-17 through D-20):
 *   1. Build/load vault index from vault directories ({path, title, firstLine, tags})
 *   2. Cheap first pass: filename/title/tag overlap scoring → top 20 candidates
 *   3. Haiku re-rank: semantic relevance scoring with threshold filter
 *   4. Format output as ## Related (RIGHT) or ## Suggested wikilinks (LEFT proposals)
 *
 * Key design decisions:
 *   - Index persisted to .cache/vault-index.json — no full vault scan per /new call (D-18)
 *   - proposals/ directory excluded from index — transient files, not linkable (D-18)
 *   - Haiku failure gracefully degrades to filename-match results — never blocks write (D-39)
 *   - CACHE_DIR_OVERRIDE env var for test isolation
 *
 * @module wikilink-engine
 */

const fs = require('fs');
const path = require('path');

// ── Path resolution ──────────────────────────────────────────────────────────

const VAULT_ROOT = process.env.VAULT_ROOT
  || path.join(process.env.HOME, 'Claude Cowork');

const _CONFIG_DIR = process.env.CONFIG_DIR_OVERRIDE
  || path.join(__dirname, '..', 'config');

/**
 * Cache directory. Overridable via CACHE_DIR_OVERRIDE for test isolation.
 * Default: .cache/ adjacent to the project root (one level up from src/).
 */
function getCacheDir() {
  return process.env.CACHE_DIR_OVERRIDE
    || path.join(__dirname, '..', '.cache');
}

function getCacheFile() {
  return path.join(getCacheDir(), 'vault-index.json');
}

// ── Config loading ───────────────────────────────────────────────────────────

// loadVaultPaths and loadPipelineConfig consolidated into pipeline-infra.js (T12.2, T12.3)
const { safeLoadVaultPaths, safeLoadPipelineConfig } = require('./pipeline-infra');

// ── Frontmatter parsing ──────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from note content.
 * Returns { title, tags, bodyStart } — bodyStart is the index where body begins.
 *
 * Supports simple scalar `title:` and both inline `tags: [a, b]` and block `tags:\n  - a` formats.
 *
 * @param {string} content - Full file content
 * @returns {{ title: string|null, tags: string[], bodyLines: string[] }}
 */
function parseFrontmatter(content) {
  const lines = content.split('\n');
  let title = null;
  const tags = [];
  let inFrontmatter = false;
  let inTagsBlock = false;
  let bodyStartIdx = 0;
  let frontmatterClosed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      continue;
    }

    if (inFrontmatter) {
      if (line.trim() === '---') {
        frontmatterClosed = true;
        bodyStartIdx = i + 1;
        break;
      }

      // Parse title
      const titleMatch = line.match(/^title:\s*(.+)/);
      if (titleMatch) {
        title = titleMatch[1].trim().replace(/^['"]|['"]$/g, '');
        inTagsBlock = false;
        continue;
      }

      // Parse tags (inline array format: tags: [a, b, c])
      const tagsInlineMatch = line.match(/^tags:\s*\[(.+)\]/);
      if (tagsInlineMatch) {
        const tagList = tagsInlineMatch[1].split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        tags.push(...tagList);
        inTagsBlock = false;
        continue;
      }

      // Parse tags (block format start: tags:)
      const tagsBlockMatch = line.match(/^tags:\s*$/);
      if (tagsBlockMatch) {
        inTagsBlock = true;
        continue;
      }

      // Parse tags (block format items: - tagname)
      if (inTagsBlock) {
        const tagItemMatch = line.match(/^\s+-\s+(.+)/);
        if (tagItemMatch) {
          tags.push(tagItemMatch[1].trim().replace(/^['"]|['"]$/g, ''));
          continue;
        } else {
          inTagsBlock = false;
        }
      }
    }
  }

  const bodyLines = frontmatterClosed ? lines.slice(bodyStartIdx) : lines;
  return { title, tags, bodyLines };
}

/**
 * Extract the first non-empty, non-frontmatter line from body lines.
 * Caps at 200 characters.
 *
 * @param {string[]} bodyLines
 * @returns {string}
 */
function extractFirstLine(bodyLines) {
  for (const line of bodyLines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed.slice(0, 200);
    }
  }
  return '';
}

// ── Index management ─────────────────────────────────────────────────────────

/**
 * Extract metadata from a file's content for indexing.
 *
 * @param {string} relativePath - Vault-relative path
 * @param {string} content - File content
 * @returns {{ path: string, title: string, firstLine: string, tags: string[] }}
 */
function extractNoteMetadata(relativePath, content) {
  const { title, tags, bodyLines } = parseFrontmatter(content);
  const filename = path.basename(relativePath, '.md');
  const firstLine = extractFirstLine(bodyLines);

  return {
    path: relativePath,
    title: title || filename,
    firstLine,
    tags,
  };
}

/**
 * Recursively collect all .md files under a directory, returning relative vault paths.
 *
 * @param {string} absDir - Absolute directory path
 * @param {string} relBase - Relative base path (vault-relative prefix)
 * @returns {string[]} Array of vault-relative file paths
 */
function collectMarkdownFiles(absDir, relBase) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (_) {
    return results;
  }
  for (const entry of entries) {
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(path.join(absDir, entry.name), relPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(relPath);
    }
  }
  return results;
}

/**
 * Build the vault index by scanning all vault directories.
 * Excludes files in the proposals/ directory (transient, not linkable per D-18).
 * Writes result to .cache/vault-index.json.
 * Creates .cache/ directory if missing.
 *
 * @returns {Promise<Array<{ path: string, title: string, firstLine: string, tags: string[] }>>}
 */
async function buildVaultIndex() {
  const vaultPaths = safeLoadVaultPaths();
  const allDirs = [...(vaultPaths.left || []), ...(vaultPaths.right || [])];

  const index = [];

  for (const dir of allDirs) {
    // Skip proposals/ entirely — transient files should not be linked
    if (dir === 'proposals' || dir.startsWith('proposals/')) continue;

    const absDir = path.join(VAULT_ROOT, dir);
    const files = collectMarkdownFiles(absDir, dir);

    for (const relPath of files) {
      // Extra guard: skip any file that somehow ended up under proposals/
      if (relPath.startsWith('proposals/')) continue;

      const absPath = path.join(VAULT_ROOT, relPath);
      try {
        const content = await fs.promises.readFile(absPath, 'utf8');
        index.push(extractNoteMetadata(relPath, content));
      } catch (_) {
        // File unreadable — skip silently
      }
    }
  }

  // Ensure .cache/ directory exists
  const cacheDir = getCacheDir();
  await fs.promises.mkdir(cacheDir, { recursive: true });

  // Write index to cache
  const cacheFile = getCacheFile();
  await fs.promises.writeFile(cacheFile, JSON.stringify(index, null, 2), 'utf8');

  return index;
}

/**
 * Load the vault index from .cache/vault-index.json.
 * Returns empty array on missing or corrupt file (graceful degradation per D-18).
 *
 * @returns {Promise<Array<{ path: string, title: string, firstLine: string, tags: string[] }>>}
 */
async function loadVaultIndex() {
  const cacheFile = getCacheFile();
  try {
    const raw = await fs.promises.readFile(cacheFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error('[wikilink-engine] vault-index.json is not an array — returning empty index');
      return [];
    }
    return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[wikilink-engine] Failed to load vault index: ${err.message} — returning empty index`);
    }
    return [];
  }
}

/**
 * Refresh a single index entry after a vault write.
 * Updates existing entry or appends new entry if not found.
 * Called by vault-gateway after successful write (D-18).
 *
 * @param {string} relativePath - Vault-relative path of the written file
 * @returns {Promise<void>}
 */
async function refreshIndexEntry(relativePath) {
  // Skip proposals/ files — they should never be in the index
  if (relativePath.startsWith('proposals/')) return;

  const index = await loadVaultIndex();

  const absPath = path.join(VAULT_ROOT, relativePath);
  let content;
  try {
    content = await fs.promises.readFile(absPath, 'utf8');
  } catch (_) {
    // File unreadable — skip
    return;
  }

  const metadata = extractNoteMetadata(relativePath, content);
  const existingIdx = index.findIndex(e => e.path === relativePath);

  if (existingIdx >= 0) {
    index[existingIdx] = metadata;
  } else {
    index.push(metadata);
  }

  // Ensure cache dir exists
  const cacheDir = getCacheDir();
  await fs.promises.mkdir(cacheDir, { recursive: true });

  const cacheFile = getCacheFile();
  await fs.promises.writeFile(cacheFile, JSON.stringify(index, null, 2), 'utf8');
}

// ── Wikilink suggestion pipeline ─────────────────────────────────────────────

/**
 * Tokenize text into lowercase words, filtering out short/common words.
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length > 3);
}

/**
 * Extract proper nouns from text: capitalized words not at sentence start.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractProperNouns(text) {
  const words = text.split(/\s+/);
  const properNouns = [];
  for (let i = 1; i < words.length; i++) {
    const word = words[i].replace(/[^\w]/g, '');
    if (word.length > 2 && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
      properNouns.push(word.toLowerCase());
    }
  }
  return properNouns;
}

/**
 * Score an index entry against input tokens.
 * Scoring weights per D-19:
 *   - Title overlap: 3 points per shared token
 *   - FirstLine overlap: 1 point per shared token
 *   - Tag overlap: 2 points per shared tag
 *
 * @param {{ title, firstLine, tags }} entry
 * @param {string[]} inputTokens - Tokenized input words
 * @param {string[]} inputTags - Tags from the note being processed
 * @returns {number} Score (higher = more relevant)
 */
function scoreEntry(entry, inputTokens, inputTags) {
  const titleTokens = tokenize(entry.title);
  const firstLineTokens = tokenize(entry.firstLine || '');
  const entryTags = entry.tags || [];

  let score = 0;

  // Title overlap (weight 3)
  for (const t of inputTokens) {
    if (titleTokens.includes(t)) score += 3;
  }

  // FirstLine overlap (weight 1)
  for (const t of inputTokens) {
    if (firstLineTokens.includes(t)) score += 1;
  }

  // Tag overlap (weight 2)
  for (const tag of inputTags) {
    if (entryTags.includes(tag)) score += 2;
  }

  return score;
}

/**
 * Suggest wikilinks for a note using the hybrid pipeline (D-17/D-19).
 *
 * Pipeline:
 *   1. Tokenize input + extract proper nouns + pull tags
 *   2. Score all index entries → top candidatePoolSize candidates
 *   3. Haiku re-rank with relevance threshold
 *   4. Format output section
 *
 * @param {string} noteBody - The note content to find links for
 * @param {string[]} noteTags - Tags from the note
 * @param {object} [options={}]
 * @param {boolean} [options.isLeftProposal=false] - If true, use "## Suggested wikilinks" header
 * @param {string} [options.correlationId] - For logging
 * @returns {Promise<{ section: string, links: Array<{ path, title, relevance, reason }> }>}
 */
async function suggestWikilinks(noteBody, noteTags = [], options = {}) {
  const { isLeftProposal = false, correlationId = 'none' } = options;

  const EMPTY_RESULT = { section: '', links: [] };

  // Step 1: Load index
  const index = await loadVaultIndex();
  if (index.length === 0) return EMPTY_RESULT;

  // Load pipeline config for thresholds
  const { config: pipelineConfig } = safeLoadPipelineConfig();
  if (!pipelineConfig) return EMPTY_RESULT;

  const {
    relevanceThreshold,
    maxSuggestions,
    candidatePoolSize,
  } = pipelineConfig.wikilink;

  // Step 1: Tokenize + proper nouns + tags
  const bodyTokens = tokenize(noteBody);
  const properNouns = extractProperNouns(noteBody);
  const allInputTokens = [...new Set([...bodyTokens, ...properNouns])];
  const inputTags = Array.isArray(noteTags) ? noteTags : [];

  // Step 2: Cheap first pass — score and rank candidates
  const scored = index
    .map(entry => ({ entry, score: scoreEntry(entry, allInputTokens, inputTags) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, candidatePoolSize)
    .map(({ entry }) => entry);

  if (scored.length === 0) return EMPTY_RESULT;

  // Step 3: Haiku re-rank
  let rankedLinks;
  let usedFallback = false;

  try {
    const { createHaikuClient } = require('./pipeline-infra');
    const haiku = createHaikuClient();

    const candidateSummary = scored.map(e =>
      `- path: "${e.path}", title: "${e.title}", firstLine: "${(e.firstLine || '').slice(0, 100)}"`
    ).join('\n');

    const systemPrompt = [
      'You are a knowledge graph assistant. Given a note and candidate notes, rank candidates by relevance.',
      'Return ONLY a JSON array. Each element: { "path": "...", "relevance": 0.0-1.0, "reason": "6 word reason here" }',
      'Reason MUST be exactly 6 words or fewer. Be specific about the connection.',
    ].join('\n');

    const userContent = [
      'Note content:',
      noteBody.slice(0, 500),
      '',
      'Candidate notes:',
      candidateSummary,
    ].join('\n');

    const wikilinkTokenBudget = (pipelineConfig.thresholds && pipelineConfig.thresholds.wikilinkTokenBudget) || 1024;
    const result = await haiku.classify(systemPrompt, userContent, { correlationId, maxTokens: wikilinkTokenBudget });

    if (result.success && Array.isArray(result.data)) {
      // Filter by relevance threshold and take top maxSuggestions
      rankedLinks = result.data
        .filter(item => typeof item.relevance === 'number' && item.relevance >= relevanceThreshold)
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, maxSuggestions)
        .map(item => {
          // Find the corresponding index entry for title
          const indexEntry = index.find(e => e.path === item.path);
          return {
            path: item.path,
            title: indexEntry ? indexEntry.title : path.basename(item.path, '.md'),
            relevance: item.relevance,
            reason: item.reason || '',
          };
        });
    } else {
      // Haiku returned failure — use fallback (D-39: enrichment failure never blocks)
      usedFallback = true;
    }
  } catch (_) {
    usedFallback = true;
  }

  // Fallback: use top 3 filename-match candidates without reasons
  if (usedFallback) {
    rankedLinks = scored.slice(0, 3).map(entry => ({
      path: entry.path,
      title: entry.title,
      relevance: 0,
      reason: '',
    }));
  }

  if (!rankedLinks || rankedLinks.length === 0) return EMPTY_RESULT;

  // Step 4: Format output
  const header = isLeftProposal ? '## Suggested wikilinks' : '## Related';
  const linkLines = rankedLinks.map(link => {
    const wikilink = `[[${link.title}]]`;
    return link.reason
      ? `- ${wikilink} — ${link.reason}`
      : `- ${wikilink}`;
  });

  const section = [header, ...linkLines].join('\n');

  return { section, links: rankedLinks };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  buildVaultIndex,
  loadVaultIndex,
  refreshIndexEntry,
  suggestWikilinks,
};

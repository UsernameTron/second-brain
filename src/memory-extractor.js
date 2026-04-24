'use strict';

/**
 * memory-extractor.js
 *
 * Memory extraction pipeline: reads session transcripts and vault files,
 * sends content to Haiku for memory candidate identification, and writes
 * candidates to proposals/memory-proposals.md via memory-proposals.js.
 *
 * Per MEM-01 requirements:
 *   - Extracts candidates from session transcripts on /wrap (Stop hook)
 *   - Extracts candidates from vault files on /extract-memories command
 *   - Every candidate has source attribution: session_id, captured_at, source_file
 *   - Dedup by content_hash before writing (D-27/D-66)
 *   - Oversized transcripts chunked: 100-message windows, 10-message overlap (D-46)
 *   - Extraction failure never blocks /wrap (D-64)
 *
 * @module memory-extractor
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createHaikuClient, loadPipelineConfig, loadMemoryCategoriesConfig } = require('./pipeline-infra');
const { writeCandidate } = require('./memory-proposals');

// ── Constants ────────────────────────────────────────────────────────────────

const VAULT_ROOT = process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');

// Tool names whose raw output should be excluded from extraction
const EXCLUDED_TOOL_NAMES = ['Read', 'Glob', 'Grep', 'Bash'];

// Keywords that indicate high-signal content (git/PR) — weighted 2x
const HIGH_SIGNAL_PATTERNS = [
  /git diff/i,
  /pull request/i,
  /\bPR\b.*merged/i,
  /merged.*\bPR\b/i,
  /diff --git/i,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute content_hash for dedup.
 * @param {string} content
 * @returns {string}
 */
function computeHash(content) {
  return crypto.createHash('sha256').update(content.trim().toLowerCase()).digest('hex').slice(0, 12);
}

/**
 * Check if a message should be excluded from the extraction corpus.
 * Excludes per D-45:
 *   - system-reminder messages (role === 'system')
 *   - messages < 20 chars
 *   - raw Read/Glob/Grep/Bash-ls tool output
 *
 * @param {object} msg - Parsed JSONL message object
 * @returns {boolean} true if the message should be excluded
 */
function shouldExclude(msg) {
  if (msg.role === 'system') return true;

  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');

  if (content.length < 20) return true;

  // Exclude raw tool output for non-decision tools
  if (msg.role === 'tool' && msg.tool_name && EXCLUDED_TOOL_NAMES.includes(msg.tool_name)) {
    return true;
  }

  return false;
}

/**
 * Check if content is high-signal (git diff, PR content).
 * @param {string} content
 * @returns {boolean}
 */
function isHighSignal(content) {
  return HIGH_SIGNAL_PATTERNS.some((p) => p.test(content));
}

/**
 * Build the extraction system prompt from templates.json categories.
 * @returns {string}
 */
function buildSystemPrompt() {
  let categories;
  try {
    categories = loadMemoryCategoriesConfig();
  } catch (_) {
    categories = {
      DECISION: { description: 'A deliberate choice.', example: '', exclusions: '' },
      LEARNING: { description: 'A new understanding.', example: '', exclusions: '' },
      PREFERENCE: { description: 'A recurring preference.', example: '', exclusions: '' },
      RELATIONSHIP: { description: 'Context about a person.', example: '', exclusions: '' },
      CONSTRAINT: { description: 'A hard boundary.', example: '', exclusions: '' },
      PATTERN: { description: 'A recurring effective approach.', example: '', exclusions: '' },
      OTHER: { description: 'Other memorable information with justification.', example: '', exclusions: '' },
    };
  }

  const categoryDescriptions = Object.entries(categories)
    .map(([name, def]) => {
      return [
        'Category: ' + name,
        'Description: ' + def.description,
        'Example: ' + (def.example || 'N/A'),
        'Exclusions: ' + (def.exclusions || 'N/A'),
      ].join('\n');
    })
    .join('\n\n');

  return [
    'You are a memory extraction assistant. Your job is to identify information worth remembering long-term from session transcripts and vault files.',
    '',
    'Extract candidates that fit one of these 7 categories:',
    '',
    categoryDescriptions,
    '',
    'EXCLUSION RULES (never extract these):',
    '- Routine actions (closing tickets, merging PRs, running tests)',
    '- Status updates with no decision or learning',
    '- Debugging steps that led nowhere',
    '- TODO items and task lists',
    '- Uninterpreted third-party quotes',
    '- ISPN, Genesys, or Asana content',
    '- Content already verbatim in memory.md',
    '- OTHER requires a one-sentence justification in the rationale field.',
    '',
    'Respond with a JSON array of candidates:',
    '[',
    '  {',
    '    "category": "DECISION|LEARNING|PREFERENCE|RELATIONSHIP|CONSTRAINT|PATTERN|OTHER",',
    '    "content": "one-paragraph proposed memory entry",',
    '    "source_ref": "session:<id> or file:<path>",',
    '    "confidence": 0.0-1.0,',
    '    "rationale": "why this is worth remembering"',
    '  }',
    ']',
    '',
    'Return [] if nothing meets the threshold.',
  ].join('\n');
}

/**
 * Process raw Haiku candidates: drop < 0.5, write >= 0.5.
 * @param {object[]} candidates - Raw candidates from Haiku
 * @param {string} sessionId
 * @param {string} sourceFile
 * @param {string} extractionTrigger
 * @param {Set} seenHashes - For cross-chunk dedup
 * @returns {Promise<object[]>} Results array
 */
async function processCandidates(candidates, sessionId, sourceFile, extractionTrigger, seenHashes) {
  let config;
  try {
    config = loadPipelineConfig();
  } catch (_) {
    config = { extraction: { confidenceLowConfidence: 0.5 } };
  }
  const confidenceLow = config.extraction.confidenceLowConfidence;

  const results = [];

  for (const candidate of candidates) {
    if (typeof candidate.confidence !== 'number' || candidate.confidence < confidenceLow) {
      // Drop below threshold
      continue;
    }

    const hash = computeHash(candidate.content);

    // Cross-chunk dedup
    if (seenHashes.has(hash)) {
      continue;
    }
    seenHashes.add(hash);

    const sourceRef = 'session:' + sessionId;

    const result = await writeCandidate({
      content: candidate.content,
      category: candidate.category,
      sourceRef,
      confidence: candidate.confidence,
      rationale: candidate.rationale || '',
      sessionId,
      sourceFile,
      extractionTrigger,
    });

    results.push({
      candidateId: result.candidateId,
      category: candidate.category,
      written: result.written,
      buffered: result.buffered || false,
    });
  }

  return results;
}

/**
 * Build corpus from message array, applying 2x weighting for high-signal content.
 * @param {object[]} messages
 * @returns {string}
 */
function buildCorpus(messages) {
  const parts = [];
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    parts.push(content);
    if (isHighSignal(content)) {
      // 2x weighting: include again with HIGH-SIGNAL prefix
      parts.push('[HIGH-SIGNAL] ' + content);
    }
  }
  return parts.join('\n\n');
}

// ── extractFromTranscript ────────────────────────────────────────────────────

/**
 * Extract memory candidates from a session transcript JSONL file.
 * Per D-44: streams line-by-line; per D-45: filters excluded messages;
 * per D-46: chunks if oversized.
 *
 * @param {string} transcriptPath - Absolute path to transcript .jsonl file
 * @param {string} sessionId - Session ID (from hook stdin)
 * @param {object} [options={}]
 * @param {object} [options._haikuClient] - Injected Haiku client (for testing)
 * @returns {Promise<object[]>} Array of extraction results
 */
async function extractFromTranscript(transcriptPath, sessionId, options = {}) {
  let config;
  try {
    config = loadPipelineConfig();
  } catch (_) {
    config = {
      extraction: {
        chunkSize: 100,
        chunkOverlap: 10,
        oversizeThresholdBytes: 5242880,
        oversizeThresholdMessages: 2000,
      },
    };
  }

  const { chunkSize, chunkOverlap, oversizeThresholdMessages } = config.extraction;
  const haiku = options._haikuClient || createHaikuClient();
  const systemPrompt = buildSystemPrompt();

  // Read transcript line-by-line
  const messages = [];
  try {
    const fileContent = fs.readFileSync(transcriptPath, 'utf8');
    const lines = fileContent.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (!shouldExclude(msg)) {
          messages.push(msg);
        }
      } catch (_) {
        // Malformed line — skip
      }
    }
  } catch (err) {
    console.error('[memory-extractor] Could not read transcript: ' + err.message);
    return [];
  }

  if (messages.length === 0) {
    return [];
  }

  const seenHashes = new Set();
  const allResults = [];

  try {
    if (messages.length <= oversizeThresholdMessages) {
      // Single pass
      const corpus = buildCorpus(messages);
      const response = await haiku.classify(systemPrompt, corpus);
      if (!response.success) {
        console.error('[memory-extractor] Haiku extraction failed: ' + (response.error || 'unknown'));
        return [];
      }
      const candidates = Array.isArray(response.data) ? response.data : [];
      const results = await processCandidates(candidates, sessionId, transcriptPath, 'wrap', seenHashes);
      allResults.push(...results);
    } else {
      // Chunked extraction per D-46
      let start = 0;
      while (start < messages.length) {
        const end = Math.min(start + chunkSize, messages.length);
        const chunk = messages.slice(start, end);
        const corpus = buildCorpus(chunk);

        const response = await haiku.classify(systemPrompt, corpus);
        if (response.success) {
          const candidates = Array.isArray(response.data) ? response.data : [];
          const results = await processCandidates(candidates, sessionId, transcriptPath, 'wrap', seenHashes);
          allResults.push(...results);
        } else {
          console.error('[memory-extractor] Chunk extraction failed at ' + start + ': ' + (response.error || 'unknown'));
        }

        // Advance with overlap
        start += chunkSize - chunkOverlap;
        if (start >= messages.length) break;
      }
    }
  } catch (err) {
    console.error('[memory-extractor] Extraction error: ' + err.message);
    return [];
  }

  return allResults;
}

// ── extractFromFile ──────────────────────────────────────────────────────────

/**
 * Extract memory candidates from a single vault file.
 * Source-ref: "file:<relative-vault-path>" per D-65.
 *
 * @param {string} relativePath - Relative vault path
 * @param {object} [options={}]
 * @param {object} [options._haikuClient] - Injected Haiku client (for testing)
 * @returns {Promise<object[]>}
 */
async function extractFromFile(relativePath, options = {}) {
  const haiku = options._haikuClient || createHaikuClient();
  const systemPrompt = buildSystemPrompt();

  let content;
  try {
    const absolutePath = path.join(VAULT_ROOT, relativePath);
    content = fs.readFileSync(absolutePath, 'utf8');
  } catch (err) {
    console.error('[memory-extractor] Could not read file ' + relativePath + ': ' + err.message);
    return [];
  }

  let response;
  try {
    response = await haiku.classify(systemPrompt, content);
  } catch (err) {
    console.error('[memory-extractor] Haiku call failed for ' + relativePath + ': ' + err.message);
    return [];
  }

  if (!response.success) {
    console.error('[memory-extractor] Haiku extraction failed for ' + relativePath + ': ' + (response.error || 'unknown'));
    return [];
  }

  const candidates = Array.isArray(response.data) ? response.data : [];
  const seenHashes = new Set();
  const results = [];

  let config;
  try {
    config = loadPipelineConfig();
  } catch (_) {
    config = { extraction: { confidenceLowConfidence: 0.5 } };
  }
  const confidenceLow = config.extraction.confidenceLowConfidence;

  for (const candidate of candidates) {
    if (typeof candidate.confidence !== 'number' || candidate.confidence < confidenceLow) {
      continue;
    }
    const hash = computeHash(candidate.content);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    const sourceRef = 'file:' + relativePath;
    const result = await writeCandidate({
      content: candidate.content,
      category: candidate.category,
      sourceRef,
      confidence: candidate.confidence,
      rationale: candidate.rationale || '',
      sessionId: 'manual',
      sourceFile: relativePath,
      extractionTrigger: 'extract-memories',
    });

    results.push({
      candidateId: result.candidateId,
      category: candidate.category,
      written: result.written,
    });
  }

  return results;
}

// ── extractFromDirectory ─────────────────────────────────────────────────────

/**
 * Extract memory candidates from all .md files in a directory.
 *
 * @param {string} relativeDir - Relative vault directory path
 * @param {object} [options={}]
 * @returns {Promise<object[]>} Aggregated results
 */
async function extractFromDirectory(relativeDir, options = {}) {
  const absoluteDir = path.join(VAULT_ROOT, relativeDir);
  let files;

  try {
    files = fs.readdirSync(absoluteDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(relativeDir, f));
  } catch (err) {
    console.error('[memory-extractor] Could not read directory ' + relativeDir + ': ' + err.message);
    return [];
  }

  const allResults = [];
  for (const file of files) {
    const results = await extractFromFile(file, options);
    allResults.push(...results);
  }

  return allResults;
}

// ── extractMemories ──────────────────────────────────────────────────────────

/**
 * Dispatch entry point for the /extract-memories command.
 * Routes to appropriate extractor based on options.
 *
 * @param {object} options
 * @param {string} [options.file] - Extract from single file
 * @param {string} [options.dir] - Extract from directory
 * @param {string} [options.since] - Filter Daily/ by date >= since (YYYY-MM-DD)
 * @param {string} [options.dailyRange] - "<start> <end>" date range for Daily/
 * @param {object} [options._haikuClient] - Injected for testing
 * @returns {Promise<object[]>}
 */
async function extractMemories(options = {}) {
  const { file, dir, since, dailyRange } = options;

  if (file) {
    return extractFromFile(file, options);
  }

  if (dir) {
    return extractFromDirectory(dir, options);
  }

  if (since || dailyRange) {
    // Filter Daily/ directory by date
    const dailyAbsDir = path.join(VAULT_ROOT, 'Daily');
    let files;
    try {
      files = fs.readdirSync(dailyAbsDir).filter((f) => f.endsWith('.md'));
    } catch (_) {
      return [];
    }

    let filtered;
    if (since) {
      filtered = files.filter((f) => {
        const datePart = path.basename(f, '.md');
        return datePart >= since;
      });
    } else if (dailyRange) {
      const parts = dailyRange.split(' ');
      const start = parts[0];
      const end = parts[1];
      filtered = files.filter((f) => {
        const datePart = path.basename(f, '.md');
        return datePart >= start && datePart <= end;
      });
    } else {
      filtered = files;
    }

    const allResults = [];
    for (const f of filtered) {
      const relPath = path.join('Daily', f);
      const results = await extractFromFile(relPath, options);
      allResults.push(...results);
    }
    return allResults;
  }

  return [];
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  extractFromTranscript,
  extractFromFile,
  extractFromDirectory,
  extractMemories,
};

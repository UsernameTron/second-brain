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

const { createHaikuClient, loadPipelineConfig, loadMemoryCategoriesConfig, loadExcludedTerms } = require('./pipeline-infra');
const { computeHash } = require('./utils/memory-utils');
const { writeCandidate } = require('./memory-proposals');
const { checkContent } = require('./content-policy');

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
 * Record a hard extraction failure on a results array.
 *
 * A failed extraction used to be indistinguishable from an empty one: every error
 * path collapsed to a bare []. Callers now check `results.errors` to tell the two
 * apart (see scripts/wrap.js, scripts/daily-sweep.js).
 *
 * ponytail: errors ride on the results array as a non-enumerable property (like
 * RegExp.exec's .index) so every existing consumer's .length / Array.isArray /
 * toEqual([]) keeps working, and partial results survive alongside the failures
 * that produced them. Extraction still never throws (D-64).
 *
 * @param {object[]} results - Results array to tag (mutated)
 * @param {string} mode - Failure mode: read-error | api-error | timeout | parse-error | extraction-error
 * @param {string} message - Human-readable failure detail
 * @returns {object[]} The same results array
 */
function recordFailure(results, mode, message) {
  if (!results.errors) {
    Object.defineProperty(results, 'errors', { value: [], enumerable: false });
  }
  results.errors.push({ mode, message });
  return results;
}

/**
 * Merge failures recorded on a child results array into a parent array.
 * Without this the signal dies at every aggregation boundary.
 *
 * @param {object[]} parent - Aggregate results array (mutated)
 * @param {object[]} child - Results returned by a nested extractor call
 * @returns {object[]} The parent array
 */
function mergeFailures(parent, child) {
  if (child && child.errors) {
    for (const e of child.errors) recordFailure(parent, e.mode, e.message);
  }
  return parent;
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

    // INGRESS-GATE-01: fail-closed exclusion check before staging (ISPN/Genesys/Asana).
    const verdict = await checkContent(candidate.content, loadExcludedTerms());
    if (verdict.decision !== 'PASS') {
      continue;
    }

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

  const { chunkSize, chunkOverlap, oversizeThresholdBytes, oversizeThresholdMessages } = config.extraction;
  const haiku = options._haikuClient || createHaikuClient();
  // A1: hook-driven callers pass a timeoutMs budget (Stop hook dies at 60s).
  // The budget is a single extraction-wide deadline, not a per-call timeout —
  // N chunks x full budget each would blow the hook's lifetime.
  const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : null;
  const DEADLINE_FLOOR_MS = 2000;
  const budgetedOptions = () => {
    const o = { maxTokens: 8192 };
    if (deadline) o.timeoutMs = Math.max(deadline - Date.now(), 1);
    return o;
  };
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
    // eslint-disable-next-line no-console -- last-resort-error: Transcript read failed; extractor returns [] tagged with errors
    console.error('[memory-extractor] Could not read transcript: ' + err.message);
    return recordFailure([], 'read-error', 'Could not read transcript: ' + err.message);
  }

  // O1 shadow (ctg-model-forge Phase 3): score the two local arms on this
  // transcript, log-only. Daily-sweep path only — the Stop hook passes a
  // timeoutMs budget and must never pay for this. It cannot change what is
  // sent or written: the shim reads the file itself and every failure stays inside.
  if (process.env.O1_SHADOW === '1' && !options.timeoutMs) {
    try {
      await require('./o1-shadow').shadow(transcriptPath, sessionId);
    } catch (_) { /* log-only */ }
  }

  if (messages.length === 0) {
    return [];
  }

  const seenHashes = new Set();
  const allResults = [];

  try {
    // A3: chunk on byte size too — a corpus can blow the model context long
    // before it hits the message-count threshold (a 62,968-token payload
    // nearly overflowed a 65,536-token local context at <2000 messages).
    // Count check first: when the count alone forces chunking, don't
    // materialize the full (high-signal-doubled) corpus just to measure it.
    let fullCorpus = null;
    if (messages.length <= oversizeThresholdMessages) {
      const candidate = buildCorpus(messages);
      if (Buffer.byteLength(candidate, 'utf8') <= oversizeThresholdBytes) {
        fullCorpus = candidate;
      }
    }
    if (fullCorpus !== null) {
      // Single pass
      const corpus = fullCorpus;
      // ponytail: 4096 headroom for a whole-corpus JSON array of candidates (unbounded
      // count, unlike other classify() callers' single-object budgets). If a corpus still
      // truncates at this size, chunk it — don't just raise the number again.
      const response = await haiku.classify(systemPrompt, corpus, budgetedOptions());
      if (!response.success) {
        // eslint-disable-next-line no-console -- last-resort-error: Single-pass Haiku extraction failed; extractor returns [] tagged with errors
        console.error('[memory-extractor] Haiku extraction failed: ' + (response.error || 'unknown'));
        return recordFailure(
          [],
          response.failureMode || 'api-error',
          'Haiku extraction failed: ' + (response.error || 'unknown')
        );
      }
      if (!Array.isArray(response.data)) {
        // eslint-disable-next-line no-console -- last-resort-error: Haiku returned a non-array payload; extractor returns [] tagged with errors
        console.error('[memory-extractor] Haiku returned a non-array payload: ' + typeof response.data);
        return recordFailure([], 'parse-error', 'Haiku returned a non-array payload: ' + typeof response.data);
      }
      const results = await processCandidates(response.data, sessionId, transcriptPath, 'wrap', seenHashes);
      allResults.push(...results);
    } else {
      // Chunked extraction per D-46
      let start = 0;
      while (start < messages.length) {
        // Deadline check per chunk — stop staging partial results rather than
        // letting the Nth chunk run past the caller's (Stop hook's) lifetime.
        if (deadline && deadline - Date.now() <= DEADLINE_FLOOR_MS) {
          recordFailure(allResults, 'timeout', 'extraction deadline exhausted');
          break;
        }

        // Close the chunk on byte size as well as message count — a run of
        // large messages can blow the byte threshold well under chunkSize.
        let end = start;
        let bytes = 0;
        while (end < messages.length && end - start < chunkSize) {
          const msgBytes = Buffer.byteLength(buildCorpus([messages[end]]), 'utf8');
          if (end > start && bytes + msgBytes > oversizeThresholdBytes) break;
          bytes += msgBytes;
          end++;
        }
        const chunk = messages.slice(start, end);
        let corpus = buildCorpus(chunk);
        if (Buffer.byteLength(corpus, 'utf8') > oversizeThresholdBytes) {
          // Single message bigger than the threshold — truncate rather than skip.
          corpus = Buffer.from(corpus, 'utf8').subarray(0, oversizeThresholdBytes).toString('utf8')
            + '\n[truncated: oversize message]';
        }

        const response = await haiku.classify(systemPrompt, corpus, budgetedOptions());
        if (!response.success) {
          // eslint-disable-next-line no-console -- degradation-warning: Chunk extraction failed; loop continues to next chunk with partial results
          console.error('[memory-extractor] Chunk extraction failed at ' + start + ': ' + (response.error || 'unknown'));
          recordFailure(
            allResults,
            response.failureMode || 'api-error',
            'Chunk extraction failed at ' + start + ': ' + (response.error || 'unknown')
          );
        } else if (!Array.isArray(response.data)) {
          // eslint-disable-next-line no-console -- degradation-warning: Chunk returned a non-array payload; loop continues with partial results
          console.error('[memory-extractor] Chunk returned a non-array payload at ' + start + ': ' + typeof response.data);
          recordFailure(allResults, 'parse-error', 'Chunk returned a non-array payload at ' + start);
        } else {
          const results = await processCandidates(response.data, sessionId, transcriptPath, 'wrap', seenHashes);
          allResults.push(...results);
        }

        // Advance with overlap; max() guarantees progress on byte-capped chunks.
        if (end >= messages.length) break;
        start = Math.max(end - chunkOverlap, start + 1);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console -- last-resort-error: Outer extraction try/catch fired; extractor returns partial results tagged with errors
    console.error('[memory-extractor] Extraction error: ' + err.message);
    // Return what was already staged rather than discarding it — the caller needs
    // the partial results AND the failure, not one masquerading as the other.
    return recordFailure(allResults, 'extraction-error', 'Extraction error: ' + err.message);
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
    // eslint-disable-next-line no-console -- last-resort-error: File read failed in extractFromFile; returns [] tagged with errors
    console.error('[memory-extractor] Could not read file ' + relativePath + ': ' + err.message);
    return recordFailure([], 'read-error', 'Could not read file ' + relativePath + ': ' + err.message);
  }

  let response;
  try {
    response = await haiku.classify(systemPrompt, content, { maxTokens: 8192 });
  } catch (err) {
    // eslint-disable-next-line no-console -- last-resort-error: Haiku call threw in extractFromFile; returns [] tagged with errors
    console.error('[memory-extractor] Haiku call failed for ' + relativePath + ': ' + err.message);
    return recordFailure([], 'api-error', 'Haiku call failed for ' + relativePath + ': ' + err.message);
  }

  if (!response.success) {
    // eslint-disable-next-line no-console -- last-resort-error: Haiku response unsuccessful in extractFromFile; returns [] tagged with errors
    console.error('[memory-extractor] Haiku extraction failed for ' + relativePath + ': ' + (response.error || 'unknown'));
    return recordFailure(
      [],
      response.failureMode || 'api-error',
      'Haiku extraction failed for ' + relativePath + ': ' + (response.error || 'unknown')
    );
  }

  if (!Array.isArray(response.data)) {
    // eslint-disable-next-line no-console -- last-resort-error: Haiku returned a non-array payload; returns [] tagged with errors
    console.error('[memory-extractor] Haiku returned a non-array payload for ' + relativePath + ': ' + typeof response.data);
    return recordFailure([], 'parse-error', 'Haiku returned a non-array payload for ' + relativePath);
  }

  const candidates = response.data;
  const seenHashes = new Set();
  const results = [];

  let config;
  try {
    config = loadPipelineConfig();
  } catch (_) {
    config = { extraction: { confidenceLowConfidence: 0.5 } };
  }
  const confidenceLow = config.extraction.confidenceLowConfidence;

  // B4: never-throw — a throw from checkContent/writeCandidate escaped and
  // aborted whole directory runs; record it and return partial results (D-64).
  try {
    for (const candidate of candidates) {
      if (typeof candidate.confidence !== 'number' || candidate.confidence < confidenceLow) {
        continue;
      }
      const hash = computeHash(candidate.content);
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);

      // INGRESS-GATE-01: fail-closed exclusion check before staging (ISPN/Genesys/Asana).
      const verdict = await checkContent(candidate.content, loadExcludedTerms());
      if (verdict.decision !== 'PASS') {
        continue;
      }

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
  } catch (err) {
    // eslint-disable-next-line no-console -- last-resort-error: Candidate loop threw in extractFromFile; returns partial results tagged with errors
    console.error('[memory-extractor] Extraction error for ' + relativePath + ': ' + err.message);
    return recordFailure(results, 'extraction-error', 'Extraction error for ' + relativePath + ': ' + err.message);
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
    // eslint-disable-next-line no-console -- last-resort-error: Directory read failed in extractFromDirectory; returns [] tagged with errors
    console.error('[memory-extractor] Could not read directory ' + relativeDir + ': ' + err.message);
    return recordFailure([], 'read-error', 'Could not read directory ' + relativeDir + ': ' + err.message);
  }

  const allResults = [];
  for (const file of files) {
    const results = await extractFromFile(file, options);
    allResults.push(...results);
    mergeFailures(allResults, results);
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
    } catch (err) {
      // eslint-disable-next-line no-console -- last-resort-error: Daily/ read failed; returns [] tagged with errors
      console.error('[memory-extractor] Could not read Daily/: ' + err.message);
      return recordFailure([], 'read-error', 'Could not read Daily/: ' + err.message);
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
      mergeFailures(allResults, results);
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

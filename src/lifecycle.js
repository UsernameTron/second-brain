'use strict';

/**
 * lifecycle.js
 *
 * Background lifecycle operations for the Second Brain content pipeline.
 *
 * Provides two maintenance functions:
 *   - retryDeadLetters: Auto-retry dead-letter files with retryable failure modes
 *   - archiveStaleLeftProposals: Archive left-proposals pending > autoArchiveDays
 *
 * Design:
 *   - Both functions are idempotent — safe to call multiple times (D-37, D-16)
 *   - retryDeadLetters respects delayMinutes and maxAttempts from pipeline.json
 *   - archiveStaleLeftProposals respects autoArchiveDays from pipeline.json
 *   - Frozen files are never retried (status: frozen is terminal)
 *   - Non-retryable failure modes are skipped permanently
 *
 * @module lifecycle
 */

const fs = require('fs');
const path = require('path');

const { loadPipelineConfig } = require('./pipeline-infra');

// ── Constants ────────────────────────────────────────────────────────────────

const VAULT_ROOT = process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');

/**
 * Failure modes that are eligible for auto-retry per D-37.
 * All others are non-retryable and are skipped permanently.
 */
const RETRYABLE_FAILURE_MODES = new Set([
  'api-error',
  'timeout',
  'exclusion-unavailable',
]);

// ── Frontmatter helpers ──────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatterRaw, fields, body }.
 *
 * @param {string} content - Full file content
 * @returns {{ frontmatterRaw: string, fields: object, body: string }}
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---')) {
    return { frontmatterRaw: '', fields: {}, body: content };
  }

  const end = content.indexOf('\n---\n', 4);
  if (end === -1) {
    return { frontmatterRaw: '', fields: {}, body: content };
  }

  const frontmatterRaw = content.slice(4, end);
  const body = content.slice(end + 5);

  // Parse key: value lines from frontmatter
  const fields = {};
  for (const line of frontmatterRaw.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) {
      fields[key] = value;
    }
  }

  return { frontmatterRaw, fields, body };
}

/**
 * Serialize frontmatter fields back to YAML frontmatter block.
 * Preserves insertion order of fields object.
 *
 * @param {object} fields - Key-value pairs
 * @returns {string} YAML frontmatter block including --- delimiters
 */
function serializeFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// ── retryDeadLetters ─────────────────────────────────────────────────────────

/**
 * Auto-retry dead-letter files in proposals/unrouted/ with retryable failure modes.
 *
 * Per D-37:
 *   - Only api-error, timeout, exclusion-unavailable are retryable
 *   - Retry interval: retry.delayMinutes (default 15)
 *   - Max attempts: retry.maxAttempts (default 3)
 *   - After maxAttempts: set status: frozen (terminal state)
 *   - Files in promoted/ and rerouted/ subdirectories are ignored
 *
 * @returns {Promise<{ retried: number, succeeded: number, failed: number, frozen: number, skipped: number }>}
 */
async function retryDeadLetters() {
  const config = loadPipelineConfig();
  const delayMinutes = config.retry.delayMinutes;
  const maxAttempts = config.retry.maxAttempts;

  const unroutedDir = path.join(VAULT_ROOT, 'proposals', 'unrouted');
  const promotedDir = path.join(unroutedDir, 'promoted');

  const summary = { retried: 0, succeeded: 0, failed: 0, frozen: 0, skipped: 0 };

  // List only direct .md files in unrouted/ — not subdirectories
  let files;
  try {
    const entries = fs.readdirSync(unroutedDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch (_) {
    // Directory does not exist — nothing to retry
    return summary;
  }

  for (const filename of files) {
    const filePath = path.join(unroutedDir, filename);

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      summary.skipped++;
      continue;
    }

    const { fields, body } = parseFrontmatter(content);

    const failureMode = fields['failure-mode'] || '';
    const status = fields['status'] || 'unrouted';
    const retryCount = parseInt(fields['retry-count'] || '0', 10);

    // Skip: terminal state
    if (status === 'frozen') {
      summary.skipped++;
      continue;
    }

    // Skip: non-retryable failure mode
    if (!RETRYABLE_FAILURE_MODES.has(failureMode)) {
      summary.skipped++;
      continue;
    }

    // Skip: already at or over max attempts
    if (retryCount >= maxAttempts) {
      summary.skipped++;
      continue;
    }

    // Skip: file created too recently (within delayMinutes)
    const createdStr = fields['created'] || fields['last-retry'];
    const referenceTime = createdStr ? new Date(createdStr).getTime() : 0;
    const ageMinutes = (Date.now() - referenceTime) / (1000 * 60);
    if (ageMinutes < delayMinutes) {
      summary.skipped++;
      continue;
    }

    // Attempt retry
    summary.retried++;

    let retrySuccess = false;
    let classificationResult = null;

    try {
      const { classifyInput } = require('./classifier');
      classificationResult = await classifyInput(body, { interactive: false });
      retrySuccess = classificationResult && classificationResult.success === true;
    } catch (err) {
      retrySuccess = false;
    }

    if (retrySuccess) {
      // Write formatted note to destination
      try {
        const { formatNote, generateFilename } = require('./note-formatter');
        const { vaultWrite } = require('./vault-gateway');

        const formattedContent = formatNote(body, classificationResult, {});
        const filename_ = generateFilename(body, {});
        const directory = classificationResult.directory || 'memory';
        const destPath = `${directory}/${filename_}.md`;

        await vaultWrite(destPath, formattedContent);

        // Move original dead-letter to promoted/
        const promotedPath = path.join(promotedDir, filename);
        fs.mkdirSync(promotedDir, { recursive: true });

        // Add promoted metadata to frontmatter before moving
        const updatedFields = {
          ...fields,
          'promoted-at': new Date().toISOString(),
          'promoted-to': destPath,
          'promoted-by': 'auto-retry',
        };
        const promotedContent = serializeFrontmatter(updatedFields) + '\n' + body;
        fs.writeFileSync(promotedPath, promotedContent, 'utf8');
        fs.unlinkSync(filePath);

        summary.succeeded++;
      } catch (_) {
        // Write succeeded classification-wise but write/move failed — treat as failed
        retrySuccess = false;
        summary.succeeded--; // undo the pre-increment that would happen below
      }
    }

    if (!retrySuccess) {
      // Increment retry-count and update last-retry
      const newRetryCount = retryCount + 1;
      const updatedFields = {
        ...fields,
        'retry-count': String(newRetryCount),
        'last-retry': new Date().toISOString(),
      };

      // Freeze if we've hit maxAttempts
      if (newRetryCount >= maxAttempts) {
        updatedFields['status'] = 'frozen';
        summary.frozen++;
      }

      const updatedContent = serializeFrontmatter(updatedFields) + '\n' + body;
      fs.writeFileSync(filePath, updatedContent, 'utf8');
      summary.failed++;
    }
  }

  return summary;
}

// ── archiveStaleLeftProposals ─────────────────────────────────────────────────

/**
 * Archive left-proposal files pending longer than autoArchiveDays.
 *
 * Per D-16:
 *   - Only pending status files are eligible for archiving
 *   - Threshold: leftProposal.autoArchiveDays (default 14)
 *   - Archived files: updated frontmatter (status: archived, archived-at: ISO-8601)
 *   - Moved to proposals/left-proposals/archive/ with same filename
 *   - Original file deleted from proposals/left-proposals/
 *
 * @returns {Promise<{ archived: number, skipped: number }>}
 */
async function archiveStaleLeftProposals() {
  const config = loadPipelineConfig();
  const autoArchiveDays = config.leftProposal.autoArchiveDays;

  const leftProposalsDir = path.join(VAULT_ROOT, 'proposals', 'left-proposals');
  const archiveDir = path.join(leftProposalsDir, 'archive');

  const summary = { archived: 0, skipped: 0 };

  // List only direct .md files in left-proposals/ — not archive/ subdirectory
  let files;
  try {
    const entries = fs.readdirSync(leftProposalsDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch (_) {
    // Directory does not exist — nothing to archive
    return summary;
  }

  const thresholdMs = autoArchiveDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const filename of files) {
    const filePath = path.join(leftProposalsDir, filename);

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      summary.skipped++;
      continue;
    }

    const { fields, body } = parseFrontmatter(content);

    const status = fields['status'] || '';
    const createdStr = fields['created'];

    // Skip: only pending proposals are eligible for archiving
    if (status !== 'pending') {
      summary.skipped++;
      continue;
    }

    // Skip: created date is missing or within the threshold
    if (!createdStr) {
      summary.skipped++;
      continue;
    }

    const createdAt = new Date(createdStr).getTime();
    const ageMs = now - createdAt;

    if (ageMs < thresholdMs) {
      summary.skipped++;
      continue;
    }

    // Archive: update frontmatter, write to archive/, delete original
    const updatedFields = {
      ...fields,
      'status': 'archived',
      'archived-at': new Date().toISOString(),
    };

    const archivePath = path.join(archiveDir, filename);
    const archivedContent = serializeFrontmatter(updatedFields) + '\n' + body;

    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(archivePath, archivedContent, 'utf8');
    fs.unlinkSync(filePath);

    summary.archived++;
  }

  return summary;
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  retryDeadLetters,
  archiveStaleLeftProposals,
};

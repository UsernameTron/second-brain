'use strict';

/**
 * memory-proposals.js
 *
 * Reader/writer for proposals/memory-proposals.md — the memory candidate staging file.
 * Implements the D-55/D-56 schema with locking (D-58) and dedup (D-27/D-66).
 *
 * @module memory-proposals
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────────────────────────

// PROMOTE-VAULT-01: call-time, not module-load-time — a module-level const
// froze process.env.VAULT_ROOT at require() time, forking the proposals
// corpus across roots for any process that set the env var after require.
const VAULT_ROOT = () => process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');

const PROPOSALS_DIR = () => path.join(VAULT_ROOT(), 'proposals');
const PROPOSALS_FILE = () => path.join(VAULT_ROOT(), 'proposals', 'memory-proposals.md');
const PENDING_FILE = () => path.join(VAULT_ROOT(), 'proposals', 'memory-proposals-pending.jsonl');
const LOCK_FILE = () => path.join(VAULT_ROOT(), 'proposals', 'memory-proposals.md.lock');
const MEMORY_FILE = () => path.join(VAULT_ROOT(), 'memory', 'memory.md');
const ARCHIVE_DIR = () => path.join(VAULT_ROOT(), 'archive', 'memory');
const PROPOSAL_ARCHIVE_DIR = () => path.join(VAULT_ROOT(), 'archive', 'proposals');

/**
 * Current resolved VAULT_ROOT. Exported so promote-memories.js can assert
 * both modules agree on the same root at promotion start (PROMOTE-VAULT-01).
 * @returns {string} The resolved vault root path.
 */
function resolvedVaultRoot() {
  return VAULT_ROOT();
}

const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 500;

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeHash(content) {
  const normalized = content.trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

function ensureProposalsDir() {
  fs.mkdirSync(PROPOSALS_DIR(), { recursive: true });
}

// ── parseCheckboxState ───────────────────────────────────────────────────────

/**
 * Parse the accept/reject/edit-then-accept/defer checkbox block of a
 * proposal candidate section. Shared by the promotion gate and (later)
 * the dream-apply changeset gate — one parser, no drift (OPERATOR HARD
 * CONSTRAINT, phase 34).
 * @param {string} sectionText - Raw candidate section markdown.
 * @returns {{status: ('accepted'|'rejected'|'edit-then-accept'|'deferred'|null), ambiguous: boolean, checkedCount: number, nearMissCount: number}} Parsed checkbox state.
 */
function parseCheckboxState(sectionText) {
  const acceptChecked = /^-\s*\[\s*[xX]\s*\]\s*accept\s*$/im.test(sectionText);
  const rejectChecked = /^-\s*\[\s*[xX]\s*\]\s*reject\s*$/im.test(sectionText);
  const editChecked = /^-\s*\[\s*[xX]\s*\]\s*edit-then-accept\s*$/im.test(sectionText);
  const deferChecked = /^-\s*\[\s*[xX]\s*\]\s*defer\s*$/im.test(sectionText);
  const checkedCount = [acceptChecked, rejectChecked, editChecked, deferChecked].filter(Boolean).length;
  const ambiguous = checkedCount > 1;

  let status = null;
  if (!ambiguous) {
    if (acceptChecked) status = 'accepted';
    else if (rejectChecked) status = 'rejected';
    else if (editChecked) status = 'edit-then-accept';
    else if (deferChecked) status = 'deferred';
  }

  // PROMOTE-PARSE-01: a checkbox line with a non-empty, non-x bracket mark
  // (e.g. `[y]`, `[xx]`, `[x!]`) is a near-miss — a human tried to check it
  // but the mark didn't parse. An empty `[ ]` is legitimately unreviewed,
  // not a near-miss.
  let nearMissCount = 0;
  const nearMissRegex = /^-\s*\[([^\]]*)\]\s*(accept|reject|edit-then-accept|defer)\b/gim;
  let nearMissMatch;
  while ((nearMissMatch = nearMissRegex.exec(sectionText)) !== null) {
    const bracket = nearMissMatch[1].trim();
    if (bracket === '' || /^x$/i.test(bracket)) continue;
    nearMissCount++;
  }

  return { status, ambiguous, checkedCount, nearMissCount };
}

// ── generateCandidateId ──────────────────────────────────────────────────────

/**
 * Generate the next deterministic candidate ID for today's proposals file.
 * Scans the current proposals file AND the proposal archive dir (an
 * archive-then-restage cycle must not re-mint an already-used NNN —
 * PROMOTE-ID-01) and returns the next sequence number in the
 * `mem-YYYYMMDD-NNN` format so concurrent extractors do not collide.
 * @returns {string} Candidate ID in the form `mem-YYYYMMDD-NNN`.
 */
function generateCandidateId() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = 'mem-' + today + '-';
  const regex = new RegExp('mem-' + today + '-(\\d{3})', 'g');

  let maxSeq = 0;

  const scanForMaxSeq = (content) => {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  };

  try {
    scanForMaxSeq(fs.readFileSync(PROPOSALS_FILE(), 'utf8'));
  } catch (_) {
    // File does not exist yet
  }

  try {
    const archiveDir = PROPOSAL_ARCHIVE_DIR();
    for (const f of fs.readdirSync(archiveDir).filter((f) => f.endsWith('.md'))) {
      scanForMaxSeq(fs.readFileSync(path.join(archiveDir, f), 'utf8'));
    }
  } catch (_) {
    // Archive dir does not exist yet
  }

  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return prefix + nextSeq;
}

// ── acquireLock / releaseLock ────────────────────────────────────────────────

async function acquireLock() {
  ensureProposalsDir();
  const lockPath = LOCK_FILE();
  const lockData = JSON.stringify({
    pid: process.pid,
    acquired: new Date().toISOString(),
    holder: 'memory-extractor',
  });

  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(lockPath, lockData, { flag: 'wx' });
      return { acquired: true };
    } catch (err) {
      if (err.code === 'EEXIST') {
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      } else {
        throw err;
      }
    }
  }

  return { acquired: false };
}

async function releaseLock() {
  try {
    fs.unlinkSync(LOCK_FILE());
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// ── Dedup check ──────────────────────────────────────────────────────────────

function isDuplicate(contentHash) {
  const filesToCheck = [];

  filesToCheck.push(PROPOSALS_FILE());
  filesToCheck.push(MEMORY_FILE());

  try {
    const archiveFiles = fs.readdirSync(ARCHIVE_DIR())
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(ARCHIVE_DIR(), f));
    filesToCheck.push(...archiveFiles);
  } catch (_) {
    // Archive dir does not exist
  }

  for (const filePath of filesToCheck) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('content_hash:: ' + contentHash)) {
        return true;
      }
    } catch (_) {
      // File does not exist
    }
  }

  return false;
}

// ── Frontmatter helpers ──────────────────────────────────────────────────────

function parseFrontmatter(content) {
  if (!content.startsWith('---')) {
    return { frontmatter: '', body: content };
  }
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) {
    return { frontmatter: '', body: content };
  }
  return {
    frontmatter: content.slice(4, end),
    body: content.slice(end + 5),
  };
}

function buildFrontmatter(totalPending, totalProcessed) {
  return [
    '---',
    'last_updated: ' + new Date().toISOString(),
    'total_pending: ' + totalPending,
    'total_processed: ' + totalProcessed,
    '---',
    '',
  ].join('\n');
}

function parseFrontmatterFields(frontmatterContent) {
  let totalPending = 0;
  let totalProcessed = 0;
  const pendingMatch = frontmatterContent.match(/total_pending:\s*(\d+)/);
  if (pendingMatch) totalPending = parseInt(pendingMatch[1], 10);
  const processedMatch = frontmatterContent.match(/total_processed:\s*(\d+)/);
  if (processedMatch) totalProcessed = parseInt(processedMatch[1], 10);
  return { totalPending, totalProcessed };
}

// ── Source-ref short derivation ──────────────────────────────────────────────

function sourceRefShort(sourceRef) {
  if (!sourceRef) return 'unknown';
  if (sourceRef.startsWith('session:')) {
    const id = sourceRef.slice(8);
    return 'session:' + id.slice(0, 8);
  }
  if (sourceRef.startsWith('file:')) {
    const filePath = sourceRef.slice(5);
    const base = path.basename(filePath);
    const ext = path.extname(base);
    return 'file:' + base.slice(0, base.length - ext.length);
  }
  if (sourceRef.startsWith('daily:')) {
    return sourceRef;
  }
  return sourceRef.slice(0, 20);
}

// ── writeCandidate (internal with lock held) ─────────────────────────────────

async function _writeCandidateWithLock(candidate) {
  const {
    content,
    category,
    sourceRef,
    confidence,
    sessionId = 'manual',
    sourceFile = '',
    extractionTrigger = 'wrap',
    proposedTags = [],
    proposedRelated = [],
  } = candidate;

  const contentHash = computeHash(content);
  const candidateId = generateCandidateId();
  const shortRef = sourceRefShort(sourceRef);
  const capturedAt = new Date().toISOString();
  const tagsStr = Array.isArray(proposedTags) ? proposedTags.join(', ') : '';
  const relatedStr = Array.isArray(proposedRelated) ? proposedRelated.join(', ') : '';

  const section = [
    '### ' + candidateId + ' \u00b7 ' + category + ' \u00b7 ' + shortRef,
    '- [ ] accept',
    '- [ ] reject',
    '- [ ] edit-then-accept',
    '- [ ] defer',
    '',
    '**Content:** ' + content,
    '**Proposed tags:** ' + tagsStr,
    '**Proposed related:** ' + relatedStr,
    '',
    'session_id:: ' + sessionId,
    'source_ref:: ' + (sourceRef || ''),
    'captured_at:: ' + capturedAt,
    'source_file:: ' + sourceFile,
    'category:: ' + category,
    'confidence:: ' + confidence,
    'content_hash:: ' + contentHash,
    'status:: pending',
    'extraction_trigger:: ' + extractionTrigger,
    '',
  ].join('\n');

  let existingBody = '';
  let totalPending = 0;
  let totalProcessed = 0;

  try {
    const existingContent = fs.readFileSync(PROPOSALS_FILE(), 'utf8');
    const parsed = parseFrontmatter(existingContent);
    existingBody = parsed.body;
    const fields = parseFrontmatterFields(parsed.frontmatter);
    totalPending = fields.totalPending;
    totalProcessed = fields.totalProcessed;
  } catch (_) {
    // New file
  }

  totalPending += 1;
  const newFrontmatter = buildFrontmatter(totalPending, totalProcessed);
  const newContent = newFrontmatter + section + existingBody;
  fs.writeFileSync(PROPOSALS_FILE(), newContent, 'utf8');

  return candidateId;
}

// ── flushPendingBuffer (internal, assumes lock held) ─────────────────────────

async function _flushPendingBufferInternal() {
  const pendingPath = PENDING_FILE();

  let lines;
  try {
    const raw = fs.readFileSync(pendingPath, 'utf8');
    lines = raw.split('\n').filter((l) => l.trim());
  } catch (_) {
    return;
  }

  if (lines.length === 0) return;

  for (const line of lines) {
    try {
      const candidate = JSON.parse(line);
      const hash = computeHash(candidate.content);
      if (!isDuplicate(hash)) {
        await _writeCandidateWithLock(candidate);
      }
    } catch (err) {
      // eslint-disable-next-line no-console -- degradation-warning: Pending-line flush failed for one entry; loop continues to remaining entries
      console.error('[memory-proposals] Failed to flush pending line: ' + err.message);
    }
  }

  fs.writeFileSync(pendingPath, '', 'utf8');
}

// ── writeCandidate (public) ──────────────────────────────────────────────────

/**
 * Write a memory candidate to the proposals staging file under a write lock.
 * Skips duplicates (D-27/D-66 hash check) and buffers to a JSONL pending file
 * if the lock is contended (D-58); on lock acquisition, drains the buffer first.
 * @param {Object} candidate - Candidate fields to stage.
 * @param {string} candidate.content - Candidate memory text (required).
 * @param {string} candidate.category - D-55 category bucket (e.g., `decisions`, `principles`).
 * @param {string} [candidate.sourceRef] - Origin reference (`session:`, `file:`, `daily:`).
 * @param {number|string} [candidate.confidence] - Extractor confidence (0..1 or label).
 * @param {string} [candidate.sessionId='manual'] - Session identifier; defaults to `'manual'`.
 * @param {string} [candidate.sourceFile=''] - Originating file path.
 * @param {string} [candidate.extractionTrigger='wrap'] - Trigger label; defaults to `'wrap'`.
 * @param {string[]} [candidate.proposedTags=[]] - Suggested tags.
 * @param {string[]} [candidate.proposedRelated=[]] - Suggested related notes.
 * @returns {Promise<{written: boolean, reason?: string, buffered?: boolean, candidateId?: string}>} Outcome record.
 */
async function writeCandidate(candidate) {
  ensureProposalsDir();

  const { content } = candidate;
  const contentHash = computeHash(content);

  if (isDuplicate(contentHash)) {
    // eslint-disable-next-line no-console -- diagnostic: Always-emit JSON audit log for WRITE_CANDIDATE SKIPPED duplicate decision
    console.error(JSON.stringify({ ts: new Date().toISOString(), action: 'WRITE_CANDIDATE', decision: 'SKIPPED', reason: 'duplicate', content_hash: contentHash }));
    return { written: false, reason: 'duplicate' };
  }

  const lockResult = await acquireLock();

  if (!lockResult.acquired) {
    const pendingPath = PENDING_FILE();
    const line = JSON.stringify(candidate) + '\n';
    fs.appendFileSync(pendingPath, line, 'utf8');
    // eslint-disable-next-line no-console -- diagnostic: Always-emit JSON audit log for WRITE_CANDIDATE BUFFERED decision
    console.error(JSON.stringify({ ts: new Date().toISOString(), action: 'WRITE_CANDIDATE', decision: 'BUFFERED', content_hash: contentHash }));
    return { written: true, buffered: true };
  }

  try {
    await _flushPendingBufferInternal();
    const candidateId = await _writeCandidateWithLock(candidate);
    // eslint-disable-next-line no-console -- diagnostic: Always-emit JSON audit log for WRITE_CANDIDATE WRITTEN decision
    console.error(JSON.stringify({ ts: new Date().toISOString(), action: 'WRITE_CANDIDATE', decision: 'WRITTEN', candidateId, content_hash: contentHash }));
    return { written: true, candidateId };
  } finally {
    await releaseLock();
  }
}

// ── flushPendingBuffer (public) ──────────────────────────────────────────────

/**
 * Drain any candidates buffered to the pending JSONL file into the proposals
 * markdown file. Acquires the write lock; logs and returns silently if the
 * lock cannot be obtained within the timeout.
 * @returns {Promise<void>} Resolves once the buffer is flushed (or skipped).
 */
async function flushPendingBuffer() {
  const lockResult = await acquireLock();
  if (!lockResult.acquired) {
    // eslint-disable-next-line no-console -- degradation-warning: Lock acquisition failed during pending-buffer flush; returns silently
    console.error('[memory-proposals] Could not acquire lock to flush pending buffer');
    return;
  }
  try {
    await _flushPendingBufferInternal();
  } finally {
    await releaseLock();
  }
}

// ── readProposals ────────────────────────────────────────────────────────────

/**
 * Parse the proposals staging markdown file into structured candidate records.
 * Returns an empty array if the file does not exist yet. Each record is the
 * shape consumed by the promotion pipeline (D-55 schema).
 * @returns {Promise<Array<{candidateId: string, category: string, session_id: string, captured_at: string, source_file: string, confidence: string, content_hash: string, status: string, extraction_trigger: string}>>} Parsed candidates.
 */
async function readProposals() {
  let content;
  try {
    content = fs.readFileSync(PROPOSALS_FILE(), 'utf8');
  } catch (_) {
    return [];
  }

  const { body } = parseFrontmatter(content);
  const candidates = [];

  const sections = body.split(/(?=^### mem-\d{8}-\d{3})/m);

  for (const section of sections) {
    const headerMatch = section.match(/^### (mem-\d{8}-\d{3})\s*\S+\s*(\w+)\s*\S+\s*(.+?)$/m);
    if (!headerMatch) continue;

    const candidateId = headerMatch[1];

    const fields = {};
    const fieldRegex = /^(\w+):: (.+)$/gm;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(section)) !== null) {
      fields[fieldMatch[1]] = fieldMatch[2].trim();
    }

    candidates.push({
      candidateId,
      category: fields.category,
      session_id: fields.session_id,
      captured_at: fields.captured_at,
      source_file: fields.source_file,
      confidence: fields.confidence,
      content_hash: fields.content_hash,
      status: fields.status,
      extraction_trigger: fields.extraction_trigger,
    });
  }

  return candidates;
}

// ── Exports ──────────────────────────────────────────────────────────────────
//
// Phase 15 (B-07): acquireLock/releaseLock were privatized. They remain used
// internally by writeCandidate and flushPendingBuffer, but are no longer part
// of the module's public surface. Grep confirmed no src/ caller used them
// directly. The dedicated test suite for lock semantics now exercises them
// indirectly through writeCandidate with simulated lock contention.

module.exports = {
  generateCandidateId,
  writeCandidate,
  readProposals,
  flushPendingBuffer,
  parseCheckboxState,
  resolvedVaultRoot,
};

// Test-only surface: tests that need to exercise lock primitives directly
// can opt in via this namespaced export. Production code must not use this.
// Test-only seam — not public API. JSDoc not required per Phase 21 D-LOCK-3.
module.exports._testOnly = {
  acquireLock,
  releaseLock,
};

'use strict';

/**
 * promote-memories.js
 *
 * /promote-memories command: promotes human-reviewed memory candidates
 * from proposals/memory-proposals.md to memory/memory.md.
 *
 * @module promote-memories
 */

const fs = require('fs');
const path = require('path');

const { computeHash, sourceRefShort } = require('./utils/memory-utils');

const VAULT_ROOT = () => process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');
const PROPOSALS_FILE = () => path.join(VAULT_ROOT(), 'proposals', 'memory-proposals.md');
const MEMORY_FILE = () => path.join(VAULT_ROOT(), 'memory', 'memory.md');
const ARCHIVE_DIR = () => path.join(VAULT_ROOT(), 'memory-archive');
const PROPOSAL_ARCHIVE_DIR = () => path.join(VAULT_ROOT(), 'memory-proposals-archive');

function loadPromotionConfig() {
  const CONFIG_DIR = process.env.CONFIG_DIR_OVERRIDE || path.join(__dirname, '..', 'config');
  const raw = fs.readFileSync(path.join(CONFIG_DIR, 'pipeline.json'), 'utf8');
  return JSON.parse(raw).promotion;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function monthString() {
  return new Date().toISOString().slice(0, 7);
}

function nowISO() {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const localISO = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 19);
  return `${localISO}${sign}${hh}:${mm}`;
}

function parseProposalsFrontmatter(content) {
  if (!content.startsWith('---')) return { frontmatter: '', body: content, totalPending: 0, totalProcessed: 0 };
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return { frontmatter: '', body: content, totalPending: 0, totalProcessed: 0 };
  const fm = content.slice(4, end);
  const body = content.slice(end + 5);
  let totalPending = 0;
  let totalProcessed = 0;
  const pm = fm.match(/total_pending:\s*(\d+)/);
  if (pm) totalPending = parseInt(pm[1], 10);
  const prm = fm.match(/total_processed:\s*(\d+)/);
  if (prm) totalProcessed = parseInt(prm[1], 10);
  return { frontmatter: fm, body, totalPending, totalProcessed };
}

function buildProposalsFrontmatter(totalPending, totalProcessed) {
  return ['---', `last_updated: ${new Date().toISOString()}`, `total_pending: ${totalPending}`, `total_processed: ${totalProcessed}`, '---', ''].join('\n');
}

function parseCandidateSections(body) {
  const rawSections = body.split(/(?=^### mem-\d{8}-\d{3})/m).filter(s => s.trim());
  const candidates = [];

  for (const rawSection of rawSections) {
    const headerMatch = rawSection.match(/^### (mem-\d{8}-\d{3})\s*·\s*(\w+)\s*·\s*(.+?)$/m);
    if (!headerMatch) continue;
    const candidateId = headerMatch[1];

    const acceptChecked = /^- \[x\] accept$/im.test(rawSection);
    const rejectChecked = /^- \[x\] reject$/im.test(rawSection);
    const editChecked = /^- \[x\] edit-then-accept$/im.test(rawSection);
    const deferChecked = /^- \[x\] defer$/im.test(rawSection);
    const checkedCount = [acceptChecked, rejectChecked, editChecked, deferChecked].filter(Boolean).length;
    const ambiguous = checkedCount > 1;

    let checkboxStatus = null;
    if (!ambiguous) {
      if (acceptChecked) checkboxStatus = 'accepted';
      else if (rejectChecked) checkboxStatus = 'rejected';
      else if (editChecked) checkboxStatus = 'edit-then-accept';
      else if (deferChecked) checkboxStatus = 'deferred';
    }

    const fields = {};
    const fieldRegex = /^(\w[\w-]*):: (.+)$/gm;
    let fm;
    while ((fm = fieldRegex.exec(rawSection)) !== null) {
      fields[fm[1]] = fm[2].trim();
    }

    const contentMatch = rawSection.match(/^\*\*Content:\*\* (.+)$/m);
    const content = contentMatch ? contentMatch[1].trim() : '';
    const tagsMatch = rawSection.match(/^\*\*Proposed tags:\*\* (.*)$/m);
    const tags = tagsMatch ? tagsMatch[1].trim() : '';
    const relatedMatch = rawSection.match(/^\*\*Proposed related:\*\* (.*)$/m);
    const related = relatedMatch ? relatedMatch[1].trim() : '';

    const currentStatus = fields['status'] || 'pending';
    const confidence = parseFloat(fields['confidence'] || '0');
    const contentHash = fields['content_hash'] || computeHash(content);
    const sourceRef = fields['source_ref'] || '';
    const capturedAt = fields['captured_at'] || new Date().toISOString();

    candidates.push({ candidateId, category: fields['category'] || headerMatch[2], confidence, content, tags, related, contentHash, sourceRef, capturedAt, currentStatus, checkboxStatus, ambiguous, checkedCount, raw: rawSection });
  }

  return candidates;
}

function isDuplicateInMemory(contentHash) {
  const filesToCheck = [MEMORY_FILE()];
  try {
    const archiveFiles = fs.readdirSync(ARCHIVE_DIR()).filter(f => f.endsWith('.md')).map(f => path.join(ARCHIVE_DIR(), f));
    filesToCheck.push(...archiveFiles);
  } catch (_) { /* file may not exist */ }
  for (const filePath of filesToCheck) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('content_hash:: ' + contentHash)) return true;
    } catch (_) { /* file may not exist */ }
  }
  return false;
}


async function runProposalArchive(allCandidates, proposalArchiveThreshold) {
  if (allCandidates.length <= proposalArchiveThreshold) {
    return { pending: allCandidates, archived: [], proposalArchived: false };
  }
  const pendingCandidates = allCandidates.filter(c => c.currentStatus === 'pending');
  const nonPendingCandidates = allCandidates.filter(c => c.currentStatus !== 'pending');
  if (nonPendingCandidates.length === 0) return { pending: allCandidates, archived: [], proposalArchived: false };

  const byMonth = {};
  for (const candidate of nonPendingCandidates) {
    const month = (candidate.capturedAt || new Date().toISOString()).slice(0, 7);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(candidate);
  }

  const archiveDir = PROPOSAL_ARCHIVE_DIR();
  fs.mkdirSync(archiveDir, { recursive: true });

  for (const [month, candidates] of Object.entries(byMonth)) {
    const archiveFile = path.join(archiveDir, `${month}.md`);
    let existingContent = '';
    try { existingContent = fs.readFileSync(archiveFile, 'utf8'); } catch (_) { /* file may not exist */ }
    fs.writeFileSync(archiveFile, existingContent + candidates.map(c => c.raw).join(''), 'utf8');
  }

  return { pending: pendingCandidates, archived: nonPendingCandidates, proposalArchived: true };
}

function buildMemoryEntry(candidate) {
  const today = todayString();
  const shortRef = sourceRefShort(candidate.sourceRef);
  const addedAt = nowISO();
  return `### ${today} · ${candidate.category} · ${shortRef}\n\n${candidate.content}\n\ncategory:: ${candidate.category}\nsource-ref:: ${candidate.sourceRef || ''}\ntags:: ${candidate.tags || ''}\nadded:: ${addedAt}\nrelated:: ${candidate.related || ''}\ncontent_hash:: ${candidate.contentHash || ''}\n`;
}

async function appendToMemoryFile(promotedCandidates) {
  const currentMonth = monthString();
  const memoryFile = MEMORY_FILE();
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });

  let existingContent = '';
  try { existingContent = fs.readFileSync(memoryFile, 'utf8'); } catch (_) { /* file may not exist */ }

  const newEntries = promotedCandidates.map(buildMemoryEntry).join('\n');
  const monthHeader = `## ${currentMonth}`;

  let newContent;
  if (existingContent.includes(monthHeader)) {
    const monthIdx = existingContent.indexOf(monthHeader);
    const afterHeader = existingContent.indexOf('\n', monthIdx) + 1;
    newContent = existingContent.slice(0, afterHeader) + '\n' + newEntries + existingContent.slice(afterHeader);
  } else {
    newContent = `${monthHeader}\n\n${newEntries}\n${existingContent}`;
  }

  fs.writeFileSync(memoryFile, newContent, 'utf8');

  // Phase 19 (MEM-EMBED-01): non-fatal embed-on-promotion; failure tracked in voyage-health.json
  try {
    const { indexNewEntries } = require('./semantic-index');
    await indexNewEntries(promotedCandidates);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[promote-memories] Semantic indexing failed (non-fatal): ${err && err.message ? err.message : err}`);
  }
}

function updateProposalsFile(body, replacements) {
  let updatedBody = body;
  for (const [candidateId, newStatus] of Object.entries(replacements)) {
    const escaped = candidateId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(`(### ${escaped}[\\s\\S]*?)(status:: )(\\w[\\w-]*)`, 'g');
    updatedBody = updatedBody.replace(sectionRegex, (match, before, statusKey) => {
      return `${before}${statusKey}${newStatus}`;
    });
  }
  return updatedBody;
}

function countMemoryEntries(content) {
  return (content.match(/^### /gm) || []).length;
}

function runMemoryArchive(archiveSizeThresholdKB, archiveEntriesThreshold) {
  const memoryFile = MEMORY_FILE();
  let content;
  try { content = fs.readFileSync(memoryFile, 'utf8'); } catch (_) { return false; }

  const fileSizeBytes = Buffer.byteLength(content, 'utf8');
  const entryCount = countMemoryEntries(content);

  if (fileSizeBytes <= archiveSizeThresholdKB * 1024 && entryCount <= archiveEntriesThreshold) return false;

  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;
  const retainYears = new Set([String(currentYear), String(previousYear)]);

  const lines = content.split('\n');
  const yearGroups = {};
  let currentYearKey = null;
  let currentSectionLines = [];

  for (const line of lines) {
    const monthMatch = line.match(/^## (\d{4})-(\d{2})$/);
    if (monthMatch) {
      if (currentYearKey && currentSectionLines.length > 0) {
        if (!yearGroups[currentYearKey]) yearGroups[currentYearKey] = [];
        yearGroups[currentYearKey].push(...currentSectionLines);
      }
      currentYearKey = monthMatch[1];
      currentSectionLines = [line];
    } else {
      currentSectionLines.push(line);
    }
  }
  if (currentYearKey && currentSectionLines.length > 0) {
    if (!yearGroups[currentYearKey]) yearGroups[currentYearKey] = [];
    yearGroups[currentYearKey].push(...currentSectionLines);
  }

  const yearsToArchive = Object.keys(yearGroups).filter(y => !retainYears.has(y));
  if (yearsToArchive.length === 0) return false;

  const archiveDir = ARCHIVE_DIR();
  fs.mkdirSync(archiveDir, { recursive: true });

  for (const year of yearsToArchive) {
    const archiveFile = path.join(archiveDir, `${year}.md`);
    const yearContent = yearGroups[year].join('\n');
    let existingArchive = '';
    try { existingArchive = fs.readFileSync(archiveFile, 'utf8'); } catch (_) { /* file may not exist */ }
    fs.writeFileSync(archiveFile, existingArchive + yearContent + '\n', 'utf8');
  }

  const retainedContent = Object.entries(yearGroups)
    .filter(([year]) => retainYears.has(year))
    .sort(([a], [b]) => parseInt(b) - parseInt(a))
    .map(([, yearLines]) => yearLines.join('\n'))
    .join('\n');

  fs.writeFileSync(memoryFile, retainedContent + '\n', 'utf8');
  return true;
}

/**
 * Promote candidate memories from staging to memory.md based on threshold,
 * deduplication, and content/style policy gates. Honors the human-reviewed
 * checkbox state on each candidate, dedupes against existing memory + archive,
 * archives stale proposals, and triggers tail-archive of memory.md when size
 * thresholds are exceeded.
 * @param {Object} [options] - Promotion options.
 * @param {number} [options.max] - Override batch cap (must fall within
 *   `pipeline.json` `promotion.batchCapMin`..`batchCapMax`); defaults to `batchCapMax`.
 * @returns {Promise<{promoted: number, deferred: number, duplicates: number, rejected: number, skipped: number, archived: boolean, error?: string}>} Promotion outcome.
 */
async function promoteMemories(options = {}) {
  let config;
  try { config = loadPromotionConfig(); } catch (err) { return { error: 'Failed to load pipeline config: ' + err.message }; }

  const { batchCapMin, batchCapMax, archiveEntriesThreshold, archiveSizeThresholdKB, proposalArchiveThreshold } = config;
  const maxRaw = options.max === undefined ? batchCapMax : options.max;

  if (typeof maxRaw !== 'number' || !Number.isInteger(maxRaw)) {
    return { error: `Batch cap must be between ${batchCapMin} and ${batchCapMax}` };
  }
  if (maxRaw < batchCapMin || maxRaw > batchCapMax) {
    return { error: `Batch cap must be between ${batchCapMin} and ${batchCapMax}` };
  }

  const batchCap = maxRaw;

  let rawContent;
  try { rawContent = fs.readFileSync(PROPOSALS_FILE(), 'utf8'); } catch (_) {
    return { promoted: 0, deferred: 0, duplicates: 0, rejected: 0, skipped: 0, archived: false };
  }

  const { body: originalBody, totalProcessed } = parseProposalsFrontmatter(rawContent);
  const allCandidates = parseCandidateSections(originalBody);

  // Phase 20 (STATS-DAILY-01): emit proposals count — how many proposals were
  // staged (available in memory-proposals.md) at the time of this promotion run.
  if (allCandidates.length > 0) {
    try {
      const { recordProposalsBatch } = require('./daily-stats');
      recordProposalsBatch(allCandidates.length);
    } catch (_) { /* briefing-is-the-product: never break promotion on stats failure */ }
  }

  const { pending: remainingCandidates, proposalArchived } = await runProposalArchive(allCandidates, proposalArchiveThreshold);

  const acceptedCandidates = allCandidates.filter(c => {
    if (c.ambiguous) return false;
    // Only process candidates still in pending state — skip already-promoted/rejected
    if (c.currentStatus !== 'pending') return false;
    if (c.checkboxStatus === 'accepted' || c.checkboxStatus === 'edit-then-accept') return true;
    return false;
  });

  const rejectedCandidates = allCandidates.filter(c => {
    if (c.ambiguous) return false;
    if (c.currentStatus !== 'pending') return false;
    if (c.checkboxStatus === 'rejected') return true;
    return false;
  });

  const skippedCandidates = allCandidates.filter(c => c.ambiguous);

  acceptedCandidates.sort((a, b) => b.confidence - a.confidence);
  const toPromote = acceptedCandidates.slice(0, batchCap);
  const toDefer = acceptedCandidates.slice(batchCap);

  const promoted = [];
  const duplicates = [];
  const promotedHashes = new Set();
  // Note: pendingProposalHashes is NOT checked here — candidates being promoted
  // are themselves pending proposals, so checking would always self-match.
  // The proposals-file dedup belongs in the extractor path (writeCandidate),
  // not the promotion batch loop. In-batch dedup uses promotedHashes below.
  for (const candidate of toPromote) {
    if (
      isDuplicateInMemory(candidate.contentHash) ||
      promotedHashes.has(candidate.contentHash)
    ) {
      duplicates.push(candidate);
    } else {
      promoted.push(candidate);
      promotedHashes.add(candidate.contentHash);
    }
  }

  if (promoted.length > 0) {
    await appendToMemoryFile(promoted);
    // Phase 20 (STATS-DAILY-01): emit one recordPromotion per promoted entry.
    // D-03: confidence = memory-extractor classifier confidence on the proposal.
    // null-confidence promotions are counted but excluded from avg_confidence mean.
    for (const candidate of promoted) {
      try {
        const { recordPromotion } = require('./daily-stats');
        const confidence = candidate.confidence;
        // Only emit a numeric confidence; null/undefined → call with null so
        // promotions count still increments but doesn't skew the mean.
        if (typeof confidence === 'number' && Number.isFinite(confidence)) {
          recordPromotion(confidence);
        } else {
          recordPromotion(null);
        }
      } catch (_) { /* briefing-is-the-product: never break promotion on stats failure */ }
    }
  }

  const replacements = {};
  for (const c of promoted) replacements[c.candidateId] = 'accepted';
  for (const c of toDefer) replacements[c.candidateId] = 'deferred';
  for (const c of duplicates) replacements[c.candidateId] = 'duplicate-of-existing-memory';

  let updatedBody;
  if (proposalArchived) {
    const pendingBody = remainingCandidates.map(c => c.raw).join('');
    updatedBody = updateProposalsFile(pendingBody, replacements);
  } else {
    updatedBody = updateProposalsFile(originalBody, replacements);
  }

  const newPendingCount = (updatedBody.match(/status:: pending/g) || []).length;
  const newProcessedCount = totalProcessed + promoted.length + duplicates.length + rejectedCandidates.length + toDefer.length;
  const newFrontmatter = buildProposalsFrontmatter(newPendingCount, newProcessedCount);

  fs.mkdirSync(path.dirname(PROPOSALS_FILE()), { recursive: true });
  fs.writeFileSync(PROPOSALS_FILE(), newFrontmatter + updatedBody, 'utf8');

  const memoryArchived = runMemoryArchive(archiveSizeThresholdKB, archiveEntriesThreshold);

  return {
    promoted: promoted.length,
    deferred: toDefer.length,
    duplicates: duplicates.length,
    rejected: rejectedCandidates.length,
    skipped: skippedCandidates.length,
    archived: memoryArchived,
  };
}

module.exports = { promoteMemories };

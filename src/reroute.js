'use strict';

/**
 * reroute.js
 *
 * /reroute command — re-invokes the full classification pipeline on a
 * dead-letter or left-proposal file (D-60 through D-63).
 *
 * Pipeline (D-61):
 *   1. Read original input body (strip frontmatter)
 *   2. Run Stage 0 exclusion gate
 *   3. Run Stage 1 + Stage 2 classification (classifyInput)
 *   4. Apply template extraction if applicable
 *   5. Generate wikilinks
 *   6. Write to new destination via vault-gateway
 *   7. Move original to proposals/<origin>/rerouted/ with metadata (D-62)
 *
 * Status transitions (D-63):
 *   - Dead-letter: status: unrouted → rerouted (success) or reroute-failed (failure)
 *   - Left-proposal: status: pending → rerouted (success)
 *
 * @module reroute
 */

const fs = require('fs');
const path = require('path');

const VAULT_ROOT = () => process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');

/**
 * Strip frontmatter and review checklists from file content.
 * Returns the raw original input body.
 */
function stripFrontmatter(content) {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return content;
  let body = content.slice(end + 5).trim();

  // Also strip the left-proposal review checklist block if present
  // Remove the ## Review section and its checkboxes
  body = body.replace(/^## Review\s*\n(- \[[ x]\] \w+.*\n)*/m, '').trim();

  return body;
}

/**
 * Determine the origin of a file: 'unrouted' or 'left-proposals'.
 * Returns the subdirectory name relative to proposals/.
 */
function determineOrigin(filePath) {
  const vaultRoot = VAULT_ROOT();
  const proposalsUnrouted = path.join(vaultRoot, 'proposals', 'unrouted');
  const proposalsLeftProposals = path.join(vaultRoot, 'proposals', 'left-proposals');

  const normalized = path.normalize(filePath);
  if (normalized.startsWith(path.normalize(proposalsUnrouted))) return 'unrouted';
  if (normalized.startsWith(path.normalize(proposalsLeftProposals))) return 'left-proposals';
  return null;
}

/**
 * Update status field in a file's frontmatter.
 * Returns updated content string.
 */
function updateStatus(content, newStatus) {
  return content.replace(/^status: \w+/m, `status: ${newStatus}`);
}

/**
 * Re-classify and reroute a dead-letter or left-proposal file.
 *
 * @param {string} filePath - Absolute path to the file to reroute
 * @returns {Promise<{
 *   rerouted: boolean,
 *   from?: string,
 *   to?: string,
 *   reason?: string,
 *   failureMode?: string
 * }>}
 */
async function rerouteFile(filePath) {
  const { generateCorrelationId } = require('./pipeline-infra');
  const correlationId = generateCorrelationId();

  // ── Check file exists ──────────────────────────────────────────────────────
  if (!fs.existsSync(filePath)) {
    return { rerouted: false, reason: `File does not exist: ${filePath}` };
  }

  const origin = determineOrigin(filePath);
  const rawContent = fs.readFileSync(filePath, 'utf8');
  const inputBody = stripFrontmatter(rawContent);

  // ── (2) Stage 0 exclusion gate ─────────────────────────────────────────────
  const { runStage0, classifyInput } = require('./classifier');
  const stage0Result = await runStage0(inputBody, correlationId);

  if (stage0Result.blocked) {
    return {
      rerouted: false,
      reason: `Blocked by exclusion gate: ${stage0Result.reason}`,
      failureMode: 'blocked',
    };
  }

  // ── (3) Run Stage 1 + Stage 2 classification ───────────────────────────────
  let classifyResult;
  try {
    classifyResult = await classifyInput(inputBody, { interactive: false, correlationId });
  } catch (err) {
    return { rerouted: false, reason: `Classification failed: ${err.message}`, failureMode: 'api-error' };
  }

  if (classifyResult.blocked) {
    return { rerouted: false, reason: `Blocked during reclassification`, failureMode: 'blocked' };
  }

  if (classifyResult.deadLettered) {
    return { rerouted: false, reason: `Reclassification failed: ${classifyResult.failureMode}`, failureMode: classifyResult.failureMode };
  }

  // ── (4) Template extraction ────────────────────────────────────────────────
  const { extractTemplateFields, formatNote, formatLeftProposal, generateFilename } = require('./note-formatter');
  const { vaultWrite } = require('./vault-gateway');
  const { suggestWikilinks, refreshIndexEntry } = require('./wikilink-engine');

  const templatedDomains = ['briefings', 'job-hunt', 'interview-prep'];
  let templateFields = {};
  const isRightSide = classifyResult.side === 'RIGHT';
  if (isRightSide && templatedDomains.includes(classifyResult.directory)) {
    try {
      templateFields = await extractTemplateFields(inputBody, classifyResult.directory, correlationId);
    } catch (_) {}
  }

  // ── (5) Generate wikilinks ─────────────────────────────────────────────────
  let wikilinkSection = '';
  try {
    const isLeftProposal = classifyResult.side === 'LEFT';
    const wikilinkResult = await suggestWikilinks(inputBody, [], {
      isLeftProposal,
      correlationId,
    });
    if (wikilinkResult && wikilinkResult.section) {
      wikilinkSection = wikilinkResult.section;
    }
  } catch (_) {
    // Non-fatal per D-39
  }

  // ── (6) Write to new destination ───────────────────────────────────────────
  try {
    const filenameResult = await generateFilename(inputBody, { correlationId });
    const noteFilename = filenameResult.filename;

    let formattedContent;
    let targetDir;

    if (classifyResult.side === 'LEFT') {
      // Per D-62: LEFT classification → proposals/left-proposals/ (never directly to LEFT)
      targetDir = 'proposals/left-proposals';
      const clr = {
        side: 'LEFT',
        directory: 'proposals/left-proposals',
        suggestedLeftPath: classifyResult.suggestedLeftPath || 'Drafts/',
        confidence: classifyResult.confidence,
        stage1: { side: 'LEFT', confidence: classifyResult.confidence },
        stage2: {
          directory: classifyResult.directory || 'Drafts',
          confidence: classifyResult.confidence,
          sonnetEscalated: false,
        },
      };
      formattedContent = await formatLeftProposal(inputBody, clr, {
        source: 'reroute',
        correlationId,
      });
    } else {
      targetDir = classifyResult.directory;
      const clr = {
        side: 'RIGHT',
        directory: targetDir,
        confidence: classifyResult.confidence,
        stage1: { side: 'RIGHT', confidence: classifyResult.confidence },
        stage2: { directory: targetDir, confidence: classifyResult.confidence, sonnetEscalated: classifyResult.sonnetEscalated || false },
      };
      formattedContent = await formatNote(inputBody, clr, {
        source: 'reroute',
        domain: targetDir,
        correlationId,
      });
    }

    if (wikilinkSection) {
      formattedContent = formattedContent + '\n\n' + wikilinkSection;
    }

    const targetPath = `${targetDir}/${noteFilename}`;
    await vaultWrite(targetPath, formattedContent);

    // Refresh index for RIGHT-side writes
    if (classifyResult.side === 'RIGHT') {
      try {
        await refreshIndexEntry(targetPath);
      } catch (_) {}
    }

    // ── (7) Move original to proposals/<origin>/rerouted/ with metadata ────────
    const vaultRoot = VAULT_ROOT();
    const reroutedDir = origin
      ? path.join(vaultRoot, 'proposals', origin, 'rerouted')
      : path.join(path.dirname(filePath), 'rerouted');

    fs.mkdirSync(reroutedDir, { recursive: true });

    const reroutedFilePath = path.join(reroutedDir, path.basename(filePath));

    // Update status field in content + append metadata
    let archivedContent = updateStatus(rawContent, 'rerouted');
    const rerouteMetadata = [
      '',
      `rerouted-at: ${new Date().toISOString()}`,
      `rerouted-from: ${filePath}`,
      `rerouted-to: ${targetPath}`,
    ].join('\n');

    archivedContent = archivedContent + rerouteMetadata + '\n';
    fs.writeFileSync(reroutedFilePath, archivedContent, 'utf8');

    // Remove original
    fs.unlinkSync(filePath);

    return { rerouted: true, from: filePath, to: targetPath };

  } catch (err) {
    // On failure, leave original file unchanged per D-61
    return { rerouted: false, reason: `Reroute failed: ${err.message}`, failureMode: 'reroute-failed' };
  }
}

module.exports = { rerouteFile };

'use strict';

/**
 * promote-unrouted.js
 *
 * /promote-unrouted command — manual promotion of a dead-letter file to a
 * specified vault path (D-51 through D-54).
 *
 * Validation pipeline (D-52):
 *   1. Verify file exists in proposals/unrouted/
 *   2. Validate --target: RIGHT-side path in vault-paths.json, OR LEFT label (→ left-proposals/)
 *   3. Re-run Stage 0 exclusion gate
 *   4. Apply template extraction (D-08/D-09) if templated domain
 *   5. Generate wikilinks
 *   6. Write via vault-gateway
 *   7. On success: move original to proposals/unrouted/promoted/ with metadata (D-53)
 *
 * @module promote-unrouted
 */

const fs = require('fs');
const path = require('path');

const VAULT_ROOT = () => process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');
const CONFIG_DIR = () => process.env.CONFIG_DIR_OVERRIDE || path.join(__dirname, '..', 'config');

function loadVaultPaths() {
  const raw = fs.readFileSync(path.join(CONFIG_DIR(), 'vault-paths.json'), 'utf8');
  return JSON.parse(raw);
}

/**
 * Strip frontmatter from file content to extract the original input body.
 * Returns the body after the closing --- delimiter.
 */
function stripFrontmatter(content) {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return content;
  return content.slice(end + 5).trim();
}

/**
 * Validate and resolve the --target option.
 * Returns { type: 'right', path: string } or { type: 'left', suggestedLeftPath: string }
 * or null if invalid.
 */
function resolveTarget(target, vaultPaths) {
  const rightPaths = vaultPaths.right || [];
  const leftPaths = vaultPaths.left || [];

  // Check if target is a valid RIGHT-side path
  if (rightPaths.includes(target)) {
    return { type: 'right', targetPath: target };
  }

  // Check if target is a valid LEFT label
  if (leftPaths.includes(target)) {
    return { type: 'left', suggestedLeftPath: target };
  }

  return null;
}

/**
 * Manually promote a dead-letter file to a specified vault path.
 *
 * @param {string} filename - Filename in proposals/unrouted/ (or absolute path)
 * @param {object} [options={}]
 * @param {string} options.target - Target directory (required)
 * @returns {Promise<{ promoted: boolean, destination?: string, reason?: string }>}
 */
async function promoteUnrouted(filename, options = {}) {
  const { target } = options;
  const correlationId = require('./pipeline-infra').generateCorrelationId();

  // ── (1) Verify file exists in proposals/unrouted/ ─────────────────────────
  const unroutedDir = path.join(VAULT_ROOT(), 'proposals', 'unrouted');
  const filePath = path.isAbsolute(filename) ? filename : path.join(unroutedDir, filename);

  if (!fs.existsSync(filePath)) {
    return { promoted: false, reason: `File does not exist: ${filename}` };
  }

  // ── (2) Validate --target ─────────────────────────────────────────────────
  let vaultPaths;
  try {
    vaultPaths = loadVaultPaths();
  } catch (err) {
    return { promoted: false, reason: `Failed to load vault-paths.json: ${err.message}` };
  }

  const targetResolved = resolveTarget(target, vaultPaths);
  if (!targetResolved) {
    return { promoted: false, reason: `Invalid target path: "${target}". Must be in vault-paths.json.` };
  }

  // ── (3) Read original input body ──────────────────────────────────────────
  const rawContent = fs.readFileSync(filePath, 'utf8');
  const inputBody = stripFrontmatter(rawContent);

  // ── (4) Re-run Stage 0 ────────────────────────────────────────────────────
  const { runStage0 } = require('./classifier');
  const stage0Result = await runStage0(inputBody, correlationId);

  if (stage0Result.blocked) {
    return { promoted: false, reason: `Blocked by exclusion gate: ${stage0Result.reason}` };
  }

  // ── (5) Apply template extraction ────────────────────────────────────────
  const { extractTemplateFields, formatNote, formatLeftProposal, generateFilename } = require('./note-formatter');
  const { vaultWrite } = require('./vault-gateway');
  const { suggestWikilinks, refreshIndexEntry } = require('./wikilink-engine');

  const templatedDomains = ['briefings', 'job-hunt', 'interview-prep'];
  let templateFields = {};
  if (targetResolved.type === 'right' && templatedDomains.includes(targetResolved.targetPath)) {
    try {
      templateFields = await extractTemplateFields(inputBody, targetResolved.targetPath, correlationId);
    } catch (_) {
      // Enrichment failure is non-fatal per D-39
    }
  }

  // ── (6) Generate wikilinks ───────────────────────────────────────────────
  let wikilinkSection = '';
  try {
    const isLeftProposal = targetResolved.type === 'left';
    const wikilinkResult = await suggestWikilinks(inputBody, [], {
      isLeftProposal,
      correlationId,
    });
    if (wikilinkResult && wikilinkResult.section) {
      wikilinkSection = wikilinkResult.section;
    }
  } catch (_) {
    // Enrichment failure is non-fatal per D-39
  }

  // ── (7) Format note ──────────────────────────────────────────────────────
  let targetDir;
  let formattedContent;
  let classificationResult;

  try {
    const filenameResult = await generateFilename(inputBody, { correlationId });
    const noteFilename = filenameResult.filename;

    if (targetResolved.type === 'left') {
      // Route to proposals/left-proposals/ with suggested-left-path (D-54)
      targetDir = 'proposals/left-proposals';
      classificationResult = {
        side: 'LEFT',
        directory: 'proposals/left-proposals',
        suggestedLeftPath: `${targetResolved.suggestedLeftPath}/`,
        confidence: 1.0,
        stage1: { side: 'LEFT', confidence: 1.0 },
        stage2: { directory: targetResolved.suggestedLeftPath, confidence: 1.0, sonnetEscalated: false },
      };
      formattedContent = await formatLeftProposal(inputBody, classificationResult, {
        source: 'promote-unrouted',
        correlationId,
      });
    } else {
      targetDir = targetResolved.targetPath;
      classificationResult = {
        side: 'RIGHT',
        directory: targetDir,
        confidence: 1.0,
        stage1: { side: 'RIGHT', confidence: 1.0 },
        stage2: { directory: targetDir, confidence: 1.0, sonnetEscalated: false },
      };
      formattedContent = await formatNote(inputBody, classificationResult, {
        source: 'promote-unrouted',
        domain: targetDir,
        correlationId,
      });
    }

    // Append wikilinks if any
    if (wikilinkSection) {
      formattedContent = formattedContent + '\n\n' + wikilinkSection;
    }

    // ── (8) Write via vault-gateway ──────────────────────────────────────────
    const targetPath = `${targetDir}/${noteFilename}`;
    await vaultWrite(targetPath, formattedContent);

    // Refresh index entry for RIGHT-side writes
    if (targetResolved.type === 'right') {
      try {
        await refreshIndexEntry(targetPath);
      } catch (_) {}
    }

    // ── (9) On success: move to proposals/unrouted/promoted/ ─────────────────
    const promotedDir = path.join(unroutedDir, 'promoted');
    fs.mkdirSync(promotedDir, { recursive: true });

    const promotedPath = path.join(promotedDir, path.basename(filePath));
    const promotionMetadata = [
      `promoted-at: ${new Date().toISOString()}`,
      `promoted-to: ${targetPath}`,
      `promoted-by: manual`,
    ].join('\n');

    // Append promotion metadata to frontmatter of archived copy
    const archivedContent = rawContent + '\n' + promotionMetadata + '\n';
    fs.writeFileSync(promotedPath, archivedContent, 'utf8');

    // Remove original from unrouted/
    fs.unlinkSync(filePath);

    return { promoted: true, destination: targetPath };

  } catch (err) {
    // Leave file in place per D-53
    return { promoted: false, reason: `Promotion failed: ${err.message}` };
  }
}

module.exports = { promoteUnrouted };

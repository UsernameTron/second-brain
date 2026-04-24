'use strict';

/**
 * new-command.js — /new command entry point.
 *
 * Classifies input via classifier.classifyInput() (Stages 0/1/2 including
 * dead-lettering) then owns Stages 3-5: template extraction, note formatting,
 * vault write, and non-blocking wikilink enrichment.
 *
 * Routing:
 *   - LEFT  → proposals/left-proposals/<filename>
 *   - RIGHT → <directory>/<filename>
 *   - Any Stage 0-2 failure → dead-lettered inside classifyInput (D-35/D-36/D-41)
 *   - Any Stage 3-5 failure → dead-lettered here via writeDeadLetter (D-35)
 *
 * Phase 15 (B-07) refactor: Stage 0/1/2 orchestration was previously inlined
 * here and duplicated classifier.classifyInput(). Now delegates to the single
 * canonical classifier pipeline.
 *
 * @module new-command
 */

const {
  generateCorrelationId,
  writeDeadLetter,
} = require('./pipeline-infra');

const { classifyInput } = require('./classifier');

const {
  formatNote,
  formatLeftProposal,
  generateFilename,
} = require('./note-formatter');

const { vaultWrite } = require('./vault-gateway');

const {
  suggestWikilinks,
  refreshIndexEntry,
} = require('./wikilink-engine');

// ── runNew ────────────────────────────────────────────────────────────────────

/**
 * Run the /new command: classify input and route to the correct vault location.
 *
 * @param {string} input - Raw input text
 * @param {object} [options={}]
 * @param {boolean} [options.interactive=true]
 * @param {string} [options.name] - User-provided filename override
 * @param {string} [options.source='cli']
 * @returns {Promise<{
 *   correlationId: string,
 *   blocked?: boolean,
 *   deadLettered?: boolean,
 *   failureMode?: string,
 *   destination?: string,
 *   side?: string,
 *   reason?: string
 * }>}
 */
async function runNew(input, options = {}) {
  const { interactive = true, source = 'cli' } = options;

  // ── Input validation ─────────────────────────────────────────────────────
  // Empty-input handling stays here (not classifier's responsibility —
  // classifier would otherwise run Stage 0 on an empty string).
  if (!input || !input.trim()) {
    const correlationId = generateCorrelationId();
    if (!interactive) {
      return {
        correlationId,
        blocked: false,
        failureMode: 'empty-input',
        deadLettered: false,
      };
    }
    // In interactive mode, the readline prompt lives in the CLI wrapper,
    // not here. Return an error envelope so the wrapper can prompt.
    return { correlationId, error: 'No input provided' };
  }

  // ── Stages 0-2: delegate to classifier.classifyInput ─────────────────────
  // classifyInput owns config load, Stage 0 exclusion, Stage 1 voice gate,
  // Stage 2 subdirectory pick, and dead-lettering for all three stages.
  const classification = await classifyInput(input, { interactive, source });
  const { correlationId } = classification;

  // Config load failure (handled by classifyInput)
  if (classification.failureMode === 'config-error') {
    return { correlationId, blocked: false, routed: false, error: 'Config load failed' };
  }

  // Hard BLOCK — already logged by classifyInput, no dead-letter per D-41
  if (classification.blocked) {
    return {
      correlationId,
      blocked: true,
      reason: classification.reason,
    };
  }

  // Dead-lettered by classifyInput (Stage 0/1/2 failure)
  if (classification.deadLettered) {
    return {
      correlationId,
      blocked: false,
      deadLettered: true,
      failureMode: classification.failureMode,
    };
  }

  // ── Stages 3-5: format, write, enrich ────────────────────────────────────
  try {
    // Stage 3: Filename generation
    const filenameResult = await generateFilename(input, {
      name: options.name,
      correlationId,
    });
    const { filenameBasis, filename } = filenameResult;

    // Stage 4: Format note based on side. classifyInput already shaped the
    // result with side/directory/suggestedLeftPath/stage1/stage2, so the
    // formatter receives it directly.
    let formattedContent;
    if (classification.side === 'LEFT') {
      formattedContent = await formatLeftProposal(input, classification, {
        source,
        correlationId,
      });
    } else {
      formattedContent = await formatNote(input, classification, {
        source,
        filenameBasis,
        domain: classification.stage2.directory,
        correlationId,
      });
    }

    // Stage 5: Vault write
    const targetDir = classification.side === 'LEFT'
      ? 'proposals/left-proposals'
      : classification.stage2.directory;
    const targetPath = `${targetDir}/${filename}`;

    await vaultWrite(targetPath, formattedContent);

    // Stage 4 (post-write): wikilink enrichment — non-blocking per D-39
    try {
      const wikiResult = await suggestWikilinks(formattedContent, { correlationId });
      if (wikiResult.section && wikiResult.links && wikiResult.links.length > 0) {
        const enrichedContent = formattedContent + '\n' + wikiResult.section;
        await vaultWrite(targetPath, enrichedContent);
      }
      await refreshIndexEntry(targetPath);
    } catch (wikiErr) {
      console.error(`[wikilinks] Non-blocking failure: ${wikiErr.message} (correlation-id: ${correlationId})`);
    }

    console.log(`Routed to ${targetPath} (correlation-id: ${correlationId})`);

    return {
      correlationId,
      blocked: false,
      side: classification.side,
      destination: targetPath,
      directory: classification.stage2.directory,
      suggestedLeftPath: classification.suggestedLeftPath,
      sonnetEscalated: classification.sonnetEscalated,
    };

  } catch (err) {
    // Any Stage 3-5 failure → dead-letter per D-35.
    // Never lose captures that cleared Stage 0.
    let failureMode = 'api-error';
    if (err.code === 'STYLE_VIOLATION') failureMode = 'gate-rejection';
    if (err.code === 'PATH_BLOCKED') failureMode = 'gate-rejection';

    const dlResult = await writeDeadLetter(input, failureMode, correlationId, { source });
    console.error(`Dead-lettered to ${dlResult.path} (failure-mode: ${failureMode})`);

    return {
      correlationId,
      blocked: false,
      deadLettered: true,
      failureMode,
      deadLetterPath: dlResult.path,
    };
  }
}

module.exports = {
  runNew,
};

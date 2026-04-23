'use strict';

/**
 * new-command.js
 *
 * /new command entry point — full pipeline orchestration for input routing.
 *
 * Pipeline (D-40):
 *   Stage 0: Exclusion gate (content-policy.js via classifier.runStage0)
 *   Stage 1: Voice gate (LEFT vs RIGHT via classifier.runStage1)
 *   Stage 2: Subdirectory pick (via classifier.runStage2)
 *   Stage 3: Template extraction (conditional on domain, via note-formatter)
 *   Stage 4: Note formatting (note-formatter.formatNote / formatLeftProposal)
 *   Stage 5: Vault write (vault-gateway.vaultWrite)
 *   Stage 4 (post-write): Wikilink enrichment (wikilink-engine.suggestWikilinks) — non-blocking (D-39)
 *   Stage 4 (post-write): Index update (wikilink-engine.refreshIndexEntry) per D-18
 *
 * Routing:
 *   - LEFT → proposals/left-proposals/<filename>
 *   - RIGHT → <directory>/<filename>
 *   - Any Stage 1-5 failure → dead-letter via writeDeadLetter (D-35)
 *
 * Interactive vs non-interactive:
 *   - Interactive: low-confidence prompts user for confirmation
 *   - Non-interactive: ambiguous → dead-letter 'non-interactive-ambiguous' (D-03)
 *
 * @module new-command
 */

const {
  generateCorrelationId,
  writeDeadLetter,
  safeLoadPipelineConfig,
} = require('./pipeline-infra');

const {
  runStage0,
  runStage1,
  runStage2,
} = require('./classifier');

const {
  formatNote,
  formatLeftProposal,
  generateFilename,
} = require('./note-formatter');

const {
  vaultWrite,
} = require('./vault-gateway');

const {
  suggestWikilinks,
  refreshIndexEntry,
} = require('./wikilink-engine');

// ── runNew ────────────────────────────────────────────────────────────────────

/**
 * Run the /new command: classify input and route to the correct vault location.
 *
 * @param {string} input - Raw input text (or empty if interactive prompt needed)
 * @param {object} [options={}]
 * @param {boolean} [options.interactive=true] - Whether interactive prompts are allowed
 * @param {string} [options.name] - User-provided filename override (--name flag)
 * @param {string} [options.source='cli'] - Source identifier
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
  const correlationId = generateCorrelationId();

  const { config: pipelineConfig, error: configErr } = safeLoadPipelineConfig();
  if (configErr) {
    return { correlationId, blocked: false, routed: false, error: `Config load failed: ${configErr.message}` };
  }
  const { stage1ConfidenceThreshold } = pipelineConfig.classifier;

  // Validate input
  if (!input || !input.trim()) {
    if (!interactive) {
      return {
        correlationId,
        blocked: false,
        failureMode: 'empty-input',
        deadLettered: false,
      };
    }
    // In interactive mode, we would prompt — for now return an error
    // (readline prompt is handled by the CLI wrapper, not this function)
    return { correlationId, error: 'No input provided' };
  }

  // ── Stage 0: Exclusion gate ──────────────────────────────────────────────
  const stage0Result = await runStage0(input, correlationId);

  if (stage0Result.blocked) {
    // Hard BLOCK — exit immediately per D-41. No dead-letter.
    return {
      correlationId,
      blocked: true,
      reason: stage0Result.reason,
    };
  }

  if (stage0Result.deadLetter) {
    // Stage 0 internal failure — dead-letter per D-36
    const dlResult = await writeDeadLetter(input, 'exclusion-unavailable', correlationId, {
      source,
    });
    return {
      correlationId,
      blocked: false,
      deadLettered: true,
      failureMode: 'exclusion-unavailable',
      deadLetterPath: dlResult.path,
    };
  }

  // ── Stage 1: Voice gate ──────────────────────────────────────────────────
  const stage1Result = await runStage1(input, correlationId, { interactive });

  if (stage1Result.side === null) {
    // Stage 1 API failure — dead-letter per D-35
    const failureMode = stage1Result.failureMode || 'api-error';
    const dlResult = await writeDeadLetter(input, failureMode, correlationId, { source });
    return {
      correlationId,
      blocked: false,
      deadLettered: true,
      failureMode,
      deadLetterPath: dlResult.path,
    };
  }

  // Low Stage 1 confidence in non-interactive mode → dead-letter per D-03
  if (stage1Result.confidence < stage1ConfidenceThreshold && !interactive) {
    const dlResult = await writeDeadLetter(input, 'non-interactive-ambiguous', correlationId, {
      source,
    });
    return {
      correlationId,
      blocked: false,
      deadLettered: true,
      failureMode: 'non-interactive-ambiguous',
      deadLetterPath: dlResult.path,
    };
  }

  // ── Stage 2: Subdirectory pick ───────────────────────────────────────────
  const stage2Result = await runStage2(input, stage1Result, correlationId, { interactive });

  if (stage2Result.failureMode && !stage2Result.directory) {
    // Stage 2 API failure
    const failureMode = stage2Result.failureMode;
    const dlResult = await writeDeadLetter(input, failureMode, correlationId, { source });
    return {
      correlationId,
      blocked: false,
      deadLettered: true,
      failureMode,
      deadLetterPath: dlResult.path,
    };
  }

  // ── Stage 3: Build classification context for formatter ──────────────────
  const classificationResult = {
    side: stage1Result.side,
    directory: stage1Result.side === 'LEFT'
      ? 'proposals/left-proposals'
      : stage2Result.directory,
    suggestedLeftPath: stage1Result.side === 'LEFT'
      ? (stage2Result.directory ? `${stage2Result.directory}/` : 'Drafts/')
      : undefined,
    confidence: stage2Result.confidence,
    stage1: {
      side: stage1Result.side,
      confidence: stage1Result.confidence,
    },
    stage2: {
      directory: stage2Result.directory,
      confidence: stage2Result.confidence,
      sonnetEscalated: stage2Result.sonnetEscalated || false,
    },
  };

  // ── Stage 4: Format note ─────────────────────────────────────────────────
  let formattedContent;
  let filenameBasis;

  try {
    // Generate filename first to know filenameBasis for frontmatter
    const filenameResult = await generateFilename(input, {
      name: options.name,
      correlationId,
    });
    filenameBasis = filenameResult.filenameBasis;
    const filename = filenameResult.filename;

    // Format based on side
    if (stage1Result.side === 'LEFT') {
      formattedContent = await formatLeftProposal(input, classificationResult, {
        source,
        correlationId,
      });
    } else {
      formattedContent = await formatNote(input, classificationResult, {
        source,
        filenameBasis,
        domain: stage2Result.directory,
        correlationId,
      });
    }

    // ── Stage 5: Vault write ───────────────────────────────────────────────
    const targetDir = stage1Result.side === 'LEFT'
      ? 'proposals/left-proposals'
      : stage2Result.directory;

    const targetPath = `${targetDir}/${filename}`;

    await vaultWrite(targetPath, formattedContent);

    // ── Stage 4 (post-write): Wikilink enrichment ────────────────────────
    // Non-blocking per D-39: failures logged but never block the pipeline
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

    const destination = targetPath;
    console.log(`Routed to ${destination} (correlation-id: ${correlationId})`);

    return {
      correlationId,
      blocked: false,
      side: stage1Result.side,
      destination,
      directory: stage2Result.directory,
      suggestedLeftPath: classificationResult.suggestedLeftPath,
      sonnetEscalated: stage2Result.sonnetEscalated,
    };

  } catch (err) {
    // Any Stage 3-5 failure → dead-letter per D-35
    // Never lose captures that cleared Stage 0
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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  runNew,
};

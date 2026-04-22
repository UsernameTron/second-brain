'use strict';

/**
 * classifier.js
 *
 * Two-stage hierarchical input classifier for the /new pipeline.
 *
 * Stage 0: Exclusion gate — calls content-policy.js checkContent.
 *   - BLOCK: returns immediately, no dead-letter (D-41)
 *   - Internal failure: fail-closed, dead-letter with 'exclusion-unavailable' (D-36)
 *
 * Stage 1: Voice gate — binary LEFT vs RIGHT via Haiku (D-02, D-59)
 *   - Does not escalate to Sonnet (voice-gate binary is empirically reliable)
 *   - Low confidence in non-interactive mode → dead-letter 'non-interactive-ambiguous' (D-03)
 *
 * Stage 2: Subdirectory pick — target directory within chosen side (D-02, D-04)
 *   - Haiku primary; Sonnet escalation when Haiku confidence < sonnetEscalationThreshold
 *   - Sonnet accepted when >= sonnetAcceptThreshold; else → needsInteractive
 *
 * Instrumentation: every run logged per D-06.
 *
 * @module classifier
 */

const path = require('path');
const fs = require('fs');

const {
  generateCorrelationId,
  createHaikuClient,
  createSonnetClient,
  writeDeadLetter,
  loadPipelineConfig,
} = require('./pipeline-infra');

const { checkContent } = require('./content-policy');

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = process.env.CONFIG_DIR_OVERRIDE
  || path.join(__dirname, '..', 'config');

/**
 * Load vault-paths.json for Stage 2 label building.
 * @returns {{ left: string[], right: string[] }}
 */
function loadVaultPaths() {
  const filePath = path.join(CONFIG_DIR, 'vault-paths.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

// ── Instrumentation logging ───────────────────────────────────────────────────

/**
 * Log classification instrumentation per D-06.
 * Output format: structured JSON to stderr with event type for grep-ability.
 *
 * @param {object} data - Instrumentation payload
 */
function logInstrumentation(data) {
  const logEntry = JSON.stringify({
    event: 'classifier:decision',
    timestamp: new Date().toISOString(),
    ...data,
  });
  process.stderr.write(logEntry + '\n');
}

// ── Stage 0: Exclusion gate ───────────────────────────────────────────────────

/**
 * Stage 0: Run the content-policy exclusion gate.
 *
 * Per D-41: Stage 0 is a hard gate.
 *   - BLOCK → return { blocked: true, reason } (caller exits immediately, no dead-letter)
 *   - Internal failure → fail-closed: { blocked: false, deadLetter: true, failureMode: 'exclusion-unavailable' }
 *   - PASS → { blocked: false }
 *
 * The excluded terms list is read from config/excluded-terms.json.
 *
 * @param {string} content - Input content to check
 * @param {string} correlationId - Pipeline correlation ID
 * @returns {Promise<{ blocked: boolean, reason?: string, deadLetter?: boolean, failureMode?: string }>}
 */
async function runStage0(content, correlationId) {
  // Load excluded terms from config
  let excludedTerms = [];
  try {
    const termsPath = path.join(CONFIG_DIR, 'excluded-terms.json');
    const raw = fs.readFileSync(termsPath, 'utf8');
    const parsed = JSON.parse(raw);
    excludedTerms = parsed.terms || [];
  } catch (_) {
    // Non-fatal: if terms can't be loaded, we still call checkContent with empty list
    // The checkContent will pass (no terms to match), which is fail-open for exclusion-unavailable
    // However, per D-41, if the entire checkContent call throws, we fail-closed.
  }

  try {
    const result = await checkContent(content, excludedTerms);

    if (result.decision === 'BLOCK') {
      return { blocked: true, reason: result.reason };
    }

    return { blocked: false };
  } catch (err) {
    // content-policy.js threw — fail-closed per D-36 / D-41
    // Dead-letter with 'exclusion-unavailable' — caller decides whether to call writeDeadLetter
    return {
      blocked: false,
      deadLetter: true,
      failureMode: 'exclusion-unavailable',
    };
  }
}

// ── Stage 1: Voice gate ────────────────────────────────────────────────────────

/**
 * Stage 1: Classify content as LEFT (human voice) or RIGHT (structured/agent).
 *
 * Per D-02, D-59: Voice gate is binary LEFT/RIGHT.
 * Per D-04: Haiku only — no Sonnet escalation for Stage 1.
 *
 * System prompt encodes D-59 operational rules:
 *   - LEFT signals: first-person, personal opinion, reflections, relationship, emotional
 *   - RIGHT signals: structured data, agent-generated, research, briefing, template
 *   - Short input (< shortInputChars) with no clear voice → default RIGHT, reduced confidence
 *
 * @param {string} content - Input to classify
 * @param {string} correlationId - Pipeline correlation ID
 * @param {object} [options={}]
 * @returns {Promise<{ side: string|null, confidence: number, rationale?: string, failureMode?: string }>}
 */
async function runStage1(content, correlationId, options = {}) {
  const pipelineConfig = loadPipelineConfig();
  const { shortInputChars } = pipelineConfig.classifier;

  const haikuClient = createHaikuClient();

  const systemPrompt = `You are a voice-authenticity classifier for a personal knowledge vault.

Determine if the input text was written by or sounds like it was written by the user personally (LEFT) or is structured/agent-generated/external data (RIGHT).

**LEFT signals** (classify as LEFT when dominant):
- First-person voice ("I think", "I feel", "I realized", "my experience")
- Personal opinions and reflections
- Relationship context about specific people
- Emotional content and identity statements
- Career narratives in the user's own words
- Communication style preferences

**RIGHT signals** (classify as RIGHT when dominant):
- Structured data (job postings, meeting minutes, tables, lists)
- Agent-generated or synthesized content
- Research summaries and extracted information
- Technical reference material
- Briefing output and template-driven content
- External data (job descriptions, company info, news)

**Rules:**
- Mixed content: classify by dominant voice; if roughly equal, classify LEFT (false-LEFT is recoverable via /reroute; false-RIGHT risks agent content on the LEFT)
- Short inputs (< ${shortInputChars} characters) with no clear voice signal: default RIGHT with reduced confidence (0.3-0.6)
- Be decisive. Do not abstain.

**Response format** (JSON only, no markdown fences):
{ "side": "LEFT" | "RIGHT", "confidence": 0.0-1.0, "rationale": "brief explanation" }`;

  const userContent = `Classify this input:\n\n${content}`;

  const response = await haikuClient.classify(systemPrompt, userContent, {
    correlationId,
    maxTokens: 256,
  });

  if (!response.success) {
    return {
      side: null,
      confidence: 0,
      failureMode: response.failureMode || 'api-error',
    };
  }

  const { side, confidence, rationale } = response.data;
  return { side, confidence, rationale };
}

// ── Stage 2: Subdirectory pick ────────────────────────────────────────────────

/**
 * Build the subdirectory label list for Stage 2 classification.
 *
 * Per D-02: Stage 2 picks a target directory within the chosen side.
 *   - LEFT side labels: ABOUT ME, Daily, Relationships, Drafts
 *   - RIGHT side labels: right entries from vault-paths.json (excluding proposals paths)
 *
 * @param {string} side - 'LEFT' or 'RIGHT'
 * @returns {string[]} List of directory labels
 */
function buildStage2Labels(side) {
  const vaultPaths = loadVaultPaths();

  if (side === 'LEFT') {
    // LEFT labels are the human-voice directories
    return vaultPaths.left || ['ABOUT ME', 'Daily', 'Relationships', 'Drafts'];
  }

  // RIGHT labels: exclude proposals paths (classifier never routes to proposals directly per D-02)
  const excluded = ['proposals', 'proposals/unrouted', 'proposals/left-proposals',
    'proposals/left-proposals/archive', 'memory-proposals-archive'];
  return (vaultPaths.right || []).filter(dir => !excluded.includes(dir));
}

/**
 * Stage 2: Pick the target subdirectory within the chosen side.
 *
 * Per D-04: Haiku primary, Sonnet escalation when Haiku confidence < sonnetEscalationThreshold (0.8).
 *   - Sonnet confidence >= sonnetAcceptThreshold (0.7) → accept
 *   - Sonnet confidence < 0.7 → return needsInteractive with top 2 candidates
 *
 * @param {string} content - Input content
 * @param {{ side: string, confidence: number }} stage1Result - Stage 1 output
 * @param {string} correlationId - Pipeline correlation ID
 * @param {object} [options={}]
 * @returns {Promise<{
 *   directory?: string,
 *   confidence: number,
 *   rationale?: string,
 *   sonnetEscalated?: boolean,
 *   needsInteractive?: boolean,
 *   topCandidates?: string[],
 *   failureMode?: string
 * }>}
 */
async function runStage2(content, stage1Result, correlationId, options = {}) {
  const pipelineConfig = loadPipelineConfig();
  const { sonnetEscalationThreshold, sonnetAcceptThreshold } = pipelineConfig.classifier;

  const { side } = stage1Result;
  const labels = buildStage2Labels(side);

  const labelDescriptions = {
    'ABOUT ME': 'Identity, work style, communication preferences, professional background',
    'Daily': 'Daily journal entries, reflections, day summaries',
    'Relationships': 'Notes about specific people — how they work, communication style, context',
    'Drafts': 'Work-in-progress writing, content being developed',
    'memory': 'Memory entries and compounding knowledge base',
    'briefings': 'Meeting notes, briefing documents, structured summaries',
    'ctg': 'CTG engagement work — consulting, projects, client deliverables',
    'job-hunt': 'Job postings, applications, company research, recruiter contacts',
    'interview-prep': 'Interview preparation, company research, story bank, risk questions',
    'content': 'Blog posts, articles, presentations, external-facing content',
    'research': 'Research notes, analysis, reference material',
    'ideas': 'Ideas, concepts, brainstorming, speculative thinking',
    'memory-archive': 'Archived memory entries from previous years',
  };

  const labelList = labels
    .map(l => `- ${l}: ${labelDescriptions[l] || 'Vault directory'}`)
    .join('\n');

  const systemPrompt = `You are a subdirectory classifier for a personal knowledge vault.

The input has been classified as ${side} content. Pick the most appropriate target directory.

Available directories:
${labelList}

**Rules:**
- Choose exactly one directory from the list above
- Be decisive; pick the best fit even for ambiguous content
- If very unsure, provide a lower confidence score and list your top alternatives in topCandidates

**Response format** (JSON only, no markdown fences):
{ "directory": "directory-name", "confidence": 0.0-1.0, "rationale": "brief explanation", "topCandidates": ["first", "second"] }`;

  const userContent = `Classify this ${side} content into a subdirectory:\n\n${content}`;

  const haikuClient = createHaikuClient();
  const haikuResponse = await haikuClient.classify(systemPrompt, userContent, {
    correlationId,
    maxTokens: 300,
  });

  if (!haikuResponse.success) {
    return {
      directory: null,
      confidence: 0,
      failureMode: haikuResponse.failureMode || 'api-error',
    };
  }

  const haikuData = haikuResponse.data;

  // Haiku confidence is high enough — accept
  if (haikuData.confidence >= sonnetEscalationThreshold) {
    return {
      directory: haikuData.directory,
      confidence: haikuData.confidence,
      rationale: haikuData.rationale,
      sonnetEscalated: false,
    };
  }

  // Haiku confidence < threshold — escalate to Sonnet per D-04
  const sonnetClient = createSonnetClient();
  const sonnetResponse = await sonnetClient.classify(systemPrompt, userContent, {
    correlationId,
    maxTokens: 300,
  });

  if (!sonnetResponse.success) {
    // Sonnet failed — fall through to interactive
    const topCandidates = haikuData.topCandidates || [haikuData.directory, labels[0]];
    return {
      needsInteractive: true,
      topCandidates: topCandidates.slice(0, 2),
      confidence: haikuData.confidence,
      sonnetEscalated: true,
      failureMode: sonnetResponse.failureMode,
    };
  }

  const sonnetData = sonnetResponse.data;

  // Sonnet confidence >= accept threshold — accept
  if (sonnetData.confidence >= sonnetAcceptThreshold) {
    return {
      directory: sonnetData.directory,
      confidence: sonnetData.confidence,
      rationale: sonnetData.rationale,
      sonnetEscalated: true,
    };
  }

  // Both Haiku and Sonnet below thresholds — needs interactive
  const haiku2 = haikuData.topCandidates || [haikuData.directory];
  const sonnet2 = sonnetData.topCandidates || [sonnetData.directory];
  // Merge and deduplicate top candidates
  const merged = [...new Set([...haiku2, ...sonnet2])].slice(0, 2);

  return {
    needsInteractive: true,
    topCandidates: merged,
    confidence: sonnetData.confidence,
    sonnetEscalated: true,
  };
}

// ── classifyInput: full pipeline orchestration ────────────────────────────────

/**
 * Run the full classification pipeline: Stage 0 → Stage 1 → Stage 2.
 *
 * Per D-40: Sequential pipeline. Per D-06: Full instrumentation logged.
 *
 * @param {string} content - Raw input content to classify
 * @param {object} [options={}]
 * @param {boolean} [options.interactive=true] - Whether interactive prompts are allowed
 * @returns {Promise<{
 *   correlationId: string,
 *   blocked: boolean,
 *   side?: string,
 *   directory?: string,
 *   suggestedLeftPath?: string,
 *   confidence?: number,
 *   needsInteractive?: boolean,
 *   topCandidates?: string[],
 *   failureMode?: string,
 *   deadLettered?: boolean,
 *   sonnetEscalated?: boolean
 * }>}
 */
async function classifyInput(content, options = {}) {
  const { interactive = true } = options;
  const correlationId = generateCorrelationId();
  const pipelineConfig = loadPipelineConfig();
  const { stage1ConfidenceThreshold } = pipelineConfig.classifier;

  const instrumentation = {
    correlationId,
    inputLength: content.length,
    interactive,
    stage1: null,
    stage2: null,
    sonnetEscalated: false,
    destination: null,
  };

  // ── Stage 0: Exclusion gate ──────────────────────────────────────────────
  const stage0Result = await runStage0(content, correlationId);

  if (stage0Result.blocked) {
    // Hard BLOCK — exit immediately per D-41. No dead-letter.
    instrumentation.destination = 'BLOCKED';
    logInstrumentation({ ...instrumentation, stage0: 'BLOCKED', reason: stage0Result.reason });
    return { correlationId, blocked: true, reason: stage0Result.reason };
  }

  if (stage0Result.deadLetter) {
    // Stage 0 internal failure — fail-closed, dead-letter
    await writeDeadLetter(content, 'exclusion-unavailable', correlationId, {
      source: options.source || 'cli',
    });
    instrumentation.destination = 'dead-letter:exclusion-unavailable';
    logInstrumentation({ ...instrumentation, stage0: 'INTERNAL_FAILURE' });
    return {
      correlationId,
      blocked: false,
      deadLettered: true,
      failureMode: 'exclusion-unavailable',
    };
  }

  // ── Stage 1: Voice gate ──────────────────────────────────────────────────
  const stage1Result = await runStage1(content, correlationId, options);

  instrumentation.stage1 = {
    side: stage1Result.side,
    confidence: stage1Result.confidence,
  };

  if (stage1Result.side === null) {
    // Stage 1 API failure — dead-letter
    const failureMode = stage1Result.failureMode || 'api-error';
    await writeDeadLetter(content, failureMode, correlationId, {
      source: options.source || 'cli',
    });
    instrumentation.destination = `dead-letter:${failureMode}`;
    logInstrumentation(instrumentation);
    return { correlationId, blocked: false, deadLettered: true, failureMode };
  }

  // Check confidence threshold — non-interactive dead-letter per D-03
  if (stage1Result.confidence < stage1ConfidenceThreshold && !interactive) {
    await writeDeadLetter(content, 'non-interactive-ambiguous', correlationId, {
      source: options.source || 'cli',
    });
    instrumentation.destination = 'dead-letter:non-interactive-ambiguous';
    logInstrumentation(instrumentation);
    return {
      correlationId,
      blocked: false,
      deadLettered: true,
      failureMode: 'non-interactive-ambiguous',
      stage1: stage1Result,
    };
  }

  // ── Stage 2: Subdirectory pick ───────────────────────────────────────────
  const stage2Result = await runStage2(content, stage1Result, correlationId, options);

  instrumentation.stage2 = {
    directory: stage2Result.directory,
    confidence: stage2Result.confidence,
  };
  instrumentation.sonnetEscalated = stage2Result.sonnetEscalated || false;

  if (stage2Result.failureMode && !stage2Result.directory) {
    // Stage 2 API failure
    const failureMode = stage2Result.failureMode;
    await writeDeadLetter(content, failureMode, correlationId, {
      source: options.source || 'cli',
    });
    instrumentation.destination = `dead-letter:${failureMode}`;
    logInstrumentation(instrumentation);
    return { correlationId, blocked: false, deadLettered: true, failureMode };
  }

  // Build the result. For LEFT content, the Stage 2 directory is advisory (suggestedLeftPath)
  // and the actual write target is always proposals/left-proposals/ per D-12.
  let result;
  if (stage1Result.side === 'LEFT') {
    const suggestedLeftPath = stage2Result.directory
      ? `${stage2Result.directory}/`
      : 'Drafts/';

    instrumentation.destination = 'proposals/left-proposals/';
    result = {
      correlationId,
      blocked: false,
      side: 'LEFT',
      directory: 'proposals/left-proposals',
      suggestedLeftPath,
      confidence: stage2Result.confidence,
      needsInteractive: stage2Result.needsInteractive,
      topCandidates: stage2Result.topCandidates,
      sonnetEscalated: stage2Result.sonnetEscalated || false,
    };
  } else {
    instrumentation.destination = stage2Result.directory || 'unknown';
    result = {
      correlationId,
      blocked: false,
      side: 'RIGHT',
      directory: stage2Result.directory,
      confidence: stage2Result.confidence,
      needsInteractive: stage2Result.needsInteractive,
      topCandidates: stage2Result.topCandidates,
      sonnetEscalated: stage2Result.sonnetEscalated || false,
    };
  }

  logInstrumentation(instrumentation);
  return result;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  classifyInput,
  runStage0,
  runStage1,
  runStage2,
};

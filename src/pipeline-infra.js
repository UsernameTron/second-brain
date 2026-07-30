'use strict';

/**
 * pipeline-infra.js
 *
 * Shared infrastructure for Phase 2 pipeline stages.
 * Provides: correlation ID generator, Haiku/Sonnet client wrappers,
 *           dead-letter writer, and config loaders.
 *
 * Design principles:
 *   - LLM clients never throw — all errors captured in return value (D-36)
 *   - Correlation IDs (UUID v4) propagate across all pipeline stages (D-42)
 *   - Dead-letter files preserve input verbatim and record failure metadata
 *   - Config loaders validate on load; fail-closed on schema errors
 *
 * @module pipeline-infra
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// dotenv.config() intentionally NOT called here. Library modules must not
// re-load .env at import time. Entry points (CLI scripts, hook runners)
// are responsible for calling dotenv.config() before requiring this module.
// See HOOK-DOTENV-01.

// ── Path resolution ──────────────────────────────────────────────────────────

const CONFIG_DIR = process.env.CONFIG_DIR_OVERRIDE
  || path.join(__dirname, '..', 'config');

const _VAULT_ROOT = process.env.VAULT_ROOT
  || path.join(process.env.HOME, 'Claude Cowork');

// ── Correlation ID ───────────────────────────────────────────────────────────

/**
 * Generate a UUID v4 correlation ID for pipeline tracing.
 * Uses Node.js built-in crypto.randomUUID() (available Node 15.6+).
 * Per D-42: every /new invocation gets a UUID that propagates through all stages.
 *
 * @returns {string} UUID v4 string
 */
function generateCorrelationId() {
  return crypto.randomUUID();
}

// ── LLM response parsing ─────────────────────────────────────────────────────

/**
 * Scan forward from `start` for the matching close bracket, returning the
 * balanced span. String-aware so brackets inside JSON strings don't miscount.
 *
 * @param {string} text
 * @param {number} start - index of the opening '[' or '{'
 * @returns {string|null} balanced substring, or null if never closed
 */
function scanBalancedSpan(text, start) {
  const open = text[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { if (inString) escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Parse JSON out of an LLM response that may be fenced, prefixed with prose,
 * or followed by commentary (e.g. "```json\n[]\n```\n\n**Rationale:** ...").
 *
 * Tries, in order: the bare string, the first fenced block, then the first
 * balanced [...]/{...} span.
 *
 * Throws SyntaxError when nothing parses — callers rely on that to emit the
 * parse-error failure signal, so a genuinely malformed response must NOT be
 * silently downgraded to an empty result.
 *
 * @param {string} rawText - raw LLM response text
 * @returns {*} parsed JSON value
 * @throws {SyntaxError} when no well-formed JSON is present
 */
function parseLlmJson(rawText) {
  const text = String(rawText);
  const attempt = (s) => {
    if (!s) return undefined;
    try { return { value: JSON.parse(s) }; } catch (_) { return undefined; }
  };

  // 1. Bare JSON — the common, well-behaved case.
  let hit = attempt(text.trim());
  if (hit) return hit.value;

  // 2. First fenced block, ```json or bare ```.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    hit = attempt(fenced[1].trim());
    if (hit) return hit.value;
  }

  // 3. First balanced array/object span — covers leading prose and unterminated
  // fences. ponytail: O(n·span) rescan; responses are max_tokens-bounded (~KB),
  // so a smarter scanner isn't worth the code.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[' && text[i] !== '{') continue;
    const span = scanBalancedSpan(text, i);
    // Never closed before EOF — the response is truncated. Scanning further would
    // pull a fragment out of the cut-off container (e.g. the first element of a
    // half-written array) and pass it off as the whole answer. Fail loudly instead.
    if (span === null) break;
    hit = attempt(span);
    if (hit) return hit.value;
  }

  throw new SyntaxError(`no well-formed JSON in LLM response: ${text.slice(0, 80)}`);
}

// ── LLM client factory ───────────────────────────────────────────────────────

/**
 * Create an LLM client wrapper that returns structured results, never throws.
 * All API errors, timeouts, and parse failures are captured in the return value.
 *
 * @param {object} options
 * @param {string} options.model - Anthropic model ID
 * @returns {{ classify: Function }}
 */
function createLlmClient(options = {}) {
  const model = options.model || 'claude-haiku-4-5';

  // Check for local LLM provider config
  const { config: pipelineConfig_, error: configErr } = safeLoadPipelineConfig();

  // Missing is not the same as malformed. An absent config file (ENOENT) falls through to
  // defaults, as it always has. A config that EXISTS but is unparseable or violates schema
  // must fail loudly: silently treating it as "no local provider" downgrades to Anthropic and
  // hides a broken setup behind results that look fine.
  if (configErr && configErr.code !== 'ENOENT') {
    return {
      classify: async () => ({
        success: false,
        error: `pipeline config invalid: ${configErr.message}`,
        failureMode: 'config-error',
      }),
    };
  }

  const llmConfig = pipelineConfig_ && pipelineConfig_.classifier && pipelineConfig_.classifier.llm;
  // Scheduled/unattended runs (the launchd dream-propose job) pin to Anthropic via
  // LLM_PROVIDER=anthropic, overriding the machine-local provider:local overlay that
  // interactive classifier runs use. Process-scoped — interactive sessions are unaffected.
  const useLocal = process.env.LLM_PROVIDER !== 'anthropic'
    && llmConfig && llmConfig.provider === 'local';

  let Anthropic, _sanitizeTermForPrompt, logDecision, anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
    ({ sanitizeTermForPrompt: _sanitizeTermForPrompt } = require('./content-policy'));
    ({ logDecision } = require('./vault-gateway'));
    anthropic = new Anthropic();
  } catch (initErr) {
    // API key missing or invalid — return a stub whose classify() always degrades gracefully
    return {
      classify: async () => ({
        success: false,
        error: `LLM client initialization failed: ${initErr.message}`,
        failureMode: 'api-error',
      }),
    };
  }

  /**
   * Classify via local OpenAI-compatible endpoint (e.g. LM Studio).
   * Falls back to Anthropic Haiku on connection failure.
   */
  async function classifyLocal(systemPrompt, userContent, callOptions = {}) {
    const maxTokens = callOptions.maxTokens || 1024;
    const correlationId = callOptions.correlationId || 'none';

    const controller = new AbortController(); // eslint-disable-line no-undef
    // Local models vary hugely in load/inference time; a 27B on first token can
    // exceed any fixed budget. Configurable, but unchanged at 10s when unset.
    // A1: clamp to the caller's budget — hook-driven callers (Stop hook is
    // SIGKILLed at 60s) pass callOptions.timeoutMs so the call can finish or
    // fall back before the process dies.
    const timeoutMs = Math.min(llmConfig.localTimeoutMs || 10_000, callOptions.timeoutMs ?? Infinity);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (process.env.LM_API_TOKEN) {
        headers['Authorization'] = `Bearer ${process.env.LM_API_TOKEN}`;
      }
      const response = await fetch(`${llmConfig.localEndpoint}/v1/chat/completions`, { // eslint-disable-line no-undef
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: llmConfig.localModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: typeof userContent === 'string' ? userContent : JSON.stringify(userContent) },
          ],
          max_tokens: maxTokens,
          // ponytail: LM Studio dropped 'json_object' (now only 'json_schema'|'text').
          // classifyLocal is generic across callers (array for extraction, object for
          // routing), so a fixed json_schema can't fit both — 'text' + the JSON-only
          // system prompt + the fence-stripping parser below is the generic choice.
          response_format: { type: 'text' },
          // Disable the model's hidden <think> phase so the token budget produces an
          // answer, not reasoning. LM Studio (this project's local engine) honors the
          // OpenAI-style `reasoning_effort`; `enable_thinking:false` is the vLLM/HF
          // chat-template equivalent for other backends. Verified live against
          // qwen3.6-27b: reasoning_effort:'none' yields non-empty content, where
          // enable_thinking alone did not. Engines ignore the key they don't know; the
          // reasoning-starved guard below is the backstop if neither lands.
          reasoning_effort: 'none',
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        logDecision('LLM_CLASSIFY', llmConfig.localModel, 'ERROR', `local: HTTP ${response.status}`);
        return { success: false, error: `Local LLM returned HTTP ${response.status}`, failureMode: 'api-error' };
      }

      const body = await response.json();
      const message = body.choices?.[0]?.message;
      if (!message?.content || typeof message.content !== 'string') {
        // A reasoning model that spends its whole token budget in the hidden
        // <think> phase returns empty content but a populated reasoning_content.
        // Flag that case distinctly so it's diagnosable from a generic shape error
        // — the fix is enable_thinking:false above and/or a larger max_tokens.
        const reason = (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim())
          ? 'reasoning-starved: content empty, reasoning_content present'
          : 'response missing choices[0].message.content';
        logDecision('LLM_CLASSIFY', llmConfig.localModel, 'SHAPE_ERROR', reason);
        return { success: false, error: 'Local LLM response missing expected shape', failureMode: 'api-error' };
      }
      const rawText = message.content;

      logDecision('LLM_CLASSIFY', llmConfig.localModel, 'CALLED', `local endpoint, correlation-id: ${correlationId}`);

      // Parse JSON response
      const data = parseLlmJson(rawText);
      return { success: true, data };
    } catch (err) {
      clearTimeout(timeoutId);

      // Parse errors: return immediately, no fallback
      const isParseError = err instanceof SyntaxError || (err.message && err.message.includes('JSON'));
      if (isParseError) {
        logDecision('LLM_CLASSIFY', llmConfig.localModel, 'PARSE_ERROR', `local: ${err.message}`);
        return { success: false, error: `JSON parse failed: ${err.message}`, failureMode: 'parse-error' };
      }

      // Network/timeout errors: fall back to Anthropic
      const isNetworkError = err.name === 'AbortError'
        || err.code === 'ECONNREFUSED'
        || err.code === 'ENOTFOUND'
        || err.code === 'ETIMEDOUT'
        || err.message?.includes('fetch failed');

      if (isNetworkError) {
        // The classifyLocalWithHealth wrapper owns the fallback decision now (plan 33-03):
        // return the failure so the tracker sees the timeout (recordFailure) and can flip
        // degraded after 3 — instead of self-falling-back and hiding the wedge.
        logDecision('LLM_CLASSIFY', llmConfig.localModel, 'ERROR', `local endpoint unreachable: ${err.message}`);
        return { success: false, error: err.message, failureMode: 'timeout' };
      }

      // Unexpected errors: surface, do NOT fall back
      logDecision('LLM_CLASSIFY', llmConfig.localModel, 'ERROR', `local: ${err.message}`);
      return { success: false, error: err.message, failureMode: 'api-error' };
    }
  }

  /**
   * Send a classify request to Anthropic and return structured result.
   * Returns { success: true, data: parsedJSON } or
   *         { success: false, error: string, failureMode: 'api-error'|'timeout'|'parse-error' }
   */
  async function classifyAnthropic(systemPrompt, userContent, callOptions = {}) {
    const maxTokens = callOptions.maxTokens || 1024;
    const correlationId = callOptions.correlationId || 'none';

    let rawText;
    try {
      const messages = [{ role: 'user', content: userContent }];

      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      });

      rawText = response.content[0].text;

      logDecision('LLM_CLASSIFY', model, 'CALLED', `correlation-id: ${correlationId}`);
    } catch (err) {
      // Distinguish timeout from other API errors
      const isTimeout = err.message && (
        err.message.toLowerCase().includes('timeout') ||
        err.message.toLowerCase().includes('timed out')
      );
      const failureMode = isTimeout ? 'timeout' : 'api-error';

      logDecision('LLM_CLASSIFY', model, 'FAILED', `${failureMode}: ${err.message}`);

      return {
        success: false,
        error: err.message,
        failureMode,
      };
    }

    // Parse JSON response
    try {
      const data = parseLlmJson(rawText);
      return { success: true, data };
    } catch (parseErr) {
      logDecision('LLM_CLASSIFY', model, 'PARSE_ERROR', `raw: ${rawText.slice(0, 100)}`);
      return {
        success: false,
        error: `JSON parse failed: ${parseErr.message}`,
        failureMode: 'parse-error',
        rawText,
      };
    }
  }

  // ── Local-classifier resilience wrapper (plan 33-03) ────────────────────────
  // Gate the local classify seam with classifier-health: count http/parse/timeout
  // failures, fall back to (capped) Haiku on ANY of them, fast-path straight to
  // Haiku while degraded (don't pay the 60s timeout), and never throw. Only the
  // useLocal path is wrapped — the anthropic path (dream pin / default) is verbatim.
  const classifierHealth = require('./utils/classifier-health'); // lazy: only the local path needs it
  const haikuNightlyCap = (pipelineConfig_ && pipelineConfig_.classifier
    && pipelineConfig_.classifier.haikuNightlyCap) || 50;

  async function classifyLocalWithHealth(systemPrompt, userContent, callOptions = {}) {
    // Capped Haiku fallback: the ONLY place a fallback call is made or counted.
    const haikuFallback = () => {
      if (classifierHealth.isHaikuCapReached(haikuNightlyCap)) {
        logDecision('LLM_CLASSIFY', 'anthropic', 'SKIPPED', `nightly Haiku cap ${haikuNightlyCap} reached; skipping classify`);
        return { success: false, skipped: true, failureMode: 'haiku-cap', error: `Haiku nightly cap ${haikuNightlyCap} reached` };
      }
      classifierHealth.recordHaikuCall();
      return classifyAnthropic(systemPrompt, userContent, callOptions);
    };

    // Degraded window open → skip the local attempt entirely (don't burn the timeout).
    if (classifierHealth.isDegraded()) {
      return haikuFallback();
    }

    const result = await classifyLocal(systemPrompt, userContent, callOptions);
    if (result && result.success === true) {
      classifierHealth.recordSuccess();
      return result;
    }
    // Any local failure (http/shape/parse/timeout) → record + fall back to capped Haiku.
    const mode = result && result.failureMode;
    const code = mode === 'parse-error' ? 'parse' : (mode === 'timeout' ? 'timeout' : 'http');
    classifierHealth.recordFailure(code);
    return haikuFallback();
  }

  return { classify: useLocal ? classifyLocalWithHealth : classifyAnthropic };
}

/**
 * Create a Haiku client wrapper.
 * Per D-04: Haiku is the default for both Stage 1 and Stage 2 classification.
 *
 * @param {object} [options={}]
 * @returns {{ classify: Function }}
 */
function createHaikuClient(options = {}) {
  return createLlmClient({ ...options, model: options.model || 'claude-haiku-4-5' });
}

/**
 * Create a Sonnet client wrapper.
 * Per D-04: Sonnet is used for Stage 2 escalation when Haiku confidence is below threshold.
 *
 * @param {object} [options={}]
 * @returns {{ classify: Function }}
 */
function createSonnetClient(options = {}) {
  return createLlmClient({ ...options, model: options.model || 'claude-sonnet-4-5' });
}

// ── Dead-letter writer ───────────────────────────────────────────────────────

/**
 * Write a dead-letter file to proposals/unrouted/.
 * Preserves original input body verbatim with failure metadata in frontmatter.
 *
 * Per D-35: Input preservation is non-negotiable for content that passes Stage 0.
 * Per D-36: Failure mode taxonomy — one of 7 defined modes.
 *
 * File format:
 * ```yaml
 * ---
 * created: <ISO-8601 with timezone>
 * failure-mode: <failureMode>
 * correlation-id: <correlationId>
 * status: unrouted
 * retry-count: 0
 * original-source: <metadata.source or 'unknown'>
 * ---
 * <inputBody verbatim>
 * ```
 *
 * Filename: `unrouted-<YYYYMMDD>-<HHmmss>-<first 8 chars of correlationId>.md`
 *
 * @param {string} inputBody - Original input to preserve verbatim
 * @param {string} failureMode - One of the 7 failure modes from D-36
 * @param {string} correlationId - UUID correlation ID for this pipeline run
 * @param {object} [metadata={}] - Optional metadata
 * @param {string} [metadata.source] - Source identifier (e.g., 'session:abc123')
 * @returns {Promise<{ path: string }>} Relative path to written dead-letter file
 */
async function writeDeadLetter(inputBody, failureMode, correlationId, metadata = {}) {
  const { vaultWrite, logDecision } = require('./vault-gateway');

  const now = new Date();

  // Build filename: unrouted-YYYYMMDD-HHmmss-<first8ofCorrelationId>.md
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timePart = now.toISOString().slice(11, 19).replace(/:/g, '');
  const idPart = correlationId.replace(/-/g, '').slice(0, 8);
  const filename = `unrouted-${datePart}-${timePart}-${idPart}.md`;
  const relativePath = `proposals/unrouted/${filename}`;

  const originalSource = metadata.source || 'unknown';

  const frontmatter = [
    '---',
    `created: ${now.toISOString()}`,
    `failure-mode: ${failureMode}`,
    `correlation-id: ${correlationId}`,
    'status: unrouted',
    'retry-count: 0',
    `original-source: ${originalSource}`,
    '---',
  ].join('\n');

  const fileContent = `${frontmatter}\n${inputBody}`;

  // Write via vault-gateway, enforcing path guard and content policy.
  // attemptCount: 1 tells Guard 3 to quarantine (not reject) on style violations —
  // dead letters are infrastructure artifacts, not user-facing content.
  try {
    const result = await vaultWrite(relativePath, fileContent, { attemptCount: 1 });
    if (result.decision === 'QUARANTINED') {
      logDecision('DEAD_LETTER', relativePath, 'QUARANTINED', 'dead-letter quarantined by vault policy');
      return { path: result.quarantinePath || relativePath, quarantined: true };
    }
    return { path: relativePath };
  } catch (err) {
    logDecision('DEAD_LETTER', relativePath, 'WRITE_FAILED', err.message);
    throw err;
  }
}

// ── Safe vault-paths loader ─────────────────────────────────────────────────

/**
 * Load vault-paths.json with overlay support and guard against malformed or missing file.
 * Returns a safe default on any read/parse error and logs via logDecision.
 *
 * @returns {{ left: string[], right: string[], haikuContextChars: number }}
 */
function safeLoadVaultPaths() {
  const SAFE_DEFAULT = { left: [], right: [], haikuContextChars: 100 };
  try {
    return loadConfigWithOverlay('vault-paths');
  } catch (err) {
    const { logDecision } = require('./vault-gateway');
    logDecision('CONFIG', 'vault-paths.json', 'LOAD_ERROR', err.message);
    return SAFE_DEFAULT;
  }
}

/**
 * Load excluded-terms.json with overlay support.
 * Returns a safe default (empty array) on any read/parse error.
 *
 * @returns {string[]} Array of excluded terms
 */
function loadExcludedTerms() {
  try {
    return loadConfigWithOverlay('excluded-terms');
  } catch (err) {
    // B5: an empty list silently turns the exclusion gate off — log the failure.
    const { logDecision } = require('./vault-gateway');
    logDecision('CONFIG', 'excluded-terms.json', 'LOAD_ERROR', err.message);
    return [];
  }
}

/**
 * Load connectors.json with overlay support.
 *
 * @returns {object} Parsed connectors configuration
 * @throws {Error} On file read or JSON parse failure
 */
function loadConnectorsConfig() {
  return loadConfigWithOverlay('connectors');
}

/**
 * Load scheduling.json with overlay support.
 *
 * @returns {object} Parsed scheduling configuration
 * @throws {Error} On file read or JSON parse failure
 */
function loadSchedulingConfig() {
  return loadConfigWithOverlay('scheduling');
}

// ── Config overlay helpers ───────────────────────────────────────────────────

/**
 * Deep-merge source into target. Arrays replace wholesale (not concatenated).
 * Mutates target in place.
 */
function deepMerge(target, source) {
  const blockedKeys = new Set(['__proto__', 'constructor', 'prototype']);
  for (const key of Object.keys(source)) {
    if (blockedKeys.has(key)) {
      continue;
    }

    const sourceValue = source[key];
    const targetValue = target[key];
    if (
      sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)
      && Object.prototype.hasOwnProperty.call(target, key)
      && targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)
    ) {
      deepMerge(targetValue, sourceValue);
    } else {
      target[key] = sourceValue;
    }
  }
  return target;
}

/** Track which config names are wired to the overlay system. */
const _overlayWiredConfigs = new Set();
let _overlayOrphanCheckDone = false;

/**
 * Load a config JSON file and deep-merge a gitignored .local.json overlay
 * if one exists. Optionally validates the merged result against a JSON Schema.
 *
 * @param {string} name - Config base name (e.g. 'pipeline' loads pipeline.json)
 * @param {object} [opts]
 * @param {boolean} [opts.validate=false] - Run schema validation on merged result
 * @returns {object} Parsed (and optionally merged) configuration
 * @throws {Error} On file read, JSON parse, or schema validation failure
 */
function loadConfigWithOverlay(name, opts = {}) {
  _overlayWiredConfigs.add(name);

  // Resolve config dir lazily so CONFIG_DIR_OVERRIDE set at call time is respected
  const configDir = process.env.CONFIG_DIR_OVERRIDE || CONFIG_DIR;

  const filePath = path.join(configDir, `${name}.json`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const config = JSON.parse(raw);

  const localPath = path.join(configDir, `${name}.local.json`);
  if (fs.existsSync(localPath)) {
    const localRaw = fs.readFileSync(localPath, 'utf8');
    const localOverrides = JSON.parse(localRaw);
    deepMerge(config, localOverrides);
  }

  if (opts.validate) {
    const schemaPath = path.join(configDir, 'schema', `${name}.schema.json`);
    if (fs.existsSync(schemaPath)) {
      const Ajv = require('ajv');
      const ajv = new Ajv({ allErrors: true });
      const schemaRaw = fs.readFileSync(schemaPath, 'utf8');
      const schema = JSON.parse(schemaRaw);
      delete schema.$schema;
      const validate = ajv.compile(schema);
      if (!validate(config)) {
        const errors = validate.errors.map(e => `${e.instancePath}: ${e.message}`).join('; ');
        throw new Error(`${name} config (after overlay merge) violates schema: ${errors}`);
      }
    }
  }

  // One-time check: warn about .local.json files that aren't wired to any loader
  if (!_overlayOrphanCheckDone) {
    _overlayOrphanCheckDone = true;
    try {
      const entries = fs.readdirSync(configDir);
      for (const entry of entries) {
        const match = entry.match(/^(.+)\.local\.json$/);
        if (match && !_overlayWiredConfigs.has(match[1])) {
          process.stderr.write(
            `[config-overlay] WARNING: ${entry} exists but "${match[1]}" is not wired to loadConfigWithOverlay — overlay will be ignored\n`
          );
        }
      }
    } catch (_) { /* non-fatal */ }
  }

  return config;
}

// ── Config loaders ───────────────────────────────────────────────────────────

/**
 * Load and validate pipeline.json with optional local overlay.
 * Reads from CONFIG_DIR (or CONFIG_DIR_OVERRIDE in tests).
 * Validates merged result against pipeline.schema.json.
 *
 * @returns {object} Parsed pipeline configuration
 * @throws {Error} On file read, required-field, or schema validation failure
 */
function loadPipelineConfig() {
  const config = loadConfigWithOverlay('pipeline', { validate: true });

  const required = ['classifier', 'extraction', 'wikilink', 'promotion', 'retry', 'leftProposal', 'filename', 'slippage'];
  for (const key of required) {
    if (!(key in config)) {
      throw new Error(`pipeline.json missing required section: "${key}"`);
    }
  }

  return config;
}

/**
 * Load and validate templates.json with optional local overlay.
 * Reads from CONFIG_DIR (or CONFIG_DIR_OVERRIDE in tests).
 * Validates merged result against templates.schema.json.
 *
 * @returns {object} Parsed templates configuration
 * @throws {Error} On file read, required-key, or schema validation failure
 */
function loadTemplatesConfig() {
  const config = loadConfigWithOverlay('templates', { validate: true });

  const required = ['domain-templates', 'memory-categories'];
  for (const key of required) {
    if (!(key in config)) {
      throw new Error(`templates.json missing required key: "${key}"`);
    }
  }

  return config;
}

/**
 * Load memory-categories.json (extracted from templates.json per T13.4).
 * Reads from CONFIG_DIR. Falls back to templates.json['memory-categories'] for
 * backward compatibility during transition.
 *
 * @returns {object} Parsed memory categories map
 * @throws {Error} On file read or JSON parse failure
 */
function loadMemoryCategoriesConfig() {
  const filePath = path.join(CONFIG_DIR, 'memory-categories.json');
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }
  // Backward-compat fallback: read from templates.json
  const templatesConfig = loadTemplatesConfig();
  return templatesConfig['memory-categories'];
}

// ── Safe config wrapper ─────────────────────────────────────────────────────

/**
 * Load pipeline config without throwing. Returns { config, error } tuple.
 * Callers that want fail-fast keep using loadPipelineConfig() directly.
 * Callers that need graceful degradation use this wrapper.
 *
 * @returns {{ config: object|null, error: Error|null }}
 */
function safeLoadPipelineConfig() {
  try {
    return { config: loadPipelineConfig(), error: null };
  } catch (err) {
    const { logDecision } = require('./vault-gateway');
    logDecision('CONFIG', 'pipeline.json', 'LOAD_ERROR', err.message);
    return { config: null, error: err };
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  generateCorrelationId,
  createHaikuClient,
  createSonnetClient,
  writeDeadLetter,
  loadPipelineConfig,
  loadTemplatesConfig,
  loadMemoryCategoriesConfig,
  loadExcludedTerms,
  loadConnectorsConfig,
  loadSchedulingConfig,
  loadConfigWithOverlay,
  safeLoadVaultPaths,
  safeLoadPipelineConfig,
};

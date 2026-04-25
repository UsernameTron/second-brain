'use strict';

/**
 * semantic-index.js
 *
 * Phase 19 core: Voyage AI semantic retrieval + RRF hybrid fusion + graceful degradation.
 * Embed-on-promotion writes to ~/.cache/second-brain/embeddings.jsonl; query-time search
 * scores via cosine + temporal decay with an excluded-terms gate applied BEFORE any Voyage call.
 *
 * @module semantic-index
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { readMemory, searchMemoryKeyword } = require('./memory-reader');
const { checkContent } = require('./content-policy');
const { safeLoadPipelineConfig } = require('./pipeline-infra');
const voyageHealth = require('./utils/voyage-health');

// ── Cache paths ───────────────────────────────────────────────────────────────

const { getSemanticCacheDir } = voyageHealth;

/**
 * Absolute path to the embeddings store.
 * @returns {string}
 */
function getEmbeddingsPath() {
  return path.join(getSemanticCacheDir(), 'embeddings.jsonl');
}

/**
 * Absolute path to the index metadata file.
 * @returns {string}
 */
function getMetadataPath() {
  return path.join(getSemanticCacheDir(), 'index-metadata.json');
}

// ── Schema version (D-14) ─────────────────────────────────────────────────────

/**
 * Compute the schema version used to decide whether a full re-embed is required.
 * Per CONTEXT.md D-14, this hashes only (model + ':' + embeddingDim) — NOT threshold or
 * recencyDecay, since those are query-time scoring math and do not invalidate embeddings.
 * @param {{model:string, embeddingDim:number}} config
 * @returns {string} 12-char hex
 */
function computeSchemaVersion(config) {
  const input = `${config.model}:${config.embeddingDim}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}

// ── Voyage error helpers ──────────────────────────────────────────────────────

/**
 * Classify a Voyage API error into a canonical failure code.
 * @param {Error} err
 * @returns {'401'|'429'|'5xx'|'timeout'|'network'}
 */
function classifyVoyageError(err) {
  const msg = String(err && err.message || '').toLowerCase();
  const status = err && (err.status || err.statusCode);
  if (status === 401 || msg.includes('unauthorized') || msg.includes('api key')) return '401';
  if (status === 429 || msg.includes('rate')) return '429';
  if (status >= 500 && status < 600) return '5xx';
  if (msg.includes('timeout') || (err && err.code === 'ETIMEDOUT')) return 'timeout';
  if (err && (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'EAI_AGAIN')) return 'network';
  return '5xx'; // default bucket for unknown HTTP errors
}

/**
 * Extract the Retry-After header value (seconds) from a 429 error object.
 * @param {Error} err
 * @returns {number|null} seconds, or null if not present
 */
function extractRetryAfterSec(err) {
  const headers = err && (err.response && err.response.headers || err.headers);
  const raw = (headers && (headers['retry-after'] || headers['Retry-After'])) || (err && err.retryAfter);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** @param {number} ms */
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// ── Voyage client wrapper ─────────────────────────────────────────────────────

/**
 * Create a Voyage API client wrapper. Returns an object with `embed(inputs, {inputType})`
 * that resolves to {success:true, embeddings:number[][]} or {success:false, failureMode, error}.
 * Never throws.
 * @param {object} config - memory.semantic block from pipeline config
 * @returns {{embed: function}}
 */
function createVoyageClient(config) {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.error('WARNING: VOYAGE_API_KEY is not set or invalid. Set it in .env or drop --semantic from your query. Falling back to keyword search.');
    return {
      async embed() {
        return { success: false, failureMode: '401', error: 'VOYAGE_API_KEY not set' };
      }
    };
  }

  let sdk;
  try {
    sdk = require('voyageai');
  } catch (err) {
    return {
      async embed() {
        return { success: false, failureMode: '5xx', error: `voyageai SDK not installed: ${err.message}` };
      }
    };
  }

  // VoyageAIClient is the named export from the extended SDK
  const Client = sdk.VoyageAIClient || sdk.default || sdk;
  const client = new Client({ apiKey });

  /**
   * Single embed attempt — records success/failure with voyageHealth.
   * @param {string[]} inputs
   * @param {{inputType: string}} opts
   */
  async function embedOnce(inputs, { inputType }) {
    try {
      const response = await client.embed({
        model: config.model,
        input: inputs,
        inputType,
      });
      voyageHealth.recordSuccess();
      // Extract embeddings array from whatever shape the SDK returns
      const embeddings = (response.data || []).map(d => d.embedding);
      return { success: true, embeddings };
    } catch (err) {
      const failureMode = classifyVoyageError(err);
      if (failureMode === '401') {
        // eslint-disable-next-line no-console
        console.error('WARNING: VOYAGE_API_KEY is not set or invalid. Set it in .env or drop --semantic from your query. Falling back to keyword search.');
      }
      voyageHealth.recordFailure(failureMode, config.degradedModeMinutes);
      return { success: false, failureMode, error: String(err.message || err), err };
    }
  }

  return {
    /**
     * Embed inputs with optional 429 retry (D-08).
     * @param {string[]} inputs
     * @param {{inputType: string}} [opts]
     * @returns {Promise<{success:boolean, embeddings?:number[][], failureMode?:string, error?:string}>}
     */
    async embed(inputs, { inputType } = {}) {
      const first = await embedOnce(inputs, { inputType });
      if (first.success) return first;
      // Retry logic for 429 only (D-08): honor Retry-After ≤ 2s
      if (first.failureMode === '429') {
        const retryAfter = extractRetryAfterSec(first.err);
        if (retryAfter !== null && retryAfter <= 2) {
          await sleep(retryAfter * 1000);
          return embedOnce(inputs, { inputType });
        }
      }
      return first;
    }
  };
}

// ── Embedding storage helpers ─────────────────────────────────────────────────

/**
 * Append one embedding record to embeddings.jsonl (creates file and cache dir if needed).
 * @param {{hash:string, embedding:number[], addedAt:string, category:string}} record
 */
function appendEmbedding(record) {
  const dir = getSemanticCacheDir();
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (_) { /* dir may already exist */ }
  fs.appendFileSync(getEmbeddingsPath(), JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/**
 * Read all embedding records from embeddings.jsonl. Returns [] if missing or empty.
 * @returns {Array<{hash:string, embedding:number[], addedAt:string, category:string}>}
 */
function readAllEmbeddings() {
  try {
    const raw = fs.readFileSync(getEmbeddingsPath(), 'utf8');
    return raw.split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    return [];
  }
}

/**
 * Read the index metadata file. Returns {} on missing or parse error.
 * @returns {object}
 */
function readMetadata() {
  try { return JSON.parse(fs.readFileSync(getMetadataPath(), 'utf8')); } catch (_) { return {}; }
}

/**
 * Write the index metadata file.
 * @param {object} meta
 */
function writeMetadata(meta) {
  try { fs.mkdirSync(getSemanticCacheDir(), { recursive: true, mode: 0o700 }); } catch (_) { /* dir may already exist */ }
  fs.writeFileSync(getMetadataPath(), JSON.stringify(meta, null, 2), { encoding: 'utf8', mode: 0o600 });
}

/**
 * Truncate the embeddings store to force a full re-embed on schema change.
 */
function truncateEmbeddings() {
  try { fs.writeFileSync(getEmbeddingsPath(), '', { encoding: 'utf8', mode: 0o600 }); } catch (_) { /* file may not exist yet */ }
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

/**
 * Cosine similarity between two equal-length vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} 0..1
 */
function _cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Days since an ISO timestamp. Defaults to 365 on parse failure.
 * @param {string|null} iso
 * @returns {number}
 */
function _daysSince(iso) {
  if (!iso) return 365;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 365;
  return Math.max(0, (Date.now() - then) / (24 * 60 * 60 * 1000));
}

/**
 * Apply temporal recency decay to a base cosine score (D-PRE-04).
 * adjusted = base * (1 + decay * recency) where recency = max(0, 1 - days/365)
 * @param {number} base - raw cosine similarity
 * @param {string|null} addedAt - ISO timestamp
 * @param {number} decay - recencyDecay tunable from config
 * @returns {number}
 */
function _adjustedScore(base, addedAt, decay) {
  const days = _daysSince(addedAt);
  const recency = Math.max(0, 1 - (days / 365));
  return base * (1 + decay * recency);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Embed freshly promoted entries and append to the embeddings store.
 * Batches up to config.embedBatchSize per Voyage call (default 128 per D-02).
 * On partial batch failure, writes successes, retries the failed subset once, then gives up
 * for this invocation (D-03). NEVER throws — all failures are non-fatal.
 *
 * @param {Array<{contentHash:string, content:string, addedAt?:string, category?:string}>} entries
 * @returns {Promise<{success:boolean, embedded:number, failed:number, failureMode?:string}>}
 */
async function indexNewEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return { success: true, embedded: 0, failed: 0 };
  const { config: pipelineConfig } = safeLoadPipelineConfig();
  if (!pipelineConfig || !pipelineConfig.memory || !pipelineConfig.memory.semantic) {
    return { success: false, embedded: 0, failed: entries.length, failureMode: 'config' };
  }
  const sem = pipelineConfig.memory.semantic;

  // Dedupe: skip entries whose hash already in store
  const existing = new Set(readAllEmbeddings().map(r => r.hash));
  const todo = entries.filter(e => e.contentHash && !existing.has(e.contentHash));
  if (todo.length === 0) return { success: true, embedded: 0, failed: 0 };

  const client = createVoyageClient(sem);
  const batchSize = sem.embedBatchSize || 128;
  let embedded = 0;
  let failed = 0;
  let lastFailureMode = null;

  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const inputs = batch.map(e => e.content);
    const res = await client.embed(inputs, { inputType: 'document' });
    if (res.success) {
      res.embeddings.forEach((vec, idx) => {
        appendEmbedding({
          hash: batch[idx].contentHash,
          embedding: vec,
          addedAt: batch[idx].addedAt || new Date().toISOString(),
          category: batch[idx].category || 'unknown',
        });
      });
      embedded += batch.length;
    } else {
      lastFailureMode = res.failureMode;
      // Retry failed subset exactly once (D-03)
      const retry = await client.embed(inputs, { inputType: 'document' });
      if (retry.success) {
        retry.embeddings.forEach((vec, idx) => {
          appendEmbedding({
            hash: batch[idx].contentHash,
            embedding: vec,
            addedAt: batch[idx].addedAt || new Date().toISOString(),
            category: batch[idx].category || 'unknown',
          });
        });
        embedded += batch.length;
      } else {
        failed += batch.length;
        break; // D-03: give up for this invocation, next /recall retries
      }
    }
  }

  // Write schema version metadata after successful embeddings
  if (embedded > 0) {
    const existingMeta = readMetadata();
    const version = computeSchemaVersion(sem);
    if (existingMeta.schema_version !== version) {
      writeMetadata({ schema_version: version, updatedAt: new Date().toISOString() });
    }
  }

  return { success: failed === 0, embedded, failed, failureMode: lastFailureMode };
}

/**
 * Compare memory.md hash-set against embeddings.jsonl and fill gaps.
 * If schema_version in metadata differs, truncate and re-embed from scratch.
 * Runs lazily on first semanticSearch/hybridSearch call per process (D-01).
 *
 * @returns {Promise<{healed:boolean, schemaChanged:boolean, embedded:number}>}
 */
async function selfHealIfNeeded() {
  const { config: pipelineConfig } = safeLoadPipelineConfig();
  if (!pipelineConfig || !pipelineConfig.memory || !pipelineConfig.memory.semantic) {
    return { healed: false, schemaChanged: false, embedded: 0 };
  }
  const sem = pipelineConfig.memory.semantic;

  const meta = readMetadata();
  const currentVersion = computeSchemaVersion(sem);
  const schemaChanged = !!(meta.schema_version && meta.schema_version !== currentVersion);

  if (schemaChanged) {
    truncateEmbeddings();
  }

  const memoryEntries = await readMemory();
  const stored = new Set(readAllEmbeddings().map(r => r.hash));
  const missing = memoryEntries.filter(e => e.contentHash && !stored.has(e.contentHash));
  if (missing.length === 0 && !schemaChanged) {
    return { healed: false, schemaChanged: false, embedded: 0 };
  }

  const toEmbed = missing.map(e => ({
    contentHash: e.contentHash,
    content: e.content,
    addedAt: e.addedAt,
    category: e.category,
  }));
  const res = await indexNewEntries(toEmbed);
  return { healed: true, schemaChanged, embedded: res.embedded };
}

/**
 * Search memory semantically. Returns {results, degraded?, blocked?, reason?}.
 * ALWAYS runs checkContent() on the query BEFORE any Voyage call (Pattern 11).
 * Returns empty results with degraded:true when Voyage is unavailable so the caller
 * can fall back to keyword search.
 *
 * @param {string} query
 * @param {{top?:number, category?:string, since?:string}} [options]
 * @returns {Promise<{results:Array, degraded?:boolean, blocked?:boolean, reason?:string}>}
 */
async function semanticSearch(query, options) {
  const opts = options || {};
  const top = opts.top || 5;
  const { config: pipelineConfig } = safeLoadPipelineConfig();
  if (!pipelineConfig || !pipelineConfig.memory || !pipelineConfig.memory.semantic) {
    return { results: [], degraded: true, reason: 'config missing memory.semantic' };
  }
  const sem = pipelineConfig.memory.semantic;
  const excludedTerms = (pipelineConfig.excludedTerms || []);

  // Pattern 11 gate — run BEFORE Voyage call
  const policy = await checkContent(query, excludedTerms);
  if (policy && policy.decision === 'BLOCK') {
    return { results: [], blocked: true, reason: policy.reason || 'blocked by content policy', matchedTerm: policy.matchedTerm };
  }

  // Pattern 7 — short-circuit if cluster is in degraded mode
  if (voyageHealth.isDegraded()) {
    return { results: [], degraded: true, reason: voyageHealth.getDegradedReason() };
  }

  // Self-heal on first call (D-01)
  await selfHealIfNeeded();

  const client = createVoyageClient(sem);
  const embedRes = await client.embed([query], { inputType: 'query' });
  if (!embedRes.success) {
    return { results: [], degraded: true, reason: `voyage ${embedRes.failureMode}: ${embedRes.error}`, failureMode: embedRes.failureMode };
  }
  const queryVec = embedRes.embeddings[0];

  const stored = readAllEmbeddings();
  if (stored.length === 0) return { results: [], degraded: false, reason: 'no embeddings stored yet' };

  // Load memory entries for metadata
  const memoryEntries = await readMemory();
  const byHash = new Map(memoryEntries.map(e => [e.contentHash, e]));

  // Apply optional filters
  let candidates = stored;
  if (opts.category) candidates = candidates.filter(r => (r.category || '').toLowerCase() === opts.category.toLowerCase());
  if (opts.since) candidates = candidates.filter(r => (r.addedAt || '') >= opts.since);

  const scored = candidates.map(r => {
    const base = _cosine(queryVec, r.embedding);
    const adjusted = _adjustedScore(base, r.addedAt, sem.recencyDecay);
    return { ...r, baseScore: base, score: adjusted, entry: byHash.get(r.hash) };
  }).filter(s => s.entry && s.score >= sem.threshold);

  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, top).map(s => ({
    id: s.entry.id,
    category: s.entry.category,
    content: s.entry.content,
    sourceRef: s.entry.sourceRef,
    date: s.entry.date,
    score: s.score,
    baseScore: s.baseScore,
  }));

  // Phase 20 D-07: emit top-1 cosine score (emit-only — not surfaced in stats columns this phase).
  // Zero results → no emit (no meaningful top-1 to record).
  if (topResults.length > 0) {
    try {
      const { recordTopCosine } = require('./daily-stats');
      recordTopCosine(topResults[0].score);
    } catch (_) { /* briefing-is-the-product: never break semantic search on stats failure */ }
  }

  return { results: topResults, degraded: false, mode: 'semantic' };
}

/**
 * Combine keyword + semantic ranks via Reciprocal Rank Fusion (D-04, D-05, D-06).
 * score(doc) = sum over sources: 1/(60+rank_i). Dedupe by entry id; tie-break on semantic base score.
 * If semantic fails, returns keyword-only with degraded:true.
 *
 * @param {string} query
 * @param {{top?:number, category?:string, since?:string}} [options]
 * @returns {Promise<{results:Array, degraded:boolean, mode:string, reason?:string, blocked?:boolean}>}
 */
async function hybridSearch(query, options) {
  const opts = options || {};
  const top = opts.top || 5;
  const { config: pipelineConfig } = safeLoadPipelineConfig();
  if (!pipelineConfig || !pipelineConfig.memory || !pipelineConfig.memory.semantic) {
    return { results: [], degraded: true, reason: 'config missing memory.semantic' };
  }
  const sem = pipelineConfig.memory.semantic;
  const cps = sem.candidatesPerSource || 20;
  const k = sem.rrfK || 60;

  // Keyword side — always runs
  const kwHits = await searchMemoryKeyword(query, {
    category: opts.category,
    since: opts.since,
  });
  const kwTop = kwHits.slice(0, cps);

  // Semantic side — may degrade
  const semRes = await semanticSearch(query, { top: cps, category: opts.category, since: opts.since });
  if (semRes.blocked) return { results: [], blocked: true, reason: semRes.reason };
  const degraded = Boolean(semRes.degraded);
  const semTop = degraded ? [] : semRes.results;

  // Fuse via RRF — sum reciprocal ranks across sources that contain the doc
  const scores = new Map(); // id -> {rrf, entry, semBase}
  kwTop.forEach((h, idx) => {
    const id = h.id;
    const prev = scores.get(id) || { rrf: 0, entry: h, semBase: 0 };
    prev.rrf += 1 / (k + (idx + 1));
    scores.set(id, prev);
  });
  semTop.forEach((h, idx) => {
    const id = h.id;
    const prev = scores.get(id) || { rrf: 0, entry: h, semBase: 0 };
    prev.rrf += 1 / (k + (idx + 1));
    prev.semBase = h.baseScore || h.score || 0;
    scores.set(id, prev);
  });

  const fused = Array.from(scores.values())
    .sort((a, b) => (b.rrf - a.rrf) || (b.semBase - a.semBase))
    .slice(0, top)
    .map(s => ({
      id: s.entry.id,
      category: s.entry.category,
      content: s.entry.content,
      sourceRef: s.entry.sourceRef,
      date: s.entry.date,
      rrfScore: s.rrf,
      semBase: s.semBase,
    }));

  return { results: fused, degraded, mode: degraded ? 'keyword (hybrid unavailable)' : 'hybrid', reason: semRes.reason };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Core pipeline
  indexNewEntries,
  semanticSearch,
  hybridSearch,
  selfHealIfNeeded,
  computeSchemaVersion,
  // Client factory (exported for tests)
  createVoyageClient,
  // Path helpers (exported for tests)
  getEmbeddingsPath,
  getMetadataPath,
  // Test-only internals
  _testOnly: {
    _cosine,
    _adjustedScore,
    _daysSince,
    classifyVoyageError,
    extractRetryAfterSec,
    readAllEmbeddings,
    readMetadata,
  },
};

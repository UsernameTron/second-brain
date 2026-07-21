'use strict';

/**
 * dream.js
 *
 * Dream-consolidation detection layer (Phase 34, monthly `/dream-propose`).
 * Every export here produces PROPOSAL objects only — nothing is applied to
 * memory.md, embeddings, or the SQLite index. Full design:
 * .planning/research/DREAM-CONSOLIDATION-DESIGN.md
 *
 * @module dream
 */

const fs = require('fs');
const path = require('path');
const { computeHash } = require('./utils/memory-utils');

// ── Cosine ────────────────────────────────────────────────────────────────────

/**
 * Cosine similarity between two equal-length vectors.
 * semantic-index.js's _cosine is a private test-only seam; this small copy
 * avoids widening that module's public surface for a one-line function.
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
 * Same-category shortRef prefix match: catches near-duplicates whose
 * embeddings run cool but whose source-ref names are obviously the same
 * topic (e.g. "gh-auth" / "gh-auth-token").
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function _shortRefPrefixMatch(a, b) {
  if (!a || !b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 3 && longer.startsWith(shorter);
}

// ── MERGE detection ──────────────────────────────────────────────────────────

/**
 * Detect candidate MERGE pairs among live (non-superseded) memory entries.
 * Zero tokens: pairwise cosine over the embeddings sidecar, unioned with
 * same-category shortRef-prefix matches. Top `config.dream.maxMergeOps` by
 * similarity.
 *
 * @param {Array} entries - readMemory() output
 * @param {Array<{hash:string, embedding:number[]}>} embeddings - readAllEmbeddings() output
 * @param {object} config - loaded pipeline.json (must carry `dream`)
 * @returns {Array<{a:object, b:object, similarity:number}>}
 */
function detectMergePairs(entries, embeddings, config) {
  const dreamCfg = config.dream;
  const live = entries.filter(e => !e.supersededBy);
  const embByHash = new Map(embeddings.map(e => [e.hash, e.embedding]));

  const pairs = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const embA = embByHash.get(a.contentHash);
      const embB = embByHash.get(b.contentHash);
      const similarity = (embA && embB) ? _cosine(embA, embB) : null;

      const cosineMatch = similarity !== null && similarity >= dreamCfg.mergeCosineMin;
      const shortRefMatch = a.category === b.category && _shortRefPrefixMatch(a.sourceRef, b.sourceRef);
      if (!cosineMatch && !shortRefMatch) continue;

      pairs.push({ a, b, similarity: similarity !== null ? similarity : dreamCfg.mergeCosineMin });
    }
  }

  pairs.sort((x, y) => y.similarity - x.similarity);
  return pairs.slice(0, dreamCfg.maxMergeOps);
}

/**
 * Author a MERGE proposal for one pair via Sonnet, then mechanically verify
 * the anti-hallucination quote guard. On any failure (LLM error, missing
 * fields, or a quote that is not a literal substring of its source) the pair
 * is DROPPED — returns null and logs a diagnostic. Never proposes a
 * fabricated merge.
 *
 * @param {{a:object, b:object, similarity:number}} pair
 * @param {object} config
 * @param {{sonnetClient?: object}} [deps={}]
 * @returns {Promise<object|null>}
 */
async function authorMerge(pair, config, deps = {}) {
  const { a, b } = pair;
  const { createSonnetClient } = require('./pipeline-infra');
  const sonnet = deps.sonnetClient || createSonnetClient();

  const systemPrompt = [
    'You merge two near-duplicate memory entries from a personal knowledge base into one.',
    'Compose the merged text ONLY from content present in the two sources — never invent facts.',
    'Include one verbatim quoted line copied exactly from EACH source (quotedFromA, quotedFromB).',
    'The more specific of the two categories wins. Union the tags.',
    'Return ONLY strict JSON: { "mergedContent": string, "category": string, "shortRef": string, "tags": string[], "rationale": string, "quotedFromA": string, "quotedFromB": string }',
  ].join('\n');

  const userContent = [
    `Source A (${a.category} · ${a.sourceRef}): ${a.content}`,
    `Source B (${b.category} · ${b.sourceRef}): ${b.content}`,
  ].join('\n\n');

  const response = await sonnet.classify(systemPrompt, userContent, { maxTokens: 1024 });
  const pairLabel = `${a.contentHash}/${b.contentHash}`;

  if (!response || !response.success || !response.data) {
    process.stderr.write(`[dream] MERGE dropped for pair ${pairLabel}: authoring failed (${(response && response.error) || 'no data'})\n`);
    return null;
  }

  const { mergedContent, category, shortRef, tags, rationale, quotedFromA, quotedFromB } = response.data;
  if (!mergedContent || !quotedFromA || !quotedFromB) {
    process.stderr.write(`[dream] MERGE dropped for pair ${pairLabel}: missing mergedContent/quotedFromA/quotedFromB\n`);
    return null;
  }
  if (!a.content.includes(quotedFromA) || !b.content.includes(quotedFromB)) {
    process.stderr.write(`[dream] MERGE dropped for pair ${pairLabel}: quote is not a literal substring of its source\n`);
    return null;
  }

  return {
    op: 'MERGE',
    mergedContent,
    category: category || a.category,
    shortRef: shortRef || a.sourceRef,
    tags: Array.isArray(tags) ? tags : [],
    rationale: rationale || '',
    quotedFromA,
    quotedFromB,
    'merged-from': `${a.contentHash}, ${b.contentHash}`,
    sourceHashes: [a.contentHash, b.contentHash],
    sourceEntries: [a, b],
    similarity: pair.similarity,
    content_hash: computeHash(mergedContent),
  };
}

// ── STALE detection ──────────────────────────────────────────────────────────

/** Categories the age criterion may never flag, per DREAM-CONSOLIDATION-DESIGN.md. */
const AGE_PROTECTED_CATEGORIES = new Set(['CONSTRAINT', 'PREFERENCE']);

function _ephemeralCategories() {
  const categories = require('../config/memory-categories.json');
  return new Set(Object.keys(categories).filter(cat => !AGE_PROTECTED_CATEGORIES.has(cat)));
}

function _daysSince(iso) {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, (Date.now() - then) / (24 * 60 * 60 * 1000));
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Extract file paths referenced in an entry body and flag the first one that
 * no longer exists in the repo. Pure code, no LLM.
 * @param {string} content
 * @returns {string|null} human-readable reason, or null if nothing dead-references
 */
function _detectDeadReference(content) {
  const pathRegex = /\b((?:src|config|scripts|test)\/[\w./-]+\.(?:js|json|md))\b/g;
  let match;
  while ((match = pathRegex.exec(content)) !== null) {
    const rel = match[1];
    const abs = path.join(__dirname, '..', rel);
    if (!fs.existsSync(abs)) {
      return `file path \`${rel}\` no longer exists`;
    }
  }
  return null;
}

/**
 * Flag (never delete) contradicted / dead-reference / over-age entries.
 * Deterministic criteria (dead-reference, age) run first over ALL live
 * entries — zero tokens. Contradiction confirms run LAST, only over a
 * bounded subset (ephemeral-category entries first, newest first), capped
 * at both `config.dream.maxStaleFlags` and the remaining
 * `config.dream.maxLLMCalls` budget — never one confirm per live entry.
 *
 * @param {Array} entries - readMemory() output
 * @param {object} config - loaded pipeline.json (must carry `dream`)
 * @param {{budget?: {used:number}, contradictionOptions?: object}} [deps={}]
 * @returns {Promise<Array<{targetHash:string, reason:string, action:string}>>}
 */
async function detectStale(entries, config, deps = {}) {
  const dreamCfg = config.dream;
  const budget = deps.budget || { used: 0 };
  const ephemeral = _ephemeralCategories();
  const live = entries.filter(e => !e.supersededBy && !e.stale);

  const flags = [];

  // 1. Dead-reference — pure code, no LLM, runs over all live entries.
  for (const entry of live) {
    if (flags.length >= dreamCfg.maxStaleFlags) break;
    const deadRef = _detectDeadReference(entry.content);
    if (deadRef) {
      flags.push({
        targetHash: entry.contentHash,
        reason: `dead-reference — ${deadRef}`,
        action: `append stale:: ${_today()} · dead-reference — ${deadRef}`,
      });
    }
  }

  // 2. Age — ephemeral categories only, never CONSTRAINT/PREFERENCE.
  for (const entry of live) {
    if (flags.length >= dreamCfg.maxStaleFlags) break;
    if (flags.some(f => f.targetHash === entry.contentHash)) continue;
    if (AGE_PROTECTED_CATEGORIES.has(entry.category) || !ephemeral.has(entry.category)) continue;
    if (_daysSince(entry.addedAt) > dreamCfg.staleAgeDays) {
      flags.push({
        targetHash: entry.contentHash,
        reason: `age — over ${dreamCfg.staleAgeDays}d`,
        action: `append stale:: ${_today()} · age — over ${dreamCfg.staleAgeDays}d`,
      });
    }
  }

  // 3. Contradicted — bounded subset only, capped by maxStaleFlags AND the
  // remaining maxLLMCalls budget. Never one confirm per live entry.
  const remainingFlagCap = dreamCfg.maxStaleFlags - flags.length;
  const remainingLlmBudget = Math.max(0, dreamCfg.maxLLMCalls - budget.used);
  const confirmCap = Math.min(remainingFlagCap, remainingLlmBudget);

  if (confirmCap > 0) {
    const { checkContradiction } = require('./contradiction-check');
    const alreadyFlagged = new Set(flags.map(f => f.targetHash));
    // Ephemeral-category entries first (most likely to be actionable), then
    // newest-first within each group.
    const candidates = live
      .filter(e => !alreadyFlagged.has(e.contentHash))
      .sort((x, y) => {
        const xEph = ephemeral.has(x.category) ? 0 : 1;
        const yEph = ephemeral.has(y.category) ? 0 : 1;
        if (xEph !== yEph) return xEph - yEph;
        return new Date(y.addedAt) - new Date(x.addedAt);
      })
      .slice(0, confirmCap);

    for (const entry of candidates) {
      if (flags.length >= dreamCfg.maxStaleFlags) break;
      budget.used++;
      const result = await checkContradiction(entry, deps.contradictionOptions || {});
      if (result.contradicts) {
        flags.push({
          targetHash: entry.contentHash,
          reason: `contradicted by ${result.against}`,
          action: `append superseded-by:: ${result.against}`,
        });
      }
    }
  }

  return flags.slice(0, dreamCfg.maxStaleFlags);
}

// ── MISSED PATTERNS extraction ───────────────────────────────────────────────

/**
 * Sections of a `## YYYY-MM-DD ...` structured log file within the last
 * `windowDays` days. Returns '' if the file is missing or nothing qualifies.
 * @param {string} filePath
 * @param {number} windowDays
 * @returns {string}
 */
function _windowedSections(filePath, windowDays) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const sections = raw.split(/\n(?=## )/);
  return sections
    .filter(section => {
      const m = section.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
      if (!m) return false;
      const d = new Date(m[1]).getTime();
      return !Number.isNaN(d) && d >= cutoff;
    })
    .join('\n\n');
}

/**
 * Detect cross-session MISSED PATTERNS and stage survivors as plain ADDs
 * into the existing `proposals/memory-proposals.md` gate — zero new apply
 * mechanics for this op. Two-layer dedup: embedding cosine vs live entries
 * (checked here) AND content_hash vs memory/archive/open proposals
 * (delegated to `writeCandidate`'s own dedup).
 *
 * @param {object} config - loaded pipeline.json (must carry `dream`; `memory.semantic` needed for cosine dedup)
 * @param {{sonnetClient?: object, voyageClient?: object, readAllEmbeddingsFn?: function, writeCandidateFn?: function, budget?: {used:number}, dryRun?: boolean}} [deps={}]
 * @returns {Promise<Array<{content:string, category:string, sourceRef:string, confidence:number}>>} candidates staged (or, in dryRun, that would be staged)
 */
async function detectPatterns(config, deps = {}) {
  const dreamCfg = config.dream;
  const budget = deps.budget || { used: 0 };
  if (budget.used >= dreamCfg.maxLLMCalls) return [];

  const { createSonnetClient } = require('./pipeline-infra');
  const sonnet = deps.sonnetClient || createSonnetClient();

  const sessionLogPath = path.join(__dirname, '..', 'state', 'session-log.md');
  const decisionsPath = path.join(__dirname, '..', 'state', 'decisions.md');
  const corpus = [
    _windowedSections(sessionLogPath, dreamCfg.sessionLogWindow),
    _windowedSections(decisionsPath, dreamCfg.sessionLogWindow),
  ].filter(Boolean).join('\n\n---\n\n');
  if (!corpus.trim()) return [];

  const systemPrompt = [
    'You review a personal knowledge-base session log for patterns the extractor missed.',
    'A pattern must span TWO OR MORE distinct sessions or decisions — never report a one-off event.',
    'Only report patterns you are confident (confidence >= 0.75) actually recur.',
    'Return ONLY strict JSON: an array of { "content": string, "category": string, "sourceRef": string, "confidence": number }.',
    'Return [] if nothing qualifies.',
  ].join('\n');

  // ≤2 chunked calls per DREAM-CONSOLIDATION-DESIGN.md — split in half only when large.
  const chunks = corpus.length > 12000
    ? [corpus.slice(0, Math.ceil(corpus.length / 2)), corpus.slice(Math.ceil(corpus.length / 2))]
    : [corpus];

  const raw = [];
  for (const chunk of chunks) {
    if (budget.used >= dreamCfg.maxLLMCalls) break;
    budget.used++;
    const response = await sonnet.classify(systemPrompt, chunk, { maxTokens: 4096 });
    if (response && response.success && Array.isArray(response.data)) {
      raw.push(...response.data);
    }
  }

  let survivors = raw.filter(c => c && c.content && typeof c.confidence === 'number' && c.confidence >= 0.75);
  if (survivors.length === 0) return [];

  // Embedding cosine dedup vs live entries — one Voyage batch call.
  const { readAllEmbeddings, createVoyageClient } = require('./semantic-index');
  const readEmbeddings = deps.readAllEmbeddingsFn || readAllEmbeddings;
  const live = readEmbeddings();

  if (live.length > 0 && config.memory && config.memory.semantic) {
    const voyage = deps.voyageClient || createVoyageClient(config.memory.semantic);
    const embedRes = await voyage.embed(survivors.map(c => c.content), { inputType: 'document' });
    if (embedRes && embedRes.success) {
      survivors = survivors.filter((c, i) => {
        const vec = embedRes.embeddings[i];
        if (!vec) return true;
        const maxCos = live.reduce((max, e) => Math.max(max, _cosine(vec, e.embedding)), 0);
        return maxCos < dreamCfg.patternDedupCosine;
      });
    }
  }

  survivors = survivors.slice(0, dreamCfg.maxPatternAdds);
  if (deps.dryRun) return survivors;

  const { writeCandidate } = require('./memory-proposals');
  const stage = deps.writeCandidateFn || writeCandidate;

  const staged = [];
  for (const candidate of survivors) {
    const result = await stage({
      content: candidate.content,
      category: candidate.category || 'OTHER',
      sourceRef: candidate.sourceRef || 'dream-pattern',
      confidence: candidate.confidence,
      extractionTrigger: 'dream',
    });
    if (result && result.written) staged.push(candidate);
  }

  return staged;
}

// ── Changeset (MERGE/STALE review) ───────────────────────────────────────────

function _proposalsDir() {
  const { resolvedVaultRoot } = require('./memory-proposals');
  return path.join(resolvedVaultRoot(), 'proposals');
}

function _changesetPath(runDate) {
  return path.join(_proposalsDir(), `dream-changeset-${runDate.slice(0, 7)}.md`);
}

/**
 * True when `hash` appears as an expected answer in eval/golden-recall.json.
 * Never throws — a missing/malformed golden set degrades to NO (false).
 * @param {string} hash
 * @returns {boolean}
 */
function _isGoldenHash(hash) {
  try {
    const goldenPath = path.join(__dirname, '..', 'eval', 'golden-recall.json');
    const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    return (golden.questions || []).some(q => (q.expected || []).includes(hash));
  } catch (_) {
    return false;
  }
}

function _entryLabel(entry, hash) {
  return entry ? `${hash} (${entry.date} · ${entry.category} · ${entry.sourceRef})` : hash;
}

/**
 * Render MERGE/STALE ops to `proposals/dream-changeset-YYYY-MM.md` in the
 * exact DREAM-CONSOLIDATION-DESIGN.md format (frontmatter + per-op
 * `- [ ] accept/reject/defer` boxes). `golden-hash::` is stamped YES when
 * any source/target hash appears in `eval/golden-recall.json`. One file per
 * run — the caller (scripts/dream.js) must check `hasUnresolvedChangeset()`
 * first.
 *
 * @param {Array<object>} mergeOps - authorMerge() output (each carries sourceEntries/sourceHashes)
 * @param {Array<{targetHash:string, reason:string, action:string}>} staleOps - detectStale() output
 * @param {{entries?: Array, runDate?: string, snapshotPath?: string}} [meta={}]
 * @returns {{written: boolean, path?: string, opsWritten: number}}
 */
function writeChangeset(mergeOps, staleOps, meta = {}) {
  const totalOps = mergeOps.length + staleOps.length;
  if (totalOps === 0) return { written: false, opsWritten: 0 };

  const entries = meta.entries || [];
  const byHash = new Map(entries.map(e => [e.contentHash, e]));
  const runDate = meta.runDate || _today();
  const run = `dream-${runDate}`;
  const snapshot = meta.snapshotPath || `memory/.snapshots/dream-${runDate.replace(/-/g, '')}/`;

  const lines = [
    '---',
    'type: dream-changeset',
    `generated: ${new Date().toISOString()}`,
    `run: ${run}`,
    `snapshot: ${snapshot}`,
    `total-ops: ${totalOps}`,
    '---',
    '',
  ];

  let seq = 0;

  for (const op of mergeOps) {
    seq++;
    const id = `${run}-${String(seq).padStart(3, '0')}`;
    const [hashA, hashB] = op.sourceHashes || [];
    const [entryA, entryB] = op.sourceEntries || [byHash.get(hashA), byHash.get(hashB)];
    const golden = (_isGoldenHash(hashA) || _isGoldenHash(hashB)) ? 'YES' : 'NO';
    lines.push(
      `## ${id} · MERGE`,
      '- [ ] accept',
      '- [ ] reject',
      '- [ ] defer',
      `sources:: ${_entryLabel(entryA, hashA)}, ${_entryLabel(entryB, hashB)}`,
      `similarity:: ${op.similarity}`,
      `golden-hash:: ${golden}`,
      `rationale:: ${op.rationale}`,
      'merged-entry::',
      `### ${runDate} · ${op.category} · ${op.shortRef}`,
      op.mergedContent,
      `category:: ${op.category}`,
      `merged-from:: ${op['merged-from']}`,
      `tags:: ${(op.tags || []).join(', ')}`,
      `content_hash:: ${op.content_hash}`,
      '',
    );
  }

  for (const flag of staleOps) {
    seq++;
    const id = `${run}-${String(seq).padStart(3, '0')}`;
    const golden = _isGoldenHash(flag.targetHash) ? 'YES' : 'NO';
    lines.push(
      `## ${id} · STALE`,
      '- [ ] accept',
      '- [ ] reject',
      '- [ ] defer',
      `target:: ${_entryLabel(byHash.get(flag.targetHash), flag.targetHash)}`,
      `reason:: ${flag.reason}`,
      `golden-hash:: ${golden}`,
      `action:: ${flag.action}`,
      '',
    );
  }

  const outPath = _changesetPath(runDate);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  return { written: true, path: outPath, opsWritten: totalOps };
}

/**
 * Parse a changeset file's body into per-op records, resolving checkbox
 * state via the SHARED `parseCheckboxState` (memory-proposals.js) — the
 * OPERATOR HARD CONSTRAINT: no second checkbox parser. This is what the
 * future `/dream-apply` (Plan 34-07) consumes.
 * @param {string} content - Raw changeset file content.
 * @returns {Array<{id:string, opType:string, section:string, status:(string|null), ambiguous:boolean, checkedCount:number, nearMissCount:number}>}
 */
function parseChangesetOps(content) {
  const { parseCheckboxState } = require('./memory-proposals');
  const sections = content
    .split(/(?=^## dream-\d{4}-\d{2}-\d{2}-\d{3} · (?:MERGE|STALE))/m)
    .filter(s => s.trim().startsWith('## dream-'));

  return sections.map(section => {
    const headerMatch = section.match(/^## (dream-\d{4}-\d{2}-\d{2}-\d{3}) · (MERGE|STALE)/);
    const checkbox = parseCheckboxState(section);
    return {
      id: headerMatch ? headerMatch[1] : null,
      opType: headerMatch ? headerMatch[2] : null,
      section,
      ...checkbox,
    };
  });
}

/**
 * Refuse-on-unresolved gate: true when any `dream-changeset-*.md` in
 * proposals/ has at least one op that is not a resolved accept/reject.
 * Deferred and ambiguous/unset ops both keep the changeset unresolved
 * (defer carries forward, same as the promote gate). `scripts/dream.js
 * --propose` must call this first and refuse to run while true.
 * @returns {boolean}
 */
function hasUnresolvedChangeset() {
  const dir = _proposalsDir();
  let files;
  try {
    files = fs.readdirSync(dir).filter(f => /^dream-changeset-\d{4}-\d{2}\.md$/.test(f));
  } catch (_) {
    return false;
  }

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch (_) {
      continue;
    }
    const ops = parseChangesetOps(content);
    // Unresolved = anything not yet terminal. Terminal is ONLY: rejected, or
    // accepted-AND-applied. An accepted op still lacking `applied::` is NOT
    // resolved — treating it as resolved lets the next propose overwrite/strand
    // it before /dream-apply ever runs (P1). Pending/deferred is also unresolved.
    if (ops.some(op => {
      if (op.status === 'rejected') return false;
      const applied = /^applied:: /m.test(op.section);
      if (op.status === 'accepted' && applied) return false;
      return true;
    })) {
      return true;
    }
  }
  return false;
}

/**
 * Absolute path of a `dream-changeset-*.md` file (most recently generated
 * month wins). Returns null if no changeset exists yet — the caller
 * (scripts/dream.js --apply) treats that as "nothing to apply".
 * @returns {string|null}
 */
function findLatestChangesetPath() {
  const dir = _proposalsDir();
  let files;
  try {
    files = fs.readdirSync(dir).filter(f => /^dream-changeset-\d{4}-\d{2}\.md$/.test(f));
  } catch (_) {
    return null;
  }
  if (files.length === 0) return null;
  files.sort();
  return path.join(dir, files[files.length - 1]);
}

// ── Apply: snapshot / applyOps / restore / eval gate ─────────────────────────

/**
 * Absolute path of the SQLite index for the current VAULT_ROOT. Mirrors
 * scripts/build-index.js's own defaultDbPath() — a private copy (same
 * precedent as _cosine above) rather than widening build-index.js's public
 * surface for a one-line path calc that only the snapshot/restore pair needs.
 * @param {string} vaultRoot
 * @returns {string}
 */
function _indexDbPath(vaultRoot) {
  const { getSemanticCacheDir } = require('./utils/voyage-health');
  const defaultVault = path.join(process.env.HOME, 'Claude Cowork');
  const root = path.resolve(vaultRoot);
  if (root === path.resolve(defaultVault)) {
    return path.join(getSemanticCacheDir(), 'index.db');
  }
  return path.join(root, '.cache', 'index.db');
}

/**
 * Snapshot memory.md + embeddings.jsonl + index.db into
 * memory/.snapshots/dream-YYYYMMDD/ BEFORE any apply edit. Missing files
 * (e.g. index.db never built yet) are skipped, not fatal — snapshot what
 * exists.
 * @param {string} [runDate] - YYYY-MM-DD; defaults to today.
 * @returns {string} Absolute snapshot directory path.
 */
function snapshotStore(runDate) {
  const { resolvedVaultRoot } = require('./memory-proposals');
  const { getSemanticCacheDir } = require('./utils/voyage-health');
  const date = (runDate || _today()).replace(/-/g, '');
  const vaultRoot = resolvedVaultRoot();
  const snapshotDir = path.join(vaultRoot, 'memory', '.snapshots', `dream-${date}`);
  fs.mkdirSync(snapshotDir, { recursive: true });

  const sources = [
    [path.join(vaultRoot, 'memory', 'memory.md'), 'memory.md'],
    [path.join(getSemanticCacheDir(), 'embeddings.jsonl'), 'embeddings.jsonl'],
    [_indexDbPath(vaultRoot), 'index.db'],
  ];
  for (const [src, name] of sources) {
    try {
      fs.copyFileSync(src, path.join(snapshotDir, name));
    } catch (_) { /* file may not exist yet — snapshot what exists */ }
  }

  return snapshotDir;
}

/**
 * Byte-restore memory.md + embeddings.jsonl + index.db from a snapshot
 * directory over the live files. Best-effort per file. A file ABSENT from the
 * snapshot (it did not exist at snapshot time) but present live was created by
 * the apply — it is removed, so the rollback is truly byte-for-byte and leaves
 * no sidecar/index drift (P2).
 * @param {string} snapshotPath
 */
function restoreSnapshot(snapshotPath) {
  const { resolvedVaultRoot } = require('./memory-proposals');
  const { getSemanticCacheDir } = require('./utils/voyage-health');
  const vaultRoot = resolvedVaultRoot();

  const restores = [
    [path.join(snapshotPath, 'memory.md'), path.join(vaultRoot, 'memory', 'memory.md')],
    [path.join(snapshotPath, 'embeddings.jsonl'), path.join(getSemanticCacheDir(), 'embeddings.jsonl')],
    [path.join(snapshotPath, 'index.db'), _indexDbPath(vaultRoot)],
  ];
  for (const [snap, live] of restores) {
    try {
      if (fs.existsSync(snap)) {
        fs.mkdirSync(path.dirname(live), { recursive: true });
        fs.copyFileSync(snap, live);
      } else if (fs.existsSync(live)) {
        // Absent at snapshot → created by the apply → remove to match snapshot.
        fs.rmSync(live);
      }
    } catch (_) { /* best-effort restore */ }
  }
}

/**
 * Append one `key:: value` field line to the entry whose `content_hash::`
 * matches `contentHash`, right after that entry's content_hash line. No-op
 * (applied:false) if the hash is not found.
 * @param {string} memoryContent
 * @param {string} contentHash
 * @param {string} fieldLine - e.g. "superseded-by:: abc123" or "stale:: 2026-08-01 · reason"
 * @returns {{content:string, applied:boolean}}
 */
function _appendFieldToEntry(memoryContent, contentHash, fieldLine) {
  const marker = `content_hash:: ${contentHash}`;
  const idx = memoryContent.indexOf(marker);
  if (idx === -1) return { content: memoryContent, applied: false };
  const lineEnd = memoryContent.indexOf('\n', idx);
  const insertAt = lineEnd === -1 ? memoryContent.length : lineEnd + 1;
  const updated = memoryContent.slice(0, insertAt) + fieldLine + '\n' + memoryContent.slice(insertAt);
  return { content: updated, applied: true };
}

/**
 * Pull the source hashes + rendered merged-entry block out of a MERGE op's
 * raw changeset section (as written by writeChangeset).
 * @param {string} section
 * @returns {{sourceHashes:string[], block:string, category:string, newHash:(string|null), content:string}}
 */
function _parseMergeOp(section) {
  const sourcesMatch = section.match(/^sources:: (.+)$/m);
  const sourceHashes = sourcesMatch ? (sourcesMatch[1].match(/[0-9a-f]{12}/g) || []) : [];
  const mergedIdx = section.indexOf('merged-entry::');
  const block = mergedIdx === -1 ? '' : section.slice(mergedIdx + 'merged-entry::'.length).trim();

  const category = (block.match(/^category:: (\w+)/m) || [])[1] || 'OTHER';
  const hashMatch = block.match(/^content_hash:: ([0-9a-f]{12})/m);
  const newHash = hashMatch ? hashMatch[1] : null;
  const lines = block.split('\n');
  const fieldStartIdx = lines.findIndex(l => /^category:: /.test(l));
  const content = lines.slice(1, fieldStartIdx === -1 ? undefined : fieldStartIdx).join('\n').trim();

  return { sourceHashes, block, category, newHash, content };
}

/**
 * Pull the target hash + field-to-append out of a STALE op's raw changeset
 * section (`target::` / `action::`, as written by writeChangeset).
 * @param {string} section
 * @returns {{targetHash:(string|null), fieldLine:string}}
 */
function _parseStaleOp(section) {
  const targetMatch = section.match(/^target:: (.+)$/m);
  const targetHash = targetMatch ? ((targetMatch[1].match(/[0-9a-f]{12}/) || [])[0] || null) : null;
  const actionMatch = section.match(/^action:: (.+)$/m);
  const action = actionMatch ? actionMatch[1].trim() : '';
  const fieldMatch = action.match(/^append\s+(.+)$/);
  const fieldLine = fieldMatch ? fieldMatch[1].trim() : action;
  return { targetHash, fieldLine };
}

/**
 * Apply accepted MERGE/STALE ops from a changeset in place, capped at
 * `config.promotion.batchCapMax`. MERGE inserts the merged entry into the
 * current `## YYYY-MM` section and appends `superseded-by:: <newhash>` to
 * BOTH sources (never deletes them); STALE appends its flag line to the
 * target. Ops already marked `applied::` (a prior apply run) are skipped —
 * an accepted checkbox alone does not mean "not yet applied". Runs
 * regenerateAutoIndex() then indexNewEntries() for new merged hashes (old
 * embeddings kept).
 * @param {string} changesetContent - Raw changeset file content.
 * @param {object} config - loaded pipeline.json (must carry `promotion`).
 * @returns {Promise<{appliedIds:string[], mergeCount:number, staleCount:number, indexResult:object}>}
 */
async function applyOps(changesetContent, config) {
  const { resolvedVaultRoot } = require('./memory-proposals');
  const vaultRoot = resolvedVaultRoot();
  const memoryFile = path.join(vaultRoot, 'memory', 'memory.md');
  const batchCap = (config.promotion && config.promotion.batchCapMax) || 10;

  const allOps = parseChangesetOps(changesetContent);
  const eligible = allOps.filter(op => op.status === 'accepted' && !/^applied:: /m.test(op.section));
  const opsToApply = eligible.slice(0, batchCap);

  let memoryContent = fs.readFileSync(memoryFile, 'utf8');
  const monthHeader = `## ${_today().slice(0, 7)}`;
  const appliedIds = [];
  const newMergeEntries = [];
  let mergeCount = 0;
  let staleCount = 0;

  for (const op of opsToApply) {
    if (op.opType === 'MERGE') {
      const { sourceHashes, block, category, newHash, content } = _parseMergeOp(op.section);
      if (!block || !newHash) continue;

      // Sources must still exist. A changeset can go stale between review and
      // apply; if a source entry vanished, skip the WHOLE merge rather than
      // half-apply it (no orphan merged entry, no partial supersede). The op
      // stays unmarked so it can be retried against a fresh changeset (P2).
      const missingSources = sourceHashes.filter(h => memoryContent.indexOf(`content_hash:: ${h}`) === -1);
      if (missingSources.length > 0) continue;

      const entryText = block + '\n';
      if (memoryContent.includes(monthHeader)) {
        const monthIdx = memoryContent.indexOf(monthHeader);
        const afterHeader = memoryContent.indexOf('\n', monthIdx) + 1;
        memoryContent = memoryContent.slice(0, afterHeader) + '\n' + entryText + memoryContent.slice(afterHeader);
      } else {
        memoryContent = `${monthHeader}\n\n${entryText}\n${memoryContent}`;
      }

      for (const srcHash of sourceHashes) {
        memoryContent = _appendFieldToEntry(memoryContent, srcHash, `superseded-by:: ${newHash}`).content;
      }

      newMergeEntries.push({ contentHash: newHash, content, addedAt: new Date().toISOString(), category });
      mergeCount++;
      appliedIds.push(op.id);
    } else if (op.opType === 'STALE') {
      const { targetHash, fieldLine } = _parseStaleOp(op.section);
      if (!targetHash || !fieldLine) continue;
      // Only record the op as applied if the target field was actually
      // inserted. If the target entry is gone (stale changeset), skip it —
      // stamping a no-op `applied::` would silently drop the flag with no
      // retry (P2).
      const res = _appendFieldToEntry(memoryContent, targetHash, fieldLine);
      if (!res.applied) continue;
      memoryContent = res.content;
      staleCount++;
      appliedIds.push(op.id);
    }
  }

  if (appliedIds.length === 0) {
    return { appliedIds: [], mergeCount: 0, staleCount: 0, indexResult: { embedded: 0, failed: 0 } };
  }

  fs.writeFileSync(memoryFile, memoryContent, 'utf8');

  const { regenerateAutoIndex } = require('./promote-memories');
  regenerateAutoIndex();

  const { indexNewEntries } = require('./semantic-index');
  const indexResult = newMergeEntries.length > 0
    ? await indexNewEntries(newMergeEntries)
    : { embedded: 0, failed: 0 };

  return { appliedIds, mergeCount, staleCount, indexResult };
}

/**
 * Uncheck the `accept` box for each op ID, reverting its status to
 * unresolved. Used on the eval-gate failure path so a restored snapshot and
 * a re-resolvable changeset stay consistent.
 * @param {string} changesetContent
 * @param {string[]} opIds
 * @returns {string}
 */
function _revertOpsToUnresolved(changesetContent, opIds) {
  let updated = changesetContent;
  for (const id of opIds) {
    const idEsc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(## ${idEsc} \\u00b7 (?:MERGE|STALE)[\\s\\S]*?)- \\[[xX]\\] accept`, 'm');
    updated = updated.replace(regex, '$1- [ ] accept');
  }
  return updated;
}

/**
 * Stamp `applied:: <ISO>` right after each op's header line, so a later
 * apply run (or the refuse-on-unresolved gate) can tell it was already
 * applied even though its accept box stays checked.
 * @param {string} changesetContent
 * @param {string[]} opIds
 * @returns {string}
 */
function _markOpsApplied(changesetContent, opIds) {
  let updated = changesetContent;
  const stamp = new Date().toISOString();
  for (const id of opIds) {
    const idEsc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^## ${idEsc} \\u00b7 (?:MERGE|STALE)\\n)`, 'm');
    updated = updated.replace(regex, `$1applied:: ${stamp}\n`);
  }
  return updated;
}

/**
 * Live-vault regression check (default gate). Every merged entry this apply
 * produced must still be retrievable from the now-mutated LIVE vault via hybrid
 * search — a merge that damages retrieval (bad authoring, lost anchor) fails
 * here. Throws on the first unretrievable merged entry. If retrieval is blocked
 * or degraded (e.g. Voyage down) it FAILS CLOSED: an apply we cannot validate
 * must not be accepted.
 *
 * This replaces the old `npm run eval:recall` gate, which scored the frozen
 * eval/seed-vault fixture (scripts/eval-recall.js hardcodes VAULT_ROOT) — a
 * corpus the apply never touches, so it could never detect a live regression.
 *
 * @param {string|null} changesetContent
 * @param {string[]} appliedOpIds
 * @param {{hybridSearchFn?: function}} [deps={}]
 */
async function _assertMergedEntriesRetrievable(changesetContent, appliedOpIds, deps = {}) {
  if (!changesetContent) return;
  const hybridSearch = deps.hybridSearchFn || require('./semantic-index').hybridSearch;
  const applied = new Set(appliedOpIds);
  const mergeOps = parseChangesetOps(changesetContent)
    .filter(op => op.opType === 'MERGE' && applied.has(op.id));

  for (const op of mergeOps) {
    const { newHash, content } = _parseMergeOp(op.section);
    if (!newHash || !content) continue;
    const res = await hybridSearch(content.slice(0, 400), { top: 10 });
    if (res.blocked || res.degraded) {
      throw new Error(`retrieval unavailable (${res.reason || 'degraded'}) — cannot validate live vault, failing closed`);
    }
    if (!(res.results || []).some(r => r.id === newHash)) {
      throw new Error(`merged entry ${newHash} not retrievable from live vault after apply — regression`);
    }
  }
}

/**
 * Mandatory post-apply gate over the LIVE vault. On regression (default:
 * a merged entry no longer retrievable) auto-restores the snapshot and reverts
 * the applied ops' accept boxes to unresolved; on pass, stamps the ops
 * `applied::` in the changeset. Never throws — a failing gate is a normal (if
 * unwelcome) outcome, not a crash.
 * @param {string} snapshotPath - from snapshotStore()
 * @param {string} changesetPath - the changeset file applyOps() read from
 * @param {string[]} appliedOpIds
 * @param {{runEvalFn?: function, hybridSearchFn?: function}} [deps={}] - runEvalFn (sync or async) throws to signal a regression; overrides the default live check
 * @returns {Promise<{passed:boolean, error?:string}>}
 */
async function runEvalGate(snapshotPath, changesetPath, appliedOpIds, deps = {}) {
  let changesetContent = null;
  try { changesetContent = fs.readFileSync(changesetPath, 'utf8'); } catch (_) { /* no changeset to update */ }

  const runEval = deps.runEvalFn
    || (() => _assertMergedEntriesRetrievable(changesetContent, appliedOpIds, deps));

  let passed = true;
  let error = null;
  try {
    await runEval();
  } catch (err) {
    passed = false;
    error = (err && err.stdout && err.stdout.toString()) || (err && err.message) || String(err);
  }

  if (!passed) {
    restoreSnapshot(snapshotPath);
    if (changesetContent !== null) {
      fs.writeFileSync(changesetPath, _revertOpsToUnresolved(changesetContent, appliedOpIds), 'utf8');
    }
    return { passed: false, error };
  }

  if (changesetContent !== null) {
    fs.writeFileSync(changesetPath, _markOpsApplied(changesetContent, appliedOpIds), 'utf8');
  }
  return { passed: true };
}

// ── Proposals lock (shared lock FILE with memory-proposals.js, not shared
// code — acquireLock/releaseLock there are privatized to _testOnly; apply
// guards concurrency by taking the same lock path memory-proposals.js uses) ──

const _LOCK_TIMEOUT_MS = 5000;
const _LOCK_RETRY_MS = 500;

/**
 * Acquire the proposals `.lock` file (same path memory-proposals.js locks)
 * around an apply run — guards against a concurrent wrap/promote write.
 * @returns {Promise<{acquired:boolean, lockPath:string}>}
 */
async function acquireProposalsLock() {
  const { resolvedVaultRoot } = require('./memory-proposals');
  const lockPath = path.join(resolvedVaultRoot(), 'proposals', 'memory-proposals.md.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const lockData = JSON.stringify({ pid: process.pid, acquired: new Date().toISOString(), holder: 'dream-apply' });

  const deadline = Date.now() + _LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(lockPath, lockData, { flag: 'wx' });
      return { acquired: true, lockPath };
    } catch (err) {
      if (err.code === 'EEXIST') {
        await new Promise(resolve => setTimeout(resolve, _LOCK_RETRY_MS));
      } else {
        throw err;
      }
    }
  }
  return { acquired: false, lockPath };
}

/**
 * Release a lock acquired via acquireProposalsLock().
 * @param {string} lockPath
 */
function releaseProposalsLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = {
  detectMergePairs,
  authorMerge,
  detectStale,
  detectPatterns,
  writeChangeset,
  parseChangesetOps,
  hasUnresolvedChangeset,
  findLatestChangesetPath,
  snapshotStore,
  restoreSnapshot,
  applyOps,
  runEvalGate,
  acquireProposalsLock,
  releaseProposalsLock,
};

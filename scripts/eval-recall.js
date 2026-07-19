#!/usr/bin/env node
'use strict';

/**
 * eval-recall.js — Phase 32 retrieval eval baseline (v1.8 Measured Memory).
 *
 * Scores /recall quality over the frozen seed vault (eval/seed-vault/) using
 * the golden set (eval/golden-recall.json), across keyword / semantic / hybrid.
 * recall@5 is SET-MEMBERSHIP (any expected content_hash in top 5 = hit) — never
 * exact rank, because recency decay reorders semantic scores daily. MRR is
 * reported but never gates.
 *
 *   npm run eval:recall               # score + compare vs newest baseline
 *   npm run eval:recall -- --baseline # write eval/baseline-YYYY-MM-DD.json
 *
 * Exit codes: 0 ok · 1 recall@5 regression vs baseline · 2 preflight failure
 * or baseline refusal · 3 live-cache isolation violation.
 *
 * Isolation: VAULT_ROOT → eval/seed-vault, CACHE_DIR_OVERRIDE → eval/.cache
 * (persistent so entry embeddings are reused across runs; gitignored). The
 * live vault and ~/.cache/second-brain/ are never touched — asserted by
 * fingerprinting the live embeddings cache before and after.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');

// Entry-point rule: scripts calling src/ load dotenv themselves (VOYAGE_API_KEY).
require('dotenv').config({ path: path.join(REPO, '.env'), quiet: true });

// Overrides MUST precede any src/ require — vault-gateway freezes VAULT_ROOT at module load.
const EVAL_DIR = path.join(REPO, 'eval');
const CACHE_DIR = path.join(EVAL_DIR, '.cache');
process.env.VAULT_ROOT = path.join(EVAL_DIR, 'seed-vault');
process.env.CACHE_DIR_OVERRIDE = CACHE_DIR;
process.env.CONFIG_DIR_OVERRIDE = path.join(REPO, 'config');
fs.mkdirSync(CACHE_DIR, { recursive: true });
// Stale-state guard: a persisted degraded window would silently skip semantic runs.
fs.rmSync(path.join(CACHE_DIR, 'voyage-health.json'), { force: true });

function fingerprint(file) {
  try {
    const st = fs.statSync(file);
    const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return { sha256: sha, mtimeMs: st.mtimeMs, size: st.size };
  } catch (_) {
    return null; // absent is a valid (and stable) state
  }
}

const LIVE_EMBEDDINGS = path.join(os.homedir(), '.cache', 'second-brain', 'embeddings.jsonl');
const liveBefore = fingerprint(LIVE_EMBEDDINGS);

const { runRecall } = require('../src/recall-command');
const {
  indexNewEntries, computeSchemaVersion, getEmbeddingsPath, getMetadataPath,
} = require('../src/semantic-index');
const { loadExcludedTerms } = require('../src/pipeline-infra');
const { readMemory } = require('../src/memory-reader');

// ponytail: fixed pacing for free-tier Voyage limits (3 RPM / 10K TPM — a 128-entry
// self-heal batch 429s outright). Set EVAL_EMBED_PACE_MS=0 on a paid key.
const PACE_MS = process.env.EVAL_EMBED_PACE_MS !== undefined
  ? Number(process.env.EVAL_EMBED_PACE_MS) : 21000;
const EMBED_CHUNK = 24; // ~6K tokens/call, safely under the 10K TPM ceiling
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fail(code, msg) {
  console.error(`eval-recall: ${msg}`);
  process.exit(code);
}

function assertIsolation() {
  const liveAfter = fingerprint(LIVE_EMBEDDINGS);
  if (JSON.stringify(liveBefore) !== JSON.stringify(liveAfter)) {
    console.error('LIVE CACHE MUTATED — isolation broken (~/.cache/second-brain/embeddings.jsonl changed during eval)');
    process.exit(3);
  }
}

function exitWith(code) {
  assertIsolation(); // isolation violation (exit 3) overrides every other outcome
  console.log('live embeddings cache untouched — isolation held');
  process.exit(code);
}

async function main() {
  const writeBaseline = process.argv.includes('--baseline');

  // --- Preflights (exit 2) ---------------------------------------------------
  const terms = loadExcludedTerms();
  if (!Array.isArray(terms) || terms.length === 0) {
    fail(2, 'config/excluded-terms.json empty or unloadable — semantic search would fail closed on every query');
  }

  const goldenPath = path.join(EVAL_DIR, 'golden-recall.json');
  let golden;
  try {
    golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  } catch (e) {
    fail(2, `cannot load ${goldenPath}: ${e.message}`);
  }
  const questions = golden.questions || [];
  if (questions.length === 0) fail(2, 'golden set has no questions');

  const vaultFile = path.join(EVAL_DIR, 'seed-vault', 'memory', 'memory.md');
  const vaultHashes = new Set(
    (fs.readFileSync(vaultFile, 'utf8').match(/content_hash:: ([0-9a-f]{12})/g) || [])
      .map((m) => m.slice(-12))
  );
  for (const q of questions) {
    for (const h of q.expected) {
      if (!/^[0-9a-f]{12}$/.test(h)) fail(2, `${q.id}: expected hash "${h}" is not 12-hex`);
      if (!vaultHashes.has(h)) fail(2, `${q.id}: expected hash ${h} not present in seed vault — golden set and snapshot have drifted`);
    }
  }

  // runRecall swallows read errors into empty results — distinguish "vault unreadable" from "recall regressed".
  const entries = await readMemory();
  if (entries.length !== golden.vaultEntries) {
    fail(2, `seed vault has ${entries.length} readable entries, golden set expects ${golden.vaultEntries}`);
  }

  const hasKey = Boolean(process.env.VOYAGE_API_KEY);
  const modes = hasKey ? ['keyword', 'semantic', 'hybrid'] : ['keyword'];
  if (!hasKey) {
    console.log('SKIPPED: semantic + hybrid (VOYAGE_API_KEY not set) — keyword-only run');
  }

  // --- Warm-up: index the seed vault in rate-limit-safe chunks ---------------
  // Left to selfHealIfNeeded, the first semantic query embeds all 135 entries in
  // one 128-entry batch, 429s on free-tier TPM, and opens voyage-health's 15-min
  // degraded window — killing the whole run. Chunked + paced, it never 429s, and
  // once eval/.cache is warm this loop is a no-op (indexNewEntries dedupes).
  if (hasKey) {
    // Stale-schema guard: indexNewEntries dedupes by content_hash, which is model-independent,
    // so a changed model/embeddingDim would make warm-up a no-op and leave selfHealIfNeeded to
    // truncate and re-embed all 135 entries in one 128-entry batch — a guaranteed 429 on the
    // free tier, exactly when evaluating a new embedding schema. Clear first, then pace.
    const sem = JSON.parse(fs.readFileSync(path.join(REPO, 'config', 'pipeline.json'), 'utf8')).memory.semantic;
    let storedVersion = null;
    try {
      storedVersion = JSON.parse(fs.readFileSync(getMetadataPath(), 'utf8')).schema_version;
    } catch (_) { /* no metadata yet — nothing to invalidate */ }
    if (storedVersion && storedVersion !== computeSchemaVersion(sem)) {
      fs.rmSync(getEmbeddingsPath(), { force: true });
      fs.rmSync(getMetadataPath(), { force: true });
      console.log('embedding schema changed — cleared eval/.cache before warm-up');
    }

    const toEmbed = entries.map((e) => ({
      contentHash: e.contentHash, content: e.content, addedAt: e.addedAt, category: e.category,
    }));
    let warmed = 0;
    for (let i = 0; i < toEmbed.length; i += EMBED_CHUNK) {
      const chunk = toEmbed.slice(i, i + EMBED_CHUNK);
      let res = await indexNewEntries(chunk);
      if (res.failed > 0) {
        await sleep(61000); // one full rate-limit window, then one more try
        res = await indexNewEntries(chunk);
      }
      if (res.failed > 0) {
        fail(2, `seed-vault warm-up failed embedding (${res.failureMode || 'unknown'}) — cannot score semantic/hybrid`);
      }
      warmed += res.embedded;
      if (res.embedded > 0 && i + EMBED_CHUNK < toEmbed.length) await sleep(PACE_MS);
    }
    if (warmed > 0) console.log(`warm-up: embedded ${warmed} seed entries into eval/.cache`);
  }

  // --- Eval loop -------------------------------------------------------------
  const modeFlags = { keyword: [], semantic: ['--semantic'], hybrid: ['--hybrid'] };
  const results = {}; // mode -> { perQuestion: {id: {hit, rr, skipped}}, hits, scored, skipped }
  const rows = [];

  for (const mode of modes) {
    results[mode] = { perQuestion: {}, hits: 0, scored: 0, skipped: 0 };
    for (const q of questions) {
      if (mode !== 'keyword') await sleep(PACE_MS); // each semantic/hybrid call embeds the query
      const r = await runRecall([q.query, '--top', '5', ...modeFlags[mode]], { _internal: true });
      // Mode-integrity gate: never score a silent keyword-fallback as semantic/hybrid.
      if (r.blocked || r.degraded || r.mode !== mode) {
        results[mode].perQuestion[q.id] = { skipped: true };
        results[mode].skipped += 1;
        rows.push(`${q.id}  ${mode.padEnd(8)}  SKIPPED (${r.blocked ? 'blocked' : r.mode})`);
        continue;
      }
      const got = r.results.map((x) => x.contentHash);
      const rank = got.findIndex((h) => q.expected.includes(h));
      const hit = rank >= 0;
      const rr = hit ? 1 / (rank + 1) : 0;
      results[mode].perQuestion[q.id] = { hit, rr };
      results[mode].scored += 1;
      if (hit) results[mode].hits += 1;
      rows.push(
        `${q.id}  ${mode.padEnd(8)}  ${hit ? `HIT  rank ${rank + 1}` : `MISS       `}  ` +
        `${hit ? '' : `expected [${q.expected.join(', ')}] got [${got.join(', ') || 'none'}]`}`
      );
    }
  }

  console.log('\nPer-question results');
  console.log('--------------------');
  for (const row of rows) console.log(row);

  const summary = {};
  console.log('\nmode      recall@5  MRR     hits  scored  skipped');
  for (const mode of modes) {
    const m = results[mode];
    const recallAt5 = m.scored ? m.hits / m.scored : null;
    const mrr = m.scored
      ? Object.values(m.perQuestion).reduce((s, x) => s + (x.rr || 0), 0) / m.scored
      : null;
    summary[mode] = { recallAt5, mrr, hits: m.hits, scored: m.scored, perQuestion: m.perQuestion };
    console.log(
      `${mode.padEnd(8)}  ${recallAt5 === null ? 'n/a   ' : recallAt5.toFixed(3) + ' '}  ` +
      `${mrr === null ? 'n/a  ' : mrr.toFixed(3)}  ${String(m.hits).padEnd(4)}  ${String(m.scored).padEnd(6)}  ${m.skipped}`
    );
  }

  // A mode that was CONFIGURED to run but skipped questions is a failed evaluation, not a
  // smaller one: dropping skipped questions from the denominator inflates recall@5, and a
  // fully-degraded mode would otherwise print "not comparable" and exit 0 — letting the gate
  // pass without ever evaluating semantic retrieval. Keyword-only runs never reach this
  // (semantic/hybrid are not in `modes` at all when the key is absent).
  const incomplete = modes.filter((mode) => results[mode].skipped > 0);
  if (incomplete.length) {
    for (const mode of incomplete) {
      console.error(`eval-recall: ${mode} skipped ${results[mode].skipped}/${questions.length} questions — provider degraded or blocked mid-run`);
    }
    console.error('eval-recall: refusing to score or compare an incomplete run (metrics would be inflated by the dropped questions)');
    return exitWith(2);
  }

  const goldenSha = sha256(goldenPath);
  const vaultSha = sha256(vaultFile);

  // --- Baseline write --------------------------------------------------------
  if (writeBaseline) {
    const incomplete =
      modes.length < 3 || modes.some((mode) => results[mode].scored !== questions.length);
    if (incomplete) {
      fail(2, 'refusing to write incomplete baseline — all 3 modes must score every question (is VOYAGE_API_KEY set?)');
    }
    let gitCommit = 'unknown';
    try {
      gitCommit = require('child_process')
        .execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim();
    } catch (_) { /* baseline still valid without it */ }
    const date = new Date().toISOString().slice(0, 10);
    const baseline = {
      date,
      gitCommit,
      goldenSet: { sha256: goldenSha, questions: questions.length },
      vault: { sha256: vaultSha, entries: golden.vaultEntries },
      modes: summary,
    };
    const outPath = path.join(EVAL_DIR, `baseline-${date}.json`);
    fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`\nbaseline written: ${path.relative(REPO, outPath)}`);
    return exitWith(0);
  }

  // --- Compare vs newest baseline -------------------------------------------
  const baselines = fs.readdirSync(EVAL_DIR)
    .filter((f) => /^baseline-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort(); // ISO dates sort lexically
  if (baselines.length === 0) {
    console.log('\nno baseline found — run with --baseline to create one');
    return exitWith(0);
  }
  const baseFile = baselines[baselines.length - 1];
  const base = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, baseFile), 'utf8'));

  if (base.goldenSet.sha256 !== goldenSha || base.vault.sha256 !== vaultSha) {
    console.log(`\nvs ${baseFile}: golden set or seed vault changed since baseline — deltas not comparable; re-anchor with --baseline`);
    return exitWith(0);
  }

  console.log(`\nvs ${baseFile} (${base.gitCommit})`);
  let regression = false;
  for (const mode of modes) {
    const cur = summary[mode];
    const prev = base.modes[mode];
    if (!prev || cur.scored === 0) {
      console.log(`${mode.padEnd(8)}  not comparable (missing in baseline or fully skipped now)`);
      continue;
    }
    const delta = cur.recallAt5 - prev.recallAt5;
    const marker = delta < 0 ? `${delta.toFixed(3)} REGRESSION` : delta > 0 ? `+${delta.toFixed(3)}` : '(=)';
    console.log(
      `${mode.padEnd(8)}  recall@5 ${prev.recallAt5.toFixed(3)} -> ${cur.recallAt5.toFixed(3)} ${marker}   ` +
      `MRR ${prev.mrr.toFixed(3)} -> ${cur.mrr.toFixed(3)}`
    );
    if (delta < 0) {
      regression = true;
      const regressed = questions
        .filter((q) => prev.perQuestion[q.id] && prev.perQuestion[q.id].hit && cur.perQuestion[q.id] && !cur.perQuestion[q.id].hit)
        .map((q) => q.id);
      if (regressed.length) console.log(`          regressed questions: ${regressed.join(', ')}`);
    }
  }
  const skippedModes = hasKey ? [] : ['semantic', 'hybrid'];
  if (skippedModes.length) {
    console.log(`skipped modes excluded from comparison: ${skippedModes.join(', ')}`);
  }
  return exitWith(regression ? 1 : 0);
}

main().catch((err) => {
  console.error('eval-recall failed:', (err && err.stack) || err);
  assertIsolation();
  process.exit(2);
});

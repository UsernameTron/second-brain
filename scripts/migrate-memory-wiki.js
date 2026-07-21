#!/usr/bin/env node
'use strict';

/**
 * migrate-memory-wiki.js
 *
 * One-time memory wiki migration (quick task 260721-gyj), two phases:
 *   A. Recategorize entries carrying the legacy coercion body note
 *      "(justification: original category "X" is not sanctioned; coerced to
 *      OTHER)" → strip the note, set category LEARNING (header + field),
 *      verify content_hash against the restored body.
 *   B. Backfill related:: for every entry with up to 5 wikilinks — memory
 *      neighbors via Voyage cosine over ALREADY-STORED vectors (zero new
 *      Voyage calls) + vault notes via the existing wikilink engine,
 *      titles filtered against excluded terms (fail-closed).
 *
 * Then: rewrite the embedding sidecar (drop notes-stripped + vanished hashes),
 * self-heal re-embeds from the clean bodies, regenerate INDEX:AUTO, rebuild
 * the SQLite index.
 *
 * Default is DRY-RUN (Phase A analysis + round-trip check only, no LLM calls,
 * no writes). Pass --apply to execute. --apply backs up memory.md and
 * embeddings.jsonl to <vault>/memory/.snapshots/wiki-<YYYYMMDD>/ first.
 *
 * Uses pipeline primitives throughout (the promotion pipeline is append-only,
 * so this script is the sanctioned mutation path — see the quick-task plan).
 *
 * @module migrate-memory-wiki
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const fs = require('fs');

const { computeHash } = require('../src/utils/memory-utils');

const VAULT_ROOT = () => process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');
const MEMORY_FILE = () => path.join(VAULT_ROOT(), 'memory', 'memory.md');
const SNAPSHOT_DIR = () => path.join(VAULT_ROOT(), 'memory', '.snapshots');

const COERCION_NOTE_RE = /^\(justification: original category "[^"]*" is not sanctioned; coerced to OTHER\)\s*$/;
const RELATED_THRESHOLD = 0.6;
const RELATED_MAX = 5;

/** First line index that _parseFields would treat as a field line (contains '::'). */
function firstFieldIdx(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('::')) return i;
  }
  return lines.length;
}

/**
 * Parse one raw entry chunk (starts with '### ') into an editable structure.
 * Rejoining header+content+tail reproduces the chunk byte-identically.
 */
function parseChunk(chunk) {
  const lines = chunk.split('\n');
  const headerLine = lines[0];
  const fieldIdx = firstFieldIdx(lines.slice(1)) + 1;
  return {
    headerLine,                       // '### date · CATEGORY · ref'
    contentLines: lines.slice(1, fieldIdx),
    tailLines: lines.slice(fieldIdx), // field lines + trailing blanks/month headers
  };
}

function serializeChunk(parsed) {
  return [parsed.headerLine, ...parsed.contentLines, ...parsed.tailLines].join('\n');
}

function headingOf(parsed) {
  return parsed.headerLine.replace(/^### /, '').trim();
}

function fieldValue(parsed, key) {
  const re = new RegExp(`^${key}:: (.*)$`);
  for (const line of parsed.tailLines) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

/** Exclusion gate for vault-note link titles — fail-closed. */
function excludedTitleFilter() {
  try {
    const { loadExcludedTerms } = require('../src/pipeline-infra');
    const { normalizeForMatch } = require('../src/content-policy');
    const terms = loadExcludedTerms().map(t => normalizeForMatch(String(t))).filter(Boolean);
    return (links) => links.filter(l => {
      const title = normalizeForMatch(String(l.title || ''));
      return title && !terms.some(term => title.includes(term));
    });
  } catch (_) {
    return () => [];
  }
}

async function migrate({ apply = false, log = (m) => process.stdout.write(m + '\n') } = {}) {
  const memoryFile = MEMORY_FILE();
  const raw = fs.readFileSync(memoryFile, 'utf8');

  // Chunking preserves every byte: split points are the '### ' entry headers.
  const chunks = raw.split(/(?=^### )/m);
  if (chunks.join('') !== raw) {
    throw new Error('round-trip check failed: chunking does not reproduce memory.md byte-identically');
  }

  const entries = [];  // { chunkIdx, parsed, hash }
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i].startsWith('### ')) continue; // preamble / INDEX block
    const parsed = parseChunk(chunks[i]);
    entries.push({ chunkIdx: i, parsed, hash: fieldValue(parsed, 'content_hash') });
  }
  log(`entries: ${entries.length}`);

  // ── Phase A: strip coercion notes, recategorize → LEARNING ────────────────
  const affectedHashes = [];
  let hashMismatches = 0;
  for (const entry of entries) {
    const noteIdx = entry.parsed.contentLines.findIndex(l => COERCION_NOTE_RE.test(l));
    if (noteIdx === -1) continue;

    entry.parsed.contentLines.splice(noteIdx, 1);
    // Collapse the blank line that separated body from note (keep exactly one
    // trailing blank before the fields).
    while (
      entry.parsed.contentLines.length >= 2 &&
      entry.parsed.contentLines[entry.parsed.contentLines.length - 1].trim() === '' &&
      entry.parsed.contentLines[entry.parsed.contentLines.length - 2].trim() === ''
    ) {
      entry.parsed.contentLines.pop();
    }

    entry.parsed.headerLine = entry.parsed.headerLine.replace(' · OTHER · ', ' · LEARNING · ');
    entry.parsed.tailLines = entry.parsed.tailLines.map(l => (l === 'category:: OTHER' ? 'category:: LEARNING' : l));

    const restored = entry.parsed.contentLines.join('\n').trim();
    const recomputed = computeHash(restored);
    if (entry.hash && recomputed !== entry.hash) {
      // Stored hash was fixed at extraction (pre-note); a mismatch means the
      // body drifted some other way. Adopt the recomputed hash — the field
      // must describe the body it sits under.
      hashMismatches++;
      log(`  hash mismatch after strip: ${entry.hash} → ${recomputed} (${headingOf(entry.parsed)})`);
      entry.parsed.tailLines = entry.parsed.tailLines.map(l =>
        l === `content_hash:: ${entry.hash}` ? `content_hash:: ${recomputed}` : l);
      affectedHashes.push(entry.hash, recomputed);
      entry.hash = recomputed;
    } else {
      affectedHashes.push(entry.hash);
    }
    log(`  recategorized: ${headingOf(entry.parsed)}`);
  }
  log(`phase A: ${affectedHashes.length ? new Set(affectedHashes).size : 0} hashes affected, ${hashMismatches} hash mismatches`);

  if (!apply) {
    const wouldBackfill = entries.length;
    log(`dry-run: would backfill related:: for ${wouldBackfill} entries (no LLM calls made). Re-run with --apply.`);
    return { entries: entries.length, recategorized: affectedHashes.length ? new Set(affectedHashes).size : 0, applied: false };
  }

  // ── Backup before any live mutation ───────────────────────────────────────
  const { getEmbeddingsPath, nearestByHash, selfHealIfNeeded } = require('../src/semantic-index');
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const backupDir = path.join(SNAPSHOT_DIR(), `wiki-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(memoryFile, path.join(backupDir, 'memory.md'));
  try { fs.copyFileSync(getEmbeddingsPath(), path.join(backupDir, 'embeddings.jsonl')); } catch (_) { /* sidecar may not exist */ }
  log(`backup: ${backupDir}`);

  // ── Phase B: backfill related:: for every entry ───────────────────────────
  // Heading map reflects Phase-A recategorizations so neighbor links resolve.
  const hashToHeading = new Map(entries.map(e => [e.hash, headingOf(e.parsed)]));
  const { suggestWikilinks } = require('../src/wikilink-engine');
  const filterLinks = excludedTitleFilter();

  let backfilled = 0;
  let haikuCalls = 0;
  for (const entry of entries) {
    const memLinks = (await nearestByHash(entry.hash, { threshold: RELATED_THRESHOLD, top: RELATED_MAX }))
      .map(n => hashToHeading.get(n.entry.contentHash))
      .filter(Boolean)
      .map(h => `[[memory#${h}]]`);

    let vaultLinks = [];
    try {
      const tags = (fieldValue(entry.parsed, 'tags') || '').split(',').map(t => t.trim()).filter(Boolean);
      const content = entry.parsed.contentLines.join('\n').trim();
      const { links } = await suggestWikilinks(content, tags, { correlationId: `wiki-migrate-${entry.hash}` });
      haikuCalls++;
      vaultLinks = filterLinks(links || []).map(l => `[[${l.title}]]`);
    } catch (err) {
      log(`  vault links skipped for ${entry.hash}: ${err && err.message ? err.message : err}`);
    }

    const merged = [...new Set([...memLinks, ...vaultLinks])].slice(0, RELATED_MAX);
    if (merged.length === 0) continue;
    const relatedLine = `related:: ${merged.join(', ')}`;
    if (entry.parsed.tailLines.some(l => l.startsWith('related::'))) {
      entry.parsed.tailLines = entry.parsed.tailLines.map(l => (l.startsWith('related::') ? relatedLine : l));
    } else {
      // Merged-variant entries lack the field — insert before content_hash::.
      const idx = entry.parsed.tailLines.findIndex(l => l.startsWith('content_hash::'));
      entry.parsed.tailLines.splice(idx === -1 ? entry.parsed.tailLines.length : idx, 0, relatedLine);
    }
    backfilled++;
  }

  // ── Write memory.md ───────────────────────────────────────────────────────
  for (const entry of entries) chunks[entry.chunkIdx] = serializeChunk(entry.parsed);
  fs.writeFileSync(memoryFile, chunks.join(''), 'utf8');

  // ── Sidecar: drop stale records, self-heal re-embeds from clean bodies ────
  const embPath = getEmbeddingsPath();
  const liveHashes = new Set(entries.map(e => e.hash));
  const stale = new Set(affectedHashes);
  let sidecarBefore = 0;
  let kept = [];
  try {
    const lines = fs.readFileSync(embPath, 'utf8').split('\n').filter(l => l.trim());
    sidecarBefore = lines.length;
    kept = lines.filter(l => {
      try {
        const rec = JSON.parse(l);
        return liveHashes.has(rec.hash) && !stale.has(rec.hash);
      } catch (_) { return false; }
    });
    fs.writeFileSync(embPath, kept.map(l => l + '\n').join(''), 'utf8');
  } catch (_) { /* sidecar may not exist; self-heal rebuilds */ }
  const heal = await selfHealIfNeeded();
  log(`sidecar: ${sidecarBefore} → kept ${kept.length}, re-embedded ${heal.embedded}`);

  // ── INDEX:AUTO + SQLite index ─────────────────────────────────────────────
  const { regenerateAutoIndex } = require('../src/promote-memories');
  regenerateAutoIndex();
  const { buildIndex } = require('./build-index');
  const idx = await buildIndex();

  // ── Metrics ───────────────────────────────────────────────────────────────
  const finalRaw = fs.readFileSync(memoryFile, 'utf8');
  const totalEntries = (finalRaw.match(/^### /gm) || []).length;
  const coercionNotes = (finalRaw.match(/\(justification: original category/g) || []).length;
  const relatedNonEmpty = (finalRaw.match(/^related:: +\S/gm) || []).length;
  const sidecarLines = fs.readFileSync(embPath, 'utf8').split('\n').filter(l => l.trim()).length;
  const coveragePct = Math.round((relatedNonEmpty / totalEntries) * 1000) / 10;

  log('--- results ---');
  log(`entries: ${totalEntries} | coercion notes: ${coercionNotes} | related coverage: ${relatedNonEmpty}/${totalEntries} (${coveragePct}%)`);
  log(`sidecar: ${sidecarLines} records | parity: ${sidecarLines === totalEntries ? 'OK' : 'MISMATCH'} | index drift: ${idx.drift}`);
  log(`haiku calls: ${haikuCalls} | backfilled related:: on ${backfilled} entries`);

  const result = {
    applied: true, entries: totalEntries, coercionNotes, relatedNonEmpty, coveragePct,
    sidecarLines, parity: sidecarLines === totalEntries, backfilled, haikuCalls,
    recategorized: new Set(affectedHashes).size, backupDir,
  };
  if (coercionNotes > 0 || !result.parity) {
    throw new Error(`postcondition failed: coercionNotes=${coercionNotes}, parity=${result.parity}`);
  }
  return result;
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  migrate({ apply })
    .then((r) => {
      if (r.applied && r.coveragePct < 80) {
        process.stdout.write(`WARNING: related coverage ${r.coveragePct}% is below the 80% bar — review before accepting.\n`);
        process.exit(2);
      }
    })
    .catch((err) => {
      process.stderr.write(`migrate-memory-wiki failed: ${err.message}\n`);
      process.exit(1);
    });
}

module.exports = { migrate };

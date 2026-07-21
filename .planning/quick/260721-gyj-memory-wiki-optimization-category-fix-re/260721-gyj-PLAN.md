# Quick Task 260721-gyj — Memory wiki optimization: category fix + related wikilinks

---
must_haves:
  truths:
    - "npm test green"
    - "sidecar line count == memory.md entry count (180/180)"
    - "zero entries matching '(justification: original category' in memory.md"
    - ">80% of entries have non-empty related:: (report exact %)"
    - "INDEX:AUTO regenerated (OTHER:5, LEARNING:79 expected)"
    - "backup of memory.md + embeddings.jsonl exists before any live mutation"
    - "no related:: link contains a content-policy exclusion term (ISPN/Genesys/Asana)"
  artifacts:
    - "scripts/migrate-memory-wiki.js"
    - "modified: src/promote-memories.js, src/semantic-index.js"
    - "tests updated + new"
---

## Grounding (from 3 investigation agents — trust these anchors, verify only if code moved)

**Live store:** `~/Claude Cowork/memory/memory.md` (180 entries, `### <date> · <CATEGORY> · <ref>` H3 headers, Dataview `field:: value` lines). Sidecar: `~/.cache/second-brain/embeddings.jsonl` (180 lines, `{hash, embedding[1024], addedAt, category}`, key = entry `content_hash::`, currently 1:1 zero-orphan). INDEX:AUTO = lines 1-7 of memory.md, comment-marker-wrapped summary block.

**Entry variants:** 168 standard (`category/source-ref/tags/added/related/content_hash`), 12 merged (`category/merged-from/tags/content_hash` — NO source-ref/added/related). Serializer must preserve both.

**Category coercion:** `coerceCategory` `src/promote-memories.js:207-214` — unsanctioned → OTHER + appends `\n\n(justification: original category "X" is not sanctioned; coerced to OTHER)` to content. Sanctioned set = keys of `config/memory-categories.json` (7, includes LEARNING). Comparison is case-sensitive exact. Invoked at `:486-488`.

**content_hash:** `computeHash` in `src/utils/memory-utils.js:21-24` = sha256(content.trim().toLowerCase()).slice(0,12). Content-only — category NOT hashed. Stored `content_hash::` was computed at extraction BEFORE the justification was appended → stripping the note restores original content → recomputed hash should equal stored hash (assert this; if mismatch, update stored field).

**Coercion-note reality (task said 10 — actual is 5):** exactly 5 body notes, memory.md lines 22/35/48/61/74 (entries at 18/31/44/57/70): 4× `"lesson"`, 1× `"capability"`. All 5 → LEARNING + strip note (task's rule: note-carriers → LEARNING). The 4 entries with `justification::` FIELD (headings 534/635/1182/1338) are deliberate 260719-reorg provenance — DO NOT touch. The 1 unmarked OTHER (heading 380) — DO NOT touch. End state: OTHER:5, LEARNING:79.

**INDEX regen:** `regenerateAutoIndex()` `src/promote-memories.js:248-259` — module-private; EXPORT it (and `buildMemoryEntry`) for script reuse.

**Sidecar mechanics:** `indexNewEntries(entries)` `src/semantic-index.js:282-345` — dedupes by contentHash, batches 128/call, append-only. `selfHealIfNeeded()` `:354-384` — fills gaps only, never GCs orphans. To refresh a vector: remove its line from embeddings.jsonl, then selfHeal re-embeds from current memory.md. Voyage: 429 seen 2026-07-21 (not degraded) — MINIMIZE Voyage calls.

**Relatedness subsystems (do NOT conflate):**
- `suggestWikilinks(noteBody, noteTags=[], opts)` `src/wikilink-engine.js:391` → `{section, links:[{path,title,relevance,reason}]}`. Lexical top-20 → ONE Haiku call → filter relevance ≥ `config.wikilink.relevanceThreshold` (0.6), top `maxSuggestions` (5). Corpus = VAULT NOTES ONLY (from `.cache/vault-index.json`; run `buildVaultIndex()` first if stale/missing). Haiku failure → lexical top-3 fallback.
- `semantic-index`: Voyage cosine over MEMORY ENTRIES only. Stored vectors already cover all 180. `_testOnly.readAllEmbeddings` + `_cosine` exist as internal seams — build a PUBLIC export instead (Task 1).
- Memory entries have no note title → link them as `[[memory#<exact H3 heading text>]]` (Obsidian heading anchor; memory.md basename is `memory`).

**LLM provider caveat:** this machine's gitignored overlay sets `provider: local`; this branch (off master) lacks the PR #83 reasoning-starvation fix → local Haiku calls return empty. Any live run that hits `suggestWikilinks` MUST run with `CONFIG_DIR_OVERRIDE` pointing at a temp config dir (copy of `config/` with `classifier.llm.provider: "anthropic"`, schema dir included).

**related:: field:** written verbatim by `buildMemoryEntry` `src/promote-memories.js:220` from `candidate.related` string. Target format: `related:: [[A]], [[B]]` (comma-joined, ≤5). 71 entries carry legacy plain-path values — OVERWRITE with computed wikilinks (backup preserves originals). Merged-variant entries: ADD the `related::` line.

**Exclusion gate:** no link whose title/heading matches content-policy exclusion terms (`src/content-policy.js` — find the exported term list/matcher). Fail-closed: policy unavailable → drop vault-note links.

## Task 1 — Promotion-path code (commit 1: `feat(memory): lesson→LEARNING alias, silent coercion, related:: wikilinks at promotion`)

Files: `src/promote-memories.js`, `src/semantic-index.js`, tests.

1. `coerceCategory`: (a) if `category.toUpperCase()` is sanctioned → return with uppercased category; (b) alias table `{ lesson: 'LEARNING' }` on lowercased input → return aliased; (c) else coerce to OTHER **without** appending any justification text.
2. `semantic-index.js`: new export `nearestByHash(contentHash, { threshold = 0.6, top = 5 })` → reads stored embeddings + `readMemory()`, cosine vs all other stored vectors, returns `[{ entry, score }]` sorted desc, score ≥ threshold. Zero Voyage calls. Reuse internal `_cosine`/`readAllEmbeddings`.
3. `promote-memories.js` promotion flow (inside real-promotion branch): reorder so `indexNewEntries(coercedPromoted)` runs BEFORE entry-text build; then per candidate: memory-links = `nearestByHash(hash)` → `[[memory#<heading>]]` (heading of the neighbor entry — derive exactly as the reader/`buildMemoryEntry` produce it); vault-links = `suggestWikilinks(content, tags)` → exclusion-filter → `[[title]]`. Merge memory-first, dedupe, cap 5, comma-join → `candidate.related`. ALL failures non-blocking: log via `logDecision`, related stays `''`, promotion proceeds (preserve existing embed-failure semantics — tests at promote-memories.test.js:1206-1244).
4. Tests: update `:1223` (INSIGHT → OTHER now WITHOUT justification note); check `test/config-schemas.test.js:261-267` (justification requirement — adjust to new contract); add: lesson→LEARNING alias, case-normalization, nearestByHash (fixture vectors), related population (mock wikilink-engine + stubbed embeddings), exclusion filtering, non-blocking failure.
5. Export `regenerateAutoIndex` + `buildMemoryEntry` from promote-memories.

## Task 2 — Migration script (commit 2: `feat(memory): one-time wiki migration — recategorize + related backfill`)

File: `scripts/migrate-memory-wiki.js` (+ test with fixture memory.md, CI-safe: no live Voyage/Haiku — mock).

- Entry-point loads dotenv (HOOK-DOTENV-01). Default DRY-RUN (prints planned changes + metrics); `--apply` executes.
- On --apply, FIRST: backup `memory.md` + `embeddings.jsonl` → `~/Claude Cowork/memory/.snapshots/wiki-<YYYYMMDD>/` (convention exists: dream-20260721).
- Parse memory.md into raw entry blocks (split on `^### ` within `## ` month sections; preserve byte-exact content of untouched regions — round-trip serializer must reproduce the input file byte-identical when no changes apply; assert this in dry-run).
- **Phase A (recategorize):** entries matching `/\n*\(justification: original category "[^"]+" is not sanctioned; coerced to OTHER\)\s*$/m` in body → strip note, `category:: OTHER` → `LEARNING` (also update the H3 header's `· OTHER ·` segment — headers carry the category), assert recomputed hash == stored `content_hash::` (else update field + report). Collect affected hashes.
- **Phase B (backfill related):** for all 180 entries: memory-links via `nearestByHash` + vault-links via `suggestWikilinks` (exclusion-filtered), merge/cap 5, write `related::` (replace existing value; insert line for merged-variant before `content_hash::`).
- Write memory.md. Rewrite embeddings.jsonl EXCLUDING Phase-A affected hashes + any hash no longer present in memory.md → `await selfHealIfNeeded()` (re-embeds the 5, one small Voyage batch). Then `regenerateAutoIndex()`, then `buildIndex()` from `scripts/build-index.js`.
- Print: total entries, recategorized, notes stripped, related coverage % (non-empty/180), sidecar parity, Voyage/Haiku call counts.

## Task 3 — Live run + verification (commit 3: `chore(memory): run wiki migration + verify`)

1. `npm test` → green (fix what your changes broke; update CLAUDE.md test-count line if totals changed).
2. Ensure vault index fresh: `buildVaultIndex()` (script may do this).
3. Dry-run: `node scripts/migrate-memory-wiki.js` → sanity-check output (5 recategorizations, ~180 related updates).
4. Live: temp config dir (cp -r config → tmp; set `classifier.llm.provider:"anthropic"` in the copy's pipeline.json; delete any pipeline.local.json in copy) then
   `CONFIG_DIR_OVERRIDE=<tmpdir> node scripts/migrate-memory-wiki.js --apply`
5. Verify (record actual numbers in SUMMARY):
   - `grep -c '(justification: original category' ~/Claude\ Cowork/memory/memory.md` → 0
   - `wc -l < ~/.cache/second-brain/embeddings.jsonl` == `grep -c '^### ' memory.md` == 180
   - related coverage: count `^related:: *\S` ≥ 145/180 (>80%)
   - INDEX:AUTO block shows OTHER:5, LEARNING:79, Last promoted 2026-07-21
   - no exclusion terms: `grep -iE 'ISPN|Genesys|Asana' memory.md` limited to pre-existing occurrences (compare vs backup — links must add none)
   - spot-check 3 entries in Obsidian-resolvable form: `[[memory#...]]` headings exist verbatim
6. If related coverage <80%: do NOT lower thresholds silently — report actual % and stop for review.

## Deviations locked by orchestrator (do not re-litigate)

- 5 note-carriers (not 10) — all → LEARNING incl. the "capability" one; `justification::`-field entries and unmarked OTHER untouched.
- Legacy plain-path related values overwritten (backup preserves).
- "Through the pipeline" = exported pipeline primitives (readMemory/computeHash/indexNewEntries/selfHealIfNeeded/regenerateAutoIndex/buildIndex) — the pipeline has no mutation API (append-only), so the script IS the sanctioned mutation path.
- Voyage cosine threshold 0.6 for memory-neighbors (task value; distinct from semantic-search 0.55 which stays).

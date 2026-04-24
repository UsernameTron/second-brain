# Phase 18: Memory Retrieval Foundation — Research

**Researched:** 2026-04-24
**Domain:** In-process full-text search over a markdown memory file; Claude Code slash-command architecture; today-command.js integration
**Confidence:** HIGH

---

## Summary

- `memory/memory.md` already exists and has a concrete, inspected format: month-level `##` headers, entry-level `###` headers with date/category/source-ref in the header line, then inline-metadata fields using `::` syntax (`category::`, `source-ref::`, `content_hash::`, `added::`, etc.).
- `minisearch` v7.2.0 (MIT) is available on npm and is the correct library for Phase 18 keyword search. It is intentionally NOT in `package.json` yet — it must be added. It is a pure-JS, zero-dependency full-text search engine that runs in-process with no external service, matching the project's architecture pattern.
- The `/recall` command follows the same CLI plumbing as `/new` and `/promote-memories`: a standalone `src/recall-command.js` module called from a thin lifecycle entry point in `src/lifecycle.js` (or a new CLI file).
- The Memory Echo integration point in `today-command.js` is **between the frog identification call (line 171) and the synthesis call (line 177)** — specifically, after `frogData` is assigned and before `generateSynthesis()` is called. It requires extracting calendar topics and VIP email subjects from `connectorResults` as the relevance signal, then calling a `memoryEcho()` function that returns `{ entries, score }`.
- `nyquist_validation` is `false` in `.planning/config.json` — the Validation Architecture section is omitted from this document per config.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEM-READ-01 | `readMemory()` parses `memory/memory.md` into structured entries `{ id, category, content, date, sourceRef, contentHash }`, returns empty array when file missing | Memory format documented below; fs.promises.readFile + regex parsing pattern maps directly to the existing `###` entry structure |
| MEM-SEARCH-KW-01 | `searchMemoryKeyword(query, options)` with AND semantics, quoted-phrase, negation, category/date filters, 100-char snippets | minisearch v7.2.0 covers all of this natively; filter options map to minisearch's `filter` callback |
| RECALL-CMD-01 | `/recall <query>` with `--category`, `--since`, `--top N` flags, numbered list output | Command architecture documented below; flag parsing follows Node.js `process.argv` slice pattern already used in lifecycle.js |
| TODAY-ECHO-01 | Memory Echo section between Frog and Pipeline in `/today` briefing when relevance > 0.65; absent otherwise | Exact line ranges in today-command.js and briefing-renderer.js documented below |
</phase_requirements>

---

## Memory File Format

Actual format from `~/Claude Cowork/memory/memory.md` (inspected 2026-04-24):

```markdown
## 2026-04

### 2026-04-23 · DECISION · file:test

Test decision content.

category:: DECISION
source-ref:: file:test.md
tags:: test
added:: 2026-04-23T00:29:39-05:00
related::
content_hash:: abc123def456
```

### Parsing Rules

| Element | Pattern | Notes |
|---------|---------|-------|
| Month section | `## YYYY-MM` | Groups entries by month |
| Entry header | `### YYYY-MM-DD · CATEGORY · SHORT-SOURCE-REF` | Three parts split on ` · ` |
| Content body | Lines between header and first `::` field | May span multiple lines |
| Inline fields | `key:: value` on own line | `category`, `source-ref`, `tags`, `added`, `related`, `content_hash` |

### Derived `readMemory()` Entry Shape

```js
{
  id: 'mem-20260423-001',          // sequential or hash-based
  category: 'DECISION',
  content: 'Test decision content.',
  date: '2026-04-23',
  sourceRef: 'file:test.md',       // from header third segment
  contentHash: 'abc123def456',     // from content_hash:: field
  tags: 'test',                    // from tags:: field (optional)
  related: '',                     // from related:: field (optional)
  addedAt: '2026-04-23T00:29:39-05:00'
}
```

Edge cases `readMemory()` must handle:
- File missing → return `[]`, no throw (ENOENT caught)
- Malformed header (missing ` · ` separators) → skip entry with warning to stderr
- Entry with no `content_hash::` field → compute hash from content on the fly
- Month sections with no entries → skip gracefully
- Archive files in `memory-archive/YYYY.md` — NOT read by `readMemory()` in Phase 18 (Phase 19 may add this)

---

## Search Algorithm Recommendation

### Phase 18: minisearch (keyword)

**Use `minisearch` v7.2.0.** It is the standard library for in-process full-text search in Node.js projects. It covers all MEM-SEARCH-KW-01 requirements without custom code.

```bash
npm install minisearch@7.2.0
```

**Index configuration:**

```js
import MiniSearch from 'minisearch';

const index = new MiniSearch({
  fields: ['content', 'category', 'sourceRef', 'tags'],
  storeFields: ['id', 'category', 'content', 'date', 'sourceRef', 'contentHash'],
  searchOptions: {
    combineWith: 'AND',       // MEM-SEARCH-KW-01: AND semantics by default
    prefix: true,             // "leader" matches "leadership"
    fuzzy: 0.2,               // tolerate minor typos
  },
});
```

**Feature coverage:**

| Requirement | minisearch Support |
|-------------|-------------------|
| AND semantics | Default with `combineWith: 'AND'` |
| Quoted phrase | `MiniSearch.getDefault('tokenize')` + `wildcard` or manual phrase check post-search |
| Negation (`-term`) | Parse query string before calling minisearch; extract `-word` tokens, post-filter results |
| Category filter | `filter: (result) => result.category === opts.category` |
| Date-range filter | `filter: (result) => result.date >= opts.since` |
| 100-char snippets | `autoSuggestOptions` or manual: find term position in `content`, slice ±50 chars |

**Quoted-phrase and negation are NOT native to minisearch** — they require a thin query preprocessor (30–50 lines) before the minisearch call. This is the only hand-rolled element; everything else is library-native.

### Upgrade Path to Phase 19

Phase 18 `searchMemoryKeyword()` function signature must remain stable for Phase 19 to call it as fallback:

```js
// Phase 18 export (must not change in Phase 19)
async function searchMemoryKeyword(query, options = {}) { ... }
module.exports = { readMemory, searchMemoryKeyword };
```

Phase 19 `semantic-index.js` will call `readMemory()` directly for hash-set comparison (per ROADMAP). Both functions live in `src/memory-reader.js` — this is the new file Phase 18 creates.

---

## Relevance Scoring for Memory Echo (TODAY-ECHO-01)

### Signal Sources

Today's context is available in `connectorResults` at the point of Memory Echo insertion:

| Signal | Source | How to Extract |
|--------|--------|----------------|
| Calendar topics | `connectorResults.calendar.data[]` | `evt.summary` (event title) |
| VIP email subjects | `connectorResults.gmail.data[]` | `em.subject` |

Extract all non-null strings, lowercase, strip punctuation → form a "today topic bag".

### Scoring Function

For each memory entry, compute relevance as:

```
score = matchingTerms / totalQueryTerms
```

Where `matchingTerms` = count of today-topic words that appear in `entry.content + entry.category + entry.tags`.

This is a Jaccard-inspired overlap score — simple, fast, no LLM needed.

**Threshold: 0.65** (configurable in `config/pipeline.json` under `memory.echoThreshold`).

### Threshold Calibration

- 0.65 was specified in REQUIREMENTS.md. It is defensible: requires >65% of extracted topic words to appear in an entry. With a typical today-context of 5–10 words, this means 4–6 words must match.
- Set too high (0.80+): Memory Echo rarely fires, users don't see the benefit.
- Set too low (0.40–): Noise; unrelated memories surface every day.
- **Recommendation: 0.65 default, configurable via `pipeline.json` `memory.echoThreshold` key.** Add to config schema validation (AJV schema in `config/schema/`).

### Degradation Behavior

When `connectorResults.calendar` or `connectorResults.gmail` failed (`.success === false`):
- Use whichever succeeded for topic extraction.
- If both failed, topic bag is empty → no entries score above threshold → Memory Echo section absent (correct behavior, no error).

---

## Command Architecture

### `/recall` Command Plumbing

Pattern follows `/new` (new-command.js called from lifecycle.js) and `/promote-memories` (promote-memories.js):

```
src/recall-command.js     ← new module, owns search logic and result formatting
src/lifecycle.js          ← add /recall routing in command dispatch
```

**Lifecycle.js dispatch pattern** (matches existing pattern for /new, /wrap, /promote-memories):

```js
// In command dispatch switch/if chain
if (command === 'recall') {
  const { runRecall } = require('./recall-command');
  const result = await runRecall(args, flags);
  // result.lines is string[] of formatted output
  process.stdout.write(result.lines.join('\n') + '\n');
}
```

**Flag parsing** — Node.js `process.argv` slice, no external library:

```js
function parseRecallArgs(argv) {
  // argv = ['recall', '"leadership"', '--category', 'DECISION', '--top', '3']
  const flags = { category: null, since: null, top: 5 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--category') { flags.category = argv[++i]; }
    else if (argv[i] === '--since') { flags.since = argv[++i]; }
    else if (argv[i] === '--top') { flags.top = parseInt(argv[++i], 10) || 5; }
    else if (!argv[i].startsWith('--')) { positional.push(argv[i]); }
  }
  return { query: positional.join(' ').replace(/^["']|["']$/g, ''), flags };
}
```

### Output Format (RECALL-CMD-01)

```
1. [DECISION] Pete prefers left-right vault split... (session:abc12345)
2. [LEARNING] Haiku client uses classify()... (file:claude-setup.md)
...

No results matching "leadership".   ← when empty
```

Each line: `N. [CATEGORY] <100-char snippet>... (<short-source-ref>)`

`shortSourceRef` function already exists in `promote-memories.js` (line 137–147) — **reuse it directly** rather than duplicating:

```js
const { sourceRefShort } = require('./promote-memories'); // or extract to utils
```

### `runRecall()` Return Shape

```js
{
  query: string,
  results: Array<{ rank, category, snippet, sourceRef, date, score }>,
  total: number,
  lines: string[],    // pre-formatted for stdout
  empty: boolean
}
```

---

## Integration Points in today-command.js

### Where Memory Echo Goes

**File:** `/Users/cpconnor/projects/second-brain/src/today-command.js`

Current pipeline in `runToday()` (lines 126–226):

| Lines | Step | Action |
|-------|------|--------|
| 146–162 | Parallel fan-out | `_fanOut()` + `_getPipelineState()` |
| 163–169 | Slippage scan | `scanSlippage()` → `slippage` |
| 171 | Frog ID | `identifyFrog(slippage, haikuClient)` → `frogData` |
| **INSERT HERE** | **Memory Echo** | **After line 171, before line 177** |
| 174 | Source health | `buildSourceHealth()` |
| 177–187 | Synthesis | `generateSynthesis()` |
| 189–198 | Render briefing | `renderBriefing()` |

**Insert after line 171:**

```js
// ── Memory Echo (Phase 18) ────────────────────────────────────────────────
const memoryEchoResult = await _getMemoryEcho(connectorResults, config);
```

Add `_getMemoryEcho()` as a new private function in the same file:

```js
async function _getMemoryEcho(connectorResults, config) {
  try {
    const { getMemoryEcho } = require('./memory-reader');
    const threshold = config && config.memory && config.memory.echoThreshold
      ? config.memory.echoThreshold
      : 0.65;
    return await getMemoryEcho(connectorResults, { threshold });
  } catch (_) {
    // Memory Echo never blocks the briefing
    return { entries: [], score: 0, skipped: true };
  }
}
```

### Where Memory Echo Section Goes in briefing-renderer.js

**File:** `/Users/cpconnor/projects/second-brain/src/today/briefing-renderer.js`

The `renderBriefing()` function (lines 246–293) builds the section array at lines 260–292. Current order:

```
Meetings → VIP Emails → Slippage → Frog → GitHub → Pipeline
```

Required order (TODAY-ECHO-01):

```
Meetings → VIP Emails → Slippage → Frog → Memory Echo → GitHub → Pipeline
```

**Change to `renderBriefing()`:**

1. Add `memoryEcho` to the `data` parameter destructuring (line 247).
2. Add `_renderMemoryEchoSection(memoryEcho)` call after `frogSection`.
3. Add the section to the output array between `## Frog` and `## GitHub` blocks (around line 282).

**`_renderMemoryEchoSection()` contract:**

```js
function _renderMemoryEchoSection(memoryEcho) {
  if (!memoryEcho || !memoryEcho.entries || memoryEcho.entries.length === 0) {
    return null;   // null → filtered out before join
  }
  return memoryEcho.entries.map((e, i) =>
    `${i + 1}. [${e.category}] ${e.snippet} (${e.sourceRef})`
  ).join('\n');
}
```

When `_renderMemoryEchoSection` returns `null`, filter it out of the section array — no heading emitted, section entirely absent (TODAY-ECHO-01 requirement).

Pass `memoryEchoResult` from `today-command.js` into `renderBriefing({ ..., memoryEcho: memoryEchoResult })`.

---

## Reusable Utilities in src/

| Utility | Current Location | How to Reuse |
|---------|-----------------|--------------|
| `sourceRefShort(sourceRef)` | `src/promote-memories.js` lines 137–147 | Extract to `src/utils/memory-utils.js` or import directly from promote-memories |
| `computeHash(content)` | `src/promote-memories.js` line 28 and `src/memory-extractor.js` line 52 | Already duplicated — extract to `src/utils/memory-utils.js` in Phase 18 (DRY opportunity) |
| `VAULT_ROOT` constant pattern | Multiple files | Reuse the pattern: `const VAULT_ROOT = () => process.env.VAULT_ROOT \|\| path.join(process.env.HOME, 'Claude Cowork');` |
| `safeLoadPipelineConfig()` | `src/pipeline-infra.js` | Use for reading `memory.echoThreshold` from pipeline.json config overlay |

**New file: `src/memory-reader.js`** — owns `readMemory()`, `searchMemoryKeyword()`, `getMemoryEcho()`. This is the sole new source file for Phase 18's search layer.

**New file: `src/recall-command.js`** — owns `runRecall()`, `parseRecallArgs()`, output formatting.

---

## Testing Approach

### Test Files to Create

| File | Covers |
|------|--------|
| `test/memory-reader.test.js` | `readMemory()` parsing, missing file, malformed entries; `searchMemoryKeyword()` AND/phrase/negation/filter/snippet; `getMemoryEcho()` threshold, empty result |
| `test/recall-command.test.js` | `parseRecallArgs()` all flag combinations; `runRecall()` output format; empty result message |

### Fixtures Required

| Fixture | Path | Purpose |
|---------|------|---------|
| Sample memory.md | `test/fixtures/memory-sample.md` | Representative entries across 2+ months, 3+ categories |
| Empty memory dir | Handled inline (no file created) | Missing-vault test case |
| Calendar/gmail connector stubs | Already in `test/fixtures/` (reuse from today tests) | Memory Echo relevance scoring test |

### Missing-Vault Test Pattern

```js
// VAULT_ROOT env override — same pattern used throughout the test suite
process.env.VAULT_ROOT = '/tmp/nonexistent-vault-' + Date.now();
const result = await readMemory();
expect(result).toEqual([]);
// no throw
```

### Coverage Requirements

Per CLAUDE.md: overall ≥90%, no module below 80%. `memory-reader.js` and `recall-command.js` are new modules — must reach ≥80% on first commit, targeting 90%+.

### Key Test Cases

1. `readMemory()` with valid file → array of structured entries with all fields populated
2. `readMemory()` with ENOENT → `[]`, no throw
3. `readMemory()` with malformed `###` header → skips that entry, returns rest
4. `searchMemoryKeyword('leadership')` → ranked results, 100-char snippets
5. `searchMemoryKeyword('leadership', { category: 'DECISION' })` → only DECISION entries
6. `searchMemoryKeyword('leadership', { since: '2026-01-01' })` → date-filtered
7. `searchMemoryKeyword('"exact phrase"')` → only entries with exact phrase
8. `searchMemoryKeyword('leadership -ISPN')` → entries without ISPN term excluded
9. `getMemoryEcho(connectorResults, { threshold: 0.65 })` → entries above threshold
10. `getMemoryEcho(connectorResults, { threshold: 0.65 })` with low-relevance calendar → `{ entries: [] }`
11. `runRecall('"leadership"', { top: 3 })` → formatted numbered list, max 3 items
12. `runRecall('nomatch-zzz')` → empty result message, no error

---

## Open Questions for the Planner

1. **`sourceRefShort` extraction**: Should Phase 18 extract `sourceRefShort` and `computeHash` to a shared `src/utils/memory-utils.js`, or import directly from `promote-memories.js`? Extraction is cleaner for Phase 19 reuse but adds a small refactor risk. Recommendation: extract to `src/utils/memory-utils.js` as part of Phase 18 Wave 0.

2. **Config schema update**: `memory.echoThreshold` is a new key in `pipeline.json`. The AJV schema lives in `config/schema/`. Verify whether Phase 18 must update `config/schema/pipeline.schema.json` or if the existing config load path is schema-validated (it is, via `pipeline-infra.js`). If so, schema update is required or `safeLoadPipelineConfig()` will warn on the unknown key.

3. **lifecycle.js routing**: Confirm `/recall` routes through `src/lifecycle.js` (the pattern for all other commands) vs. a new thin CLI script. The existing lifecycle.js should be read before planning to verify the dispatch mechanism.

4. **Memory Echo in `renderBriefing()` data contract**: `renderBriefing()` currently takes a flat data object (line 247). Adding `memoryEcho` extends this object. Verify no destructuring `...spread` breaks. The function is synchronous with no default values — the planner should note that `memoryEcho` defaults to `{ entries: [], score: 0 }` when absent, so existing tests pass unmodified.

5. **Phase 19 hash contract**: `readMemory()` returns `contentHash` per MEM-READ-01. Phase 19's `semantic-index.js` compares these hashes against `embeddings.jsonl`. The hash algorithm in `promote-memories.js` is `sha256(content.trim().toLowerCase()).slice(0,12)`. `readMemory()` must read `content_hash::` from the file (already stored at promotion time) rather than recomputing — recomputation would diverge if entry content was ever edited after promotion.

---

## Sources

### Primary (HIGH confidence)
- Direct inspection of `src/today-command.js` (all 231 lines)
- Direct inspection of `src/today/briefing-renderer.js` (all 302 lines)
- Direct inspection of `src/promote-memories.js` — entry format and `buildMemoryEntry()`, `sourceRefShort()`, `computeHash()`
- Direct inspection of `~/Claude Cowork/memory/memory.md` — live format reference
- Direct inspection of `config/pipeline.json` — existing config keys, threshold patterns
- Direct inspection of `.planning/config.json` — `nyquist_validation: false` confirmed
- Direct inspection of `package.json` — confirmed minisearch NOT yet a dependency
- `npm view minisearch version` → 7.2.0, MIT license

### Secondary (MEDIUM confidence)
- minisearch npm registry metadata (version, description, license) — verified 2026-04-24
- REQUIREMENTS.md Phase 18 section — all four requirements read verbatim

---

## Metadata

**Confidence breakdown:**
- Memory file format: HIGH — inspected live file
- minisearch fit: HIGH — npm verified, feature set confirmed against requirements
- today-command.js integration lines: HIGH — read full source, line numbers verified
- Threshold calibration: MEDIUM — 0.65 specified in requirements, rationale documented; empirical calibration deferred to post-ship

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (stable domain; minisearch major versions are infrequent)

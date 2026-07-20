# Dream Memory Consolidation — Design

**Status:** Design complete, unimplemented. Feeds Phase 34 planning.
**Date:** 2026-07-20
**Concept source:** Anthropic Managed Agents memory work — on a schedule, an agent re-reads its own past sessions, merges duplicate memories, prunes stale ones, and extracts patterns it missed while working. Every change is human-reviewed before it lands.

---

## Why

The memory layer does forward capture only: extract → stage to `proposals/memory-proposals.md` → human-gated `/promote-memories`. `memory.md` only grows. Nothing merges near-duplicates (two gh-auth CONSTRAINT entries coexist today, memory.md lines ~15-35), nothing flags stale entries (the only prune is whole-year archival at >200KB / >500 entries, `runMemoryArchive` in `src/promote-memories.js:317-376`), and nothing looks back across sessions for patterns single-session extraction missed.

The roadmap already reserves the slot: **Phase 34, third bullet** — "monthly snapshot-first dream-consolidation script + launchd plist (stages for human review, no auto-apply) codifying the 2026-07-19 manual reorg" (`.planning/ROADMAP.md:29`).

## Verified ground truth this design builds on

- `memory/memory.md`: 163 entries, 112KB, RIGHT-side (writable). Entry = `### YYYY-MM-DD · CATEGORY · shortRef` + body + `category:: / source-ref:: / tags:: / added:: / related:: / content_hash::` (12-hex sha256 of trimmed-lowercased content). Auto-index block regenerated on every promotion (`regenerateAutoIndex`, `src/promote-memories.js:248-259`).
- Embeddings sidecar: `~/.cache/second-brain/embeddings.jsonl`, hash-keyed, voyage-4-lite 1024-dim, 163 lines — in parity with memory.md. `src/semantic-index.js` exposes `readAllEmbeddings()`, `indexNewEntries()`, `hybridSearch()`.
- Promotion gate is add-only: `parseCandidateSections` → checkbox state → `buildMemoryEntry` → `appendToMemoryFile` (`src/promote-memories.js`). Exactly-one-checkbox rule; `--auto` is the only unreviewed path; content_hash dedup vs memory + archive; batchCap 5–10.
- Session records: `state/session-log.md` (64 structured `##` entries: Task/Actions/Outcome/Decisions/Next, 110KB), `state/decisions.md` (188 headings, 83KB). 111 JSONL transcripts (56MB) at `~/.claude/projects/-Users-cpconnor-projects-second-brain/` — already mined forward nightly by `scripts/daily-sweep.js` with ledger `state/transcripts-swept.json`.
- LLM infra: `src/pipeline-infra.js` `createHaikuClient()` / `createSonnetClient()`, never-throws contract, LM Studio fallback. No token accounting; per-call maxTokens only.
- Scheduling pattern: `scripts/*.js` entry + launchd plist `~/Library/LaunchAgents/com.secondbrain.*.plist` (daily-sweep 23:45, today 06:45 weekdays). Phase 33 fixes plist reliability; dream inherits those fixes.
- Eval harness (Phase 32): `npm run eval:recall` — frozen seed vault, `eval/golden-recall.json` keyed by `content_hash`, baseline `eval/baseline-2026-07-19.json` (keyword 0.900 / semantic 0.800 / hybrid 0.900 recall@5), exit 1 on regression. Golden identity is content_hash — any op that removes a hashed entry can invalidate golden expectations.
- Naming collision: a `dream-memory-consolidation` skill already exists (`.claude/skills/dream-memory-consolidation/SKILL.md`) owning `/dream` triggers — it consolidates Claude Code's `MEMORY.md` auto-memory files, **not** the vault store. Different tool, colliding name.

## Design

### Naming

New commands **`/dream-propose`** and **`/dream-apply`** (script: `scripts/dream.js --propose|--apply|--dry-run`). Avoids the `/dream` trigger collision; each skill description states which store it targets (vault `memory/memory.md` vs Claude Code `MEMORY.md`).

### Inputs per pass

| Corpus | Feeds | Window | Why |
|---|---|---|---|
| `memory/memory.md` + embeddings sidecar | MERGE, STALE | all live (non-superseded) entries | pairwise cosine is local — zero tokens; no reason to window 163 entries |
| `state/session-log.md` | MISSED PATTERNS | entries since last run | the compressed session record — this is what "re-reading past sessions" means here |
| `state/decisions.md` | STALE (contradictions), PATTERNS | same window | cheap, structured |
| JSONL transcripts | **not read** | — | daily-sweep already mines them forward with a ledger; re-reading is double-mining plus 56MB of tokens |
| vault standups | **not read** | — | already fed forward capture; nothing retrospective-only there |

New ledger: `state/dream-ledger.json` — `{"lastRun": "...", "runs": [{date, opsProposed, opsAccepted}]}` — same pattern as `transcripts-swept.json`.

### The three operations — every one a proposal, never an applied edit

**1. MERGE (duplicate consolidation)**
- Detection, 0 tokens: pairwise cosine over `readAllEmbeddings()` for live entries; candidate pair at cosine ≥ `mergeCosineMin` (0.90). Union in same-category shortRef prefix matches (catches the gh-auth pair even if embeddings run cool). Top `maxMergeOps` (15) pairs by similarity.
- Authoring: Sonnet, one call per pair, maxTokens 1024. Merged text must be composed only of content present in the sources; must include one verbatim quoted line from EACH source; keep the older entry's date context; more specific category wins; tags unioned. Output JSON `{mergedContent, category, shortRef, tags, rationale, quotedFromA, quotedFromB}`.
- Mechanical guard (no LLM trust): `quotedFromA`/`quotedFromB` verified as literal substrings of the sources — fail → pair dropped and logged, never proposed.
- Provenance: merged entry carries `merged-from:: <hashA>, <hashB>`; `content_hash::` via existing `computeHash()`.
- Originals are **never deleted**. On accept, each source gets `superseded-by:: <newhash>` (the Phase 34 convention; `src/memory-reader.js` downranks). Physical removal stays with the existing year-archive sweep.

**2. STALE (flag, never delete)**
Ranked criteria, deterministic before LLM:
1. Contradicted: `hybridSearch(entry, {top:5})` + Haiku confirm — reuses Phase 34's contradiction-check helper (build once, promotion gate and dream both call it).
2. Dead references: file paths / config keys / flag names in the body → `fs.existsSync` / repo grep. Pure code.
3. Age > `staleAgeDays` (180) in ephemeral categories only (whitelist in `config/memory-categories.json`; never CONSTRAINT/PREFERENCE).

Cap `maxStaleFlags` (10). Accepted flag appends `stale:: YYYY-MM-DD · <reason>` (or `superseded-by:: <hash>` when a specific contradicting entry exists). `memory-reader.js` downranks `stale::` same as `superseded-by::`.

**3. MISSED PATTERNS (cross-session extraction)**
- Sonnet over the session-log/decisions window, ≤2 chunked calls, maxTokens 4096: "patterns spanning ≥2 sessions that are not one-off events," confidence ≥ 0.75 (extractor's bar).
- Anti-re-proposal dedup (the reason near-dupes exist today): drop candidates whose `content_hash` matches memory/archive/open proposals (existing `isDuplicateInMemory` + proposals scan) OR whose embedding cosine vs any live entry ≥ `patternDedupCosine` (0.86) — one Voyage batch call.
- Cap `maxPatternAdds` (5). These are plain ADDs → staged into `proposals/memory-proposals.md` via `memory-proposals.js` and reviewed through the **untouched `/promote-memories` gate**. `source-ref::` points at session-log headings. Zero new apply mechanics for this op.

### The changeset the human reviews

MERGE/STALE ops go to `proposals/dream-changeset-YYYY-MM.md` (first segment `proposals` → RIGHT, writable). One file per run; **propose refuses to run while an unresolved changeset exists** — no pile-up, review stays mandatory.

Why a separate file + applier instead of extending `/promote-memories`: the promotion gate is a proven add-only path (`parseCandidateSections` → `buildMemoryEntry` → `appendToMemoryFile`); threading MERGE/STALE op-types through it branches every step. A small separate applier that reuses `memory-proposals.js` lock/hash/frontmatter helpers is the shorter, safer diff. Pattern-ADDs still ride the old gate, so `/dream-apply` handles only two op types.

**Hard constraint — one gate parser, shared:** the checkbox-state logic (exactly-one-box → status; multiple boxes → `ambiguous` → skip) currently lives inline in `parseCandidateSections` (`src/promote-memories.js:104-152`, regexes :113-126). `/dream-apply` must NOT reimplement it — extract it into a shared helper (natural home: `src/memory-proposals.js`, which both gates already depend on for lock/hash/frontmatter) and have both `promote-memories.js` and `dream.js` call the same function. Two gate implementations will drift.

Format (same checkbox mechanics as the existing gate — exactly-one-box, edit-then-accept on merged text, defer carries forward):

```markdown
---
type: dream-changeset
generated: 2026-08-01T07:15:00Z
run: dream-2026-08-01
snapshot: memory/.snapshots/dream-20260801/
total-ops: 12
---

## dream-2026-08-01-001 · MERGE
- [ ] accept
- [ ] reject
- [ ] defer
sources:: a1b2c3d4e5f6 (2026-03-04 · CONSTRAINT · gh-auth), 9f8e7d6c5b4a (2026-05-11 · CONSTRAINT · gh-auth-token)
similarity:: 0.94
golden-hash:: NO
rationale:: Both state gh CLI must use the keychain token. Quotes: "…" / "…"
merged-entry::
### 2026-08-01 · CONSTRAINT · gh-auth
<merged body>
category:: CONSTRAINT
merged-from:: a1b2c3d4e5f6, 9f8e7d6c5b4a
tags:: …
content_hash:: <computed>

## dream-2026-08-01-002 · STALE
- [ ] accept
- [ ] reject
- [ ] defer
target:: 1a2b3c4d5e6f (2026-02-01 · OTHER · pipeline-flag-x)
reason:: dead-reference — config/pipeline.json key `flagX` removed 2026-06-14
action:: append `stale:: 2026-08-01 · dead-reference config key flagX`
```

`golden-hash:: YES` is stamped when any source/target hash appears in `eval/golden-recall.json` — the reviewer knows accepting may require a golden-set update; the eval gate below backstops mistakes regardless.

### Apply semantics (`/dream-apply` — human-invoked only, never scheduled)

Batch cap reuses `batchCapMin/Max` (5–10 ops per invocation). Sequence:

1. **Snapshot first:** copy `memory/memory.md`, `embeddings.jsonl`, `index.db` to `memory/.snapshots/dream-YYYYMMDD/` (codifies the `.pre-audit.20260719` backup pattern).
2. Acquire the proposals lock (`memory-proposals.js` lock helpers) — guards against concurrent wrap/promote writes.
3. Apply accepted ops in place: MERGE inserts the merged entry into the current `## YYYY-MM` section and appends `superseded-by:: <newhash>` to each source; STALE appends its flag line.
4. `regenerateAutoIndex()`.
5. `indexNewEntries()` for new merged hashes. **Old embeddings kept** — superseded entries still exist in the file; the `--strict` drift check requires sidecar/file parity; downranking is read-time.
6. SQLite rebuild (`scripts/build-index.js`), reach export, drift check `--strict`.
7. **Eval gate:** `npm run eval:recall`. Exit 1 → **auto-restore snapshot**, revert op statuses to unresolved, exit nonzero with the eval diff.
8. Update `state/dream-ledger.json`; mark applied ops processed in the changeset.

Golden hashes stay resolvable throughout because sources are superseded, not deleted.

### Cadence, models, token bounds

- **Monthly**: `~/Library/LaunchAgents/com.secondbrain.dream.plist`, `StartCalendarInterval {Day: 1, Hour: 7, Minute: 15}` (clear of the 23:45 sweep and 06:45 briefing), running `scripts/dream.js --propose` only. Built to whatever plist conventions Phase 33 lands (WorkingDirectory, env, absolute node path, log file).
- **Budget ≲ 50k tokens/pass:** detection free (local cosine); merge ≤15 Sonnet calls ≈ 24k; stale ≤10 Haiku confirms ≈ 10k; patterns 2 Sonnet calls ≈ 15k; one Voyage batch for candidate dedup.
- **Config:** new `dream` block in `config/pipeline.json` + schema update:
  `{ "enabled": true, "mergeCosineMin": 0.90, "patternDedupCosine": 0.86, "maxMergeOps": 15, "maxStaleFlags": 10, "maxPatternAdds": 5, "staleAgeDays": 180, "sessionLogWindow": 30, "maxLLMCalls": 40 }`
  `maxLLMCalls` is the hard circuit breaker inside the propose loop.

### Failure modes → guards

| Failure | Guard |
|---|---|
| Hallucinated merge (non-duplicates merged) | cosine ≥0.90 floor; verbatim quotes from BOTH sources mechanically verified as substrings, else dropped; human review; reversible — sources superseded, never deleted |
| Over-pruning | no delete path exists at all: stale is a flag field; physical prune remains the existing year-archive; `maxStaleFlags` cap |
| Voice/meaning drift in merged text | merged text constrained to source content + quote requirement; edit-then-accept; originals preserved verbatim under `merged-from::` provenance |
| Recall regression | mandatory post-apply `eval:recall` with automatic snapshot restore on exit 1 |
| Golden-set hash invalidation | superseded-not-deleted keeps hashes live; per-op `golden-hash::` warning; eval gate backstop |
| Runaway tokens / API loops | per-op caps + `maxLLMCalls` breaker + never-throws client (degrades to LM Studio) |
| Concurrent writes vs wrap/promote | reuse the proposals `.lock` around apply |
| Changeset pile-up (review skipped) | propose refuses to run while an unresolved changeset exists |
| Sidecar/file drift after apply | old embeddings kept + `indexNewEntries` for new + existing `--strict` drift check in the apply sequence |

## Implementation sketch (for the Phase 34 plan)

1. `superseded-by::` + `stale::` downranking in `src/memory-reader.js` (already Phase 34 bullet 2 — prerequisite).
2. Shared contradiction-check helper (promotion gate + dream stale-detection both call it — Phase 34 bullet 1).
3. Extract the checkbox-state parser from `src/promote-memories.js:104-152` into a shared helper in `src/memory-proposals.js`; `promote-memories.js` switches to it (behavior-preserving refactor, existing tests must stay green).
4. `src/dream.js`: pair detection, merge authoring + quote verification, stale detection, pattern extraction + dedup, changeset writer + changeset parser calling the shared checkbox helper.
5. `scripts/dream.js` entry (`--propose` / `--apply` / `--dry-run`), snapshot/restore, apply sequence with eval gate.
6. Skills `/dream-propose`, `/dream-apply`; `config/pipeline.json` `dream` block + schema; launchd plist.
7. Tests: quote-verification rejects a fabricated merge; apply → eval-fail → snapshot-restore round-trip on the frozen seed vault; propose refuses on unresolved changeset; both gates exercised through the same shared checkbox parser (multi-box → ambiguous → skipped in each).

## GSD insertion point

**`/gsd:plan-phase 34`.** The dream-consolidation script is already Phase 34's third bullet, and it depends on the phase's other two bullets (`superseded-by::` downranking, contradiction check) — plan them together, don't add a phase or milestone.

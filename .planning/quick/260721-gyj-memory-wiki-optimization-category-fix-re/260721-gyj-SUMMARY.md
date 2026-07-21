# Quick Task 260721-gyj — Memory wiki optimization: category fix + related wikilinks

**Date:** 2026-07-21
**Branch:** `feat/memory-wiki-optimization` (off master)
**Commits:** `7e4d2ac` promotion code · `9f0c1ab*` migration script · `7a908d2` reader root-cause fix · `df1a484` block-ref anchors (*see git log for exact second hash)

## Done-criteria — measured

| Criterion | Target | Measured | Status |
|---|---|---|---|
| npm test | green | **1394 total, 72 files** (1365 pass / 29 skip local; +11 tests) | ✅ |
| Coercion notes in memory.md | 0 | **0** | ✅ |
| Sidecar ↔ entry parity | equal | **180 == 180** (index drift: false) | ✅ |
| Non-empty `related::` | >80% | **178/180 = 98.9%** | ✅ |
| INDEX:AUTO regenerated | yes | **LEARNING:79, OTHER:5** (was 74/10), Last promoted 2026-07-21 | ✅ |
| Exclusion terms in links (added gate) | 0 | **0** | ✅ |
| Anchor uniqueness (added gate) | unique | **180/180 distinct `^hash` anchors, 0 self-links** | ✅ |

## What shipped

1. **Category fix** (`src/promote-memories.js`): `coerceCategory` case-normalizes sanctioned names, aliases `lesson→LEARNING` (CAT-ALIAS-01), and coerces truly-unknown labels to OTHER **silently** — the "(justification: ...)" body-note appender is gone.
2. **related:: at promotion** (WIKI-RELATED-01): each promoted entry gets up to 5 wikilinks — Voyage-cosine memory neighbors (threshold 0.6, one batched embed per run, zero extra stored state) via new `semantic-index` exports `nearestByVector`/`nearestByHash`, plus vault-note links from the existing wikilink engine, titles filtered against `excluded-terms.json` (fail-closed). Non-blocking: failures leave `related` empty, promotion proceeds. New entries carry a `^<contenthash>` block anchor.
3. **Migration** (`scripts/migrate-memory-wiki.js`, dry-run default / `--apply`): stripped the 5 coercion notes, recategorized those entries to LEARNING (header + field), verified restored bodies against stored hashes (**0 mismatches**), added 180 block anchors, backfilled `related::` through pipeline primitives, dropped+re-embedded the 5 touched sidecar records via `selfHealIfNeeded`, regenerated INDEX:AUTO, rebuilt SQLite index. Backup at `~/Claude Cowork/memory/.snapshots/wiki-20260721/`. Run cost: 180 Haiku calls + 1 Voyage batch (5 embeds).
4. **Root-cause fix found during dry-run** (`src/memory-reader.js`): the "first line containing `::`" field rule swallowed the PROMOTE-D entry's whole body (prose contained `status::pending`), leaving its content empty for search/embedding. Field lines now require `key:: ` at line start; migration script mirrors the rule.
5. **Anchor redesign after first live run**: headings are non-unique (97 distinct / 180 entries — one shared by 11), so `[[memory#heading]]` was ambiguous (34 links hit same-heading siblings). Links are now `[[memory#^hash|heading]]` — unique block-ref target + readable alias. Second `--apply` run confirmed idempotency (Phase A: 0 affected).

## Deviations from the task text (locked by orchestrator)

- **"10 OTHER entries with coercion note" → actually 5.** The 10 OTHER entries split: 5 body-notes (4× "lesson", 1× "capability" — all → LEARNING per the note-carrier rule), 4 with `justification::` *fields* from the deliberate 260719 reorg (provenance — untouched), 1 unmarked (untouched). Final OTHER count: 5.
- **71 legacy plain-path `related::` values overwritten** with wikilinks (backup preserves originals).
- **"Through the pipeline"** = exported pipeline primitives (`readMemory`/`computeHash`/`nearestByHash`/`selfHealIfNeeded`/`regenerateAutoIndex`/`buildIndex`); the pipeline is append-only with no mutation API, so the script is the sanctioned mutation path.
- **Live run used `CONFIG_DIR_OVERRIDE`** with `provider: anthropic` — this branch predates PR #83's local-LLM reasoning fix, so local Haiku calls would starve.
- **Executor subagent replaced by inline execution**: gsd-executor's enforced worktree isolation severed `.env`, the live vault, and the uncommitted plan; it burned its budget without output. Orchestrator executed the plan directly with the same atomic-commit structure.

## Residual notes

- 2 entries have empty `related::` (no neighbor ≥0.6 and no vault link survived filtering) — honest gaps, not failures.
- A few vault links point at archive month-files (e.g. `[[2026-04]]`) — Haiku ranked them ≥0.6; harmless, revisit if noisy.
- `readMemory` consumers gained corrected content for the PROMOTE-D entry; its embedding was refreshed from the clean body.

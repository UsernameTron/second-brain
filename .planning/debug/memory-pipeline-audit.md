---
status: diagnosed
trigger: "Functionality audit of the second-brain memory pipeline. Verify extraction → staging → promotion → memory.md → semantic sidecar → reach export → recall. ASSESSMENT ONLY — find and document, DO NOT FIX."
created: 2026-07-19T00:00:00Z
updated: 2026-07-19T20:12:00Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: CONFIRMED — dotenv gate on the /promote-memories entry point makes every promotion embed ZERO vectors (green run, silent). Recall self-heal (loads dotenv) masks it, unless Voyage is degraded.
test: Isolated E2E trace (VAULT_ROOT/CACHE_DIR_OVERRIDE/REACH_TARGETS_OVERRIDE → scratch) — Scenario A (no dotenv) vs B (dotenv); + real hash coverage check.
expecting: A embeds 0 vectors on green promote; B embeds 1. Both confirmed.
next_action: Return diagnosis (find_only). No fix. Real data untouched; scratch cleaned.

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: Every layer of the memory pipeline works: extractor stages candidates, promotion writes memory.md AND embeds vectors in sidecar, reach export lands digests in all reach targets, all three recall modes return promoted entries.
actual: Unknown — proactive functionality audit. Owner wants proof per layer. Known failure mode: green promotion run whose Voyage sidecar embedded ZERO vectors (dotenv gate); sidecar vector count must match promoted entry count.
errors: ~/.cache/second-brain/voyage-health.json showed 429-degraded (4 consecutive failures, degraded_until 2026-07-19T19:55:14Z). If still degraded, semantic search is DEGRADED not broken — verify keyword fallback.
reproduction: Run pipeline-health skill checks, then one end-to-end trace with test entry (summary prefixed TEST-AUDIT).
started: v1.7 shipped 2026-07-16. Earlier audit today (14:54) interrupted — left pre-audit backups + 40 REAL pending candidates in proposals/memory-proposals.md.

## Eliminated
<!-- APPEND only - prevents re-investigating -->

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: STEP0
  checked: Clean-state — diff current vs pre-audit.20260719-145456 backups (proposals, memory.md, embeddings.jsonl, index-metadata.json); grep TEST-AUDIT all layers
  found: All 4 files IDENTICAL to backups. grep TEST-AUDIT across proposals + memory.md + cache + both reach targets = 0 matches (exit 1). Clean.
  implication: No prior pollution from interrupted 14:54 audit. Safe to start. Backups exist for rollback.

- timestamp: BASELINE
  checked: Baseline counts
  found: proposals total_pending=40 (40 `### mem-` entries, all status:: pending). memory.md 156 `### ` entries = 156 content_hash. embeddings.jsonl 174 vectors {hash,embedding[1024],addedAt,category}. index-metadata.json {schema_version 6aa095ea3dee, updatedAt 2026-04-24}. voyage-health degraded_until 2026-07-19T19:55:14Z (4x 429). daily-counters-07-19: promotions=54, proposals=366, recallCount=3.
  implication: Sidecar has 18 more vectors (174) than memory entries (156) — orphans. index-metadata.updatedAt frozen at Apr-24 despite 07-19 embeds — metadata not updated on embed. 54 promotions vs 44 07-19 vectors = 10-vector gap (dedup or 429 miss).

- timestamp: EMBED-DATES
  checked: embeddings.jsonl addedAt distribution
  found: 2026-04-23:1, 04-24:8, 04-25:28, 04-26:10, 04-27:8, 07-12:70, 07-18:5, 07-19:44 (total 174)
  implication: Sidecar IS embedding recently (44 today) — NOT frozen-in-April zero-vector failure at the file level. But per-run zero-vector still possible; verify with the TEST-AUDIT trace.

- timestamp: STEP1
  checked: pipeline-health SKILL 4 checks
  found: (1) config-validator EXIT 0 = PASS, but WARNING daily-stats-frontmatter.json not found. (2) connectors gmail/github/calendar all OK. (3) curl localhost:27123 = 000 UNREACHABLE (Obsidian REST API down). (4) scheduling.json present: cron "45 11 * * 1-5", enabled=FALSE (RemoteTrigger disabled by-design; primary=launchd com.secondbrain.today).
  implication: Per SKILL verdict rules, Vault REST API UNREACHABLE = UNHEALTHY (critical). But promotion/reach/recall use DIRECT file writes to VAULT_ROOT (~/Claude Cowork), NOT the REST API — verified in source (promote-memories.js writes MEMORY_FILE via fs; reach-exporter fs.writeFileSync). So REST API being down does NOT block the memory pipeline. Downgrade to DEGRADED in practice.

- timestamp: DOTENV-GATE-SOURCE
  checked: pipeline-infra.js:23-26 + .claude/commands/promote-memories.md + who loads dotenv
  found: pipeline-infra.js DELIBERATELY does not call dotenv.config() ("Entry points ... are responsible", HOOK-DOTENV-01). The /promote-memories command invokes `node -e "require('./src/promote-memories')..."` with NO dotenv.config(). scripts/recall.js DOES load dotenv (line 22). memory-extraction-hook.js does NOT load dotenv. semantic-index createVoyageClient reads process.env.VOYAGE_API_KEY; absent → returns 401 stub → indexNewEntries embeds 0; embed failure is caught non-fatally in promote-memories.js:230-236 (promotion stays green).
  implication: Every /promote-memories run embeds ZERO vectors — the exact known failure mode. Masked by recall.js self-heal (loads dotenv) UNLESS Voyage degraded.

- timestamp: DOTENV-GATE-EMPIRICAL
  checked: VOYAGE_API_KEY visibility + .env contents
  found: VOYAGE_API_KEY NOT in shell env; IS in repo .env. Probe: `node -e "require('./src/promote-memories'); console.log(process.env.VOYAGE_API_KEY?...)"` → "NO (undefined)". indexNewEntries does NOT check isDegraded() (only query-time search does), so embed-on-promotion always ATTEMPTS Voyage — the failure is key-absence, not the degraded flag.
  implication: Confirmed at runtime: production promote path cannot see the key.

- timestamp: TRACE-SCENARIO-A (isolated, NO dotenv — production-faithful)
  checked: extractFromTranscript(stub LLM) → writeCandidate → promoteMemories({auto}) with VAULT_ROOT/CACHE_DIR_OVERRIDE/REACH_TARGETS_OVERRIDE → scratch
  found: PROMOTE RESULT {"promoted":1,...} (GREEN). embeddings BEFORE=0 AFTER=0 (ZERO vectors). memory.md gained 1 TEST-AUDIT entry. reach: both targets written, TEST-AUDIT in digest YES. recall keyword=1 hit; semantic=0 degraded (401 "VOYAGE_API_KEY not set"); hybrid=1 via keyword fallback (mode "keyword (hybrid unavailable)").
  implication: REPRODUCED the zero-vector green run exactly. Extraction/staging/promotion/memory.md/reach/keyword-recall all WORK; only the sidecar embed silently no-ops.

- timestamp: TRACE-SCENARIO-B (isolated, WITH dotenv)
  checked: same trace, dotenv loaded from repo .env
  found: VOYAGE_API_KEY present. PROMOTE {"promoted":1}. embeddings BEFORE=0 AFTER=1 (vector count == promoted count). isolated voyage-health consecutive_failures=0 (Voyage 429 has cleared — degraded_until 19:55Z < now 20:09Z). memory.md 1 entry; reach both written; recall keyword=1, semantic=1 (NOT degraded), hybrid=1 mode "hybrid" (NOT degraded).
  implication: Embed mechanism + all recall modes WORK when key present. Defect is purely the missing dotenv.config() on the promote entry point.

- timestamp: REAL-COVERAGE (read-only)
  checked: hash coverage real memory.md vs real embeddings.jsonl
  found: 156 memory hashes; 174 embedding hashes; 146 covered; **10 memory entries MISSING a vector** (unsearchable semantically); 28 orphan vectors (archived/removed entries). embeddings addedAt: 44 on 07-19, 70 on 07-12 — recent vectors exist (from recall self-heal, NOT promotion).
  implication: The dotenv gate has REAL fallout: 10 promoted entries currently have no vector — promotion embedded 0, and recall self-heal was blocked by the 429 window earlier today. Next --semantic/--hybrid recall (now that 429 cleared) should backfill them. Orphans + index-metadata.updatedAt frozen at 2026-04-24 are minor (cache bloat / cosmetic).

- timestamp: ISOLATION-VERIFY + CLEANUP
  checked: real layers after trace + scratch removal
  found: grep TEST-AUDIT across real proposals/memory.md/cache/both reach targets = 0 (exit 1). proposals total_pending=40, 40 entries, 40 status:: pending (the 40 human-gated candidates UNTOUCHED). memory.md 156 (==baseline). embeddings 174 (==baseline). reach targets mtime still 14:39 (untouched). daily-counters still promotions:54 proposals:366 (untouched). Scratch trace dirs+scripts removed.
  implication: Trace was 100% isolated — real pipeline state identical to pre-audit baseline. Nothing to un-pollute; the 40 candidates never at risk.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: |
  PRIMARY DEFECT (the known failure mode, CONFIRMED): The /promote-memories entry
  point (.claude/commands/promote-memories.md, the `node -e "require('./src/promote-memories')..."`
  block, lines 11-43) never calls dotenv.config(). By design, library modules
  (src/pipeline-infra.js:23-26) do NOT load .env — entry points must. Result: on every
  /promote-memories run, process.env.VOYAGE_API_KEY is undefined → semantic-index.js
  createVoyageClient() (src/semantic-index.js:99-108) returns the 401 stub →
  indexNewEntries() embeds ZERO vectors. The embed failure is swallowed non-fatally
  in promote-memories.js appendToMemoryFile() (lines 230-236), so the promotion reports
  success ("green"). Sidecar vector count therefore does NOT match promoted entry count.
  Masked in normal use because scripts/recall.js DOES load dotenv (line 22) and
  selfHealIfNeeded() backfills missing vectors on the next --semantic/--hybrid recall —
  but that mask fails whenever Voyage is 429-degraded (as it was earlier today), leaving
  entries permanently unsearchable until a later healthy recall.
  OBSERVED FALLOUT: 10 real memory.md entries currently have no vector.
fix: "NONE APPLIED — assessment/find_only mode. Suggested direction (NOT done): add `require('dotenv').config({ path: <repo>/.env })` to the /promote-memories entry (mirror scripts/recall.js:22), and/or to .claude/hooks/memory-extraction-hook.js. Consider making the embed failure LOUD in promote output (report embedded/failed counts) so a zero-vector run is not silently green."
verification: "Isolated E2E trace reproduced the zero-vector green run (Scenario A) and proved the embed + all recall modes work with the key present (Scenario B). Real pipeline data untouched and verified equal to pre-audit baseline."
files_changed: []

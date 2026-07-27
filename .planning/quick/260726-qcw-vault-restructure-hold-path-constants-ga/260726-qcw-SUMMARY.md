# 260726-qcw — Vault Restructure: SUMMARY

**Date:** 2026-07-26
**Branch:** feat/vault-restructure-260726-qcw
**Commit:** 8273de2 (repo change-set) + follow-up fixture refresh

## What shipped

**Vault moves (103 files, nothing deleted).** Root went from 83 loose files to 1 (`CLAUDE.md`); top-level items 109 → 26. Every move logged line-by-line to `archive/dispatch/2026-07-26-vault-restructure-log.md` in the vault.

| Rule | Files | Destination |
|---|---|---|
| R1 CTG-* | 16 | `ctg/` |
| R2 standups (root + `Daily Standups/`) | 41 | `standups/` |
| R3 executed prompts + completed audits | 4 | `archive/dispatch/` |
| R4 playbooks / build plans / DRAFT-* | 6 | `projects/second-brain/` |
| R5 date-titled notes (Connor's, checkpoint-approved) | 2 | `Daily/` |
| R6 showcase deck | 2 | `research/` |
| R7 archive consolidation | 4 | `archive/memory/`, `archive/proposals/` |
| R8 RIGHT/ dissolved | 11 | `briefings/`, `briefings/daily/` |
| R9 Darren material | 6 | `ctg/Darren-Starter-Pack/` |
| R10 no rule matched | 11 | `inbox/` |

**Repo change-set.** Archive constants repointed at all 7 sites in the same commit as the moves (dedup does a flat `readdirSync` of `ARCHIVE_DIR()` and swallows a missing directory — a gap would have made archived hashes re-promotable). `RIGHT/` residue cleared, including the gateway-bypassing briefing writer at `today-command.js:322` that would otherwise have stranded the 06:45 run. `vault-paths.json` right[] now matches the folders that exist.

**Enforcement.** `checkPath()` names a vault-root file write instead of reporting a generic allowlist miss; a `PATH_BLOCKED` write now leaves a metadata-only quarantine record before throwing. Scope stated honestly: this only covers writes routed through the gateway.

**Visibility.** New `vault_hygiene` column in daily-stats counts loose root files + undeclared top-level folders, surfaced in the yesterday summary line when non-zero. This is what catches the writers that bypass the gateway (Cowork sessions, Obsidian, the external standup agent).

**Memory dashboard.** `src/memory-dashboard.js` regenerates `memory/dashboard.md` whole on every promotion and after `dream-apply` — category counts, last 10 promoted with dates, pending-proposal count, last-promotion stamp, no content_hash noise.

## Verification (all run, all evidence-backed)

| Check | Result |
|---|---|
| `npx jest` | 1494 passed, 29 skipped, 0 failed (81 suites) |
| `npm run lint` | clean |
| `node src/config-validator.js` | all PASS, exit 0 |
| `npm run verify:baseline` | 27/27 hashes resolve from `archive/memory/` |
| Dedup survival | real archived hash `11a67a5303da` still returns `written:false reason:duplicate`; no proposal staged |
| `/recall "vault gateway" --hybrid` | identical result set before/after (only the dotenv banner tip line differs) |
| Reach export | 15 targets written; `second-brain.md` + `MEMORY.md` index line intact |
| Pre-commit hooks | schema + vault boundary + archive integrity (21 entries across 2 files at the new path) |
| Tree proof | root files 83 → 1; top-level items 109 → 26 |

## Post-move boundary audit (vault-guardian) — two findings, both pre-existing

**Fixed here (commit d7a6400):** reach-export egress could fail *open*. `loadExcludedTerms()` (`pipeline-infra.js:501-507`) returns `[]` on any load failure, and `checkContent()` against an empty term list matches nothing and returns PASS immediately (`content-policy.js:250-259`) — so a broken `excluded-terms.json` would have shipped an unfiltered digest into all 15 auto-memory targets. The module's comment claimed this matched "the gate semantics used by vault-gateway", but `validateConfig` throws on an empty list there. An empty term list now suppresses the digest; the pointer still ships (no memory content in it). Test added; live export unchanged in the healthy case (included=10, excluded=5, 15 targets).

**Filed, not fixed:** the `/today` briefing body is written with raw fs at `today-command.js:322-326` — `grep -n "checkContent\|checkStyle\|vaultWrite" src/today-command.js` returns nothing, so neither the exclusion filter nor the style lint runs on it, despite the content being LLM-synthesized from Gmail/Calendar/GitHub. The restructure only repointed its destination; routing it through `vaultWrite()` changes what happens when a guard fires (quarantine = no briefing that morning), which is a product decision against the standing "briefing-is-the-product" principle. Spawned as its own task.

Audit verdicts otherwise: gateway LEFT/RIGHT enforcement PASS (no path to LEFT or root; `quarantine()`'s destination is hardcoded and cannot be redirected by the blocked path or reason string), ingress exclusions PASS fail-closed, `memory-dashboard.js` PASS (fixed literal path, cannot clobber `memory.md`, separate `.tmp`).

## Left for Connor

Five now-empty folders await manual deletion (agent never deletes): `RIGHT/`, `RIGHT/daily/`, `Untitled/`, `Daily Standups/`, `memory-archive/`, `memory-proposals-archive/`.

Two schema files carry stale strings but are protected-file-guarded, so they were not edited — exact diff filed in the final report: `config/schema/pipeline.schema.json:297` (`"default": "RIGHT/daily-stats.md"`, inert — AJV `useDefaults` is off) and `config/schema/daily-stats-frontmatter.schema.json:4` (description text).

The root standup writer is a Cowork-side scheduled agent, not this repo — its prompt needs updating to write into `standups/`. Until then the hygiene counter reports the drift daily.

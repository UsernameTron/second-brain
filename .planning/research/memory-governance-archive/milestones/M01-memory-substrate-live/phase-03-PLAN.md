# Harness Memory Governance — Phase 03
# Migration & De-duplication

**GSD lifecycle state:** PHASE_DISCUSSING (stub)
**Estimated build time:** 3–4 hours
**Flesh out:** when phase-02 ships

> **Stub.** This is the highest-judgment phase in M01 — most of the time is Pete adjudicating conflicts, not Claude moving files. Plan it against the real `overlap-report.txt`, not against a guess about what it will contain.

## What you're building

One home per fact. Content moves from `ABOUT ME/`, `CLAUDE.md`, and `~/context/` into `canon/`. Every conflict from phase-01 gets adjudicated and resolved. `CLAUDE.md` becomes a router. Old locations get tombstones.

## Sections to author

- **3.1 — Adjudicate the conflict list.** One pass through `overlap-report.txt`. For each pair: which is true? The loser is deleted, not merged. **Merging conflicting facts produces a fact that was never true.**
- **3.2 — Migrate to `canon/`**, applying the frontmatter schema. `provenance:` matters here — be honest about what Claude proposed vs. what Pete decided.
- **3.3 — Seed `ledger/decisions.md`** from ADR-0002, ADR-0003, and the key decisions in PROJECT.md.
- **3.4 — Seed `ledger/failures.md`.** Entry #1 is the enrichment MCP timeout. Entry #2 is whatever the phase-01 skill-count discrepancy turns out to be — it's a live specimen of the exact failure this project exists to fix.
- **3.5 — Rewrite `CLAUDE.md` as a router.** Target under 100 lines. Grep it for facts afterward; every one you find is a defect.
- **3.6 — Tombstone** the old locations with `MOVED` stubs (see AUTHORITY.md A4).
- **3.7 — Re-run the 20 probes.** Must not regress.

## Validation gates

| Gate | Pass criterion |
|:---|:---|
| Zero duplication | `dupe-check.py` returns 0 |
| Router is thin | `CLAUDE.md` < 100 lines, contains no facts |
| No regression | Cold-start recall ≥ phase-01 baseline |
| Every conflict resolved | `overlap-report.txt` re-run is clean |
| Tombstones in place | Every migrated source has a `MOVED` stub |

## Rollback

`git checkout` the pre-migration tag; restore `ABOUT ME/` and `CLAUDE.md` from the tombstoned originals (which is exactly why you tombstone rather than delete).

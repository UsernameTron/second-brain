# Requirements: Second Brain

**Defined:** 2026-07-12
**Milestone:** v1.6 Enforcement Integrity & Surface Completion
**Core Value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.

> v1.5 requirements archived to [milestones/v1.5-REQUIREMENTS.md](./milestones/v1.5-REQUIREMENTS.md) — all 10 complete.

## v1.6 Requirements

This milestone closes the last places where the repo *declares* an enforcement it does not actually *perform*. Two requirements are live defects found on 2026-07-12 while seeding the memory corpus from 27 → 97 entries; the promotion workflow is now in daily use, which is what makes them urgent rather than theoretical.

### Promotion Safety

The human review gate is the entire safety model for long-term memory. Both of these break it.

- [ ] **PROMOTE-FLAGS-01** *(P1)*: `/promote-memories --dry-run` previews without writing to `memory.md`, and `--auto` accepts pending candidates. Both flags are currently parsed by the command wrapper but ignored by `promoteMemories()`, which reads only `options.max` (`src/promote-memories.js:288`) — so `--dry-run` performs a **real promotion**. **Ranked P1: as of 2026-07-12 the proposals file contains live accept boxes, making this an unguarded write to the memory corpus. It destroys data, where PROMOTE-DEFER-01 only strands it recoverably.** Unknown flags must be rejected loudly rather than silently ignored.
- [ ] **PROMOTE-DEFER-01**: Accepting more than `batchCapMax` (10) proposals promotes the first 10 and leaves the remainder promotable on the next run. Today they are stamped `status:: deferred` (`:342,385`) while the accept filter admits only `status:: pending` (`:326,333`), so they are locked out permanently. Fix by resetting `deferred` → `pending` at end of run, or by draining the queue in a loop. **This bug already caused a silent loss once:** the 2026-04-26 handoff recorded "8 deferred memory proposals — review in next session" and attributed it to dedup logic; it was this. Current workaround: promote in batches of exactly 10.

### Context Honesty

Both requirements answer the same failure mode: context that is confidently wrong, or absent, and no mechanism notices. They are the spine of this milestone — see [decisions/ADR-018-cross-surface-reach.md](../decisions/ADR-018-cross-surface-reach.md).

- [ ] **SURFACE-REACH-01**: The memory layer is discoverable from every Claude surface (Desktop, Cowork, chat), not only from inside this repo in Claude Code. Surface-level instructions must name `memory.md` as canonical and point at this project as its owner. **Evidence it matters:** on 2026-07-12 a Claude session with no knowledge of Second Brain spent ~4 hours independently designing a memory-governance system before discovering v1.5.0 had already shipped equivalent components. A memory system no other surface can see will be reinvented by the next surface that needs one. Prior art absorbed into `.planning/research/AUTHORITY.md` (a source-of-truth hierarchy across the auto-memory blob, userPreferences, ABOUT ME, and CLAUDE.md — a gap this project does **not** currently solve) and `.planning/research/LIFECYCLE.md` (countable retention/decay/promotion rules).
- [ ] **REQ-CTX-01** *(E-02)*: A SessionStart hook warns when the CLAUDE.md status block's `Last verified:` date exceeds **14 days**. The block sat 77 days stale before the 2026-07-12 audit caught it, and nothing in the system noticed. 14 days chosen to catch drift early without firing during an active milestone, where docs update naturally.

### Surface Completion

Commands and agent modes the repo advertises but never wired up.

- [ ] **REQ-SURF-01** *(C-01)*: `/reroute` is invocable as a slash command and re-routes a previously classified item to a different vault location. The underlying `src/reroute.js` works; only the wrapper is missing. The return shape uses `r.to` — **not** `r.target`, which is what a naive wrapper would reach for (the audit's own proposed diff had exactly this bug; adversarial verification caught it).
- [ ] **REQ-SURF-02** *(C-04)*: docs-sync Phase-Closure Audit Mode fires from the **pre-push hook**, so documentation drift is caught before it reaches the remote. The mode is fully implemented in the agent but wired to no trigger, which means the repo currently claims an automated docs-drift gate it does not have.

## Future Requirements

- **F-02 follow-up — `schema_version` type mismatch.** The daily-stats frontmatter schema declares `schema_version` as a string; `daily-stats.js` may write an integer. Deferred from the 2026-07-12 audit, which originally proposed deleting this schema as an orphan — **refuted**: the pre-commit hook discovers schemas by scanning `config/schema/*.schema.json` and matches by filename convention, so a literal-name grep could not see the linkage. Needs a decision on which side is authoritative before anything changes.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Config hot-reload (FIX-02) | Deferred permanently in v1.1 — restart workaround sufficient |
| Automatic memory promotion | Out of scope since v1.0 — the human review gate is the safety model, and PROMOTE-FLAGS-01 exists precisely because that gate turned out to be bypassable |
| Re-mining the vault corpus | The 2026-07-12 batch seeded 97 entries. Further mining hits diminishing returns until daily use accumulates new material |
| chokidar v4 upgrade | Pinned to v3 for CJS compat; v4 is an unneeded major bump requiring dependency approval |
| Connector changes | Gmail/Calendar/GitHub connectors stable since v1.1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROMOTE-FLAGS-01 | Phase 26 | Pending |
| PROMOTE-DEFER-01 | Phase 26 | Pending |
| SURFACE-REACH-01 | Phase 27 | Pending |
| REQ-CTX-01 | Phase 27 | Pending |
| REQ-SURF-01 | Phase 28 | Pending |
| REQ-SURF-02 | Phase 28 | Pending |

**Coverage:**
- v1.6 requirements: 6 total
- Mapped to phases: 6
- Unmapped: 0

---
*Requirements defined: 2026-07-12*
*Last updated: 2026-07-12 at milestone open*

# Codebase Concerns

**Analysis Date:** 2026-07-22

## Governance

**Master branch protection — RESOLVED 2026-07-21 (PR #91)**
- Branch protection restored and verified live (`.planning/STATE.md` Open Blockers: None).
- Required status check is `test (22)` (Node 22 is the only matrix entry since the node:sqlite floor).

## Tech Debt

**`.planning/STATE.md` "Filed, not fixed" staleness — RESOLVED 2026-07-21**
- STATE.md no longer carries the already-fixed "Rejected candidates" line (fix landed in commit `c0b3c70`, PROMOTE-REJECT-01; terminal status at `src/promote-memories.js:630-633`).

**`daily-stats` frontmatter `schema_version` type mismatch — RESOLVED 2026-07-21 (PR #91)**
- `config/schema/daily-stats-frontmatter.schema.json` now declares `schema_version` as `"type": "integer"`, matching what `src/daily-stats.js:197` writes.

**`.planning/backlog.md` is stale relative to shipped code — HYGIENE**
- Sampled 8 of the v1.3-era backlog items against current source; all 8 are already resolved but the file still lists them as open MEDIUM/LOW items:
  - B-01 (classifyLocal missing fetch timeout) — fixed: `AbortController` at `src/pipeline-infra.js:190`, used in the `fetch()` call at `src/pipeline-infra.js:200`.
  - B-02 (writeDeadLetter bypasses vault-gateway) — fixed: `src/pipeline-infra.js:433-434` routes through `vault-gateway`'s `vaultWrite`.
  - B-07 (today-command.js god module, 724 LOC) — fixed: now 409 LOC (`wc -l src/today-command.js`), briefing logic extracted to `src/briefing-helpers.js`.
  - B-14 (missing schemas for vault-paths/excluded-terms/scheduling) — fixed: all three exist in `config/schema/` (`vault-paths.schema.json`, `excluded-terms.schema.json`, `scheduling.schema.json`).
  - B-16 (branch coverage threshold 70% vs 90%) — partially fixed: raised to 80 (`.github/workflows/ci.yml:29` sets `"branches":80,"functions":90,"lines":90,"statements":90`), still the lowest of the four.
  - B-20 (41 no-console warnings) — dispositioned via option (a), `eslint-disable-next-line no-console` on each call site (43 occurrences across `src/*.js`); CLAUDE.md confirms 0 live warnings.
  - B-21 (UAT never runs automatically) — fixed via recommended option (a): `.github/workflows/uat.yml:3-9` runs on `workflow_dispatch` plus a weekly `cron: '0 13 * * 1'`.
- Fix approach: triage the rest of `backlog.md` in the same pass (Phase 6 of this session's plan) and prune everything already shipped — the file is misleading anyone who reads it as current.

**AJV `removeSchema` catch swallows errors — HYGIENE**
- `src/config-validator.js:80`: `try { ajv.removeSchema(schemaForCompile.$id); } catch (_) { /* ok */ }`.
- Backlog B-12, still present, but benign: this only pre-clears a schema cache entry before recompiling (test re-use with the same `$id`); failure here just means nothing was cached yet, and the subsequent `ajv.compile()` at line 82 is not swallowed — it has its own catch block that sets `result.status = 'ERROR'` (lines 83-87).
- Fix approach: none needed; the inline comment could name the ceiling explicitly (`ponytail`-style) so a future reader doesn't have to re-derive this.

## Fragile Areas

**God modules — no file over ~500 LOC lacks test coverage, but several are grab-bags — HYGIENE**
- By line count (`wc -l src/*.js`): `src/dream.js` 1005, `src/pipeline-infra.js` 721, `src/promote-memories.js` 705, `src/vault-gateway.js` 638, `src/semantic-index.js` 623, `src/memory-extractor.js` 598, `src/daily-stats.js` 557, `src/wikilink-engine.js` 539, `src/classifier.js` 517, `src/memory-proposals.js` 511.
- All ten have a corresponding test file (`test/dream.test.js`, `test/pipeline-infra.test.js`, `test/promote-memories.test.js`, `test/vault-gateway.test.js`, etc.), so this is a readability/maintainability concern, not a coverage gap.
- `src/pipeline-infra.js` (721 LOC) is the one worth watching — its name signals a shared-utility grab-bag (JSON extraction, dead-letter writing, LLM fetch/timeout handling all live there per `src/pipeline-infra.js:108-113`, `190-211`, `433-461`). If it keeps absorbing unrelated cross-cutting concerns, split by responsibility before it becomes the next `today-command.js`-style extraction (see B-07 above, already done once).
- Fix approach: no action needed now; revisit if any of these cross ~1000 LOC without a natural seam (dream.js is already there).

**Corpus-size ceiling on batch classification — HYGIENE (documented ceiling, not a bug)**
- `src/memory-extractor.js:330-332`: `// ponytail: 4096 headroom for a whole-corpus JSON array of candidates (unbounded count, unlike other classify() callers' single-object budgets). If a corpus still truncates at this size, chunk it — don't just raise the number again.`
- This is a self-aware scaling limit, not a defect. Flagging because it's the one `ponytail:` marker in the codebase with a real growth vector (session transcript size is user-controlled and unbounded).
- Fix approach: already named in the comment — chunk the corpus rather than raising `maxTokens` again, if truncation is ever observed in practice.

**JSON-extraction rescan is O(n·span) — HYGIENE (documented ceiling)**
- `src/pipeline-infra.js:111-113`: bracket-matching fallback scans linearly per candidate span; comment notes responses are `max_tokens`-bounded (~KB), so a smarter scanner isn't worth the code.
- No action needed; ceiling and rationale are already documented at the call site.

## Test Coverage Gaps

**No TODO/FIXME/HACK/XXX markers in `src/` — clean**
- The only regex hit, `src/memory-extractor.js:163`, is a string literal (`'- TODO items and task lists'`) used to describe capturable content types, not a real code marker. No open inline debt markers exist.

**No empty or comment-only-without-rationale catch blocks — clean**
- Checked both a same-line empty-brace pattern and a multi-line body scan across `src/*.js`; zero true empty catches. Every non-trivial `catch` block that swallows an error carries an inline rationale comment (e.g. `src/promote-memories.js:606` `/* flag-only: never let the contradiction check affect promotion */`, `src/promote-memories.js:622` `/* briefing-is-the-product: never break promotion on stats failure */`).

## Scope Boundaries (not debt)

**Phase 36 Ingest Breadth is decision-gated and unbuilt**
- `.planning/STATE.md:26` lists Phase 36 as decision-gated within the still-in-progress v1.8 milestone.
- Confirmed no connector-to-memory seam exists: `src/connectors/` (`calendar.js`, `github.js`, `gmail.js`, `types.js`) has zero references to `memory-extractor`, `memory-proposals`, `promote-memories`, or `extractMemories` — connectors are briefing-only today.
- This is an intentional, documented scope boundary pending a product decision, not an implementation gap to fix.

---

*Concerns audit: 2026-07-22*

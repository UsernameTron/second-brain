---
phase: 2
reviewers: [codex, claude-host]
reviewed_at: "2026-04-22T14:30:00Z"
artifact_reviewed: 02-CONTEXT.md
gemini_status: failed (403 PERMISSION_DENIED — auth scope insufficient)
claude_cli_status: failed (output capture issue — stdout/stderr routing)
---

# Cross-AI Context Review — Phase 2: Content Pipeline

Review of 02-CONTEXT.md (50 decisions, D-01 through D-50) as a pre-planning gate before `/gsd:plan-phase 2`.

---

## Codex Review

**1. Under-Specified Decisions**

- `D-02` — "voice-authenticity rule" is the core Stage 1 classifier, but the rule itself is not defined. A developer still has to assume: decision criteria, examples/counterexamples, how mixed human/agent text is handled, and how Stage 2's "full directory path" relates to `D-12`'s proposal-only LEFT writes.
- `D-03` — "Stage 1 < 0.8 -> prompt user; Stage 2 < 0.7 -> present top 2" leaves major UX and control-flow gaps: what the prompt looks like, what happens if the user rejects both options, how non-TTY/non-interactive is detected, and what metadata goes into the dead-letter.
- `D-05` — "add dir to vault-paths.json + add label to Stage 2 prompt. No routing-table" is not sufficient for extensibility. A developer must still assume how a new directory is assigned to LEFT vs RIGHT and whether other config/templates/indexing must be updated.
- `D-06` — "log every classification with all metadata" does not define the log sink, metadata schema, retention, or whether raw user text is logged.
- `D-07` — "YAML frontmatter + raw input body preserved verbatim" does not define the required frontmatter fields for ordinary `/new` notes.
- `D-08` — "Template overlays for 3 domains ONLY" does not define the actual overlay shapes, required fields, or file layout for those templates.
- `D-09` — "Low-confidence fields left empty" does not define what "low-confidence" means per field or how field-level confidence is represented.
- `D-10` — "short input -> use as filename; long -> Haiku generates 4-8 word name" leaves "short" vs "long" undefined; filename sanitization, slugging, max length, and illegal character handling are also unspecified.
- `D-11` — "Timestamps: ISO-8601 with timezone offset" does not say which timestamps exist (created, captured, updated, etc.).
- `D-12` — "LEFT-classified content routes to proposals/left-proposals/ as a proposal file" does not define proposal filename rules or whether any LEFT path is ever written automatically.
- `D-13` — "proposal-action (create|append|edit-section)" is incomplete without defining how edit-section targets a section, how append selects an anchor/location, and what minimum metadata is required.
- `D-16` — "Auto-archive after 14 days pending" does not define the archive destination, archive format, or whether archived proposals remain reroutable/reviewable.
- `D-17` — "3-5 links in `## Related` footer" does not define exact output format when a note already has a related-links section or when template overlays also inject structured sections.
- `D-18` — "Cached vault index at `.cache/vault-index.json`" does not define the index schema, rebuild ownership, or stale-cache behavior.
- `D-19` — "tokenize + extract nouns + tags -> grep index -> top 20 -> Haiku re-rank" still leaves noun extraction method, initial ranking/scoring, tag source, and tie-breaking undefined.
- `D-21` — "daily sweep of Daily/ at 23:45" does not define scheduler ownership, timezone source, or idempotency relative to `/wrap` and `/extract-memories`.
- `D-23` — "OTHER requires justification" does not define where that justification is stored or how it is validated.
- `D-24` — "content already in memory.md" is an exclusion rule without a matching rule for how equivalence is determined at extraction time.
- `D-25` — "0.5-0.75 -> low-confidence status" does not define the actual status value or how low-confidence proposals differ operationally.
- `D-26` — "Returns JSON array" is too thin for implementation. The schema for each candidate is missing, including the source-attribution fields required by MEM-01.
- `D-27` — "Dedup via source-ref + content-hash" does not define hash normalization or the hash algorithm.
- `D-28` — "month-level sections" does not define the heading format or insertion algorithm.
- `D-29` — "`## YYYY-MM-DD . CATEGORY . source-ref-short` header" does not define source-ref-short derivation or the actual "4-6 inline fields".
- `D-30` — "reads marks, writes to memory.md, archives" does not define where processed proposals are archived or what is preserved.
- `D-31` — "edit-then-accept" is not parseable without defining where edits occur and how the CLI distinguishes edited prose from control markup.
- `D-32` — "`--max N override, --all bypasses with confirmation`" does not define the allowed range for N or how confirmation works in non-interactive contexts.
- `D-34` — "archive oldest year to `memory-archive/YYYY.md` when memory.md > 200KB or 500 entries" does not define when archival runs or whether it happens before/after promotion.
- `D-37` — "Auto-retry... 15min, cap at 3" does not define where retry state lives or which process owns retries.
- `D-38` — "`/today` surfaces unrouted count" does not define output format, count source, or whether count means files vs entries.
- `D-44` — "`/wrap` reads transcript_path from hook stdin (JSONL)" does not define the stdin schema, transcript file schema, or missing/unreadable path behavior.
- `D-45` — "semantically-weighted tool outputs" and "short messages" are undefined. "Read/Glob/Grep/LS tool pairs" is also too vague to implement consistently.
- `D-46` — "chunked 100-message windows" does not define overlap/boundaries, so extraction quality and dedup behavior are left to assumption.
- `D-48` — "hot-reload fix... atomic swap" does not define which config files hot-reload or what consumers must observe.
- `D-49` — "False-positive audit required" does not define the audit method, pass/fail threshold, or whether it blocks release.

**2. Contradictions**

- `D-02` vs `D-12`: D-02 says Stage 2 outputs a "full directory path" on the LEFT side, but D-12 says LEFT content always routes to `proposals/left-proposals/`. The classifier's declared output for LEFT is never used.
- `D-03` vs `D-36`: D-03 uses `non-interactive-ambiguous` as a failure mode, but D-36's taxonomy does not include it.
- `D-35` vs `D-41`: D-35 says "Global fallback: dead-letter... Never lose captures." D-41 says Stage 0 BLOCK exits immediately. If the fallback is global, blocked content should be dead-lettered; if Stage 0 exits immediately, the fallback is not global.

**3. Thin Traceability**

- **INPUT-01** — Thin. Covers classification flow but not final write semantics. D-12 is omitted even though LEFT inputs don't write to the classified directory.
- **INPUT-02** — Thin/partially unmet. D-12 routes voice content to proposals/left-proposals/, not LEFT itself. The table assumes proposal-queue routing satisfies "route to LEFT" but that interpretation isn't stated. D-02 depends on an undefined voice-authenticity rule.
- **INPUT-03** — Thin. D-35 creates ambiguity about whether blocked content hits disk. D-43 is a phase-boundary constraint, not real coverage. D-49 (the exclusion terms themselves) is not cited.
- **INPUT-04** — Mostly covered but thin at the surface. Decisions don't define whether wikilink suggestions appear in CLI output or only in note content.
- **MEM-01** — Thin. Decisions never define the memory-proposals.md schema or what valid source attribution looks like. D-21's Daily-note sweep conflated with session extraction.
- **MEM-02** — Moderately covered but thin. Archive location for processed proposals unspecified. edit-then-accept not machine-parseable.
- **MEM-03** — Missing/contradicted. Requirement says "capped at 5-10 items." D-32 says "10 default, --max N, --all bypasses." That is a default with escape hatches, not a cap.

**4. Scope Gaps**

- `/reroute` — Not adequately specified. No decision defines: whether Stage 0 reruns, whether templates/wikilinks rerun, source file handling (update/move/copy), status transitions, or whether rerouting a LEFT proposal can cause a direct LEFT write.
- `/promote-unrouted` — Essentially unspecified. No decision defines: target-path validation, classification bypass, LEFT write possibility, ingress filter rerun, template/wikilink application, or dead-letter lifecycle after promotion.
- `/today` modifications — Missing required detail. Only D-38 mentions /today. Memory proposals pending count (in-scope) has no decisions defining source, status filter, format, or warning threshold.
- `/wrap` integration — Not fully specified. D-44-46 define reading/chunking but not: hook stdin payload schema, absent/unreadable transcript handling, whether extraction failure blocks /wrap, source-ref formation, or dedup across /wrap and daily sweep.

**5. Ranked Fix List**

| Rank | Issue | Decisions |
|------|-------|-----------|
| CRITICAL | Resolve LEFT routing semantics — classifier outputs LEFT dir path but runtime writes to proposals/ | D-02, D-12 |
| CRITICAL | Resolve blocked-content write contradiction — "never lose captures" vs "exit immediately on BLOCK" | D-35, D-41 |
| CRITICAL | Fix failure-mode taxonomy — `non-interactive-ambiguous` used but not defined | D-03, D-36 |
| CRITICAL | Specify `/promote-unrouted` — in scope with zero decision coverage | In-Scope list |
| CRITICAL | Define memory-proposals.md item schema and source-attribution fields | D-21-27, D-30-31, D-44-46 |
| HIGH | Define Stage 1 voice-authenticity rule and mixed-content handling | D-02 |
| HIGH | Align D-32 with MEM-03 — `--all` bypass contradicts "capped at 5-10" | D-32, MEM-03 |
| HIGH | Specify `/reroute` lifecycle — reprocessing stages, file movement, status transitions | In-Scope list |
| HIGH | Complete `/today` spec — pending memory proposals count not specified | D-38 |
| HIGH | Complete `/wrap` hook contract — stdin schema, failure behavior, dedup control | D-44-46 |
| MEDIUM | Fill note/file schema gaps — frontmatter fields, filenames, timestamps, memory entry fields | D-07-11, D-13, D-28-31 |
| MEDIUM | Fill wikilink/index details — index shape, ranking, delivery surface | D-17-20 |
| MEDIUM | Define scheduler/retry/config behavior — operational contracts | D-21, D-37, D-48, D-49 |
| LOW | Define logging schema and retention | D-06 |

---

## Claude (Host Session) Review

Independent analysis from the orchestrating Claude session, reviewing the same 50 decisions against the same 5 dimensions.

**1. Under-Specified Decisions**

Codex identified the major gaps. Additional under-specifications not covered above:

- `D-14` — "Daily note handling: if classifier picks Daily, suggested-left-path defaults to Daily/{today}.md" — does not define the date format in the filename (ISO? locale?), or what happens when the user's Daily note uses a non-standard naming convention. Also unclear: does the existing Daily note's content get read to avoid duplicate appends?
- `D-16` vs archive policy — "Auto-archive after 14 days" runs on what trigger? A cron job? At /new invocation time? At /reroute time? The 14-day clock needs an owner.
- `D-22` — Seven categories are listed but the distinction between LEARNING and PATTERN is not defined. Example: "I discovered that chokidar handles symlinks differently than fs.watch" — is that a LEARNING or a PATTERN? Without boundary definitions inline (D-23 delegates to config), the extractor prompt has no guidance in the CONTEXT itself.
- `D-33` — "content-hash check against memory.md + memory-archive/*.md" — for a file that could be 200KB+, this implies parsing all of memory.md on every promotion. No indexing or caching strategy is defined for dedup lookups.
- `D-39` — "Enrichment failures never block the primary write path" — correct principle, but doesn't define whether failed enrichment is logged, retried later, or permanently skipped. A note written without wikilinks today never gets them unless manually re-processed.

**2. Contradictions**

Codex found the three main contradictions. One additional tension:

- `D-32` vs `MEM-03` — This is more than "thin traceability." D-32's `--all` flag directly contradicts MEM-03's "capped at 5-10 items." The requirement says capped; the decision says bypassable. This needs a resolution: either MEM-03 is amended to "default 10, overridable" or D-32 drops `--all`.
- `D-07` vs `D-29` — D-07 defines base note format with "YAML frontmatter + raw input body." D-29 defines memory.md entry format with "inline Dataview fields per entry." These are different metadata strategies (YAML frontmatter vs inline `field:: value`). The reason is sound (multiple entries per file), but the CONTEXT never explicitly states this divergence or when each applies. A developer implementing both could assume consistency and get it wrong.

**3. Thin Traceability**

Concur with Codex's assessment. One amplification:

- **MEM-01** source attribution — The requirement explicitly says "source attribution (session ID, date, source file)." None of D-21 through D-27 define what a session ID is, how it's obtained, or whether it maps to Claude Code's internal session_id from hook stdin. This is a concrete gap: the requirement names three specific fields and the decisions define zero of them.

**4. Scope Gaps**

Concur fully with Codex. Additional gap:

- **Vault directory creation** — In-Scope lists 5 new vault directories (proposals/unrouted/, proposals/left-proposals/, etc.). No decision defines who creates these directories, whether they're created on first use or at install time, or whether vault-gateway needs to be updated to recognize them as valid RIGHT-side paths. Phase 1's vault-paths.json would need updating, but D-43 says "Phase 2 does not modify its internals."
- **memory-proposals.md lifecycle** — The file is central to MEM-01 and MEM-02 but no decision defines: where it lives (vault path), whether it's a single file or per-month, what happens when it grows large, or how concurrent /wrap + /extract-memories writes are handled.

**5. Ranked Fix List (Additive to Codex)**

| Rank | Issue | Decisions |
|------|-------|-----------|
| CRITICAL | Define memory-proposals.md location, format, and lifecycle | D-21-27, D-30-31 |
| HIGH | Resolve D-07 vs D-29 metadata strategy divergence (YAML frontmatter vs inline fields) | D-07, D-29 |
| HIGH | Define vault directory creation and vault-paths.json update strategy | D-43, In-Scope |
| HIGH | Define MEM-01 source-attribution fields (session ID, date, source file) concretely | D-21-27, MEM-01 |
| MEDIUM | Define D-14 daily note date format and duplicate-append prevention | D-14 |
| MEDIUM | Define D-16 archive trigger ownership (cron vs on-demand vs piggyback) | D-16 |
| MEDIUM | Define D-33 dedup performance strategy for large memory.md | D-33 |
| LOW | Clarify D-22 category boundaries (LEARNING vs PATTERN) inline or by reference | D-22 |
| LOW | Define D-39 enrichment failure logging and whether retry is ever attempted | D-39 |

---

## Consensus Summary

### Agreed Concerns (raised by both reviewers)

1. **CRITICAL: LEFT routing semantic gap (D-02 vs D-12)** — Both reviewers flag that the classifier declares a LEFT directory path output that is never used, because D-12 routes all LEFT content to proposals/. This is the #1 implementation risk.

2. **CRITICAL: Blocked-content contradiction (D-35 vs D-41)** — Both identify the tension between "never lose captures" and "exit immediately on BLOCK." The INPUT-03 requirement ("never reaches disk") demands D-41 wins, but D-35 needs scoping language.

3. **CRITICAL: Failure-mode taxonomy incomplete (D-03 vs D-36)** — Both flag `non-interactive-ambiguous` as used but undefined.

4. **CRITICAL: /promote-unrouted is unspecified** — Both identify this as an in-scope command with zero decision coverage.

5. **CRITICAL: memory-proposals.md schema missing** — Both flag that the central artifact of MEM-01 and MEM-02 has no defined format, location, or source-attribution fields.

6. **HIGH: Voice-authenticity rule undefined (D-02)** — Both note the most important classifier rule has no decision-level specification.

7. **HIGH: D-32 vs MEM-03 cap contradiction** — Both identify `--all` bypass as contradicting the 5-10 item cap requirement.

8. **HIGH: /reroute under-specified** — Both flag missing lifecycle, reprocessing stages, and file movement rules.

9. **HIGH: /wrap hook contract incomplete** — Both identify missing stdin schema, failure behavior, and dedup control.

10. **HIGH: /today modifications under-specified** — Both note memory-proposal pending count has no decisions.

### Divergent Views

- **Vault directory creation**: Only Claude-host flagged this as a gap (who creates proposals/unrouted/ etc., and how vault-paths.json gets updated given D-43's phase boundary constraint).
- **D-07 vs D-29 metadata strategy**: Only Claude-host flagged the YAML-frontmatter vs inline-fields divergence as a potential implementation trap.
- **D-33 dedup performance**: Only Claude-host raised concerns about parsing 200KB+ memory.md on every promotion without an index.

### Gate Recommendation

**BLOCK** — Do not proceed to `/gsd:plan-phase 2` until the 5 CRITICAL items are resolved. The 7 HIGH items can be resolved during planning but should not be deferred to implementation.

### Minimum Fixes Before Planning

1. Amend D-02 to acknowledge Stage 2 LEFT output is advisory (suggested-left-path), not a write target
2. Scope D-35 to exclude Stage 0 BLOCK results — those are intentional rejections, not lost captures
3. Add `non-interactive-ambiguous` to D-36 taxonomy
4. Add decisions for `/promote-unrouted` (at minimum: target validation, ingress re-check, LEFT write rules)
5. Define memory-proposals.md: vault path, item schema, source-attribution fields (session_id, date, source_file)

---

*Reviewed: 2026-04-22*
*Reviewers: Codex (OpenAI), Claude Host Session (Anthropic)*
*Gemini: unavailable (auth scope 403)*

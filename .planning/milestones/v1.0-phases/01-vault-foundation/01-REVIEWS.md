---
phase: 1
reviewers: [codex, claude]
reviewed_at: "2026-04-22T00:35:00.000Z"
review_round: 2
plans_reviewed: [01-01-PLAN.md, 01-02-PLAN.md]
note: "Round 2 review of revised plans (post-revision from round 1 Codex feedback). Gemini failed on auth (token file corrupted)."
---

# Cross-AI Plan Review — Phase 1 (Round 2)

> Plans were revised after round 1 Codex review to address 5 HIGH concerns: path security hardened with canonical resolution, quarantine made metadata-only, content sanitization path added, minimal-context Haiku windows, createVaultWriter() enforcement wrapper, policy/IO module separation. This round 2 review evaluates the revised plans.

## Codex Review (Round 2)

### Overall Take

These two plans are directionally strong and mostly aligned with the phase goal: establish a hard write boundary first, then add content and style policy on top. The sequencing is sensible, and the security posture is better than average for a phase-1 plan. The main weaknesses are a few implementation-level gaps that could undermine the guarantees if left unspecified: case-insensitive filesystem handling, non-existent-path symlink checks, proof that *all* write paths actually use the gateway, and some fragility in the proposed sanitization and style-guide parsing approach. Plan 01 is close to implementation-ready with a few security clarifications; Plan 02 has the right shape but carries materially higher product and correctness risk because classification accuracy and sanitization behavior are underdefined.

### Plan 01: Project skeleton, config files, write-gateway

#### Summary

This is a solid foundation plan with the right first-order priorities: centralize writes, enforce path-based permissions, and make the boundary config-driven rather than implied by folder placement. The security mindset is good, especially around traversal, absolute paths, and symlink escape prevention. The plan is slightly over-scoped for a first wave because it mixes core enforcement with hot reload, bootstrap automation, quarantine behavior, and wikilink helpers, but most of that is still reasonable. The biggest issues are a few hidden edge cases that matter a lot for a "mechanically enforced" boundary: `~` expansion, macOS case-insensitive path behavior, how symlink defense works for non-existent write targets, and the fact that the plan does not explicitly ensure LEFT directories are created or documented.

#### Strengths

- Centralizes all writes through `vaultWrite()`, which is the right architectural control point for VAULT-02.
- Uses config-driven left/right allowlists, matching D-01, D-04, and D-05 cleanly.
- Treats unknown paths as blocked for both read and write, which is the safest interpretation of the three-tier model.
- Includes explicit tests for traversal, absolute paths, and symlink escape attempts.
- Keeps blocked-content quarantine metadata-only, which strongly supports the "never reaches disk" goal.
- Separates read policy from write policy, which makes the LEFT read-only rule enforceable and testable.
- Includes qualified wikilink helpers, which is important if note names collide across LEFT and RIGHT.

#### Concerns

- **[HIGH] Case-insensitive filesystem bypass is not addressed.** On default macOS filesystems, `daily/foo.md` may resolve to `Daily/foo.md`; a first-segment string check alone is not enough to enforce LEFT/RIGHT safely.
- **[HIGH] Symlink defense for writes to non-existent files is underspecified.** `realpathSync` on the target path fails if the file does not exist, so the implementation must resolve and validate the nearest existing parent directory, not just the final target.
- **[HIGH] `VAULT_ROOT = ~/Claude Cowork/` is not a valid Node path literal.** `~` will not expand automatically; if implemented as written, the gateway may enforce against the wrong root or fail unpredictably.
- **[MEDIUM] Success criterion 1 requires LEFT and RIGHT directories to exist, but `bootstrapVault()` only creates `config.right`.** That leaves `Daily/`, `Relationships/`, and `Drafts/` unmanaged unless they already exist.
- **[MEDIUM] "Documented boundary definition" is not represented in the outputs.** The plan creates code and config, but not an explicit doc artifact.
- **[MEDIUM] `fs.watch` hot reload is platform-flaky and may be unnecessary in phase 1.** It increases complexity and test brittleness without changing the enforcement model.
- **[MEDIUM] Wikilink success is only partially covered by utility functions.** That proves formatting, not resolution behavior under duplicate basenames or cross-side references.
- **[LOW] Pulling in `@anthropic-ai/sdk` in Plan 01 is premature.** It is not needed until Plan 02 and slightly muddies the responsibility of this wave.

#### Suggestions

- Replace `~/Claude Cowork/` handling with `path.join(os.homedir(), 'Claude Cowork')` and test it explicitly.
- Define path authorization against a canonical, real filesystem path, not just the submitted relative string.
- Add explicit handling for case-insensitive filesystems: resolve the actual on-disk parent path with `realpath`, compare canonical relative paths against allowed roots, reject ambiguous casing if needed.
- Change symlink defense to validate every existing ancestor directory before file creation, not only the final path.
- Either create both LEFT and RIGHT directories from config or split behavior clearly: create RIGHT automatically, validate LEFT exists and fail bootstrap if missing.
- Add a small documentation artifact such as `docs/vault-boundary.md` or update `CONTEXT.md` with the enforced rule and configured roots.
- Reduce scope by deferring hot reload unless there is a real runtime need; a simple reload-on-call or startup-load may be enough for phase 1.
- Add tests for basename collisions and qualified wikilinks, not just raw helper output.
- Add an audit task to identify existing write points and confirm they are all routed through `vaultWrite()`.

#### Risk Assessment

**MEDIUM** — The plan is fundamentally sound and likely to achieve VAULT-01 and VAULT-02 if implemented carefully, but the remaining security edge cases are important enough that getting them wrong would invalidate the "mechanically enforced boundary" claim. Most of the risk is concentrated in path canonicalization details, not the overall design.

---

### Plan 02: Content filter (two-stage with Haiku), style lint, keyword expansion

#### Summary

This plan has the right overall decomposition: a dedicated content policy module, a dedicated style policy module, and integration back into the gateway. The three-gate ordering is mostly correct, and the attempt to minimize classifier exposure by sending only local context windows is a strong privacy instinct. That said, this plan carries more product risk than Plan 01 because the hardest parts are semantic: distinguishing disallowed employer/client content from allowed career narrative, deciding whether sanitized content is still useful, and ensuring every writing agent actually receives the style guide. The design is viable, but several thresholds and interfaces are too implicit for something that is supposed to be a hard gate.

#### Strengths

- Separates content policy from style policy, which keeps the gateway simpler and easier to test.
- Preserves the right gate order: path enforcement before any content handling.
- Uses a fast keyword scan before model classification, which is good for latency and cost.
- Defaults Haiku timeout/unavailability to block, which matches D-08 and avoids silent bypass.
- Limits model exposure to small matched-context windows rather than full note payloads.
- Keeps style lint lightweight and deterministic with regex-only checks.
- Adds `createVaultWriter()` to push style-guide injection upstream into generation time, not only post-write.
- Expands excluded terms into config, which keeps the policy data-driven.

#### Concerns

- **[HIGH] The sanitization approach is fragile.** "Replace sentences containing excluded terms" breaks down on bullets, headings, tables, fragments, transcripts, and notes without reliable sentence boundaries.
- **[HIGH] The `>50% retained` rule is arbitrary and may produce low-value or misleading notes.** A note can retain 60% of characters while losing the meaning-bearing parts, or be quarantined even when a clean salvageable summary remains.
- **[HIGH] Minimal 100-character windows may not preserve enough context for D-07.** Distinguishing "blocked employer/client content" from "allowed career narrative or neutral mention" may require sentence-level or paragraph-level context around the term.
- **[HIGH] `createVaultWriter()` does not guarantee all generators use it.** The requirement says the style guide must be loaded into every agent prompt producing vault content; a helper alone is not enforcement.
- **[MEDIUM] `attemptCount` being mandatory but caller-managed creates coordination risk.** Different callers may pass inconsistent values and accidentally skip the intended reject/regenerate/quarantine flow.
- **[MEDIUM] Parsing banned words from a markdown table is brittle.** A formatting change in the style guide could silently alter enforcement.
- **[MEDIUM] The plan does not fully specify how Haiku calls are mocked and timed out in tests.** This is testable, but only if the client and timeout mechanism are injectable.
- **[MEDIUM] "Sanitize when BLOCKs, else quarantine" weakens the phase statement that excluded content is stripped before any write completes.** If sanitized output still leaks structure or adjacent sensitive context, the guarantee becomes fuzzy.
- **[LOW] Keyword expansion is left as a human checkpoint, which may delay completion of the actual enforcement set for the phase.
- **[LOW] Style lint based only on banned words may under-catch obvious AI phrasing unless the banned list is maintained aggressively.

#### Suggestions

- Redefine sanitization at the block or line level, not sentence level: redact the entire matched line/bullet/paragraph block, preserve surrounding structure where safe, return both `sanitized` and a machine-readable redaction report.
- Replace the `>50% retained` heuristic with a clearer policy: allow sanitized write only when all matched blocks were fully removed and the remaining content still passes lint; otherwise quarantine.
- Increase classifier context from raw 100-char windows to bounded semantic windows, such as: full sentence containing the match, preceding/following sentence if available, capped total token budget across all windows.
- Add an explicit `UNCERTAIN` outcome from Haiku and treat it as `BLOCK` or quarantine, rather than forcing a binary judgment from weak context.
- Make the Anthropic client injectable and wrap timeout behavior in a testable adapter so unit tests can deterministically simulate PASS, ALLOW, BLOCK, timeout, and service unavailable.
- Move banned-word definitions to a machine-readable file or frontmatter section, and treat markdown extraction as a convenience layer rather than the source of truth.
- Tighten the agent-writing contract so direct content generation cannot bypass prompt injection: centralize generation through `createVaultWriter()`, or require a writer token/metadata proving a prompt wrapper was used.
- Consider having the gateway own retry state for style violations, or at least formalize a `generationAttempt` field in a shared interface used by all callers.
- Add integration tests for the full three-gate pipeline with representative edge cases: neutral career narrative mentioning a blocked term, tool comparison note mentioning Asana generically, mixed-content note with both safe and blocked sections, style violation after successful content filtering, timeout path to proposals quarantine.
- Explicitly verify that every known write entry point (`/new`, `/today`, promotions) routes through the updated gateway, not just that the gateway itself behaves correctly.

#### Risk Assessment

**HIGH** — The structure is good, but the correctness of the phase outcome depends on semantic classification, salvage logic, and caller discipline. Those are exactly the areas where the plan is least crisp. It can succeed, but only if the interfaces and fallback rules are tightened before implementation.

---

## Gemini Review

**Status: FAILED** — Token file corrupted / insufficient authentication scopes. Gemini CLI needs re-authentication. Run `gemini` interactively to re-auth.

---

## Claude Review (Round 2)

**Reviewer:** Claude Opus 4.6 (independent session)

### Plan 01-01: Project Skeleton, Config, Write-Gateway

#### Summary

A strong foundation plan that correctly prioritizes the write-permission boundary as the first thing built. The canonical path security model (5-step normalizePath) is thorough, the metadata-only quarantine cleanly solves the "excluded content never reaches disk" constraint, and the config-driven bootstrap avoids the hardcoding trap. The Codex revisions were well-integrated. Remaining concerns are edge-case-level, not structural.

#### Strengths

- Canonical path enforcement is layered correctly -- absolute rejection, normalize, traversal check, resolve-against-root, symlink defense. Each layer catches what the previous might miss.
- Quarantine redesign is clean -- removing the content parameter entirely from quarantine() is the strongest possible guarantee.
- Config-driven bootstrap -- reading from config.right instead of a hardcoded array means config and runtime can't drift.
- Three-tier read model -- vaultRead() blocking unknown paths (not just LEFT/RIGHT) matches D-04 exactly.
- Config validation with fail-closed -- invalid config throws at startup rather than silently using broken data.
- 11 test groups covering the right surface area.

#### Concerns

- **[MEDIUM] Case-insensitive filesystem vs. case-sensitive allowlist.** macOS APFS defaults to case-insensitive (case-preserving) on consumer installs. The plan comments say APFS is case-sensitive, which is factually wrong. The behavior is fail-safe (false blocks, never false allows), but the comment could mislead maintainers.
- **[MEDIUM] No overlap validation between LEFT and RIGHT config arrays.** A misconfigured vault-paths.json with an entry in both lists creates ambiguous behavior. Add a validation rule: left and right must have no intersection.
- **[LOW] Root-level file writes silently blocked.** `vaultWrite('notes.md', content)` blocks because the first segment matches nothing. This is correct per D-04 but could use a more specific error message.
- **[LOW] TOCTOU race in symlink check.** Negligible in single-user context but worth documenting.
- **[LOW] fs.watch rename events.** Some editors write to temp files and rename. The watcher should handle both `change` and `rename` events.

#### Suggestions

- Add a test for case-variant paths: `checkPath('Memory/note.md', config)` returns BLOCK.
- Add config validation: reject configs where LEFT and RIGHT arrays intersect.
- Consider making VAULT_ROOT overridable via environment variable for integration testing.
- Document that fs.watch handles both change and rename events.

#### Risk Assessment

**LOW** -- Well-hardened after Codex revision cycle. Remaining concerns are edge cases that are either fail-safe or negligible. Core security model is sound.

---

### Plan 01-02: Content Filter, Style Lint, Keyword Expansion

#### Summary

Tackles harder problems: privacy-preserving LLM classification, content sanitization, and style enforcement. Module separation is clean. Minimal-context Haiku approach is a smart privacy/accuracy tradeoff. Primary concerns are sanitization approach (mechanical stripping vs. semantic classification mismatch) and 100-char context sufficiency.

#### Strengths

- Module separation is the right call -- content-policy.js and style-policy.js as separate modules.
- Privacy-preserving Haiku classification -- 100-char context windows cap data exposure at ~750 chars.
- Sanitization path meets VAULT-03 -- attempting sentence-level stripping before full quarantine.
- 50% threshold provides a clear, mechanical decision point.
- createVaultWriter as enforcement wrapper -- returns both write function and system prompt prefix.
- Fail-closed on Haiku errors -- timeout, API down, malformed response all BLOCK.
- Regex escaping for config-supplied terms prevents a class of bugs.

#### Concerns

- **[HIGH] Mechanical sanitization can leak contextual confidential information.** Haiku's classification is semantic; sanitization is mechanical. Example: "The routing architecture at Genesys handles 50,000 concurrent sessions. Each session uses a proprietary load-balancing algorithm." Sentence 1 stripped (contains keyword), sentence 2 retained -- still confidential. **Recommendation:** Lower threshold to 30%, or strip entire paragraph containing match, or add "contamination radius" stripping N adjacent sentences.
- **[MEDIUM] 100-character context window may be insufficient for classification accuracy.** Ambiguous career narratives describing responsibilities near a keyword may not have enough context for accurate BLOCK/ALLOW.  **Recommendation:** Make window size configurable, default 100.
- **[MEDIUM] options.attemptCount ?? 0 creates API discrepancy.** vaultWrite defaults it (lenient), checkStyle requires it (strict). Document the two contracts explicitly.
- **[MEDIUM] Sentence boundary detection is fragile.** Abbreviations ("Dr. Smith at Genesys"), bullet points without sentence-ending punctuation, markdown code blocks.
- **[LOW] Style guide hot-reload reads from LEFT side.** If save is non-atomic, watcher may read partial file. extractBannedWords should handle gracefully.
- **[LOW] escapeRegex import creates style-policy -> content-policy coupling.** Duplicate the one-liner or extract to src/utils.js.

#### Suggestions

- Consider "contamination radius" in sanitization: also strip preceding/following sentences in same paragraph.
- Make Haiku context window size configurable.
- Add Haiku system prompt example for ambiguous career narrative case.
- Extract escapeRegex to src/utils.js.
- Add test for sanitization at exactly 50% threshold boundary condition.
- Add test for abbreviation-laden text.

#### Risk Assessment

**MEDIUM** -- Architecturally sound, Codex revisions substantially improved it. Content sanitization concern (HIGH) is the most significant remaining issue. Haiku context window is tunable. Everything else is LOW risk.

---

### Cross-Plan Analysis

**Three-gate pipeline ordering is correct and optimal:** path (sync, ~0ms) -> content (async, 0ms common case) -> style (sync, <10ms). Minimizes latency for common case.

**Phase goal achievement:**

| Goal | Verdict |
|------|---------|
| LEFT/RIGHT directories exist with documented boundary | MET |
| All writes through single gateway | MET |
| Excluded content stripped before write | MOSTLY MET (sanitization concern) |
| Agent content reflects anti-AI style guide | MET (convention-based) |
| Wikilinks resolve between LEFT and RIGHT | MET |

**Missing from both plans:** No integration test against real filesystem (all tests mock fs). No documentation of [REDACTED] marker behavior. No CONTRIBUTING.md explaining createVaultWriter convention.

**Overall Claude risk assessment: LOW-MEDIUM**

---

## Cross-Plan Risks (Codex)

### Key Gaps Across Both Plans

- **Enforcement proof gap:** Neither plan explicitly includes an audit/migration step proving that all existing write paths use the gateway.
- **Documentation gap:** Phase success includes a documented boundary definition, but neither plan clearly delivers it.
- **Collision/resolution gap:** XREF-01 is only partially satisfied unless duplicate-note-name behavior is tested and a qualified-link rule is defined.
- **Operational observability gap:** There is no mention of structured logging or metrics for blocked writes, quarantines, timeouts, and style violations, which will matter during rollout.
- **Config integrity gap:** Hot-reload plus dynamic policy files implies the need for invalid-config behavior; the plans should say whether the gateway fails closed on malformed config.

### Cross-Plan Recommendation

- Add a thin "policy contract" doc and one integration test suite that exercises: path check, content filter, sanitization/quarantine, style lint, final write/quarantine result.
- Treat malformed config, missing style guide, and classifier failure as fail-closed states.
- Add a rollout-safe audit log for decisions made by the gateway, with no blocked content payload stored.

---

## Consensus Summary (Codex + Claude)

### Round 2 vs Round 1 Delta

**Resolved from Round 1 (both reviewers confirm):**
- Path security hardened with 5-step canonical resolution (was HIGH)
- Quarantine is now metadata-only, no blocked content to disk (was HIGH)
- Content sanitization path added alongside block (was HIGH)
- Privacy-preserving minimal context windows for Haiku (was HIGH)
- createVaultWriter() added for VAULT-04 enforcement (was HIGH)
- Policy/IO module separation (was MEDIUM)
- Bootstrap derives from config, not hardcoded list (was MEDIUM)
- attemptCount is explicit caller contract (was MEDIUM)

### Agreed Strengths (raised by both reviewers)

- 5-step canonical path security is defense-in-depth done right
- Metadata-only quarantine is the strongest possible "never reaches disk" guarantee
- Config-driven bootstrap prevents config/code drift
- Three-tier access model (LEFT read-only, RIGHT read-write, unknown blocked) is correct
- Fail-closed on Haiku errors matches D-08
- Module separation (content-policy.js, style-policy.js) keeps gateway clean
- Three-gate ordering (path -> content -> style) is optimal for latency

### Agreed Concerns (raised by both reviewers)

#### HIGH (1 item)
1. **Sanitization can leak contextual confidential information** -- mechanical sentence-level stripping misses adjacent sensitive content that Haiku correctly classified as BLOCK. Both reviewers independently identified the same failure mode: keyword-containing sentence stripped but surrounding confidential context retained. (Codex: "fragile", Claude: "leak contextual confidential information")

#### MEDIUM (3 items)
1. **Case-insensitive filesystem interaction** -- both reviewers flagged macOS APFS case-insensitive behavior. Codex: "bypass risk". Claude: "fail-safe but factually wrong comment."
2. **100-char context windows may be insufficient** for accurate D-07 classification. Both suggest larger or configurable windows.
3. **Sentence boundary detection is fragile** -- abbreviations, bullets, headings, code blocks. Both agree this is a known limitation.

### Divergent Views

| Topic | Codex | Claude |
|-------|-------|--------|
| **Plan 01 risk** | MEDIUM (security edge cases could invalidate boundary) | LOW (edge cases are fail-safe or negligible) |
| **Plan 02 risk** | HIGH (classification accuracy and sanitization underdefined) | MEDIUM (sanitization is the main issue, rest is tunable) |
| **Case sensitivity severity** | HIGH (bypass risk) | MEDIUM (fail-safe, but misleading comment) |
| **>50% threshold** | HIGH (arbitrary, may produce misleading notes) | Acceptable (clear mechanical decision point) |
| **createVaultWriter enforcement** | HIGH (helper alone is not enforcement) | MET (convention-based, acceptable for v1) |
| **Config overlap validation** | Not mentioned | MEDIUM (LEFT/RIGHT intersection creates ambiguity) |
| **fs.watch rename events** | Not mentioned | LOW (some editors trigger rename, not change) |
| **escapeRegex import coupling** | Not mentioned | LOW (extract to utils.js) |
| **Observability/logging** | Flagged (no audit log) | Not flagged |
| **Documentation artifact** | Flagged (boundary doc missing) | Not flagged |

### Recommendations for Replanning

**Must address before execution:**
1. **Sanitization**: Add "contamination radius" (strip adjacent sentences in same paragraph) or lower threshold to 30%, or both. This is the only agreed-upon HIGH concern.

**Should address (improve robustness):**
2. **Case sensitivity**: Add comment clarifying fail-safe behavior on case-insensitive FS. Add test for case-variant paths confirming BLOCK.
3. **Config validation**: Reject configs where LEFT and RIGHT arrays intersect.
4. **Haiku context**: Make window size configurable (default 100, stored in config).
5. **escapeRegex**: Extract to `src/utils.js` to avoid policy module coupling.

**Consider for v1 (nice-to-have):**
6. **VAULT_ROOT overridable via env var** for integration testing
7. **One real-filesystem integration test** (write to temp dir instead of mocking fs)
8. **Document [REDACTED] marker behavior** in sanitized notes
9. **Audit log** for gateway decisions (blocked, quarantined, sanitized, written)

---

*Round 1 review: 2026-04-21 (Codex only, pre-revision)*
*Round 2 review: 2026-04-21 (Codex + Claude, post-revision)*
*To incorporate: `/gsd:plan-phase 1 --reviews`*

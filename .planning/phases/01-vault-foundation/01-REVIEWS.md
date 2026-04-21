---
phase: 1
reviewers: [codex]
reviewed_at: "2026-04-21T22:30:00.000Z"
plans_reviewed: [01-01-PLAN.md, 01-02-PLAN.md]
---

# Cross-AI Plan Review — Phase 1

## Codex Review

### Plan 01-01

#### Summary
Plan 01-01 is a solid foundation plan: it centralizes vault access early, matches the locked decision to enforce the boundary by root-folder allowlist rather than wrapper folders, and includes a sensible test bundle. The main weaknesses are around boundary hardening and requirement coverage: the proposed path validation is not strong enough for a true write-permission boundary, the quarantine design may conflict with "excluded content never reaches disk," and `toWikilink()` by itself does not guarantee cross-side wikilink resolution in real Obsidian usage.

#### Strengths
- Centralizes writes behind `vaultWrite()`, which strongly supports `VAULT-02`.
- Uses config-driven LEFT/RIGHT allowlists, which fits `D-01` and `D-04`.
- Includes explicit read tiers (`LEFT`, `RIGHT`, unknown blocked), which matches the access model well.
- Adds a typed error (`VaultWriteError.code`), which is useful for callers and future policy enforcement.
- Includes tests for traversal, access control, quarantine, bootstrap, and wikilinks, which is the right instinct for a boundary module.

#### Concerns
- **HIGH**: `path.normalize()` plus `..` rejection is not enough to enforce the boundary; absolute paths, symlink escapes, case-insensitive path issues, and canonicalization gaps can still bypass a naive allowlist.
- **HIGH**: `toWikilink()` does not fully satisfy `XREF-01`; `[[noteName]]` becomes ambiguous if the same note name exists in multiple root folders, so links may not resolve predictably.
- **HIGH**: `quarantine()` writing into `proposals/quarantine-{timestamp}.md` may violate the phase goal that excluded content never reaches disk, especially if raw blocked content is stored there.
- **MEDIUM**: `bootstrapVault()` only mentions creating RIGHT-side directories; `VAULT-01` also needs the LEFT/RIGHT boundary to be clearly defined and documented, not just writable folders created.
- **MEDIUM**: Hardcoding "9 RIGHT-side directories" is brittle and may drift from the allowlist config over time.
- **MEDIUM**: `fs.watch` hot-reload adds complexity and nondeterminism for a phase whose main goal is enforcement, not dynamic config management.
- **LOW**: Pulling in `@anthropic-ai/sdk` during Wave 1 expands scope before it is needed for this plan's stated requirements.

#### Suggestions
- Replace simple normalization with canonical path enforcement: resolve against the vault root, reject absolute paths, and verify the final real path remains inside the vault.
- Add explicit config/schema validation so invalid LEFT/RIGHT allowlists fail closed at startup and on reload.
- Make wikilink generation path-aware, not just note-name-based; include duplicate-title tests and prefer `[[Folder/Note]]` when needed.
- Make quarantine metadata-only, redacted, or outside the vault if the project truly requires excluded content to never land on disk.
- Derive bootstrap directories from config instead of hardcoding a fixed folder list.
- Treat hot-reload as optional unless there is a confirmed long-running daemon requirement in this phase.
- Add tests for symlink traversal, absolute path input, case-variant folder names, config reload failure, and duplicate note-name linking.

#### Risk Assessment
**MEDIUM** — The plan is pointed in the right direction and could become a strong Phase 1 base, but the current path-security model and wikilink strategy are not yet strong enough for the project's core boundary guarantees.

---

### Plan 01-02

#### Summary
Plan 01-02 aims at the right controls for `VAULT-03` and `VAULT-04`, but it currently under-specifies the hardest parts: how excluded content is actually stripped rather than merely detected, how prompt injection is enforced across all generators, and how privacy is preserved when sending content to Haiku. It also places a lot of policy, model IO, retry semantics, and style enforcement into one gateway module, which raises complexity and operational risk for a phase that should stay mechanically reliable.

#### Strengths
- Correctly follows the locked two-stage filter design from `D-06`.
- Uses fail-closed timeout handling, which aligns with `D-08`.
- Keeps post-write style lint regex-based and fast, which matches `D-13`.
- Exposes a reusable `getStyleGuideForPrompt()` concept, which is a good building block for `VAULT-04`.
- Includes a checkpoint before broadening excluded terms, which is a good control against accidental overreach.

#### Concerns
- **HIGH**: The plan describes `BLOCK/ALLOW` classification, but `VAULT-03` requires excluded content to be stripped before write; detection alone does not meet the requirement.
- **HIGH**: Sending full note content to Haiku may violate the "minimum viable permission" constraint by exposing more vault content than necessary to an external model.
- **HIGH**: `getStyleGuideForPrompt()` does not ensure every vault-writing prompt actually uses it; without a shared generation wrapper, `VAULT-04` is only partially addressed.
- **HIGH**: `attemptCount` inside `checkStyle()` is underspecified; the gateway cannot reliably know whether this is a first or second generation attempt unless the caller provides that state.
- **MEDIUM**: Quarantine on timeout/unavailable can still write sensitive or excluded content to disk unless the quarantine payload is redacted.
- **MEDIUM**: A fixed 2s timeout may satisfy fail-closed behavior but could create frequent false blocks in normal degraded conditions.
- **MEDIUM**: Adding another `fs.watch` hot-reload path for the style guide compounds complexity in a module already doing network calls and write enforcement.
- **LOW**: Expanding terms from 3 to 15-20 entries is helpful, but the plan does not mention normalization, aliases, or pattern variants, so coverage may still be weaker than expected.

#### Suggestions
- Separate policy from IO: use small modules like `contentPolicy`, `stylePolicy`, `classifierClient`, and keep `vaultWrite()` as the orchestrator.
- Add an explicit sanitization/redaction step so blocked references are removed before write when possible, with hard-block only for uncertain cases.
- Send only minimal context windows around matched keywords to Haiku, not full document bodies.
- Enforce style-guide injection via a shared prompt-builder or agent client used by every vault-writing workflow.
- Make retry state explicit in the API, e.g. caller passes `attemptNumber` and receives structured violation details.
- Define strict classifier output handling: malformed output, timeout, and SDK errors should all fail closed with distinct error codes.
- Add tests for timeout, malformed classifier responses, style-guide parse failures, redacted quarantine behavior, and mixed allowed/blocked content that should be partially stripped.

#### Risk Assessment
**HIGH** — The plan targets the right requirements, but as written it risks missing both `VAULT-03` and `VAULT-04` in practice, while also introducing privacy and reliability concerns on the write path.

---

## Cross-Plan Notes

- The biggest unresolved issue across both plans is **quarantine semantics**: if blocked content is quarantined inside the vault or in raw form, that appears to conflict with the phase goal that excluded content never reaches disk.
- The second biggest gap is **mechanical enforcement of prompt injection**: loading a style guide is not the same as guaranteeing every generator uses it.
- The plans would be stronger with a clear **error contract** for callers: path denied, unknown path, content blocked, content redacted, style reject, classifier timeout, quarantine required.
- Both plans should explicitly define whether the system **blocks entire writes** or **writes sanitized content**, because that choice materially affects whether the phase success criteria are actually met.

---

## Consensus Summary

*Single reviewer (Codex) — consensus analysis not applicable.*

### Key Concerns (by severity)

**HIGH (5 items):**
1. Path security: `path.normalize()` + `..` rejection insufficient — needs canonical path resolution, absolute path rejection, symlink checks
2. Quarantine semantics conflict: writing blocked content to `proposals/` may violate "excluded content never reaches disk" goal
3. Content filter detects but doesn't strip — VAULT-03 requires stripping, not just blocking
4. Privacy: sending full note content to Haiku exposes more vault data than necessary
5. VAULT-04 partially addressed — `getStyleGuideForPrompt()` exists but nothing enforces its use by all generators

**MEDIUM (5 items):**
1. Quarantine payload should be redacted, not raw blocked content
2. Bootstrap hardcodes 9 directories instead of deriving from config
3. 2s Haiku timeout may cause frequent false blocks
4. `attemptCount` state management underspecified
5. Multiple `fs.watch` instances add complexity

**LOW (2 items):**
1. @anthropic-ai/sdk pulled in Wave 1 before needed
2. Keyword expansion lacks normalization/alias handling

### Recommendations for Replanning
- Address quarantine semantics: decide if quarantine stores redacted metadata or full content, and whether quarantine directory is inside or outside the vault
- Strengthen path security with canonical resolution
- Add content sanitization path alongside block path
- Minimize data sent to Haiku classifier
- Consider module separation (policy vs IO vs orchestration)

---

*Reviewed: 2026-04-21 by Codex*
*To incorporate: `/gsd:plan-phase 1 --reviews`*

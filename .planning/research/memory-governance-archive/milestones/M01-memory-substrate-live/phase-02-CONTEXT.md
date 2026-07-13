# Phase 02 — Context

**Phase name:** Substrate & Authority
**Phase state:** PHASE_DISCUSSING (stub — flesh out when phase-01 ships)

## Requirement

Create `~/memory` as a private git repo, install the authority hierarchy and lifecycle rules, and stand up the security gates **before a single transcript is ingested**. Nothing is migrated in this phase — only the container and the rules that govern it.

## Inputs to this phase

- `~/memory-audit/inventory.md` (phase-01) — determines the directory shape
- `reference/AUTHORITY.md` and `reference/LIFECYCLE.md` — installed verbatim
- `~/memory-audit/dupe-check.py` (phase-01) — becomes the X2 pre-commit gate

## Open questions

- Is `gitleaks` installed, or does it need `brew install gitleaks`?
- Should `~/memory` be symlinked into the Obsidian vault for browsing, or stay standalone? (Leaning standalone — the vault must not become a second writer.)
- Remote or local-only? Private remote gives backup; local-only removes all exfil risk. **Default to local-only until the scrubbing gate has survived 30 days of real capture.**

## Decisions made

| Question | Decision | Rationale |
|:---|:---|:---|
| Security gate timing | Before any ingestion, not after | Transcripts contain credentials and excluded-topic contamination. Building the pipe before the filter is how you get a finding during an active enterprise-deal certification. |
| Who writes to canon | The weekly pass only | Single-writer discipline eliminates merge conflicts across four concurrent Claude surfaces, by construction. |

## Success looks like

`gitleaks` blocks a deliberately-planted fake key. The exclusion grep blocks a deliberately-planted excluded term. `dupe-check.py` blocks a deliberately-duplicated fact. All three tested with real attempts, not assumed.

## Outputs

- `~/memory/` git repo, private, with `canon/ working/ ledger/ procedural/ _meta/`
- `_meta/AUTHORITY.md`, `_meta/LIFECYCLE.md`
- `.git/hooks/pre-commit` running: gitleaks + exclusion-grep + dupe-check
- Frontmatter schema validator

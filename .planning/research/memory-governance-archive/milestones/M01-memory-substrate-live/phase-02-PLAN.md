# Harness Memory Governance — Phase 02
# Substrate & Authority

**GSD lifecycle state:** PHASE_DISCUSSING (stub)
**Estimated build time:** 2–3 hours
**Flesh out:** when phase-01 ships, using `inventory.md` to finalize the directory shape

> **Stub.** Full runbook authored at PHASE_DISCUSSING per GSD lifecycle. Premature detail rots before execution.

## What you're building

The container and its rules. `~/memory` as a private git repo with the five-directory tier structure, the authority hierarchy and lifecycle rules installed verbatim from `reference/`, and three blocking pre-commit gates. No content moves yet — that's phase-03.

## Sections to author

- **Phase 0 — Pre-flight:** gitleaks install; local-only vs. private-remote decision; confirm the Obsidian vault is *not* wired as a second writer
- **2.1 — `git init`** the repo, private, with the tier skeleton
- **2.2 — Install `AUTHORITY.md` and `LIFECYCLE.md`** from `reference/` (they ship ready; do not rewrite them)
- **2.3 — Frontmatter schema + validator** (the 9-field block from LIFECYCLE.md)
- **2.4 — Pre-commit gate #1: gitleaks** — blocks secrets
- **2.5 — Pre-commit gate #2: exclusion-grep** — blocks the three permanently-excluded terms, sourced from `canon/exclusions.md`
- **2.6 — Pre-commit gate #3: `dupe-check.py`** — blocks cross-file duplication (rule X2)
- **2.7 — Adversarial gate test** — plant a fake AWS key, a real excluded term, and a duplicated sentence. All three commits must be **blocked**. A gate you haven't tried to defeat is a gate you don't have.

## Validation gates

| Gate | Pass criterion |
|:---|:---|
| Secret block | A planted `AKIA...` test key is rejected at commit |
| Exclusion block | A planted excluded term is rejected at commit |
| Dupe block | A deliberately duplicated statement is rejected at commit |
| Schema | Malformed frontmatter in `canon/` is rejected |
| Repo hygiene | `git log` shows atomic commits with real messages, not "wip" |

## Rollback

`rm -rf ~/memory`. Nothing outside it has been touched yet — phase-03 is where the machine changes.

# Phase 1: Vault Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 01-vault-foundation
**Areas discussed:** Vault directory layout, Ingress filter scope, Style guide enforcement

---

## Vault Directory Layout

### Question 1: How should the RIGHT side of the vault be organized?

| Option | Description | Selected |
|--------|-------------|----------|
| Functional groupings | Directories by purpose: Memory/, Briefings/, Captures/, Proposals/. Flat within each. | |
| Single flat directory | All agent output in one RIGHT/ directory. Simplest. | |
| Mirror LEFT structure | RIGHT directories mirror LEFT naming. | |
| Custom (user-provided) | No LEFT/RIGHT parent folders. Domain folders at vault root, write-gateway enforces by path allowlist. | ✓ |

**User's choice:** Custom — no parent wrapper folders. Domain folders at vault root. Detailed layout provided with 9 RIGHT directories and 4 LEFT directories. Write-gateway uses `config/vault-paths.json` with `{left: [...], right: [...]}` arrays.

**Notes:** User provided complete directory tree with purpose annotations for each folder. Emphasis on keeping Obsidian navigation flat.

### Question 2: Unknown path handling model?

| Option | Description | Selected |
|--------|-------------|----------|
| Block unknown (whitelist) | Only paths in 'right' array are writable. | |
| Allow unknown (blacklist) | Only paths in 'left' array are protected. | |
| Custom three-tier | Whitelist both sides. LEFT = read-only. RIGHT = read-write. Unknown = fully blocked. | ✓ |

**User's choice:** Three-tier access. LEFT paths: agent reads, never writes. RIGHT paths: agent reads and writes. Unknown paths: agent blocked entirely (no read, no write). `vault-paths.json` is the complete manifest of what the agent can see.

**Notes:** Tighter than the presented options. Agent cannot even read paths not explicitly listed in the config.

---

## Ingress Filter Scope

### Question 1: How aggressive should ISPN/Genesys/Asana filtering be?

| Option | Description | Selected |
|--------|-------------|----------|
| Keyword match — block the write | Any occurrence blocks entire write. Simple, aggressive. | |
| Keyword match — strip the sentence | Sentences with keywords removed; rest writes normally. | |
| Context-aware filtering | Claude judges substantive vs passing reference. | |
| Custom two-stage hybrid | Stage 1 keyword scan → Stage 2 Haiku classification on hits only. Graceful degradation. | ✓ |

**User's choice:** Two-stage filter. Stage 1: keyword scan (case-insensitive, word-boundary). No hit = immediate write. Hit = Stage 2 Haiku classification. Block substantive content about/from these entities. Allow neutral tool references and career narrative. Timeout/API failure = BLOCK + queue to proposals/ for human review. Never bypass.

**Notes:** User specified exact Stage 2 classification criteria (BLOCK vs ALLOW categories) and graceful degradation behavior including 2-second timeout threshold.

### Question 2: Keyword list hardcoded or configurable?

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable file, start with 3 | Keywords in config/excluded-terms.json. Ships with 3. | ✓ |
| Hardcoded, just the 3 | Baked into filter code. | |
| Configurable with expanded seed | Config file seeded with known sub-terms now. | |

**User's choice:** Configurable file, seed with 3. Dedicated Phase 1 task to expand to 15-20 terms before go-live. Target categories: former employer product names, project codenames, client names, internal tool names, senior leadership names. Config reloadable without restart.

---

## Style Guide Enforcement

### Question 1: How should the anti-AI style guide be enforced?

| Option | Description | Selected |
|--------|-------------|----------|
| Prompt injection only | Style guide in agent prompts. No post-write validation. | |
| Prompt injection + post-write lint (full) | Both generation-time and validation. Belt and suspenders. | |
| Post-write lint only | Validate after generation, flag violations. | |
| Custom: prompt + regex-only lint | Prompt injection for semantic concerns. Regex-only lint for deterministic banned words. Two-strike failure handling. | ✓ |

**User's choice:** Prompt injection (full style guide in system prompt for all vault-writing agents) + post-write lint (regex-only, NOT semantic). Banned words extracted from style guide, cached, reloaded on file change. 1st violation = reject + regenerate with callout. 2nd violation = queue to proposals/ with flag for human review. Semantic enforcement stays in prompts only. Lint latency target: <10ms.

**Notes:** User explicitly scoped lint to regex/keyword only. Semantic style concerns (hedging, buzzword density, performative enthusiasm) are prompt-injection-only.

---

## Wikilink Strategy (not discussed — user provided defaults)

**User's directive:** Agent creates wikilinks freely on RIGHT side. Agent proposes wikilinks for LEFT side (human approves).

---

## Claude's Discretion

- Write-gateway implementation approach
- Internal data structures
- File-watching mechanism
- Test strategy

## Deferred Ideas

None.

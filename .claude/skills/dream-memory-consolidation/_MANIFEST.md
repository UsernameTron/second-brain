# dream-memory-consolidation — Manifest

- **Version:** 2.0.0
- **Created:** 2026-04-18
- **Source video:** [Claude Code's Hidden /dream Feature MASSIVELY Upgrades Memory](https://www.youtube.com/watch?v=E-1Lmyv6Cjo)
- **Source prompt:** [Piebald-AI GitHub](https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/system-prompts/agent-prompt-dream-memory-consolidation.md)
- **Uploader:** Chase AI
- **Duration:** 9 minutes
- **Pattern:** Sequential Workflow (Pattern 1) + Context-Aware Branching (Pattern 4) hybrid
- **Gate 2 Score:** 11/12

## Gate 2 Rubric (v2.0.0)

| Dimension | Score | Rationale |
|:----------|:-----:|:----------|
| Specificity | 3/3 | Exact domain (Claude Code memory), exact method (grep JSONL, daily logs), exact constraints (200 lines, 25KB) |
| Trigger clarity | 3/3 | Compound keyword triggers ("/dream", "dream user"), semantic ("deep memory cleanup", "full memory consolidation") |
| Scope boundary | 3/3 | Explicit REFUSES + differentiation from consolidate-memory + "NEVER read full JSONL" constraint |
| Differentiation | 2/3 | Clear vs consolidate-memory (grep + logs + scope routing). Minor overlap on shared vocabulary. |

**Total: 11/12** — passes minimum 10/12

## Changelog

### 2.0.0 (2026-04-18)
- **BREAKING:** Rewrote transcript handling from "read last 5 files" to grep-based narrow search (matches official Anthropic prompt)
- Added daily logs (`logs/YYYY/MM/`) as Priority 1 signal source
- Added 25KB cap on MEMORY.md alongside 200-line cap
- Added assistant-mode layout check (`logs/`, `sessions/` subdirectories)
- Bundled grep command template for deterministic transcript search
- Removed ARCHITECTURE section (Claude knows its own memory system)
- Removed blocking "present findings" step — consolidation proceeds directly, summary at end
- Added "demote verbose index entries" instruction from official prompt
- Reduced from 235 lines to 182 lines (-23%)

### 1.2.0 (2026-04-18)
- Trimmed description to 681 chars (under 1024 limit)
- Removed bare "dream" from triggers to reduce false positives

### 1.0.0 (2026-04-18)
- Initial build from YouTube transcript

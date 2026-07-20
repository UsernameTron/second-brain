---
description: Extract memories from the current session transcript and stage as proposals. Usage: /wrap [--transcript <path>] [--file <path>] [--dir <path>] [--since YYYY-MM-DD]
---

Run the `/wrap` command to extract memory candidates from the session transcript (or from vault files) and stage them in `proposals/memory-proposals.md` for human review via `/promote-memories`.

Run `scripts/wrap.js` — it loads dotenv (extraction classifies via Haiku and 401s without `ANTHROPIC_API_KEY`) and, with no flags, resolves the newest Claude Code transcript for this project:

```bash
node scripts/wrap.js $ARGUMENTS
```

Flags:
- *(no flags)* — extract from this project's newest transcript in `~/.claude/projects/<slug>/`.
- `--transcript <path>` — extract from a specific transcript `.jsonl` (use when several sessions are open and the newest is not the one you mean).
- `--file <path>` — extract from a specific vault file (relative to vault root).
- `--dir <path>` — extract from all markdown files in a vault directory.
- `--since YYYY-MM-DD` — extract from Daily/ notes on or after this date.

Report the candidate count and remind the operator to review with `/promote-memories`. Candidates are staged, never promoted — promotion is a separate human-gated step.

**Do not call `extractMemories({})` with no options** — it returns `[]` immediately and stages nothing. Transcript extraction goes through `extractFromTranscript`, which is what `scripts/wrap.js` does for the no-flag case.

---
description: Query the compounding memory layer. Usage: /recall <query> [--category X] [--since YYYY-MM-DD] [--top N]
---

Run the `/recall` command to query the user's compounding memory layer (`memory/memory.md` in the vault).

Invoke `runRecall` from `./src/recall-command` with the user's arguments split into an argv array, then print each line of the `lines` field on its own line of output. Nothing else.

Reference implementation:

```bash
node -e "
  const { runRecall } = require('./src/recall-command');
  const args = process.argv.slice(1);
  runRecall(args).then(r => {
    for (const line of r.lines) process.stdout.write(line + '\n');
  }).catch(err => {
    process.stderr.write('recall failed: ' + err.message + '\n');
    process.exit(1);
  });
" -- $ARGUMENTS
```

Output contract (from ROADMAP Phase 18 SC1):
- On match: numbered list, up to 5 entries (or `--top N`), each line is `N. [CATEGORY] <<=100-char snippet> (short-source-ref)`.
- On no match: a single line `No results matching "<query>".`
- On missing `memory/memory.md`: same empty-result line — never a stack trace.

Flags:
- `--category <LABEL>` — restrict to entries whose category matches.
- `--since <YYYY-MM-DD>` — restrict to entries dated on or after this date.
- `--top <N>` — max results (default 5).

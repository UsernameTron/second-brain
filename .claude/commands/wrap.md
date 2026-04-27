---
description: Extract memories from the current session transcript and stage as proposals. Usage: /wrap [--file <path>] [--dir <path>] [--since YYYY-MM-DD]
---

Run the `/wrap` command to extract memory candidates from session transcripts or vault files and stage them in `proposals/memory-proposals.md` for human review.

Invoke `extractMemories` from `./src/memory-extractor` with an options object built from the user's arguments.

Reference implementation:

```bash
node -e "
  const { extractMemories } = require('./src/memory-extractor');
  const args = process.argv.slice(1);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i+1]) opts.file = args[++i];
    else if (args[i] === '--dir' && args[i+1]) opts.dir = args[++i];
    else if (args[i] === '--since' && args[i+1]) opts.since = args[++i];
  }
  extractMemories(opts).then(r => {
    const count = Array.isArray(r) ? r.length : 0;
    process.stdout.write('Extracted ' + count + ' memory candidate(s) to proposals/memory-proposals.md\n');
  }).catch(err => {
    process.stderr.write('wrap failed: ' + err.message + '\n');
    process.exit(1);
  });
" -- $ARGUMENTS
```

Flags:
- `--file <path>` — extract from a specific vault file (relative to vault root).
- `--dir <path>` — extract from all markdown files in a vault directory.
- `--since YYYY-MM-DD` — extract from Daily/ notes on or after this date.

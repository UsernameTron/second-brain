---
description: Promote reviewed memory candidates from proposals to the compounding memory layer. Usage: /promote-memories [--dry-run] [--auto]
---

Run the `/promote-memories` command to promote human-reviewed memory candidates from `proposals/memory-proposals.md` to `memory/memory.md`.

Invoke `promoteMemories` from `./src/promote-memories` with an options object. Only candidates marked `[x] accept` are promoted. After promotion, accepted entries are archived and the proposals file is updated.

Reference implementation:

```bash
node -e "
  const { promoteMemories } = require('./src/promote-memories');
  const args = process.argv.slice(1);
  const opts = {};
  if (args.includes('--dry-run')) opts.dryRun = true;
  if (args.includes('--auto')) opts.auto = true;
  promoteMemories(opts).then(r => {
    process.stdout.write('Promoted ' + (r.promoted || 0) + ' candidate(s) to memory/memory.md\n');
    if (r.archived) process.stdout.write('Archived ' + r.archived + ' processed entries.\n');
  }).catch(err => {
    process.stderr.write('promote-memories failed: ' + err.message + '\n');
    process.exit(1);
  });
" -- $ARGUMENTS
```

Flags:
- `--dry-run` — show what would be promoted without writing.
- `--auto` — auto-accept all pending candidates (skip human review).

---
description: Promote reviewed memory candidates from proposals to the compounding memory layer. Usage: /promote-memories [--dry-run] [--auto]
---

Run the `/promote-memories` command to promote human-reviewed memory candidates from `proposals/memory-proposals.md` to `memory/memory.md`.

Invoke `promoteMemories` from `./src/promote-memories` with an options object. Only candidates marked `[x] accept` are promoted. After promotion, accepted entries are archived and the proposals file is updated.

Reference implementation:

```bash
node -e "
  require('dotenv').config({ path: require('path').join(__dirname, '.env') });
  const { promoteMemories, parsePromoteArgs } = require('./src/promote-memories');
  let opts;
  try {
    opts = parsePromoteArgs(process.argv.slice(1));
  } catch (err) {
    process.stderr.write(err.message + '\n');
    process.exit(1);
  }
  promoteMemories(opts).then(r => {
    if (r.error) {
      process.stderr.write('promote-memories failed: ' + r.error + '\n');
      process.exit(1);
    }
    if (r.dryRun) {
      process.stdout.write('DRY RUN — no writes performed\n');
      process.stdout.write('Would promote ' + r.promoted + ', defer ' + r.deferred + ', duplicates ' + r.duplicates + ', rejected ' + r.rejected + '\n');
      (r.wouldPromote || []).forEach(c => process.stdout.write('  would promote: ' + c.candidateId + ' [' + c.category + ']\n'));
      (r.wouldDefer || []).forEach(id => process.stdout.write('  would defer: ' + id + '\n'));
    } else {
      process.stdout.write('Promoted ' + r.promoted + ' candidate(s) to memory/memory.md\n');
      process.stdout.write('Embedded ' + r.embedded + ' of ' + r.promoted + ' (failed: ' + r.embedFailed + ')\n');
      if (r.reach && r.reach.targets) {
        const written = r.reach.targets.filter(t => t.status === 'written').length;
        process.stdout.write('Reach export: ' + written + ' of ' + r.reach.targets.length + ' target(s) updated\n');
      }
      if (r.archived) process.stdout.write('Archived processed entries.\n');
    }
  }).catch(err => {
    process.stderr.write('promote-memories failed: ' + err.message + '\n');
    process.exit(1);
  });
" -- $ARGUMENTS
```

Flags:
- `--dry-run` — full pipeline preview with zero writes: no memory.md append, no embedding, no reach export, no proposals rewrite, no archives.
- `--auto` — treat unreviewed pending candidates (no checkbox) as accepted. Explicit reject/defer checkboxes are still honored. Composes with `--dry-run`.
- `--max <n>` — override the batch cap (within `batchCapMin`..`batchCapMax` from `config/pipeline.json`).
- Unknown flags are rejected with a non-zero exit — a mistyped flag never falls through to a real promotion.

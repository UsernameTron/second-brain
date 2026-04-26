---
description: Re-route an unrouted dead-letter file to a specified vault location. Usage: /promote-unrouted <filename> --target <path>
---

Run the `/promote-unrouted` command to manually promote a dead-letter file from `proposals/unrouted/` to a specified vault path.

Invoke `promoteUnrouted` from `./src/promote-unrouted` with the filename and options. The command validates the target path, re-runs the exclusion gate, applies template extraction if applicable, generates wikilinks, and writes via vault-gateway.

Reference implementation:

```bash
node -e "
  const { promoteUnrouted } = require('./src/promote-unrouted');
  const args = process.argv.slice(1);
  const filename = args[0];
  if (!filename) { process.stderr.write('Usage: /promote-unrouted <filename> --target <path>\n'); process.exit(1); }
  const opts = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--target' && args[i+1]) opts.target = args[++i];
    if (args[i] === '--dry-run') opts.dryRun = true;
  }
  promoteUnrouted(filename, opts).then(r => {
    if (r.success) process.stdout.write('Promoted ' + filename + ' to ' + r.target + '\n');
    else process.stdout.write('Failed: ' + (r.reason || 'unknown error') + '\n');
  }).catch(err => {
    process.stderr.write('promote-unrouted failed: ' + err.message + '\n');
    process.exit(1);
  });
" -- $ARGUMENTS
```

Arguments:
- `<filename>` — name of the file in `proposals/unrouted/` to promote.

Flags:
- `--target <path>` — destination vault path (RIGHT-side path from vault-paths.json, or LEFT label for left-proposals/).
- `--dry-run` — validate routing without writing.

---
description: Re-route a dead-letter or left-proposal file by re-running the full classification pipeline. Usage: /reroute <file>
---

Run the `/reroute` command to re-classify a dead-letter (`proposals/unrouted/`) or left-proposal
(`proposals/left-proposals/`) file and write it to the destination the pipeline chooses.

Invoke `rerouteFile` from `./src/reroute` with the file path. The command re-runs the exclusion
gate, Stage 1 + Stage 2 classification, template extraction, and wikilink generation, then writes
via vault-gateway and archives the original with reroute metadata. There is no manual target
override — reroute re-classifies, it does not relocate to an arbitrary path.

Reference implementation:

```bash
node -e "
  const { rerouteFile } = require('./src/reroute');
  const args = process.argv.slice(1);
  const filePath = args[0];
  if (!filePath) { process.stderr.write('Usage: /reroute <file>\n'); process.exit(1); }
  rerouteFile(filePath).then(r => {
    if (r.rerouted) process.stdout.write('Rerouted ' + r.from + ' -> ' + r.to + '\n');
    else { process.stdout.write('Failed: ' + (r.reason || 'unknown error') + '\n'); process.exit(1); }
  }).catch(err => {
    process.stderr.write('reroute failed: ' + err.message + '\n');
    process.exit(1);
  });
" -- $ARGUMENTS
```

Arguments:
- `<file>` — absolute path to the file in `proposals/unrouted/` or `proposals/left-proposals/` to reroute.

Reroute re-runs classification and reports the destination it chose (`r.to`); it does not accept
a manual `--target` override.

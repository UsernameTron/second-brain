---
description: Run the daily prep briefing. Usage: /today [--dry-run]
---

Run the `/today` command to produce the daily 6-section morning briefing.

Invoke `runToday` from `./src/today-command` with an options object, then print the result. The command aggregates slippage items, calendar events, Gmail subjects, GitHub activity, and memory proposals into a single briefing written to the vault and echoed to the terminal.

Reference implementation:

```bash
node -e "
  const { runToday } = require('./src/today-command');
  const dryRun = process.argv.includes('--dry-run');
  runToday({ dryRun }).then(r => {
    process.stdout.write(r.output || 'Today briefing complete.\n');
  }).catch(err => {
    process.stderr.write('today failed: ' + err.message + '\n');
    process.exit(1);
  });
" -- $ARGUMENTS
```

Flags:
- `--dry-run` — generate briefing without writing to vault.

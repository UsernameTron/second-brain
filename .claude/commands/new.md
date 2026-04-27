---
description: Route mixed input to the correct vault location via two-stage LLM classifier. Usage: /new <content>
---

Run the `/new` command to classify and route user input into the vault.

Invoke `classifyInput` from `./src/classifier` with the user's content as the first argument. The two-stage classifier determines LEFT (identity/reference) vs RIGHT (active work) placement, then picks a subdirectory within the chosen side.

Reference implementation:

```bash
node -e "
  const { classifyInput } = require('./src/classifier');
  const content = process.argv.slice(1).join(' ');
  if (!content) { process.stderr.write('Usage: /new <content>\n'); process.exit(1); }
  classifyInput(content).then(r => {
    if (r.blocked) {
      process.stdout.write('BLOCKED: ' + (r.reason || 'content excluded by policy') + '\n');
    } else {
      process.stdout.write('Routed to: ' + r.target + '\n');
      if (r.needsInteractive) process.stdout.write('(low confidence — may need manual review)\n');
    }
  }).catch(err => {
    process.stderr.write('classify failed: ' + err.message + '\n');
    process.exit(1);
  });
" -- $ARGUMENTS
```

Output contract:
- On successful routing: `Routed to: <vault-path>`
- On block (content-policy exclusion): `BLOCKED: <reason>`
- On low confidence: appends manual-review note.

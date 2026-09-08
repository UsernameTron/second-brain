---
description: Weekly memory pulse — show the latest, or answer its open question. Usage: /pulse [show|yes|no] [hash] [reason]
---

Run the weekly memory pulse over `memory/memory.md`. The pulse itself is written on a schedule (`com.secondbrain.pulse`, Monday 07:00) to `briefings/pulse/YYYY-MM-DD.md`; this command shows the latest brief and answers its one question.

The brief is fully templated — nothing in it is model-generated. Answering the question is the only step that needs a human.

## Show the latest pulse

```bash
node scripts/pulse.js --show
```

## Answer the open question

The brief prints the entry's hash in the command it tells you to run. Pass it through:

```bash
node scripts/pulse.js yes <hash>
```

```bash
node scripts/pulse.js no <hash> [reason]
```

`yes` confirms the entry and touches only `state/pulse-asked.json`. `no` appends `stale:: <date> · retired via pulse` to that entry in `memory.md` — the same lifecycle field `dream.js` uses, so `/recall` downranks it. Nothing is deleted.

The hash is optional only when exactly one question is open. Questions accumulate (a new entry is asked each week whether or not the last was answered), so with more than one open the command refuses and lists the open hashes rather than guessing.

## Write a pulse now (off-schedule)

```bash
node scripts/pulse.js --dry-run
```

Prints the brief and writes nothing. Drop `--dry-run` to write it to the vault, notify, and open it in Obsidian; add `--no-open` to skip Obsidian.

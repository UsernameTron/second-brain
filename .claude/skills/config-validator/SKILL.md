---
name: config-validator
description: Validates config/*.json files against their corresponding config/schema/*.schema.json schemas using AJV. Use when checking config validity, after config changes, or before shipping changes that touch config/ files.
---

# Config Validator

Validates project configuration files against their JSON Schema definitions.

## Usage

Run the validation engine:

```bash
node src/config-validator.js
```

## What It Checks

Dynamically discovers schemas in `config/schema/*.schema.json` and validates the corresponding config file in `config/`. Schema-to-config mapping: `config/schema/foo.schema.json` validates `config/foo.json`.

Current schemas (9 — 8 with a backing config in `config/`, plus one frontmatter schema):
- `connectors.schema.json` -> `config/connectors.json`
- `daily-stats-frontmatter.schema.json` -> no backing config — **expect a WARNING on every run.** This schema validates the frontmatter of the generated `daily-stats.md` (matched by filename convention through the pre-commit hook), not a file in `config/`. The WARNING is benign; do not delete the schema to silence it.
- `docsync.schema.json` -> `config/docsync.json`
- `excluded-terms.schema.json` -> `config/excluded-terms.json`
- `memory-categories.schema.json` -> `config/memory-categories.json`
- `pipeline.schema.json` -> `config/pipeline.json`
- `scheduling.schema.json` -> `config/scheduling.json`
- `templates.schema.json` -> `config/templates.json`
- `vault-paths.schema.json` -> `config/vault-paths.json`

## Output

| Status | Meaning |
|--------|---------|
| PASS | Config validates against schema |
| FAIL | Config has schema violations (JSON path + error shown) |
| WARNING | Schema exists but config file is missing |
| ERROR | JSON parse failure or schema compilation error |

## Exit Codes

- `0` — All configs PASS or WARNING (validation clean)
- `1` — Any config FAIL or ERROR (validation failed)

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

Current schemas (8, each with a backing config in `config/`):
- `connectors.schema.json` -> `config/connectors.json`
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

---
name: pipeline-health
description: Checks operational health of the second-brain pipeline — connector reachability, config validity, vault REST API status, and scheduler state. Use when diagnosing pipeline issues, after config changes, or for routine health checks. Trigger phrases: pipeline health, pipeline status, system health, connector status.
---

# Pipeline Health

Runs four sequential checks and produces a structured status table with an overall verdict.

All checks must complete within 30 seconds. Individual commands have a 5-second timeout enforced via `timeout 5 <command>`.

---

## Check 1: Config Validation

```bash
node src/config-validator.js
```

- Exit 0 → PASS
- Exit 1 → FAIL (capture stdout for error details)

Reports PASS/FAIL with a one-line summary of any validation failures.

---

## Check 2: Connector Reachability

Read `config/connectors.json` to identify which connectors are configured. For each connector, check whether its source file exists:

```bash
test -f src/connectors/gmail.js     && echo "OK" || echo "MISSING"
test -f src/connectors/github.js    && echo "OK" || echo "MISSING"
test -f src/connectors/calendar.js  && echo "OK" || echo "MISSING"
```

Report OK if the file exists, MISSING if not.

---

## Check 3: Obsidian Local REST API

```bash
timeout 5 curl -s -o /dev/null -w "%{http_code}" http://localhost:27123/
```

Interpret the HTTP response:
- 200–399 → REACHABLE
- 401 or 403 → REACHABLE-AUTH-REQUIRED (server is up, auth expected)
- Connection refused, timeout, or 5xx → UNREACHABLE

---

## Check 4: Scheduler State

```bash
test -f config/scheduling.json && cat config/scheduling.json || echo "NOT FOUND"
```

If present, extract:
- `trigger.schedule` — cron expression
- `trigger.enabled` — true/false
- `trigger.name` — trigger name

Report OK with schedule summary if found, MISSING if not.

---

## Output Format

Produce exactly this table after all four checks:

```
Pipeline Health Report
======================

| Component          | Status                  | Detail                                    |
|--------------------|-------------------------|-------------------------------------------|
| Config validity    | PASS / FAIL             | All clean / N schema violations           |
| Gmail connector    | OK / MISSING            | src/connectors/gmail.js exists or not     |
| GitHub connector   | OK / MISSING            | src/connectors/github.js exists or not    |
| Calendar connector | OK / MISSING            | src/connectors/calendar.js exists or not  |
| Vault REST API     | REACHABLE / UNREACHABLE | HTTP status or connection error           |
| Scheduler config   | OK / MISSING            | schedule + enabled state or not found     |

Overall: HEALTHY / DEGRADED (N issues) / UNHEALTHY (N critical)
```

**Verdict rules:**
- HEALTHY: all components are PASS / OK / REACHABLE
- DEGRADED: 1–2 non-critical issues (e.g., one connector MISSING, scheduler MISSING, vault REACHABLE-AUTH-REQUIRED)
- UNHEALTHY: config validation FAIL or ERROR, OR vault REST API UNREACHABLE

**Critical components** (UNHEALTHY triggers): Config validity, Vault REST API
**Non-critical components** (DEGRADED triggers): Individual connectors, Scheduler config

---

## Reference Files

- `config/connectors.json` — connector definitions (gmail, github, calendar)
- `config/pipeline.json` — pipeline tuning parameters
- `config/scheduling.json` — RemoteTrigger schedule and DST notes
- `src/config-validator.js` — AJV validation engine (exit 0 = clean, exit 1 = failures)
- `src/connectors/gmail.js`, `src/connectors/github.js`, `src/connectors/calendar.js` — connector implementations

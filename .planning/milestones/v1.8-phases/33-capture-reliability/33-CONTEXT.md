# Phase 33: Capture Reliability - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning
**Mode:** Smart discuss (auto — yolo; 4/4 grey areas defaulted, receipt in session log)

<domain>
## Phase Boundary

The nightly 23:45 daily-sweep actually fires, proves it fired, and survives local-LLM failure. Three deliverables:
1. **Launchd reliability** — root-cause the current exit-78 (EX_CONFIG) failure (job ran 2×, log 0 bytes), version the fixed `com.secondbrain.daily-sweep.plist` into `config/`, rebootstrap, and observe a real launchd-context fire.
2. **Fire evidence** — persist `state/daily-sweep-last-run.json`; `/today` Compounding section gains a sweep line: `sweep ran/staged N | STALE | NEVER RAN`.
3. **Classifier resilience** — `src/utils/classifier-health.js` (voyage-health clone) gating local-27B → `classifyAnthropic` fallback, extended to HTTP/parse/timeout errors, with a per-night Haiku call cap.

</domain>

<decisions>
## Implementation Decisions

### Launchd reliability & observation gate
- Diagnose exit 78 first: `launchctl print` full state, `log show --predicate` for spawn errors; the installed plist content is already correct (fixed 260719-lfn: full node path, WorkingDirectory, PATH, log paths) — prime suspect is the fixed plist never being rebootstrapped over the old registration
- Version the plist: `config/com.secondbrain.daily-sweep.plist` = source of truth (dream.plist pattern); install = copy to `~/Library/LaunchAgents/` + `launchctl bootout` / `bootstrap`
- Observation: `launchctl kickstart gui/$UID/com.secondbrain.daily-sweep` for a same-day REAL launchd-context fire (satisfies "observe one real fire FIRST" without an overnight block); tonight's scheduled 23:45 fire is the confirming observation → human-verify item in VERIFICATION.md
- No log rotation this phase (YAGNI); keep existing single log path

### /today Compounding sweep line
- Exact states: `sweep ran HH:MM, staged N` / `sweep STALE (last ran <date>)` / `sweep NEVER RAN`
- STALE threshold: last run > 26h ago (one missed night + margin); constant, not config
- Renders inside the existing Compounding section (Phase 30/31 renderer seam, `src/today/compounding-trend` adjacency)
- Fail-open: missing/corrupt state file → `NEVER RAN`; never throw from /today

### classifier-health.js
- Mirror `src/utils/voyage-health.js` API + persistence shape; state at `~/.cache/second-brain/classifier-health.json`
- Failure classes counted: HTTP errors (non-2xx/network), JSON parse failures, timeouts (PR #83's 60s local timeout counts as failure)
- Degraded mode routes classify calls to `classifyAnthropic` (Haiku) — same recovery/backoff semantics as voyage-health
- Per-night Haiku call cap: default 50, key in `config/pipeline.json` (+ AJV schema update); cap hit → stop classifying (skip, log decision), never crash the sweep

### Config & scope guards
- Daily-sweep stays LOCAL-FIRST with health-gated fallback — do NOT set LLM_PROVIDER=anthropic in this plist (that pin is dream-propose-only, per 260721-ljn); classifier-health IS the sweep's resilience story
- `state/daily-sweep-last-run.json` in repo `state/` (gitignored, dream-ledger.json precedent); written atomically at sweep end with ts + staged count + duration + degraded flag
- Tests mirror voyage-health.test.js; anything touching live endpoints is UAT-guarded (CI skip logic)

### Claude's Discretion
- Exact JSON shape of last-run state file; log-line wording; internal module structure of classifier-health; whether kickstart observation is scripted or manual steps in plan

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/voyage-health.js` — the clone template (adaptive denial tracker, cache persistence)
- `config/com.secondbrain.dream.plist` — versioned-plist pattern incl. EnvironmentVariables + install/reload steps
- `scripts/daily-sweep.js` — entry point already loads dotenv (guarded to require.main), orchestrates extractMemories + lifecycle; exits 0/1 only
- `src/today-command.js:262-276` — Compounding section seam (`compounding-trend` require)
- `src/pipeline-infra.js` — `createLlmClient` local/anthropic routing + LLM_PROVIDER override (260721-ljn), 60s local timeout (PR #83)

### Established Patterns
- Health-state JSON persisted under `~/.cache/second-brain/` (voyage-health.json)
- launchd jobs: full node path `/opt/homebrew/opt/node@22/bin/node`, WorkingDirectory, PATH env, log to `~/Library/Logs/<label>.log`
- AJV schema validation on config/*.json enforced by pre-commit hook
- Decision logging via `logDecision` (LLM_CLASSIFY actions observed in wiki migration)

### Integration Points
- Fallback seam: wherever daily-sweep's extraction classifies via local model (memory-extractor → pipeline-infra client)
- `/today` briefing renderer Compounding section
- `launchctl` gui domain for the current user; job Label com.secondbrain.daily-sweep

### Live Diagnostic Facts (verified 2026-07-21)
- `launchctl print`: runs = 2, last exit code = **78 (EX_CONFIG)**, state not running
- `~/Library/Logs/com.secondbrain.daily-sweep.log`: exists, **0 bytes**, mtime Jul 19 23:45
- Installed plist content is the FIXED version (node@22 path, WorkingDirectory, PATH, logs) — but no `config/` copy exists; repo has no daily-sweep plist versioned
- `/opt/homebrew/opt/node@22/bin/node` exists
- No `state/daily-sweep-last-run.json` anywhere yet

</code_context>

<specifics>
## Specific Ideas

- Roadmap line is the spec: "fix + version the `com.secondbrain.daily-sweep` launchd plist … observe one real 23:45 fire FIRST; persist `state/daily-sweep-last-run.json`; `/today` Compounding line 'sweep ran/staged N | STALE | NEVER RAN'; `src/utils/classifier-health.js` (voyage-health clone) gating local-27B → `classifyAnthropic` fallback, extended to HTTP/parse errors, with per-night Haiku call cap."
- Today's live lesson (260721-ljn): unpinned local calls wedge indefinitely when LM Studio is loaded-but-stuck — classifier-health must treat the 60s timeout as a counted failure so repeated wedges flip to degraded quickly.

</specifics>

<deferred>
## Deferred Ideas

- Log rotation for launchd logs (revisit if logs grow)
- LLM_PROVIDER pin for daily-sweep (explicitly rejected this phase — local-first is the point)

</deferred>

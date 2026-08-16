# HubSpot Agent CLI — Claude working surface (Phase 2 of the MCP plan)

> **Reference material for an optional external tool surface — not a status
> record.** Everything here about package versions, transport, tool counts, and
> account or runtime availability was read from a published package on
> 2026-08-13 and can drift without anything in this repository changing. It does
> **not** establish that any connector, credential, or permission is live; only
> a fresh capability probe does that. Current release state lives in
> [HANDOFF.md](HANDOFF.md), phase intent in [ROADMAP.md](ROADMAP.md).

The HubSpot **Agent CLI** is the app-development agent surface inside
`@hubspot/cli` (v8.13+). Its MCP server (`hs mcp start`) is what Pete runs
locally as **HubSpotDev** (21 tools). Verified from the published package
source (2026-08-13): transport is **stdio only**, it operates on the local
filesystem + the CLI's authenticated account — a developer-workstation tool
by construction. That shapes where it lives:

| Surface | Status |
|---|---|
| Pete's Mac (Claude Code / Desktop) | **DONE** — `HubSpotDev` connected, `hs mcp start --ai-agent claude` |
| Claude Code **cloud** sessions (this repo's environment) | This document — CLI driven directly, no MCP layer needed |
| Agent Canvas product | Phase 3 — `hubspot-mcp-bridge` Cloud Run service (see the plan / HANDOFF) |

## The 21 tools ↔ what Claude runs directly

In cloud sessions Claude drives `hs` as a CLI; the MCP wrapper adds nothing
when the agent can already run commands. Capability map:

- **Project lifecycle** — `hs project create` (CreateProject/GuidedWalkthrough),
  `hs project upload` / `hs project deploy` (Upload/DeployProject),
  `hs project logs` + build status (GetBuildLogs/GetBuildStatus),
  `hs project add` (AddFeatureToProject), validation, `hs project list`
  (FindProjects), `hs account info` (AuthAccount/GetConfigValues),
  test accounts (`hs testAccount`/`hs sandbox`).
- **Docs** — DocsSearch/DocFetch have no CLI verb; in sessions Claude fetches
  developers.hubspot.com directly (network policy permits it).
- **CMS dev** — `hs cms` subcommands (modules, templates, functions, logs).

## Environment setup (owner does once, in Claude Code environment settings)

1. **Setup command** (environment → setup script):
   `npm install -g @hubspot/cli`
2. **Environment variables — THREE, not two** (names verified against the
   installed CLI 8.13.0 source, 2026-08-14):
   - `USE_ENVIRONMENT_HUBSPOT_CONFIG` = `true` — **required switch**: without
     it the CLI ignores the other two and hunts for a hubspot.config.yml
     (`@hubspot/local-dev-lib` config/utils.js gates env-based auth on it).
   - `HUBSPOT_PERSONAL_ACCESS_KEY` — from app.hubspot.com/l/personal-access-key
     for the chosen account (treat like a password; environment settings
     only, never the repo).
   - `HUBSPOT_ACCOUNT_ID` — that same account's id. **The PAK encodes the
     portal it was minted from**; a mismatched id fails with HTTP 400
     VALIDATION_ERROR ("account ID provided isn't valid") — a 400, not a
     401, is the mismatch signature.
   **Account decision (Pete, 2026-08-14): PRODUCTION portal 243103424, not
   the sandbox** — the org tests in production, a sandbox qualifier would
   confuse the team. Acceptable because the PAK carries only Pete's own user
   permissions, this surface is app-dev (it does not browse the CRM), and
   CRM writes remain solely ops-runner (ADR-0041).
   Set these in the environment for the **repo root**
   (`UsernameTron/second-brain`) — environments are per-repo; agent-canvas
   sessions inherit them. The env-vars box is plaintext (visible to anyone
   using the environment) — today that is Pete alone.
3. **Network policy**: Full network access (or allowlist `api.hubapi.com`,
   `app.hubspot.com`, `developers.hubspot.com`). Policy applies to NEW
   containers only.

## First-session verification

```bash
hs --version
hs project list --use-env   # read-only inventory; clean exit proves auth
```

**`--use-env` is mandatory and per-command** (verified in CLI 8.13.0 source,
2026-08-14): `injectAccountIdMiddleware` reads `HUBSPOT_ACCOUNT_ID` only when
the *flag* is set (`lib/middleware/configMiddleware.js`), and the flag only
exists on commands registered with `useEnvironmentOptions: true`. Supported:
`project list/info/upload/deploy/logs`, `secret *`, `custom-object *`, `hs api`.
NOT supported (need a hubspot.config.yml, so effectively out of scope in
cloud sessions): `hs account info`, `project add/lint/release/migrate`.
`USE_ENVIRONMENT_HUBSPOT_CONFIG=true` alone only skips the config-file check —
without `--use-env` the command still dies on "An account needs to be
supplied"; that contradictory error pair is the fingerprint of this gap.

## Ground rules for Claude on this surface

- **Reads are free** (account info, project list, build status, logs, docs).
- **`hs project upload` / `deploy` / anything that changes a HubSpot account
  happens only when Pete asks for that change in the task at hand** — deploys
  are per-task consent, the same posture as the canvas's preview-first writes.
- **CRM data is out of scope here entirely.** CRM reads/writes belong to
  ctg-hs-ops-runner (ADR-0041 — sole HubSpot CRM execution authority) and,
  later, the Phase 3 bridge's read-only `/crm` path. The Agent CLI builds
  apps; it does not browse the CRM.
- Every session that deploys anything records what/where/why in its handoff.

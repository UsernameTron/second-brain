# HubSpot Agent CLI — Claude working surface (Phase 2 of the MCP plan)

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
     only, never the repo). Sandbox 246460341 recommended — the Agent CLI
     builds apps, real-CRM access buys nothing here.
   - `HUBSPOT_ACCOUNT_ID` — that same account's id.
   Set these in the environment for the **repo root**
   (`UsernameTron/second-brain`) — environments are per-repo; agent-canvas
   sessions inherit them.
3. **Network policy**: Full network access (or allowlist `api.hubapi.com`,
   `app.hubspot.com`, `developers.hubspot.com`). Policy applies to NEW
   containers only.

## First-session verification

```bash
hs --version
hs project list --use-env   # read-only inventory; proves env-based auth
```

**`hs account info` does NOT work here** — verified 2026-08-14: it has no
`--use-env` flag at all (`hs account info --help` confirms; passing it
errors `Unknown arguments: use-env, useEnv`), and without it the command
always falls back to a config-file default account, failing with `An
account needs to be supplied either via "--account" or through setting a
"defaultAccount"` even when all three env vars are set correctly. `hs
account`'s subcommands are config-file-only by design. Use `hs project
list --use-env` for verification instead — it, along with the other
account-targeted commands (`project create/upload/deploy/logs`, `cms
list`, `hubdb list`), does support `--use-env`. An empty result (`No
projects found for account <id>`) is a **successful** verification, not a
failure — it means auth worked and the account just has no projects
uploaded yet.

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

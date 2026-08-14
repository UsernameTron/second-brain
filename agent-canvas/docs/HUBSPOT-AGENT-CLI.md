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
2. **Environment variables:**
   - `HUBSPOT_PERSONAL_ACCESS_KEY` — from app.hubspot.com → CLI personal
     access key (treat like a password; environment settings only, never the
     repo).
   - `HUBSPOT_ACCOUNT_ID` — the target account id.
   (These are the CLI's non-interactive/CI auth path; verify the exact
   variable names against `hs --help` on first session — pinned CLI versions
   occasionally rename them.)
3. **Network policy**: Full network access (or allowlist `api.hubapi.com`,
   `app.hubspot.com`, `developers.hubspot.com`). Policy applies to NEW
   containers only.

## First-session verification

```bash
hs --version
hs account info          # proves auth without touching anything
hs project list          # read-only inventory
```

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

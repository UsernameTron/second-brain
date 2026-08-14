# Portfolio Fold-In — mission brief for a fresh session

Self-contained instruction: analyze the CTG project portfolio and fold its
functional capabilities into Agent Canvas. Written 2026-08-14 from a live
inventory of `/Users/cpconnor/projects/CTG-Workspace-Build/projects`
(~60 entries). Start a session with: *"Read
agent-canvas/docs/PORTFOLIO-FOLD-IN.md and execute it."*

## Mission

Integrate the portfolio's functional capabilities into Agent Canvas
(`~/projects/second-brain/agent-canvas`, Cloud Run project
`agent-canvas-ctg-0811`). Success = agents on the canvas can **use** these
capabilities in runs — scored ICP lookups, CRM intelligence, enrichment,
outreach queues, org knowledge — making the canvas the single proprietary
intelligence tool for cloudtechgurus.com. Analysis alone is failure; the end
state is merged, deployed, verified integrations.

## Orient first (read, in order)

1. [HANDOFF.md](HANDOFF.md) — deployed state; all phases closed 2026-08-14.
2. [../CLAUDE.md](../CLAUDE.md) + [DEPLOY.md](DEPLOY.md) — house rules, deploy.
3. The shortlist below — do NOT re-inventory all 60 projects; spot-verify
   the shortlist instead (does it still run? where's the entry point?).

## Proven integration patterns (reuse, do not invent)

- **MCP connector row** — any Streamable-HTTP MCP service plugs in via
  Admin → Connectors with per-tool consent (`server/mcp/client.js`).
  `${ENV:NAME}` and `${GCP_IDTOKEN}` header auth both supported. Live
  examples: `hubspot-crm` (via bridge), two RapidAPI LinkedIn connectors.
- **IAM-gated bridge** — stdio-only or private services get a thin Cloud Run
  front: `hubspot-mcp-bridge/` is the template (raw JSON-RPC HTTP→stdio
  pass-through, ~120 lines, IAM-gated, sole invoker `agent-canvas-run@…`).
- **Ops-runner client** — policy-gated writes via identity tokens
  (`server/hubspot/opsrunner.js`). ALL HubSpot CRM writes stay on this lane
  (ADR-0041). Never mint new HubSpot tokens.
- **Committed data registry** — data ships as committed JSON interpolated
  into prompts (`server/config/icp-sr-icp-v5.json` + Radar in
  `server/roster.js`). Fresh export = new commit, not live sync. Vendor
  names live in data, never in prompts (test-enforced).
- **Roster template** — new agent capabilities = roster entries
  (`server/roster.js`), seeded `enabled=0` when risky (the Gauge pattern).

## Portfolio shortlist (spot-verify before building)

1. **ctg-signal-radar** — signal scan, sr-icp-v5 composite scoring, outreach
   queue, MCP server, dashboard behind IAP. The crown jewel; the canvas
   already carries its ICP export.
2. **sr-icp-connector** — DEPLOYED remote MCP (`sr-icp-connector.fly.dev`):
   LinkedIn people search scored against sr-icp-v5. Cheapest win — possibly
   a single connector row.
3. **ctg-ai-platform** (v2.0, FastAPI, deployed) — ICP intent scoring with
   decay, churn/loyalty, email→opportunity classifier, HubSpot dedupe.
4. **ctg-gtm-automation** — HubSpot→BigQuery mirror + enrichment run ledger
   + DQ observability; the data spine.
5. **ctg-ops-automation** — LIVE scheduled ops (hygiene scan, pipeline
   digest, support triage).
6. **advisor-match** — supplier matching/ranking engine (Postgres, deployed).
7. **ctg-enrichment-dispatch** — per-field arbitration + confidence gate +
   provenance write-back (prototype, tests green).
8. **ctg-hs-exec-tool / ctg-hs-ops-runner** — the sanctioned CRM read and
   write lanes (write lane already wired to the canvas).
9. **AI-google** — org RAG over Drive/email with citations (knowledge-layer
   candidate).
10. **ctg-google-workspace-hubspot-automation** — consent/suppression/fit
    rules engine (TS monorepo, 931 tests, built-not-activated).

Skip: planning-only projects (`Jess-SDR`, `ctg-hubspot-SDR`, `ctg-CX-Ray`,
`ctg-account-intelligence`, `hubspot-audit`), empty dirs (`ctg-zero-egress`,
`advisor-plans`), vendored samples (`gcp-ps`,
`google-workspace-resources`), `_archive/`. `ctg-pe-radar` is a
signal-radar fork — one engine, two domains, integrate once.

## Method

1. **Score the shortlist** (half a day, not a week). Per candidate: does it
   run today; integration surface (MCP / HTTP+IAM / data export); what
   canvas capability it adds; effort S/M/L. Present a ranked fold-in
   roadmap to Pete with a recommendation BEFORE building anything.
2. **Integrate in waves, cheapest-first, ONE PR per wave** — Pete wants few
   PRs; batch related changes. Wave 1 is likely sr-icp-connector as a
   connector row plus a signal-radar MCP/bridge; later waves per Pete's
   picks from the roadmap.
3. **Each wave ends deployed and verified in-app** — probe green, one agent
   smoke run, lamps honest (the Phase 3 playbook in HANDOFF.md).

## Hard rules

- Read broadly, write reasonably, destroy never. Lamps never fake green.
  Every claim verified against a tool result.
- Consent model holds: connector tools stay unticked until Pete enables
  them; risky roster agents ship `enabled=0`.
- CRM writes: ops-runner only (ADR-0041). Reads: the read-only bridge /
  exec-tool lanes. No new HubSpot credentials, ever.
- Never surface ISPN/Genesys/Asana content. No vendor names in prompts.
  The CTG Context Intelligence Brief is never seeded into the workspace.
- Don't rebuild what exists: memory (canvas memory contract + second-brain
  recall), scoring (signal-radar), CRM write lane (ops-runner). Folding in
  = wiring, not rewriting.
- Secrets: Secret Manager via deploy scripts with shape guards; never paste
  keys into runbooks or commit them. Cloud Run env vars are set WHOLESALE —
  export everything on redeploy (see HANDOFF.md).
- Branch per wave; never commit to master; `npm test` green before push.

## Decision rights

The ranked roadmap, and anything touching production CRM, spend, or new
external services → Pete decides. Wiring already-approved waves, tests,
docs → proceed autonomously.

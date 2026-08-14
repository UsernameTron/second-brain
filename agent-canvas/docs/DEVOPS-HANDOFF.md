# Agent Canvas — DevOps Handoff (router)

Operational truth lives in these files; this page only routes.

- **[HANDOFF.md](HANDOFF.md)** — deployed state, redeploy procedure (env vars
  set WHOLESALE), incident log, open items. Start here.
- **[DEPLOY.md](DEPLOY.md)** — main service deploy (`deploy/deploy.sh`,
  Cloud Run `agent-canvas`, project `agent-canvas-ctg-0811`, us-central1).
- **[../hubspot-mcp-bridge/deploy.sh](../hubspot-mcp-bridge/deploy.sh)** —
  Phase 3 HubSpot MCP bridge (IAM-gated, secret `hubspot-mcp-token`).
- **[GO-LIVE-UNBLOCK.md](GO-LIVE-UNBLOCK.md)** — historical OAuth saga
  (obsolete since the org move; kept for context).

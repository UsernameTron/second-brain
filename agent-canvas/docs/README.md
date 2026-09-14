# Agent Canvas documentation map

This index prevents plans, historical handoffs, and live claims from being
treated as interchangeable.

**Non-technical users start here:** the two-page [quick guide PDF](../output/pdf/Agent-Canvas-Quick-Guide.pdf)
and [editable Word copy](../output/docx/Agent-Canvas-Quick-Guide.docx) give simple
steps for everyday requests and the more advanced functions. The
[illustrated HTML guide](../output/html/Agent-Canvas-User-Guide.html) adds
enlargeable screenshots, a checklist and a two-page print view in one offline file. The full
[../USER-GUIDE.md](../USER-GUIDE.md) covers the agent team, recovery and safety
promises. These guides describe the simplified local build. Everything below
is for builders and operators.

## Authority order

When two claims conflict, use this order:

1. A fresh production probe for live service, configuration, and connector
   claims.
2. Current `master` source, migrations, and executable tests for implemented
   behavior.
3. Git history for merge and commit claims.
4. The top current-state block in [HANDOFF.md](HANDOFF.md) for the latest
   reconciled snapshot.
5. [ROADMAP.md](ROADMAP.md) for intended sequence and acceptance gates.
6. Historical and reference documents for rationale only.

`planned`, `implemented`, `merged`, `deployed`, and `live-accepted` are distinct
states. “Complete” means merged, deployed, and accepted in the real signed-in
journey; tests alone do not establish it.

## Current operational documents

- [2026-09-14 finalization](releases/2026-09-14-finalization.md) — fresh gates,
  scoped PR preparation and authorized deployment tracking.

- [2026-09-14 completion audit](releases/2026-09-14-simplification-audit.md) — all
  three reproduced implementation gaps closed locally, with regression evidence.
- [2026-09-14 release review](releases/2026-09-14-ui.md) — exact local image,
  verification, live baseline, approval boundaries and rollback; not deployed.
- [UI-TESTING.md](UI-TESTING.md) — complete local browser test command, coverage,
  screenshot evidence, fixes and explicit live-testing limits.
- [SIMPLIFICATION.md](SIMPLIFICATION.md) — approved UX/reliability phases,
  complete control destinations and local verification evidence; not a deploy claim.
- [HANDOFF.md](HANDOFF.md) — the current-state block, and nothing else. Kept
  short on purpose so the live claim is never buried.
- [ACTIVATION-RUNBOOK.md](ACTIVATION-RUNBOOK.md) — the enumerated owner
  actions that light up built-but-dark capability (connector tool ticks,
  Gauge staffing, content-lane first run, scheduler resume order, the parked
  qualification-engine scope probe). Owner actions only; every step ends in a
  probe.
- [DEPLOY.md](DEPLOY.md) — current deployment and scheduler procedure.
- [DEVOPS-HANDOFF.md](DEVOPS-HANDOFF.md) — short operations router.
- [ROADMAP.md](ROADMAP.md) — phase classification and remaining P6/P7 intent.
- [../README.md](../README.md) — product and local-development orientation.
- [../CLAUDE.md](../CLAUDE.md) — working agreement for agents in this subtree.

## Reference documents

Reference material describes an optional external tool surface. It does not
prove that a connector, permission, or deployment is live — only a fresh
capability probe does.

- [HUBSPOT-AGENT-CLI.md](HUBSPOT-AGENT-CLI.md) — the HubSpot Agent CLI / MCP
  surface, read from a published package on 2026-08-13. Its version, transport,
  and tool-count claims need a fresh probe before being relied on.
- [FRONTEND-SPEC.md](FRONTEND-SPEC.md) is the original frontend design baseline;
  current components and tests supersede its inventory.

## Historical records

These files remain because they preserve decisions and failure history. They
are not current instructions, status ledgers, or backlogs. Each one opens with a
banner saying so:

- [HANDOFF-HISTORY.md](HANDOFF-HISTORY.md) — the implementation and incident
  record split out of `HANDOFF.md` on 2026-08-16, preserved verbatim.
- [AUTONOMOUS-EXECUTION.md](AUTONOMOUS-EXECUTION.md)
- [GO-LIVE-UNBLOCK.md](GO-LIVE-UNBLOCK.md)
- [IMPROVE-FINDINGS.md](IMPROVE-FINDINGS.md)
- [PORTFOLIO-FOLD-IN.md](PORTFOLIO-FOLD-IN.md)
- [WAVE2-SOI-RUNBOOK.md](WAVE2-SOI-RUNBOOK.md)

## Truth-maintenance rule

After a merge, deployment, rollback, or live acceptance, update the top block
of `HANDOFF.md` in the same close-out change. Never convert a roadmap intention
into a shipped claim without source evidence, and never convert a source claim
into a live claim without a production probe. Preserve old reasoning as history;
do not leave it masquerading as the next instruction.

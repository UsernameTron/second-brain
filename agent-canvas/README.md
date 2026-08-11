# Agent Canvas Workspace

A shared visual canvas where the cloudtechgurus.com team drives multiple AI agents by text or voice. Agents hold focused roles (research, coding, review), run in parallel on the same project, hand work to each other, and escalate to a human only when a decision genuinely needs one. A persistent, provenance-carrying project memory holds what the agents learn.

One deployable service: Node 22 + Express + WebSocket + SQLite (Litestream→Cloud Storage in production) + a Vite/React frontend, running on Cloud Run. Google sign-in restricted to cloudtechgurus.com plus an owner-editable allowlist.

## The memory contract (the product)

- **Append-only.** `memory_entries` rows are never updated or deleted. A correction inserts a new entry and stamps `superseded_by` on the old one inside a transaction — concurrent corrections of the same entry surface as a human escalation, never last-write-wins.
- **Provenance on every write:** authoring agent/user, source, timestamp, producing run.
- **Explicit epistemic state** on every entry — `verified` / `inference` / `assumption` — rendered distinctly (shape + color) in the UI and delivered verbatim to agents, never flattened.
- **Contamination tracing.** Citations record which entries fed which; `run_reads` records what each run had in context. Correcting an entry flags everything downstream of it (transitively) and the lineage view answers "which input produced this output" for any entry.

Key files: `server/memory.js` (contract), `server/orchestrator/runner.js` (run loop with hard step/wall-clock budgets), `server/orchestrator/tools.js` (agent tool surface incl. handoff/livelock/escalation), `server/orchestrator/control.js` (global pause + daily budget), `server/audit.js` (hash-chained audit log), `server/auth.js` (Google sign-in + allowlist + per-canvas access).

## Runtime safety

- Hard per-run step budget and wall-clock timeout → halt + escalate, never loop.
- Livelock detection: an item bouncing between the same two agents more than twice escalates instead of dispatching.
- Global pause (any member) kills in-flight model calls instantly; owner-only resume.
- Daily token budget (owner-configurable) suspends new runs when spent; per-run/per-agent/per-day cost metering in the UI.
- Model routing by task weight: `claude-haiku-4-5` for intent parsing/routing and light agents, `claude-opus-5` for strong agents (both env-overridable).
- Immutable hash-chained audit log of every action, queryable by the owner; full workspace export as JSON.

## Quickstart

```bash
cd agent-canvas
npm install && (cd frontend && npm install && npm run build)
ANTHROPIC_API_KEY=sk-ant-... DEV_AUTH=1 node server/index.js
# open http://localhost:8080 — dev sign-in as pete@cloudtechgurus.com
npm test
```

Production deploy: `deploy/deploy.sh` — see [docs/DEPLOY.md](docs/DEPLOY.md).

The workspace seeds itself on first boot with the demo canvas **"Conference Lead Cleanup"**: 12 sample lead rows (junk fields, format problems, and two genuinely ambiguous rows), a pinned intake-rules note that feeds every agent run as live context, and three agents — **Scout** (research, strong tier), **Forge** (coding, fast tier), **Sentinel** (review, strong tier). Press **Run cleanup**: Scout triages rows and escalates the ambiguous ones to the needs-you tray, Forge turns findings into a reviewable change set, Sentinel verifies every change against the intake rules before rows are marked done.

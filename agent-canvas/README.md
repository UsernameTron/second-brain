# Agent Canvas Workspace

A shared intelligence workspace where the cloudtechgurus.com team asks questions,
inspects evidence, assigns work to focused AI agents, and approves consequential
actions. Agents can work in parallel, hand work to each other, and escalate only
the decisions that genuinely need a person. A persistent, provenance-carrying
project memory holds what they learn.

One deployable service: Node 22 + Express + WebSocket + SQLite (Litestream→Cloud Storage in production) + a Vite/React frontend, running on Cloud Run. Google sign-in restricted to cloudtechgurus.com plus an owner-editable allowlist.

## The memory contract (the product)

- **Append-only content.** A correction inserts a new memory entry; the old
  entry is retained and linked through `superseded_by`. That lineage link is the
  only permitted update to the old row. Concurrent corrections surface as a
  human escalation, never last-write-wins.
- **Provenance on every write:** authoring agent/user, source, timestamp, producing run.
- **Explicit epistemic state** on every entry — `verified` / `inference` / `assumption` — rendered distinctly (shape + color) in the UI and delivered verbatim to agents, never flattened.
- **Contamination tracing.** Citations record which entries fed which; `run_reads` records what each run had in context. Correcting an entry flags everything downstream of it (transitively) and the lineage view answers "which input produced this output" for any entry.

Key files: `server/memory.js` (contract), `server/orchestrator/runner.js` (run loop with hard step/wall-clock budgets), `server/orchestrator/tools.js` (agent tool surface incl. handoff/livelock/escalation), `server/orchestrator/control.js` (global pause + daily budget), `server/audit.js` (hash-chained audit log), `server/auth.js` (Google sign-in + allowlist + per-canvas access).

## Runtime safety

- Hard per-run step budget and wall-clock timeout → halt + escalate, never loop.
- Livelock detection: an item bouncing between the same two agents more than twice escalates instead of dispatching.
- Global pause (any member) kills in-flight model calls instantly; owner-only resume.
- Daily USD spend budget (owner-configurable) suspends new runs when spent;
  per-run/per-agent/per-day cost metering remains visible in the UI.
- Model routing by task weight: `claude-haiku-4-5` for intent parsing/routing and light agents, `claude-sonnet-5` for strong agents (both env-overridable).
- Tamper-evident hash-chained audit log of every action, queryable by the owner;
  optional locked Cloud Logging retention provides the irreversible layer.
- Owner operational-ledger export as JSON. It covers the principal work and
  audit ledgers but is not yet a complete backup of every product table; token
  and credential material is intentionally excluded.

## Current source surfaces

- **Home:** ask in plain language, read the answer first, inspect evidence and
  open the Explain Map.
- **Needs You:** one review queue for decisions, conflicts, approvals, and
  scheduled-rule attention.
- **Rooms:** maintain bounded evidence collections with refresh and screened
  export.
- **Agent Builder:** describe a job, review the generated role and authority,
  rehearse it, then publish a version as owner.
- **Standing Rules:** interpret, rehearse, activate, pause, and revoke scheduled
  read-only work. The scheduler must be wired separately; visible UI is not
  proof that scheduled execution is live.

## Quickstart

```bash
cd agent-canvas
npm install && (cd frontend && npm install && npm run build)
ANTHROPIC_API_KEY=sk-ant-... DEV_AUTH=1 node server/index.js
# open http://localhost:8080 — dev sign-in as pete@cloudtechgurus.com
npm run verify
```

`npm run verify` is the gate: backend tests, frontend tests, the frontend
production build, `deploy.sh` syntax, and the deploy preflight self-test. Plain
`npm test` runs the **backend only** — it has passed while the frontend suite
was red, so do not read it as a green light. Before proposing a commit, add
`npm audit --omit=dev` in both the root and `frontend/`.

Documentation map: [docs/README.md](docs/README.md). Production deploy:
`deploy/deploy.sh` — see [docs/DEPLOY.md](docs/DEPLOY.md).

The workspace seeds itself on first boot with the demo canvas **"Conference Lead Cleanup"**: 12 sample lead rows (junk fields, format problems, and two genuinely ambiguous rows), a pinned intake-rules note that feeds every agent run as live context, and three agents — **Scout** (research, strong tier), **Forge** (coding, fast tier), **Sentinel** (review, strong tier). Press **Run cleanup**: Scout triages rows and escalates the ambiguous ones to the needs-you tray, Forge turns findings into a reviewable change set, Sentinel verifies every change against the intake rules before rows are marked done.

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

- **Workspace:** a fresh installation starts empty. Create a canvas, choose the
  agents that belong on it, and add the people and context needed for that
  piece of work; the product does not manufacture a sample project.
- **Home:** ask in plain language, read the answer first, inspect evidence and
  open the Explain Map.
- **Canvas:** add, edit, pin, and remove notes on a canvas you can edit. Pinned notes are
  intentionally included in future runs on that canvas; removed notes leave
  the active workspace while their audit history is retained. Use
  **+ Document** for PDF, Word (`.docx`), TXT, Markdown, CSV, JSON, or XLSX
  documents up to 5 MB. Agents can read those documents through
  `read_canvas_files`; removing one excludes it from future
  agent reads while retaining deletion provenance. Connected Drive/Docs remains
  the path for documents that should stay in Google Workspace.
- **Needs You:** one review queue for decisions, conflicts, approvals, and
  scheduled-rule attention.
- **Rooms:** maintain bounded evidence collections with refresh and screened
  export.
- **Agent Builder:** describe a job, review the generated role and authority,
  rehearse it, then publish a version as owner.
- **Enrichment:** a roster agent that returns information for every requested
  lead using Radar's lead-data connections, without requiring the lead to meet
  Radar's hot-lead threshold. It reports provenance and gaps instead of hiding
  records that do not qualify.
- **SDR:** a roster agent that takes a target-account list from enrichment to
  human-approved CRM staging (records and their associations) and draft-only
  opener emails, and assembles pre-call briefs from canvas memory and
  per-record engagement history. CRM writes go through preview → Needs You
  approval → apply, against the sandbox HubSpot portal only and only when the
  ops-runner is configured; paid enrichment requires the enrichment dispatch
  lane (currently dark in production); opener drafts exist only under full
  Gmail scopes and are never sent — no send capability exists.
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

## Workspace content contract

First boot creates access and durable system configuration, but no user
workspace content: no demo canvas, sample rows, sample runs, fabricated
memories, pinned instructions, or kickoff task. Users create a canvas and staff
it from the agent roster. Canvas notes are user-authored context, not a hidden
configuration channel; the canonical ICP taxonomy is the committed registry
exposed to authorized agents through `read_registry`, not a visible note that
can drift out of sync.

The former **Workbook**, **Run cleanup**, sample-row, and reviewable-demo-change
set journey is retired. Those fixtures are not document analysis. Real
documents enter through **+ Document** or the user's connected Google
Drive/Docs tools; the relevant source and permission are recorded as evidence.
Historical ledger records remain exportable for audit, but retired demo content
does not appear as active workspace content.

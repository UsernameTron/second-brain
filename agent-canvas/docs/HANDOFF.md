# Agent Canvas — Session Handoff (2026-08-13)

Fresh-context orientation for the next session. Everything here was true at
handoff time; verify anything load-bearing with a probe or a gcloud describe
before depending on it.

## What this is

Multi-agent canvas workspace for cloudtechgurus.com (~10 seats). Agents with
executive personas (Fred/strategic, Darren/commercial, Jess/operational,
Atlas/workspace) work on shared visual canvases, use the directing user's
Google Workspace, remember decisions in an append-only memory with epistemic
states (verified/inference/assumption), supersession, citation lineage, and
taint propagation. Escalations go to a human tray; runs carry step budgets,
wall clocks, spend metering against a daily cap, livelock detection, global
pause with epoch fencing, and a hash-chained audit log.

- **Code:** `agent-canvas/` in UsernameTron/second-brain, branch
  `claude/agent-canvas-workspace-1qquiu` (~40 commits), **draft PR #99**.
- **Tests:** 62/62 (`cd agent-canvas && npm test`). CI job `agent-canvas-test`.
- **Docs:** `docs/DEPLOY.md`, `docs/GO-LIVE-UNBLOCK.md`, `docs/FRONTEND-SPEC.md`.

## Deployed state (LIVE and proven)

- **GCP project:** `agent-canvas-ctg-0811` (number 1072020835166), inside org
  `cloudtechgurus.com` (609954620663). Owners: cpeteconnor@gmail.com (bootstrap
  identity) AND pete@cloudtechgurus.com.
- **Cloud Run:** service `agent-canvas`, us-central1. TWO hostnames, both real,
  both registered on the OAuth client:
  - https://agent-canvas-mqqftm2ora-uc.a.run.app
  - https://agent-canvas-1072020835166.us-central1.run.app
- **OAuth:** consent screen **Internal** (org-moved 2026-08-13; the whole
  tester-list saga in GO-LIVE-UNBLOCK.md is obsolete). Client id
  `1072020835166-veol39lc5meet0h5v1ftl272moudki9f.apps.googleusercontent.com`;
  client secret in Secret Manager `google-oauth-secret`.
- **Model:** `MODEL_PROVIDER=anthropic` — the **bridge**, not the destination.
  Key in Secret Manager `anthropic-api-key` (v3+; v2 is a corrupted
  bullet-masked paste, never use). Vertex is the intended provider; see
  "Vertex return" below.
- **Workspace data APIs** (gmail/drive/sheets/calendar-json) enabled manually
  on the live project; deploy.sh now enables them for future deploys.
- **Proven live:** sign-in, per-user Workspace connect, probes (gmail 1032ms,
  drive 91ms, sheets 69ms, model 665ms), Scout memory-write run, and a full
  Darren→Jess handoff with a protocol-correct synthesis (see memory on the
  Executive Roundtable canvas — it is the demo artifact).

## The two-identity trap (cost ~2 days; read before touching GCP)

The project was bootstrapped by cpeteconnor@gmail.com; the org/work identity is
pete@cloudtechgurus.com. Both now have owner, but console pages open under
whichever authuser the browser prefers. When a console page 403s, append
`&authuser=<the-other-one>`. The Mac's gcloud runs as the gmail account.

## Redeploy procedure (env vars are set WHOLESALE — partial redeploys drop them)

```bash
cd ~/projects/second-brain && git pull origin claude/agent-canvas-workspace-1qquiu
export PROJECT_ID=agent-canvas-ctg-0811
export MODEL_PROVIDER=anthropic
export ANTHROPIC_API_KEY='<current key — console.anthropic.com>'
export GOOGLE_CLIENT_ID='1072020835166-veol39lc5meet0h5v1ftl272moudki9f.apps.googleusercontent.com'
export GOOGLE_CLIENT_SECRET='<from Secret Manager google-oauth-secret>'
export OWNER_EMAIL=pete@cloudtechgurus.com
./agent-canvas/deploy/deploy.sh
```
Exports one-per-line on purpose: Pete's terminal mangles backslash
continuations, and once masked a pasted key into literal U+2022 bullets that
got stored as a real secret version (the health lamp now detects that case).

## PENDING — a redeploy is owed

Four merged fixes are NOT yet on the live revision: masked-key detection,
Office-file read workaround message, **scored memory retrieval** (agents'
multi-word searches were silently missing seeded facts), run-summary fallback.
Run the redeploy above.

## Open items, in rough order

1. **Vertex return.** Quota requests for Anthropic models auto-DENIED on
   2026-08-13 (new project + personal billing at the time). **Billing was
   swapped to the org account Dev Ops Pipeline `01ED6F-426C14-5CCD33` later
   that day** (verified `billingEnabled: true`), which was the lever — so the
   REFILE is the pending action, not the swap. Refile small: Global online
   prediction REQUESTS 10/min AND input tokens 100k/min, base_models
   anthropic-claude-haiku-4-5 + anthropic-claude-sonnet, region **global**
   (us-east5 404s these models for this project). On approval:
   `--update-env-vars MODEL_PROVIDER=vertex`, then delete the Anthropic key.
   If auto-denied again, reply to the denial email for human review, citing
   the org-owned billing account and the 10-seat internal use case.

   Billing note: CTG Production (`01DDA7-18F84C-0510F2`) was the first choice
   for its spend history, but pete@ lacks `billing.resourceAssociations.create`
   on it; Dev Ops Pipeline linked without a grant. Either is org-owned.
2. **HubSpot lamp.** Client built+tested; needs two commands (printed by the
   deploy banner, STEP 2): run.invoker grant on ctg-hs-ops-runner (project
   ctg-hs-exec-tool) + `HS_OPS_RUNNER_URL` env. Writes are preview-first;
   apply only in escalation-resumed runs. Sandbox portal 246460341 only.
3. **Team launch.** Admin → verify allowlist matches real mailboxes
   (fred@/darren@/jessica@), invite; each clicks Connect once. Consent is
   Internal so no warnings. Set the daily budget deliberately (default $25).
4. **MCP.** Layer built+tested (Streamable HTTP, per-tool enablement); no
   connector configured. `MCP_SERVERS` env or `config/mcp.json`.
5. **xlsx parsing.** Darren found the real HubSpot CRM export in Drive and
   could not read it (Office file). Error now explains the convert-to-Sheet
   workaround; native parsing is the queued feature.
6. **PR #99** — draft; mark ready/merge to call it shipped. CodeQL was clean
   at last check; CI test job green after the condition-wait fix.
7. **Loose ends:** CUE mascot → `frontend/public/mascot.png` + rebuild;
   confirm old Anthropic keys (exposed in chat twice) are deleted, not just
   superseded; billing-swap verification (item 1).

## Architecture cheat sheet

`server/` — index (boot/seeds), routes (API+OAuth+health/probes), auth
(Google sign-in, hd+allowlist per request), memory (the contract:
supersession/lineage/taint/verification-authority), db (SQLite, additive
migrations at bottom), audit (hash chain), ws (presence),
google/workspace.js (per-user OAuth tools, scope modes full|standard,
guardrails structural), hubspot/opsrunner.js (IAM client of Pete's
policy-gated runner), mcp/client.js, orchestrator/ (queue+reconciler,
runner, tools registry incl. ws_/hs_/mcp_, control=pause/budget,
anthropic=provider seam vertex|gemini|anthropic, gemini adapter).
`frontend/src/` — Workspace (hub), Canvas (nodes/edges/Tidy/Fit),
CapabilitiesModal (systems board + matrix + connect), MemoryPanel, Tray,
HUD in Workspace; styles.css is fully tokenized, light=CTG brand,
dark=TOS bridge console, theme per-account.
`server/seed.js` — demo canvas + Executive Roundtable (personas embed the
synthesis protocol; confidentiality guard refuses exact ARR/valuation).
The confidential CTG Context Intelligence Brief is deliberately NOT in the
workspace and must never be seeded — its subjects sign into this product.

## House rules that held all session

Read broadly, write reasonably, destroy never — enforced structurally
(operations that don't exist can't be called), per-user identity everywhere
(runs carry initiated_by through handoff chains), every external call
audited, lamps never fake green (dark = honestly unwired), and every claim
verified against a tool result before telling the user — the js-yaml lesson.

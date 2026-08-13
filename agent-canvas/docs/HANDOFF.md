# Agent Canvas — Session Handoff (2026-08-13, end of day)

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

- **Code:** `agent-canvas/` in UsernameTron/second-brain — **PR #99 MERGED
  to master 2026-08-13** (squash, ~55 commits; CodeQL-remediated, final
  review hardened). Follow-up work starts from master on a fresh branch.
- **Tests:** 68/68 (`cd agent-canvas && npm test`). CI job `agent-canvas-test`.
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
cd ~/projects/second-brain && git checkout master && git pull origin master
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
The `<placeholders>` above are NOT copy-pasteable — deploy.sh now REFUSES
values not shaped like the real credentials (sk-ant-* / GOCSPX-*) after the
2026-08-13 incident below.

## 2026-08-13 afternoon: the placeholder-paste incident (resolved)

The redeploy runbook was pasted verbatim, placeholders included, and deploy.sh
stored `<current key — console.anthropic.com>` as anthropic-api-key v4 and
`<from Secret Manager google-oauth-secret>` as google-oauth-secret v3. Both
env vars reference `:latest`, so the live revision served garbage: model calls
failed (the masked-key lamp caught it — non-ASCII) and OAuth sign-in broke at
token exchange. Recovery, in order: destroyed v4/v3 → discovered Secret
Manager's `latest` does NOT fall back (it pins to the highest-numbered version
even when destroyed, and new revisions fail validation) → copied the good
payloads forward (anthropic v3→v5, oauth v2→v4) via piped gcloud calls →
shape-checked `latest` (sk-ant- / GOCSPX-) → rolled revision agent-canvas-00018.
Structural fix: deploy.sh paste-guard (merged). Lessons: `latest` is a version
pointer, not a health pointer; and runbooks with placeholders get pasted whole.

## Redeploy: DONE 2026-08-13 (latest: revision agent-canvas-00022-d4s)

All four fixes (masked-key detection, Office-file workaround message, scored
memory retrieval, run-summary fallback) went live on 00018; the day ended on
**00022-d4s**, which additionally carries the CUE mascot (sign-in card +
tray), the canvas-lifecycle feature (below), and HS_OPS_RUNNER_URL wired.
Secret Manager versions have piled up (anthropic-api-key v8, google-oauth-secret
v7) — that's deploy.sh re-adding the same good values each run, normal and
harmless; latest is always shape-verified by the paste-guard.
In-app verification CONFIRMED 2026-08-13 evening: sign-in, every lamp green
(MODEL, GMAIL, DRIVE, SHEETS, CALENDAR, AUDIT CHAIN, DATABASE, WEB SEARCH,
HUBSPOT), MCP dark by design, Workspace connected. Pete ran the full test
pass — no errors.

## Canvas lifecycle (merged + live 2026-08-13 evening, PR #102)

The switcher is now a daily driver, not demo furniture: a **"+"** in the
topbar creates canvases inline (any member); an owner-only **Archive/Restore**
button hides a canvas from everyone's switcher while keeping it — rows,
memory, audit lineage — fully intact under an owner-visible "Archived"
optgroup. Additive `canvases.archived` column; `PATCH /canvases/:id` takes
`archived` and/or `access_mode` with all-or-nothing validation; both flips
audited. Plan of record: *Conference Lead Cleanup* (demo scaffolding: the
"How this demo works" note, conference-leads.csv, batch task) gets archived;
*Executive Roundtable* stays active — it holds the personas and the
Darren→Jess demo artifact.

## Open items, in rough order

1. **Vertex return — NOT BLOCKING, deprioritized.** Quota auto-denied TWICE
   (2026-08-13), the second time explicitly citing billing history, after
   billing moved to org account Dev Ops Pipeline `01ED6F-426C14-5CCD33`
   ($0 spend history — that was the flaw in the swap; CTG Production
   `01DDA7-18F84C-0510F2` has $84 but pete@ lacks
   `billing.resourceAssociations.create` on it). The Anthropic bridge works
   fine, so this is perimeter hygiene, not a blocker. Three paths, cheapest
   first:
   (a) **Wait.** The project now bills to Dev Ops Pipeline; running Agent
       Canvas accrues history there. Retry in ~30 days.
   (b) **Human review.** Reply to the denial email: org-owned billing,
       internal 10-seat tool, minimal initial quota. Auto-denials are often
       reversed by a human.
   (c) **Link CTG Production instead** (has the history): grant pete@
       Billing Account User at
       `console.cloud.google.com/billing/01DDA7-18F84C-0510F2/manage?authuser=pete@cloudtechgurus.com`,
       then `gcloud billing projects link agent-canvas-ctg-0811 --billing-account=01DDA7-18F84C-0510F2`,
       then refile.
   Refile shape when retrying: Global online prediction REQUESTS 10/min AND
   input tokens 100k/min, base_models anthropic-claude-haiku-4-5 +
   anthropic-claude-sonnet, region **global** (us-east5 404s these models).
   On approval: `--update-env-vars MODEL_PROVIDER=vertex`, then delete the
   Anthropic key.

2. **HubSpot lamp — runner ALIVE, wiring via console (2026-08-13 evening).**
   The runner is deployed and serving: Pete's console dashboard for
   ctg-hs-exec-tool shows Cloud Run in Resources, requests flowing, billing
   accruing. Coordinates confirmed against the runner repo
   (`~/projects/CTG-Workspace-Build/projects/ctg-hs-ops-runner/scripts/deploy.sh`:
   service `ctg-hs-ops-runner`, project `ctg-hs-exec-tool`, us-central1).
   An earlier "Run API disabled / org-policy" diagnosis was WRONG — built on
   a grep that swallowed stderr. The real problem is CLI-only: pete@ is
   roles/owner yet every `gcloud run`/`gcloud services` call against this
   project is denied (agent-canvas project works fine from the same shell).
   Prime suspect: stale quota-project in gcloud config — probe with
   `gcloud config list --format='value(billing.quota_project)'` and
   `gcloud config unset billing/quota_project`, then retry
   `gcloud run services list --project ctg-hs-exec-tool`.
   Lamp wiring goes around the CLI: (a) console → Cloud Run →
   ctg-hs-ops-runner → Security → add principal
   `agent-canvas-run@agent-canvas-ctg-0811.iam.gserviceaccount.com` as
   Cloud Run Invoker; (b) on the canvas project (CLI works there):
   `gcloud run services update agent-canvas --project agent-canvas-ctg-0811
   --region us-central1 --update-env-vars HS_OPS_RUNNER_URL=<console URL>`.
   DONE — lamp CONFIRMED GREEN 2026-08-13 evening ("Wired to
   ctg-hs-ops-runner, sandbox portal 246460341"): deterministic URL
   https://ctg-hs-ops-runner-874411154198.us-central1.run.app wired on
   revision agent-canvas-00019-wl8, Invoker granted via console. Writes are
   preview-first; sandbox portal 246460341 only. (Note: a
   script.google.com/.../exec URL also surfaced during wiring — that is a
   DIFFERENT Apps Script HubSpot tool, incompatible with the canvas's Cloud
   Run IAM auth; a natural first MCP connector candidate instead.)
3. **Team launch — DONE 2026-08-13.** Allowlist verified against real
   mailboxes, daily budget set deliberately, invites out to
   fred@/darren@/jessica@ (Internal consent: one Connect click each, no
   warnings). Darren's tray escalation answered the same evening (prospectus
   data for the expo) — the human-in-the-loop demo is closed end-to-end. The
   two chat-exposed Anthropic keys were deleted at console.anthropic.com;
   the live key is the sole survivor.
4. **MCP.** Layer built+tested (Streamable HTTP, per-tool enablement); no
   connector configured. `MCP_SERVERS` env or `config/mcp.json`.
5. **xlsx parsing.** Darren found the real HubSpot CRM export in Drive and
   could not read it (Office file). Error now explains the convert-to-Sheet
   workaround; native parsing is the queued feature.
6. **PR #99 — MERGED 2026-08-13** (squash, auto-merge after branch update).
   Final review added: deploy.sh credential paste-guard, shared state-JWT
   secret (dropped the hardcoded dev fallback), X-Content-Type-Options:
   nosniff on all responses.
7. **Loose ends:** CUE mascot → `frontend/public/mascot.png` + rebuild;
   delete old Anthropic keys at console.anthropic.com (exposed in chat twice;
   superseding isn't deleting) — the KEEPER is the key stored in
   anthropic-api-key v3/v5 (shape-verified live 2026-08-13); billing-swap
   verification (item 1).

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

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

## Redeploy: DONE 2026-08-13

All four fixes (masked-key detection, Office-file workaround message, scored
memory retrieval, run-summary fallback) are live on revision
agent-canvas-00018-czb with clean secrets (anthropic-api-key v5,
google-oauth-secret v4, both shape-verified). In-app verification loop
(sign-in, lamps, Scout probe, multi-word memory search, xlsx message) and
Darren's tray answer were with Pete at handoff time — confirm before assuming.

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

2. **HubSpot lamp — PARKED after 2026-08-13 investigation.** The two banner
   commands are correct in every coordinate (service `ctg-hs-ops-runner`,
   project `ctg-hs-exec-tool`, us-central1, per the runner repo at
   `~/projects/CTG-Workspace-Build/projects/ctg-hs-ops-runner/scripts/deploy.sh`),
   BUT the Cloud Run Admin API is DISABLED on ctg-hs-exec-tool and cannot be
   re-enabled: pete@ is roles/owner there, billing is healthy (CTG Production
   01DDA7-18F84C-0510F2, enabled), yet `gcloud services enable
   run.googleapis.com` fails with a serviceusage PreconditionFailure
   (subject 110002, AUTH_PERMISSION_DENIED). Prime suspect: org-policy
   restriction on service enablement. Next probe:
   `gcloud resource-manager org-policies describe serviceuser.services --project ctg-hs-exec-tool --effective`.
   Note the runner itself may need redeploying once the API is back (disabling
   the API stops its services); token secret HUBSPOT_SANDBOX_OPS_TOKEN status
   unverified. Writes are preview-first; sandbox portal 246460341 only.
3. **Team launch.** Admin → verify allowlist matches real mailboxes
   (fred@/darren@/jessica@), invite; each clicks Connect once. Consent is
   Internal so no warnings. Set the daily budget deliberately (default $25).
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

# Autonomous execution mandate — review the plans, then run them

Handoff for a fresh session. Start it with: *"Read
agent-canvas/docs/AUTONOMOUS-EXECUTION.md and execute it."* Written
2026-08-14 at the close of the planning week. Pete has delegated execution:
after the review step, plan → execute → verify proceeds WITHOUT his
oversight, inside the rails below. His only routine touchpoint is ticking
connector tools when he wants agents to have them.

## Step 0 — Bootstrap (prerequisite)

This file, the deep-dive specs, and the brief's **Revised wave order** live
on branch `docs/agent-canvas-deep-dive-specs`. If that branch is not yet
merged to master, merge it first (docs-only PR, auto-merge per the Git
policy below). Every wave branch cuts from master **after** that merge —
a "fresh master" that lacks this file cannot support the loop.

## Step 1 — Review, compare, improve (before any building)

Read, in order: [PORTFOLIO-FOLD-IN.md](PORTFOLIO-FOLD-IN.md) (all four
exercises: shortlist, context intelligence, Apps Script audit, deep-dive
specs), [HANDOFF.md](HANDOFF.md), [../CLAUDE.md](../CLAUDE.md) — and note
that file defers workflow to the repo-root `second-brain/CLAUDE.md`, which
governs. Then adversarially review the plans as a set:

- **Compare** the four exercises for contradictions, double-counting, and
  gaps (e.g. does the Context Wave's ontology distillation duplicate what
  SOI retrieval already answers? does the GTM bridge make any planned
  connector redundant?).
- **Re-verify the load-bearing claims** that gate wave order — the ones
  the specs flag as documented-not-observed: enrichment-dispatch LIVE
  state, GTM view→raw read-through, SOI reachability. A claim that fails
  re-verification changes the plan; record the correction in the brief and
  add a one-line pointer to it in the ledger. If a claim **cannot** be
  verified from the current surface (e.g. enrichment-dispatch LIVE needs a
  `gcloud describe` that pete@ lacks IAM for and cloud containers cannot
  run), mark the wave it gates `BLOCKED` in the ledger with the unverified
  claim in Notes, and continue — never assume it true. A local session
  clears `BLOCKED` rows by verifying the claim.
- **Improve where evidence warrants.** Every change to the brief must cite
  what was observed (tool result, file, probe) — no taste-based rewrites.
- Output of step 1: an updated PORTFOLIO-FOLD-IN.md (if warranted) and a
  **progress ledger** row appended to this file. Ship the Step-1 review as
  its own docs-only PR (same auto-merge rule) before Wave 1 — it is the
  one PR that is not per-wave. Then proceed immediately — do not wait for
  approval.

## Step 2 — The loop (per wave, from the brief's Revised wave order)

For each wave: **plan** (scoped tasks + written verification criteria) →
**execute** (feature branch, minimum diff, tests alongside) → **verify**
(the verification bar below) → **record** (update HANDOFF.md + the ledger
here) → next wave. Do not stop between waves; stop only on a Stop
Condition.

**Verification bar:** `npm test` green · deployed changes probed live
(connector probe returns tool count + latency) · one agent smoke run
exercising the new capability end-to-end with its audit entry confirmed ·
lamps honest (dark = unwired, never faked) · docs updated in the same PR.
A wave's ledger row reads `DONE` only after the full bar passes — no
exceptions; until then it is `READY-TO-DEPLOY` at best.

**Surface split:** cloud sessions build code, tests, and docs and open the
PR with an exact deploy runbook; anything needing `gcloud`/deploys runs
from a local Mac session. If you are cloud-only, finish the wave to
"PR + runbook" state, record it in the ledger as `READY-TO-DEPLOY`, and
continue to the next wave's code — deploys batch up for the next local
session, whose **first duty** is running the deferred verification bar for
every `READY-TO-DEPLOY` and `BLOCKED` row before starting new wave code.
A row flips to `DONE` when the bar passes; if the bar fails for a fixable
reason (deploy defect, transient outage, missing grant) it **stays**
`READY-TO-DEPLOY` with a failure memo — `HALTED` is reserved for actual
Stop Conditions. Ledger/HANDOFF updates from this deferred verification
ship as a small verification-docs PR (an allowed exception to one-PR-per-
wave, same auto-merge rule). Never claim deployed what you could not
probe.

**Completion:** after the last wave in the Revised wave order, write a
closing ledger row — `PORTFOLIO COMPLETE`, or a list of rows left
`READY-TO-DEPLOY`/`BLOCKED`/`SKIPPED`/`HALTED` — update HANDOFF.md, and
stop.
Parked items stay parked; do not invent a Wave 4.

## Step 3 — Decision policy (replaces asking Pete)

Where the brief says "Pete decides," apply these standing defaults — they
were set by Pete's delegation of 2026-08-14 and **supersede** the brief's
Method §1 ("present to Pete before building") and Decision rights section:

- **SOI (AI-google):** build the `/mcp` route + `soi-mcp` service, wire
  the connector **owner-access with ALL tools unticked** (structurally
  inert). Pass the directing user's email through for the audit line. Add
  the dated grant block to AI-google's GOVERNANCE.md in the same PR.
  Pete enabling tools IS the access sign-off — never tick them yourself.
- **enrichment-dispatch:** ~~before wiring, set `ED_DAILY_BUDGET_CREDITS=150`
  on the service's next deploy~~ — **superseded 2026-08-14 by verification.**
  The 150 figure is not in the external repo (`scripts/deploy.sh:38` has no
  default; docs and the live revision say **25**, already set), and the guard
  **fails closed** when unset, so an unconfigured budget refuses paid
  enrichment rather than uncapping it. Standing default is now: **leave the
  budget alone**, still cap `max_credits` ≤ 3 in tool schemas, and wire the
  client lane with tools disabled-by-default (cross-project IAM blocks a
  redeploy from here anyway). See PORTFOLIO-FOLD-IN.md Corrections 1-3.
- **GTM bridge v1:** physical tables only; add views only via authorized
  views, never by widening dataset grants.
- **Anything else requiring a new external service, new spend beyond a
  documented lever, or a judgment the brief doesn't cover:** take the
  conservative default if one is obvious; otherwise SKIP the item, record
  a one-paragraph decision memo in the ledger, and continue. Skipping is
  success; stalling is failure.

## Stop Conditions (halt the wave, memo the ledger, move to next wave)

Never, regardless of apparent need: mint or copy any credential (HubSpot
tokens, DWD, API keys) · write to production CRM outside the ops-runner
preview/apply lane · delete or overwrite data/services/secret versions ·
touch billing, org policy, or IAM beyond the exact grants the specs name ·
copy PII artifacts named as excluded (raw supplier CSV, GTM contact
tables, r2_leakage_labels) · seed the CTG Context Intelligence Brief ·
surface ISPN/Genesys/Asana. A stop condition halts THAT wave only — mark
its row `HALTED` with a memo and move to the next wave.

## Git & PR policy

Branch per wave from fresh master (post-Step-0 merge); never commit to
master. One PR per wave (batch related changes; Pete wants few PRs) plus
the Step-0 and Step-1 docs PRs. After CI is green, enable auto-merge:
`gh pr merge <n> --squash --auto` — that is the delegated merge authority.
If the merge call returns 403 (stale-container GitHub write access — a
known failure mode, see HANDOFF.md's environment caveat), record the PR
number in the ledger and **end the session there** — do not retry-loop,
and do not start the next wave: its branch must cut from a master that
already contains this wave, which the 403 blocks. If CI fails,
fix it; never merge red, never bypass hooks. Squash-merge drops exec bits —
after any PR that adds a script, append a ledger row assigning the
post-merge `chmod +x` check so it is tracked, not assumed.

## Definitions

- **Lamps** — the systems-board integration statuses (`server/routes.js`
  systems list: ready/attention/planned/down). Note an MCP lamp reads
  `ready` from `enabledTools.length` — config, not probe evidence — so a
  green lamp never substitutes for the connector probe in the
  verification bar; they are separate required checks. Dark/planned =
  honestly unwired (house rule: "lamps never fake green").
- **Probe** — two senses in the docs: the health-lamp latency probe
  (gmail/drive/model timings) and the **connector probe** that returns the
  server's tool inventory + latency. The verification bar means the
  connector sense.
- **ops-runner preview/apply lane** — the sandboxed HubSpot write path
  (`server/hubspot/opsrunner.js`; sandbox portal 246460341 only),
  governed by ADR-0041 in `~/projects/CTG-Workspace-Build/decisions/adr/`:
  writes are sandbox-only, preview/dry-run first, apply explicitly
  confirmed; the service never bypasses the dry-run digest.
- **Ledger Status vocabulary** — `IN-PROGRESS` · `READY-TO-DEPLOY` (cloud
  built, bar deferred to local; also where a fixable verification failure
  lands, with memo) · `BLOCKED` (gating claim unverifiable from current
  surface; claim named in Notes) · `DONE` (full bar passed) · `SKIPPED`
  (decision memo in Notes) · `HALTED` (actual Stop Condition only, memo
  in Notes).

## Progress ledger (append-only; newest session on top)

| Date | Session | Wave | Status | Notes |
|---|---|---|---|---|
| 2026-08-14 | local exec | — | **PORTFOLIO NOT COMPLETE — nothing deployed** | Every wave in the Revised wave order was worked and every one is `READY-TO-DEPLOY` or `BLOCKED`; **zero rows reached `DONE`, because no row can.** The deploy is the common blocker: `./agent-canvas/deploy/deploy.sh` was refused by this session's permission layer, so nothing built here has reached Cloud Run and no connector probe, agent smoke run, or lamp check has been performed. Four PRs merged: **#121** Step-1 review · **#122** Wave 1 sr-icp row · **#123** Wave 2 ED lane + SOI runbook · **#124** hardening + context registries. `npm test` 123/123 (was 95). **The next local session's first duty** is the deferred verification bar for every `READY-TO-DEPLOY` row, in the order below. Rows left `BLOCKED`: GTM bridge (BigQuery grant), SOI deploy (`ctg-workspace-dev` CLI), Wave 3 upstream v6 (`gh auth switch`), Apps Script parity (needs a live run). Parked items stay parked; no Wave 4 was invented. |
| 2026-08-14 | local exec | Step 1 | DONE | Review shipped in PORTFOLIO-FOLD-IN.md § "Step-1 adversarial review". 3 gating claims re-verified: SOI LIVE (IAP answered), ED LIVE (401-vs-404 discriminator), GTM **unverifiable**. 3 corrections + 4 cross-exercise gaps recorded there. Step 0 already satisfied — #119/#120 are on master. |
| 2026-08-14 | local exec | Step 3 correction | DONE | **`ED_DAILY_BUDGET_CREDITS=150` is not a real figure** — `scripts/deploy.sh:38` has no default; docs and the live revision say **25**, already set. Action: change nothing. Also the guard **fails closed** when unset (`app/company.py:246-254`), so the ED lane cannot cause spend. See brief Corrections 1-2. |
| 2026-08-14 | local exec | 3 (harvest half) | READY-TO-DEPLOY | Supplier catalogue (420 rows) + org-context distillation (84 FACT nodes) shipped as committed registries with ingress filters — excluded-vendor list applied per field, commission terms stripped, contradicted/INFERENCE/UNKNOWN nodes refused. Exposed via one `read_registry` tool rather than a canvas note: `read_notes` returns every note in full, so 130KB there would tax every call. The supplier CSV (420 emails, 406 phones, 402 commission rates) was never read. |
| 2026-08-14 | local exec | 3 (upstream v6 half) | BLOCKED | The title-taxonomy + advisor-match classifier harvests must land **upstream first** in `ctg-signal-radar` so `icp-sr-icp-v5.json` stays the single generated truth (brief's rule). That repo is `peteconnorCTG/CTG_Signal_Detection_App` — a different GitHub account needing a machine-wide `gh auth switch`, and its working tree is already dirty with unrelated deletions. Hand-editing the exported JSON here instead would break single-source-of-truth, which the brief explicitly forbids. Clears when Pete pushes the upstream change and re-exports as v6; the canvas side is then one committed JSON + a note that `find_icp_leads` stays v5-scored until the fly.dev service is re-exported (gap 3). |
| 2026-08-14 | local exec | 3 (Apps Script parity) | BLOCKED | Assigned to Wave 3 by the Step-1 review. Needs a live canvas run answering each of the exec-tool page's five locked-button questions — impossible while the deploy is blocked. |
| 2026-08-14 | local exec | Hardening | READY-TO-DEPLOY | Not a brief wave — the operator's added ask ("create agents, /improve as the outcome"). Read-only survey → [IMPROVE-FINDINGS.md](IMPROVE-FINDINGS.md), 15 findings; **12 fixed**, 3 open with reasons in its disposition table. Headlines: data/instruction boundary on all retrieved content, DEV_AUTH production backstop, real per-call wall clock + timeouts on every outbound fetch, single-finish guarantee, connectors refused mutating tool names. Two agents added under `.claude/agents/`. 113/113 (was 95). |
| 2026-08-14 | local exec | 2 (SOI half) | BLOCKED | Unverified/unreachable: the deploy surface, not the claim — SOI itself is verified LIVE. `gcloud run`/`gcloud services` denied on `ctg-workspace-dev` for both identities (while `get-iam-policy` succeeds — same pattern as HANDOFF open item 8), and the code change lands in `peteconnorCTG/ctg-system-of-intelligence`, which needs a machine-wide `gh auth switch`. Route code, both deploy commands, connector settings (owner-access, tools UNTICKED) and the GOVERNANCE.md grant block are all written out in [WAVE2-SOI-RUNBOOK.md](WAVE2-SOI-RUNBOOK.md). No connector row seeded — the URL does not exist yet. |
| 2026-08-14 | local exec | 2 (ED half) | READY-TO-DEPLOY | `server/enrichment/dispatch.js` + 4 tools, scoped research/targeting/commercial, absent unless `ED_DISPATCH_URL` is set. No commit tool (test-enforced); spend clamped to 3 credits/call; directing user required and forwarded as `x-caller-email`. Deploy runbook line 1 is the cross-project `run.invoker` grant, which this session could not make. Budget left alone per the Step 3 correction. 105/105. |
| 2026-08-14 | local exec | 1 (sr-icp half) | READY-TO-DEPLOY | `sr-icp-leadfinder` seeded as a connector row (`server/mcp/seed.js`), members-visible, tools EMPTY, no credential — the service takes no auth header. Seed key bumped `seed_mcp_v1`→`v2` so an already-seeded workspace picks up only the new row; audit now reports rows actually inserted, not the constant's length. 96/96. Bar's deploy+probe+smoke half runs after merge. |
| 2026-08-14 | local exec | 1 (GTM half) | BLOCKED | Unverified claim: `ctg_gtm_marts` contents and the view→raw read-through. No BigQuery access from either identity — `bigquery.jobs.create` denied in `ctg-hs-exec-tool`, and the cross-project pattern (job billed to canvas) is denied on `ctg_gtm_marts.INFORMATION_SCHEMA.TABLES`. Clears when someone with admin on `ctg-hs-exec-tool` grants `dataViewer` on `ctg_gtm_marts` to pete@. |

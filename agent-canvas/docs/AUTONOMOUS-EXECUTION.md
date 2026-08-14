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
- **enrichment-dispatch:** before wiring, set `ED_DAILY_BUDGET_CREDITS=150`
  on the service's next deploy and cap `max_credits` ≤ 3 in tool schemas.
  The 150 figure is deploy.sh's documented example value in the external
  `ctg-enrichment-dispatch` repo — verify it there before setting. If you
  cannot redeploy the service (cross-project IAM), wire the client lane
  with the tools disabled-by-default and mark the cap as the deploy
  runbook's first line.
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
| 2026-08-14 | planning (this file authored) | — | Brief final: 4 exercises, waves defined | Decisions delegated; defaults recorded above |

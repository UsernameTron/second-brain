# Autonomous execution mandate — review the plans, then run them

Handoff for a fresh session. Start it with: *"Read
agent-canvas/docs/AUTONOMOUS-EXECUTION.md and execute it."* Written
2026-08-14 at the close of the planning week. Pete has delegated execution:
after the review step, plan → execute → verify proceeds WITHOUT his
oversight, inside the rails below. His only routine touchpoint is ticking
connector tools when he wants agents to have them.

## Step 1 — Review, compare, improve (before any building)

Read, in order: [PORTFOLIO-FOLD-IN.md](PORTFOLIO-FOLD-IN.md) (all four
exercises: shortlist, context intelligence, Apps Script audit, deep-dive
specs), [HANDOFF.md](HANDOFF.md), [../CLAUDE.md](../CLAUDE.md). Then
adversarially review the plans as a set:

- **Compare** the four exercises for contradictions, double-counting, and
  gaps (e.g. does the Context Wave's ontology distillation duplicate what
  SOI retrieval already answers? does the GTM bridge make any planned
  connector redundant?).
- **Re-verify the load-bearing claims** that gate wave order — the ones
  the specs flag as documented-not-observed: enrichment-dispatch LIVE
  state, GTM view→raw read-through, SOI reachability. A claim that fails
  re-verification changes the plan; record the correction in the brief.
- **Improve where evidence warrants.** Every change to the brief must cite
  what was observed (tool result, file, probe) — no taste-based rewrites.
- Output of step 1: an updated PORTFOLIO-FOLD-IN.md (if warranted) and a
  **progress ledger** appended to this file (wave status table). Then
  proceed immediately — do not wait for approval.

## Step 2 — The loop (per wave, from the brief's Revised wave order)

For each wave: **plan** (scoped tasks + written verification criteria) →
**execute** (feature branch, minimum diff, tests alongside) → **verify**
(the Phase 3 bar below) → **record** (update HANDOFF.md + the ledger here)
→ next wave. Do not stop between waves; stop only on a Stop Condition.

**Verification bar (every wave, no exceptions):** `npm test` green ·
deployed changes probed live (probe returns tool count + latency) · one
agent smoke run exercising the new capability end-to-end with its audit
entry confirmed · lamps honest (dark = unwired, never faked) · docs
updated in the same PR.

**Surface split:** cloud sessions build code, tests, and docs and open the
PR with an exact deploy runbook; anything needing `gcloud`/deploys runs
from a local Mac session. If you are cloud-only, finish the wave to
"PR + runbook" state, record it in the ledger as `READY-TO-DEPLOY`, and
continue to the next wave's code — deploys batch up for the next local
session. Never claim deployed what you could not probe.

## Step 3 — Decision policy (replaces asking Pete)

Where the brief says "Pete decides," apply these standing defaults —
they were set by Pete's delegation of 2026-08-14:

- **SOI (AI-google):** build the `/mcp` route + `soi-mcp` service, wire
  the connector **owner-access with ALL tools unticked** (structurally
  inert). Pass the directing user's email through for the audit line. Add
  the dated grant block to AI-google's GOVERNANCE.md in the same PR.
  Pete enabling tools IS the access sign-off — never tick them yourself.
- **enrichment-dispatch:** before wiring, set `ED_DAILY_BUDGET_CREDITS=150`
  (deploy.sh's documented example value) on the service's next deploy and
  cap `max_credits` ≤ 3 in tool schemas. If you cannot redeploy the
  service (cross-project IAM), wire the client lane with the tools
  disabled-by-default and mark the cap as the deploy runbook's first line.
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
surface ISPN/Genesys/Asana. A stop condition halts THAT wave only.

## Git & PR policy

Branch per wave from fresh master; never commit to master. One PR per
wave (batch related changes; Pete wants few PRs). After CI is green,
enable auto-merge: `gh pr merge <n> --squash --auto` — that is the
delegated merge authority. If CI fails, fix it; never merge red, never
bypass hooks. Squash-merge drops exec bits — `chmod +x` scripts get
verified post-merge by the next session.

## Progress ledger (append-only; newest session on top)

| Date | Session | Wave | Status | Notes |
|---|---|---|---|---|
| 2026-08-14 | planning (this file authored) | — | Brief final: 4 exercises, waves defined | Decisions delegated; defaults recorded above |

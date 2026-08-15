# Agent Canvas — Session Handoff (2026-08-15)

Fresh-context orientation. Verify anything load-bearing with a probe before
depending on it. **The single current-state block is directly below; every
`## START HERE`/`## Superseded` block further down is prior-session history,
kept for the reasoning, not the status.**

## P1 SHIPPED TO MASTER (2026-08-15 — PRs #171–#175 + S6)

All six slices of the approved P1 roadmap (Inquiry Home / evidence receipts /
Explain Map — plan file `cosmic-pondering-axolotl`) are merged; suite
**199/199**. **DEPLOYED + LIVE-ACCEPTED 2026-08-15: revision
`agent-canvas-00047-jnz`, 100% traffic** (00046 carried P1; 00047 added the
dark-theme token fix #178 that Pete's probe caught — P1 CSS had hard-coded
light-theme colors). Pete's in-app probe passed all done-when criteria:
ICP-scoring question auto-routed to Radar (targeting), answered from memory
with a live v5/v6 skew check, receipt showed 1 search / 9 ranked scored
results / 0 written (the "cites nothing — unsupported summary" warning fired
correctly), Explain Map rendered. Env verified intact through the wholesale
set; `/api/config` 200 with `inquiryHome: true`; zero error logs.

Operational signal from the probe receipt (pre-existing, not P1): the
sr-icp-leadfinder MCP still serves v5 and refused three consecutive
find_icp_leads calls that run — the v6 connector push (branch
`feat/icp-v6-registry`, no origin remote) remains on Pete's list.

- **S1 evidence spine** (#171): `evidence_refs` + `evidence_citations`
  (entry→external artifact — the one missing edge); refs minted at the tool
  funnels with `[evidence_ref:]` markers OUTSIDE the external_content wrapper;
  `memory_write.evidence` validated per-run, atomic; receipt gains additive
  evidence keys with gmail/drive/sheet URI redaction for non-directing users.
- **S2 inquiries + run modes** (#173): `POST /canvases/:id/inquiries` parses
  AND dispatches (fast-tier pick, deterministic role fallback, tx rollback on
  429); `runs.mode` act|ask|rehearse — one MUTATING_TOOLS set enforced at
  offer AND call time; paid enrichment blocked outside act; escalation resume
  inherits the escalating run's mode via parentRunId.
- **S3 Inquiry Home** (#175): Home view is the signed-in landing (flag
  `inquiry_home`, default on; `setSetting('inquiry_home','0')` reverts with
  zero deploy). Answer-first cards: evidence chips, epistemic mix, conflict
  flags, "Not found:" lines, full receipt. Signed-out card carries the value
  prop + three questions.
- **S4 Explain Map** (#174): `server/explain.js` over existing records only;
  flow/evidence/impact lenses; 12-node deterministic collapse; verbs incl.
  `contradicted` on superseded cites; map==receipt evidence parity is
  test-asserted; "Read as steps" a11y alternative; "Why? → Map" in run detail.
- **S5 native XLSX** (#172): exceljs 4.4.0 exact-pinned (uuid overridden to
  ^11.1.1, npm audit clean); zip-bomb gate on declared uncompressed size;
  CSV-quoted cells; row/cell/sheet/time budgets with honest truncation
  markers; `XLSX_READ=0` kill-switch.
- **S6 command modes** (this branch): Ask/Act/Rehearse segmented control in
  the CommandBar; mode rides intent→confirm→dispatch.
- All 16 claude-review findings across the five PRs were fixed in-PR and
  re-reviewed clean (zip-bomb gate, mode laundering via escalation resume,
  paid enrichment in read-only modes, pause race in routing, etc.).

**Next:** deploy + in-app probe (ask a canonical question on Home, open
receipt + map, confirm evidence parity), then the P2 plan (people/NEEDS YOU)
when Pete calls it.

## MEMORY-OBSERVABILITY ROADMAP SHIPPED (2026-08-14, late session — PRs #152–#158)

All 7 waves of the approved roadmap (plan file: memory visible at read time)
are merged to master; tests **168/168**. **DEPLOYED 2026-08-14 late session:
revision `agent-canvas-00042-m82`** — clean boot, zero error logs, env
verified intact (`ED_DISPATCH_URL` + `HS_OPS_RUNNER_URL` on the revision),
`/api/config` 200. Migrations self-applied; `memory_fts` backfilled on boot.
Lamps are AMBER until probed, by design — Pete probes in-app.

- **0a hygiene+perf** (#152): memory_search description fixed (was claiming
  AND semantics), dead runner import gone, batched citation reads, taint
  walk short-circuits when nothing is superseded.
- **2 escalation capture** (#153): the server — not the resumed agent —
  writes the verified decision entry under the human's identity; resume
  runs inherit lineage from `escalation.context.entry_ids`; blank answers
  400 instead of silently no-opping; `tx()` is re-entrant now.
- **1 Context Receipt** (#154): `memory_retrievals` + `run_feedback`
  tables; `GET /runs/:id/receipt` (provided / searches / cited /
  feedback); receipt + 👍👎 in the AgentPanel run detail.
- **3 typed memory** (#155): kind/subject/applies_to/effective/review
  columns (all optional, untyped rows unaffected); filters everywhere;
  corrections inherit types.
- **0b a11y floor** (#156): :focus-visible everywhere, dialog semantics,
  ≤700px viewports fit — verified live in the browser at 375px.
- **4 FTS5 retrieval** (#157): bm25 over an external-content index (insert
  trigger only — store is append-only); scored-OR fallback if FTS5 absent
  or `MEMORY_FTS=0`; retrieval-quality eval (12 cases) passes under both.
- **5 analytics + conflicts** (#158): `GET /canvases/:id/analytics`
  (diagnosis, not a leaderboard) + deterministic same-subject
  verified-vs-verified conflict surfacing, computed on read.

Deliberately NOT built (dispositions in the plan): episodic memory (wait
for feedback data), embeddings (Vertex-only option; revisit if the eval
suite shows lexical recall failing on real queries), agent builder,
pipeline hygiene (lives in ctg-ops-automation).

## SESSION CLOSE (2026-08-15) — Gate 0 fully accepted; P1 is the next build

**Live:** revision **`agent-canvas-00045-gwg`**, 100% traffic (carries the
sr-icp v5 reseed / v6 Radar version-check prompt). Tests **169/169** on
master (`9fc75fa`). The whole systems board is green.

**Everything from the Gate 0 acceptance checklist is now DONE:**
- **SOI** — wired, probed (71ms), `org_knowledge_search` ticked, corpus-miss
  verified ×2 by live agent runs, corpus-hit verified with citations, and the
  connector access flipped `members`→`owner` (Pete, in-app 2026-08-15).
- **sr-icp** — start/poll pair exercised live: 10 Healthcare tier-1 leads,
  `icp_version: sr-icp-v6`, per-lead `why` arithmetic. v6 re-export proven.
- **/exec parity — CLOSED (Pete resolved Q1, 2026-08-15).** Q2–Q5 verified
  live against portal 243103424 via SA impersonation; Q1 Workflows (token had
  no `automation` scope) resolved by Pete in-app. The four verified /exec
  buttons and the Workflows button are all reconciled. *(Config-side changes —
  the SOI access flip and the Q1 resolution — are not headlessly re-verifiable
  from this Mac; recorded on Pete's confirmation.)*
- **Enrichment lamp** green; **ontology fix** merged (#180); **fly.dev v6
  re-export** live; **Dependabot** clear. All prior list items closed.

**OUTSTANDING (nothing blocks P1; ranked):**
1. **sr-icp connector source hygiene** — the v6 registry commit is on branch
   `feat/icp-v6-registry` in `CTG-Workspace-Build/projects/sr-icp-connector`,
   which has **no `origin` remote**. The fly.dev deploy is already live, so
   this is source-of-truth hygiene only: push the branch wherever that project
   is hosted when convenient.
2. **`claude-review` CI is flaky** — the claude-code-action installer 403s
   (~1 in N runs), producing no review; `gh run rerun <id> --failed` clears
   it. Worth pinning/replacing the action eventually; non-blocking today.
3. **Memory hygiene** — second-brain `stash@{0}` (PETE-REVIEW sentinel) and
   CTG-Workspace-Build's 6 stashes are keep/drop calls; `/dream-apply` review
   of the existing changeset; `/promote-memories` batches.
4. **Vertex quota refile** — deprioritized (the Anthropic bridge works); paths
   in Open item 1 below.
5. **P1 — Inquiry Home / evidence receipts** (roadmap in the Desktop verdict).
   Gate 0 is fully accepted, so P1 may open on a fresh branch when you're ready.

---

## CURRENT STATE (2026-08-14 close-out — prior authoritative block; superseded by SESSION CLOSE above)

**Live:** revision **`agent-canvas-00043-7wn`**, 100% traffic (Gate 0
verified 2026-08-14 via `gcloud run services describe` — carries the
close-out redeploy of #152–#163). Tests **169/169** on master. Deploys only via the "Redeploy procedure" below,
token-verified pete@ (`tokeninfo`, never `gcloud auth list`);
`ED_DISPATCH_URL` is a REQUIRED export — omitting it darkens the enrichment
lane.

**Close-out session (late 2026-08-14) — shipped and verified:**
- Memory-observability roadmap, waves 0a–5 (PRs #152–#158): Context Receipt,
  retrieval log, run feedback, typed/scoped memory, FTS5 bm25 retrieval
  (probe-verified, scored-OR fallback), analytics + conflict surfacing,
  a11y/responsive floor, perf floor. Enrichment lane proven end-to-end by a
  live paid `enrich_company` run (get_enriched_record never existed — the
  free read is `get_enriched_contact`, docs corrected in #161).
- Track A close-out (#162): ICP version-drift fix (org-context +
  seed templates version-agnostic; verified byte-identical to the
  regenerated output after the upstream ontology fix), /exec parity
  checklist prepared, mascot 378KB, doc truth-ups.
- **R2 (#163): `asked_by` on MCP calls is server-controlled** — the
  directing user overwrites any model-supplied value when the tool schema
  declares the field. External-review finding, verified then fixed.
- **SOI `soi-mcp` DEPLOYED and verified** (`soi-mcp-00001-jk2`,
  https://soi-mcp-6acfaoyzwa-uc.a.run.app): route merged
  (peteconnorCTG/ctg-system-of-intelligence#5 + governance block), canvas SA
  granted invoker, unauthenticated → 403, `tools/list` = exactly
  `org_knowledge_search`, live corpus-miss returned "Not found in the
  corpus.", `mcp_call user=pete@cloudtechgurus.com` in the service log.
  Runbook bar items 1+4 DONE headlessly; items 2–3 (connector wire, probe,
  tick, hit/miss agent runs) are Pete's — the tick IS the access sign-off.
- IAM verified clean: NO project-level bigquery.dataViewer on
  ctg-hs-exec-tool (the feared shortcut-grant was already reverted).

**GATE 0 BASELINE (2026-08-14, post-close-out) — verified from this Mac,
recorded so the P1 roadmap branch starts from facts, not a stale handoff:**
- Production pinned: `agent-canvas-00043-7wn`, latest-ready, 100% traffic.
  Suite 169/169 on synced master (`8a050e7`, #164). No redeploy owed.
- **Ontology fix is fully landed** — `779cb2d` is the head of
  CTG-Cloud-Tech-Gurus/CTG-Workspace-Build PR **#180, MERGED**
  2026-08-14T21:46Z. List item 4 below is DONE. Caveats: that repo is
  readable only with the peteconnorCTG token (no auth switch needed:
  `GH_TOKEN=$(gh auth token --user peteconnorCTG) gh …`), and the local
  clone's `origin/main` is stale (pre-merge) and cannot fetch as
  UsernameTron — refresh it as peteconnorCTG when next working there.
- **Dependabot #14 is CLEAR** — `gh api …/dependabot/alerts?state=open`
  returns zero with the current token (it does have the scope). List item 6
  below is DONE.
- gh auth healthy on both accounts (UsernameTron active; a prior "both
  identities invalid" diagnosis was stale — verify with `gh auth status`
  before believing it again).
- Residue dispositions, none blocking: second-brain `stash@{0}` is the
  PETE-REVIEW sentinel (his to pop); CTG-Workspace-Build has 2 modified
  rollout-board files + 1 untracked archive + 6 stashes (his, keep).
- **`claude-review` CI is flaky, not broken** — it fails with
  `curl: (22) … 403` × 3 from the claude-code-action installer
  ("Failed to install Claude Code after 3 attempts"), producing no review and
  no findings. Transient upstream: `gh run rerun <id> --failed` passed on the
  first retry. Rerun before treating a red claude-review as a real finding.
- P1 (Inquiry Home / evidence receipts) branches only after list items 1–3
  below pass in-app.

**Pete's remaining list (nothing else is open from this Mac):**
1. ~~Wire + probe + tick the `soi` connector, corpus-hit/miss runs~~
   **DONE 2026-08-15** (ledger row has the full evidence: probe 71ms, miss
   ×2 by agent runs, grounded hit with citations, asked_by
   server-controlled). **One click left: flip the soi row's access
   dropdown to `owner`** — it was created `members`; the runbook holds it
   owner-only until usage data (rate ceiling, no limiter). Note for hit
   questions: the M01 corpus holds firm-overview / projects-roster /
   team-priorities / content-strategy docs — no V/TO, no commission
   governance; those miss honestly until M02 ingests more.
2. Enrichment lamp: ~~probe~~ **DONE** (board all-green on `00045-gwg`).
   ~~sr-icp start/poll smoke run~~ **DONE 2026-08-15** — ran headlessly
   against fly.dev: job `c1613ff9337e` → 10 Healthcare tier-1 leads,
   `icp_version: sr-icp-v6`, per-lead `why` arithmetic (ledger has it). The
   earlier failed Scout run is moot — the pair works and is v6-scored now.
3. ~~Run the /exec parity checklist~~ **4/5 DONE 2026-08-15**, conducted
   headlessly via the canvas SA on the hubspot bridge (PORTFOLIO-FOLD-IN §
   parity has the numbers). Q2/Q3/Q4/Q5 pass against portal 243103424.
   **Q1 Workflows FAILS** — the CRM token has no `automation` scope, so
   `hubspot-list-workflows`/`hubspot-get-workflow` 403. **Your decision:**
   recommend unticking those two tools on the `hubspot-crm` connector (honours
   the "no tool the deployment can't honor" rule) and keeping the /exec
   Workflows button; alternatively grant `automation` read scope. Retire the
   other four /exec buttons now; not Workflows.
4. ~~Commit the staged ontology fix in CTG-Workspace-Build~~ **DONE** —
   committed as `779cb2d`, merged as CTG-Workspace-Build PR #180 (see
   Gate 0 block above).
5. ~~B2: fly.dev leadfinder v5→v6 re-export~~ **DONE 2026-08-14** — the
   `sr-icp-connector` fly.dev app now serves `sr-icp-v6` (`ping` verified
   live; `icp.json` is the byte-identical `scripts/export_icp.py` artifact,
   never hand-edited; tools/list still exactly ping + find_icp_leads +
   check_lead_search; unknown job_id still fails closed with the restart
   message). Radar's prompt drops the skew warning for a version CHECK
   against `ping`, `RESEED_KEY` bumped to `seed_roster_prompts_v4` so live
   agents follow. **Redeploy the canvas to propagate it.** Connector-side
   commit is on branch `feat/icp-v6-registry` in
   `CTG-Workspace-Build/projects/sr-icp-connector` (that path has no `origin`
   remote — push it wherever that project lives when convenient; the fly.dev
   deploy is already live regardless).
6. ~~Dependabot #14~~ **DONE** — zero open alerts via the API (see Gate 0
   block above; the token does have the read scope).
7. Stashes keep/drop (signal-radar, agent-canvas); /dream-apply review of
   the existing changeset, then /promote-memories batches.
8. Vertex quota refile (deprioritized, unchanged).

**What is live and verified (this session, PRs #134–#150 here + upstream):**
- **GTM named-query bridge** — `gtm-mcp-bridge` on Cloud Run (dedicated SA,
  `bigquery.jobUser` on the canvas project, dataset-scoped READER on
  `ctg-hs-exec-tool:ctg_gtm_marts` only). 4 tools ticked; verified by a live
  agent read (Medical Mutual, tier B) with the query job billed in the
  canvas project.
- **Prompt caching + tool-result cap** — verified live: 321k-token run at
  $0.47 vs the 279k baseline at $1.55. Cache reads bill at 0.1×.
- **IMPROVE findings: all 15 addressed.** 8 (lamps earn green from probe
  evidence — AMBER after every deploy until probed, by design), 10 (health
  poll tail-verifies the audit chain), 13 (/intent behind budget + pause),
  11 (prompt edits OWNER-ONLY + audited, Pete's decision).
- **ICP v6, fully propagated** — upstream harvest merged
  (peteconnorCTG/CTG_Signal_Detection_App#127, 2535 tests), canvas carries
  `config/icp-sr-icp-v6.json`, reseed v3 propagated prompts + the v6
  registry note to live canvases (audit `workspace.roster_reseed`, 13
  updates; v5 note preserved). **Skew CLOSED 2026-08-14:** the fly.dev lead
  finder was re-exported and now serves sr-icp-v6 (ping-verified); Radar's
  prompt checks the live version rather than naming one.
- **Enrichment lane LIT** (Pete released the F-01 hold in-session) —
  `ED_DISPATCH_URL` on the revision, ENRICHMENT · DISPATCH lamp on the
  board, invoker grant verified in live IAM. Reads free
  (`get_enriched_contact`); paid enrichment is research/targeting/commercial
  only, never system-triggered.
- **Probe rate bucket** — probing the board no longer burns the sign-in
  limit (they shared a 10/min bucket; probes now 60/min).

**Open for the next session (Pete said further improvements are coming):**
1. **SOI** — now CLI-deployable (`ctg-workspace-dev` access verified live
   this session). Runbook: [WAVE2-SOI-RUNBOOK.md](WAVE2-SOI-RUNBOOK.md).
2. Enrichment lamp: Pete to probe once + one free `get_enriched_contact`
   agent run for the end-to-end proof.
3. Parked per PORTFOLIO-FOLD-IN: qualification-engine lift, signal-radar
   full integration, ctg-ai-platform's other surfaces.

**Operating lessons this session (verified, will bite again):**
- IAM-gated Cloud Run in this org answers unauthorized callers **GFE 404,
  not 403** — a 404 is the gate working, not a broken route.
- Roster prompt edits: run `scripts/snapshot-roster-prompts.js` BEFORE
  editing roster.js, then bump `RESEED_KEY` — or live agents silently keep
  the old prompt (#145 had to reconstruct the snapshot from git history).
- A run ending `complete({outcome: "incomplete"})` renders as status
  `failed` with cost and empty error — a deliberate park (escalation
  pending), not a crash. Check `run_events` first.
- `gh auth switch` is machine-wide: `peteconnorCTG` owns signal-radar,
  `UsernameTron` owns this repo — switch before pushing either.
- ctg-signal-radar has 3 pre-existing uncommitted v2–v4 artifact deletions
  stashed on `main` ("pre-existing uncommitted v2-v4 artifact deletions") —
  Pete's to keep or drop.

---

## START HERE (2026-08-14, earlier) — live and verified on `agent-canvas-00031-mpk`

The fold-in is **live**. Full verification bar passed on Wave 1's connector
row, the hardening pass, and the two context registries: 124/124, deployed,
`hubspot-crm` probed at 85ms with 14 read tools, `sr-icp-leadfinder` carrying
its 3 tools, and an end-to-end agent run on `read_registry` with its audit
entry confirmed in Cloud Logging (`stepsUsed: 2`, `costUsd: 0.164229`).

**One console session clears three of the four blockers.** They share a single
root cause, diagnosed 2026-08-14 and written up as open item 8: a **VPC
Service Controls perimeter** (or org deny policy) around `ctg-hs-exec-tool`
and `ctg-workspace-dev` that blocks every service API from a local CLI while
leaving Resource Manager IAM working — pete@ holds `roles/owner` on both and
is still denied. No grant fixes it. The console is the working surface.

While you are in there, in this order:

1. **Cloud Run → `enrichment-dispatch` → Security → Add principal**
   `agent-canvas-run@agent-canvas-ctg-0811.iam.gserviceaccount.com`, role
   **Cloud Run Invoker**. Then tell this repo, and one redeploy lights the
   enrichment lane. `ED_DISPATCH_URL` is deliberately **not** set yet: setting
   it before the grant would advertise four tools that 403 on every call,
   which is the "never show a tool the deployment cannot honor" rule broken in
   the other direction.
2. **BigQuery → `ctg_gtm_marts` → Sharing → Add principal** pete@, role
   **BigQuery Data Viewer**, **on the dataset — never the project.** The
   project-level version reads `ctg_gtm_raw`, which holds 44k people's emails
   and phones.
3. **SOI** — the deploy in `ctg-workspace-dev`, per
   [WAVE2-SOI-RUNBOOK.md](WAVE2-SOI-RUNBOOK.md). Same perimeter, so it needs
   the console or Cloud Shell too.

The fourth blocker is unrelated: the Wave 3 upstream ICP v6 harvest needs a
push to `peteconnorCTG`, which is a machine-wide `gh auth switch`.

**RESOLVED 2026-08-14 evening — the "#130 perimeter" was a crossed credential,
confirmed by Pete's GCP findings register (F-00).** The local gcloud credential
*labeled* `pete@cloudtechgurus.com` held **cpeteconnor@gmail.com's refresh
token**; `gcloud auth list` and `CLOUDSDK_CORE_ACCOUNT` report the label, not
the token, so only `tokeninfo` caught it. pete@ held dataset-level BigQuery
Data Owner on `ctg_gtm_marts` all along — **GTM was never blocked**; the bridge
can be built against the real schema now. There was never a VPC-SC perimeter.

**Radar smoke run passed (agent-canvas-00032-ss4):** 100 hot leads all ≥0.75,
per-lead arithmetic, version-stamped, no spin — the behavior fixes and the
prompt re-seed are confirmed live. It cost ~$1.56/~280k input tokens, though,
*more* than the burn it replaced, because it succeeded and re-sent the growing
100-lead payload across poll turns with no prompt caching. Making Radar cheap
(prompt caching + message-array trimming) is a separate, still-open change —
the survey's finding-8-adjacent token amplifier.

**Security context now governs the enrichment lane.** Pete's findings register
(F-01/F-07) documents the agent-canvas→`enrichment-dispatch`→`ctg-hs-exec-tool`
chain as the exposure that reached production. `ED_DISPATCH_URL` is therefore
**deliberately still unset** — lighting a new production ingress while F-01
(external gmail identity with prod admin) and F-02 (DRS off) are open, during
funding diligence, is the wrong direction. Hold until F-01 closes. The invoker
grant Pete made is harmless while the URL is unset (the tools stay absent).

**What is left, in the order it is worth doing.**

1. **One `sr-icp-leadfinder` smoke run.** The row is live and probed but no
   agent has exercised it. Give a targeting-role agent a search and tell it to
   poll — `find_icp_leads` and `check_lead_search` are a **start/poll pair**,
   and an agent that calls the first and stops gets nothing. Results are
   **v5-scored**.
2. **Light the enrichment lane** (highest value, one grant + one redeploy) —
   the three steps in the Wave 2 section below. It is inert until then and
   cannot spend even if wired, because the service fails closed on an unset
   budget.
3. **Blocked on access, each with a runbook:** SOI
   ([WAVE2-SOI-RUNBOOK.md](WAVE2-SOI-RUNBOOK.md)) · the GTM bridge
   (`dataViewer` on `ctg_gtm_marts`) · the Wave 3 upstream ICP v6 harvest (a
   push to `peteconnorCTG`).
4. **Three known-open improvements** with their reasoning in
   [IMPROVE-FINDINGS.md](IMPROVE-FINDINGS.md)'s disposition table — the
   biggest is finding 8, lamps deriving from config rather than probe
   evidence. That one changes what operators see and wants its own PR.

**Two live defects were found and fixed during go-live**, both worth not
repeating: a refused write tool reported itself as a fatal config-parse
failure claiming no connector was active (#127), and the admin route rejected
any save containing a write tool — so the save that removed them was refused
for containing them, with no way out (#128). It strips and reports now. Both
were introduced by the connector rule in #124; the rule itself was right and
caught seven live write tools against the production portal.

## Superseded — START HERE (2026-08-14 late) — four merged PRs, nothing deployed

The portfolio fold-in ran to the end of its wave order. **Nothing reached
Cloud Run**: `./agent-canvas/deploy/deploy.sh` was refused by the executing
session's permission layer, so every wave is `READY-TO-DEPLOY` or `BLOCKED`
and **no row is `DONE`** — no connector probe, no agent smoke run, no lamp
check has been performed against anything below. Treat every "shipped" claim
in this file as *merged to master*, never as *live*, until you have run the
bar yourself.

Merged: **#121** Step-1 review · **#122** Wave 1 sr-icp connector row ·
**#123** Wave 2 enrichment lane + SOI runbook · **#124** hardening + context
registries. `npm test` 123/123 (was 95).

**The connector rule caught seven live write tools — read this before
re-ticking anything.** On the first authenticated load after the deploy, the
`hubspot-crm` connector was found with **seven write tools enabled against the
REAL portal 243103424**: `hubspot-batch-create-associations`,
`hubspot-batch-create-objects`, `hubspot-batch-update-objects`,
`hubspot-create-property`, `hubspot-update-property`,
`hubspot-create-engagement`, `hubspot-update-engagement`. They were ticked
during the Phase 3 "tick 21 tools" step. The bridge's token is read-only
scoped, so HubSpot would have refused them — but nothing in the canvas said
so, and a token swap or a widened scope would have made them live. They are
refused in code now. **Do not re-enable them**: CRM writes go through the
ops-runner preview/apply lane (ADR-0041), and the remaining read tools are
unaffected.

The first version of that refusal reported itself through `configError()`,
which made the systems board replace every connector lamp with a red *"MCP
configuration failed to parse … no connector is active until this is fixed."*
That was false — the connectors loaded fine and kept every read tool. Fixed:
refusals now ride their own channel, the affected connector's lamp goes
**amber** and names the refused tools, and `configError` again means only
"the config could not be loaded".

**UPDATE — step 1 is DONE.** Deployed 2026-08-14 to revision
`agent-canvas-00029-tr6`, carrying #122/#123/#124. Env survived the wholesale
set. Two things were verified from outside an authenticated session and need
no repeating: the seed audit line reads `{"candidates": 3, "servers": 1}`
(the `seed_mcp_v1`→`v2` upgrade landed exactly the one new connector row on
the live workspace, and reported it honestly), and `/api/config` returns
**`devAuth: false`** in production. **Steps 2-5 still stand — they need a
signed-in session, so they are yours.**

**Do these in order.**

1. ~~**Redeploy**~~ — DONE, revision `agent-canvas-00029-tr6`. Re-run the
   block under "Redeploy procedure" below only if you change code or env.
2. **Probe `sr-icp-leadfinder`** in Admin → Connectors. Expect **3 tools**
   (`ping`, `find_icp_leads`, `check_lead_search`) and a latency. Tick what you
   want agents to have — it ships with none. Tell whoever uses it that the two
   search tools are a **start/poll pair** and that results are **v5-scored**.
3. **Re-probe the existing connectors.** #124 tightened the connector rule and
   MCP URLs are now https-or-loopback. If a tool you had ticked disappears,
   `GET /api/health/integrations` will now *say so* rather than dropping it
   silently — check the message before assuming a bug.
4. **One agent smoke run per new capability**, with its audit entry confirmed:
   a Radar/Scout run using a ticked lead-finder tool, and a run that reads
   `read_registry` (try `{registry: "suppliers", query: "wfm"}` and
   `{registry: "org_context", query: "commission"}`).
5. **Then flip the ledger rows** in AUTONOMOUS-EXECUTION.md from
   `READY-TO-DEPLOY` to `DONE`, and only then. A row that fails for a fixable
   reason stays `READY-TO-DEPLOY` with a memo.

**Not deployable from here, and why** — each has its runbook:
`enrichment-dispatch` needs a cross-project `run.invoker` grant on
`ctg-hs-exec-tool` (see the Wave 2 section) · SOI needs a deploy in
`ctg-workspace-dev`, where every `gcloud run`/`services` call is denied for
both identities ([WAVE2-SOI-RUNBOOK.md](WAVE2-SOI-RUNBOOK.md)) · the GTM
bridge needs `dataViewer` on `ctg_gtm_marts` · the Wave 3 upstream ICP v6
harvest needs a push to `peteconnorCTG`, a machine-wide `gh auth switch`.

## Earlier START HERE — one blocker (environment, not code), then two owner actions

**PR #108 MERGED** — the MCP Connectors platform (roster+heal PR #106 was
already merged prior) is on `master` as of commit `79ca6ad`. Code is done,
tested (90/90), and not yet confirmed live.

**Read this before doing anything else — it will save you a repeat of
today's confusion:** the authoring session's network access (blocked from
reaching `developers.hubspot.com`, `mcp.rapidapi.com`, the deployed
`*.run.app` service, and GitHub's write API) did **not** clear when Pete
changed the environment's network policy mid-session. Root cause, confirmed
by testing: **network policy and GitHub-App write access are applied when a
session's container STARTS.** Switching models (`/model`) or resuming a
session (same conversation, new turn) reuses the existing container — it
does **not** re-provision it. Only a genuinely **new session** (new
conversation) picks up policy changes made after the old one started. If the
next session still hits `curl: (56)` on external hosts or a GitHub-write
403, that is the same stale-container issue, not a policy that reverted —
start over with a brand-new session, don't debug the settings page again.
(Also confirmed this session: no `gcloud` binary in this container — Cloud
Run verification has always required Pete's Mac or a session that has it.)

**UPDATE 2026-08-14 late night — items 1, 2, and 4 are ALL DONE, live, and
verified in-app.** Canvas redeployed (revision `agent-canvas-00027-hj5`,
carries #110); linkedin-fresh (5 tools) + linkedin-blitz (4 tools) probed and
enabled; **Phase 3 /crm is COMPLETE** — see the Phase 3 STATUS block under
"MCP Connectors". `hubspot-crm` connector live with 21 tools (105ms probe),
smoke-tested end-to-end by a Scout run (`hubspot-get-user-details` → verified
memory entry). Note from that run: the bridge's read-only key hits the REAL
portal 243103424; writes remain sandbox-only via ops-runner (246460341).
Phase 2 (item 3) is now also DONE (verified 2026-08-14, see below) — **no
owner action remains open from this list.** Deploy gotchas fixed along the
way: `rapidapi-key` secret needed a manual `secretAccessor` grant for
agent-canvas-run (now durable); squash-merge drops exec bits (deploy.sh
needed `chmod +x`, PR #111).

1. **Confirm the redeploy happened / run it.** From Pete's Mac, the block
   under "Redeploy procedure" below — note the `RAPIDAPI_KEY` export added
   this cycle. If already run, skip straight to the check command in that
   section (`workspace.seed_mcp` in the audit log, `servers: 2`). **DONE**
2. **Admin → Connectors** (new tab, live once deployed): Probe
   `linkedin-fresh` and `linkedin-blitz`, tick the lookup tools you want
   agents to have — connectors are inert until tools are explicitly enabled
   (consent model holds end to end). Access/roles editable there too (both
   seeded members-visible, scoped to research/targeting/commercial). **DONE**
3. **Phase 2 (Claude-side HubSpot Agent CLI) — DONE, verified 2026-08-14.**
   Repo-root environment carries the setup command + THREE env vars
   (`USE_ENVIRONMENT_HUBSPOT_CONFIG=true`, `HUBSPOT_PERSONAL_ACCESS_KEY`,
   `HUBSPOT_ACCOUNT_ID=243103424` — production portal, Pete's decision).
   `hs project list --use-env` authenticated and returned "No projects
   found" (correct: nothing uploaded yet). See
   [HUBSPOT-AGENT-CLI.md](HUBSPOT-AGENT-CLI.md) for the verified
   `--use-env` contract (`hs account info` can never verify env auth).
4. **Phase 3 — DONE** (verification, build, deploy, wire, smoke test).

## What this is

Multi-agent canvas workspace for cloudtechgurus.com (~10 seats). Agents with
executive personas (Fred/strategic, Darren/commercial, Jess/operational,
Atlas/workspace) work on shared visual canvases, staffed from a workspace-level
CTG agent roster, use the directing user's
Google Workspace, remember decisions in an append-only memory with epistemic
states (verified/inference/assumption), supersession, citation lineage, and
taint propagation. Escalations go to a human tray; runs carry step budgets,
wall clocks, spend metering against a daily cap, livelock detection, global
pause with epoch fencing, and a hash-chained audit log.

- **Code:** `agent-canvas/` in UsernameTron/second-brain — **PR #99 MERGED
  to master 2026-08-13** (squash, ~55 commits; CodeQL-remediated, final
  review hardened). Follow-up work starts from master on a fresh branch.
- **Tests:** 95/95 as of 2026-08-14 (`cd agent-canvas && npm test`). CI job `agent-canvas-test`.
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
export OWNER_EMAIL=pete@cloudtechgurus.com
export GOOGLE_CLIENT_ID='1072020835166-veol39lc5meet0h5v1ftl272moudki9f.apps.googleusercontent.com'
export ANTHROPIC_API_KEY="$(gcloud secrets versions access latest --secret anthropic-api-key --project agent-canvas-ctg-0811)"
export GOOGLE_CLIENT_SECRET="$(gcloud secrets versions access latest --secret google-oauth-secret --project agent-canvas-ctg-0811)"
export RAPIDAPI_KEY="$(gcloud secrets versions access latest --secret rapidapi-key --project agent-canvas-ctg-0811 2>/dev/null || true)"  # first deploy: export the literal key instead
export HS_OPS_RUNNER_URL="$(gcloud run services describe agent-canvas --region us-central1 --project agent-canvas-ctg-0811 --format=json | python3 -c 'import json,sys;print(next(e["value"] for e in json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0]["env"] if e["name"]=="HS_OPS_RUNNER_URL"))')"
export ED_DISPATCH_URL="https://enrichment-dispatch-874411154198.us-central1.run.app"  # enrichment lane — lit by Pete 2026-08-14; omitting this export darkens it
./agent-canvas/deploy/deploy.sh
```

**No placeholders by construction** — every secret is read from Secret Manager
and `HS_OPS_RUNNER_URL` from the running revision, so the paste incident below
cannot recur, and deploy.sh's shape guards (`sk-ant-*` / `GOCSPX-*`) still
validate before anything is stored. Env vars are set WHOLESALE: a var you do
not export is DROPPED from the new revision — that is why the HubSpot URL is
read back from the live service rather than omitted. Verify after deploying:

```bash
gcloud run services describe agent-canvas --region us-central1 --project agent-canvas-ctg-0811 \
  --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep -E 'HS_OPS|MODEL_PROVIDER|GOOGLE_CLIENT_ID'
gcloud logging read 'resource.labels.service_name=agent-canvas' \
  --project agent-canvas-ctg-0811 --freshness=30m --limit 200 --format=json | grep -iE 'seed_roster|roster_heal'
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

## Redeploy: DONE 2026-08-13 (latest: revision agent-canvas-00023-xhf)

All four fixes (masked-key detection, Office-file workaround message, scored
memory retrieval, run-summary fallback) went live on 00018; 00022-d4s added
the CUE mascot (sign-in card + tray), the canvas-lifecycle feature (below),
and HS_OPS_RUNNER_URL wired. The day ended on **00023-xhf**, which carries
the Agent Roster (below). Verified on 00023 by gcloud describe
(HS_OPS_RUNNER_URL, MODEL_PROVIDER, GOOGLE_CLIENT_ID all intact through the
wholesale env set) and by `workspace.seed_roster` in the audit log.
Secret Manager versions have piled up (anthropic-api-key v9, google-oauth-secret
v8) — that's deploy.sh re-adding the same good values each run, normal and
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

## Agent Roster (merged 2026-08-13, live on 00023-xhf — Issue #2)

New canvases used to be born empty with no UI to staff them. The roster is a
workspace-level, owner-editable **template library**; canvas agents are
instantiated copies carrying `roster_id` for provenance and resync.

**The nine entries.** Fred, Darren, Jess, Atlas (lifted from the shared
`EXEC_AGENTS` consts — exactly one copy of each prompt exists, so editing the
seed edits the roster); Scout (research), Forge (build), Sentinel (review);
**Gauge** (HubSpot ops, ships `enabled=0` — turn it on in Admin → Roster when
you want CRM legwork); **Radar** (ICP scoring against the committed
registry — sr-icp-v6 since 2026-08-14).

**Where things live.**
- `server/roster.js` — the library, seeding, healing, instantiation.
- `server/config/icp-sr-icp-v6.json` — the ctg-signal-radar ICP export
  (source of truth `src/backend/icp_registry.py`). Radar's scoring digest is
  **interpolated from this file**, so the prompt cannot drift from the data.
  A fresh export is a new commit, not a live sync.
- `server/config/legacy-exec-prompts.json` — the exec prompts exactly as PR
  #99 seeded them. Generated from git; used only to recognize pristine
  pre-roster agents. Do not hand-edit.

**Two design rules worth not re-litigating.**
1. **The ICP note is deliberately UNPINNED.** Pinned notes are injected
   verbatim into *every* agent's system prompt on *every* run
   (`orchestrator/runner.js`), so pinning a 12.8KB registry would tax every
   dispatch on the canvas. Radar reads it on demand via `read_notes`. The
   synthesis protocol stays pinned — it is small and load-bearing.
2. **No vendor is ever named in a prompt.** The excluded-vendor list exists
   only as data in the registry note; prompts refer to "any domain on the
   registry's `excluded_vendor_domains` list". A test asserts this
   data-driven, so the vendor-surfacing rule holds by construction.

**Self-healing migrations — ON THE BRANCH, NOT YET LIVE** (see START HERE).
Guarded, idempotent, run on boot in this order: `healExecAgents` →
`linkExecAgents` → `supersedeStaleIcpMemory`. The heal only
touches an agent whose prompt is **byte-for-byte** a known previous template —
proof no human edited it. A hand-edited prompt is left alone and is not
adopted into the roster; the owner resyncs explicitly from Admin → Roster.
The memory fix goes through the normal `correctEntry` path, so the old anchor
survives, stamped `superseded_by`, and the correction cites it. Verified
against a simulated pre-roster database in `test/roster-heal.test.js`.

## MCP Connectors (Phase 1+2 MERGED — PR #108, master `79ca6ad`)

**What it is:** owner-managed external MCP servers, served to agents through
the existing server-side Streamable-HTTP client — users install nothing,
ever (the Docker question's structural answer). New `mcp_servers` DB table +
**Admin → Connectors** tab: add server, probe (returns tool inventory), tick
tools to enable, set access (`owner`/`members`) and agent-role scope. Nothing
a server offers reaches an agent unless the owner ticked it.

**Enforcement is two-layer** (the hs_apply_change shape): owner-only
connectors are never OFFERED to member-directed runs (`toolsForRole(role,
{userRole})`, runner passes the directing user's allowlist role), and the MCP
execution path re-checks at call time (audited `mcp.denied`). Role scoping is
a token-cost lever: every offered tool schema rides in every model call, so
LinkedIn tools are scoped to research/targeting/commercial and editable in
the tab.

**Seeded** (`seed_mcp_v1`): `linkedin-fresh` + `linkedin-blitz` (RapidAPI,
member-visible, tools EMPTY until probed+ticked, key as `${ENV:RAPIDAPI_KEY}`
→ Secret Manager `rapidapi-key`). **HubSpot is deliberately NOT seeded** —
both HubSpot MCPs are stdio-only (verified from package source) and arrive
via the Phase 3 `hubspot-mcp-bridge` service (ops-runner pattern: one IAM-
gated Cloud Run service bridging `/crm` → @hubspot/mcp-server with a
READ-ONLY-scoped token, `/dev` → the Agent CLI's server with a GCS-mounted
workspace). CRM writes remain solely ctg-hs-ops-runner (ADR-0041).

**Decisions on record:** GCP/dev/qwen MCPs stay in Pete's local Claude Code
(stdio; not product material). Docker MCP Gateway cannot be wired directly
(stdio on the Mac; needs Docker-in-Docker, impossible on Cloud Run); the
GCE-VM route is documented as future-only. CloudMindMaps: pending an
execution-time auth probe (claude.ai-configured, possibly OAuth-only) — wire
member-visible if static auth works and tools return shareable map URLs,
else drop. RapidAPI key: Pete's call, no rotation, one shared key.

**Phase 3 STATUS (2026-08-14 late night): /crm COMPLETE — deployed, wired,
smoke-tested.** Bridge live at
`https://hubspot-mcp-bridge-mqqftm2ora-uc.a.run.app/crm` (revision
`hubspot-mcp-bridge-00001-kjr`, IAM-gated, sole invoker
`agent-canvas-run@…`); secret `hubspot-mcp-token` stored (`pat-na2-…`,
shape-verified) with `secretAccessor` granted to the DEFAULT COMPUTE SA
(the bridge's runtime identity — deploy.sh grants it). `hubspot-crm`
connector wired owner-access with `authorization: ${GCP_IDTOKEN}`, 21 tools
enabled, probe 105ms; Scout smoke run pulled real user details and logged a
verified memory entry. Reads hit REAL portal 243103424 (read-only scopes);
writes stay sandbox-only via ops-runner. Build history below:

**(2026-08-13 night): verification DONE, /crm bridge BUILT.**
The remote MCP check ran first as mandated: mcp.hubspot.com is **OAuth-only**
(anonymous probe → 401 + `WWW-Authenticate: Bearer resource_metadata=
.../oauth-protected-resource`; developers.hubspot.com/mcp confirms OAuth 2.0
is the sole method, no PAT support). So the bridge stays. Shipped:
`hubspot-mcp-bridge/` (raw JSON-RPC HTTP→stdio pass-through around pinned
`@hubspot/mcp-server@0.4.0`, IAM-gated, `/crm` only — `/dev` deferred until
Phase 2's CLI lands) plus `${GCP_IDTOKEN}` header support in `mcp/client.js`
(keyless metadata-server identity, opsrunner.js pattern). End-to-end test:
`test/hubspot-mcp-bridge.test.js`. To deploy: store the CTG Ops Automation
key as secret `hubspot-mcp-token`, run `hubspot-mcp-bridge/deploy.sh`, then
Admin → Connectors → add `hubspot-crm` at `<bridge URL>/crm` with header
`authorization` = `${GCP_IDTOKEN}`, access=owner, probe, tick tools.

**Phase 3 intel from Pete's HubSpot portal (2026-08-13 screenshots) — read
before building the bridge:**
- **"MCP Auth Apps" exists in his developer portal** ("client ID and secret,
  preconfigured scopes, and a redirect URL flow so your users can bring
  HubSpot data and actions into your product"). This is HubSpot's OAuth front
  door for hosted/remote MCP — strong evidence the remote endpoint is real.
  FIRST verification step of Phase 3: if the remote MCP accepts a
  bearer PAT, the /crm half of the bridge collapses to a single connector
  row; if it is OAuth-only, either add OAuth support to mcp/client.js or
  keep the bridge. Do not build the /crm bridge before checking this.
- **Service key "CTG Ops Automation" already exists** with exactly the
  read-only CRM scopes the plan specced (contacts/companies/deals/quotes/
  line_items/owners/lists + schemas, all .read). That key IS the designated
  /crm credential (HUBSPOT_MCP_TOKEN -> Secret Manager) — do not mint a new
  one. Pete holds it; it enters Secret Manager only when Phase 3 deploys.
- **Developer API Key (na2-…) is deliberately UNUSED** — it manages app
  configurations and webhooks account-wide (admin-plane power, not CRM data).
  Least-privilege rule: nothing in this system needs it.
- **HubSpot "Projects" page is empty and that is expected** — it is the
  landing surface for Phase 2's `hs project create` work, not a missed
  integration.

**Wave 1 — `sr-icp-leadfinder` connector (2026-08-14).** ctg-signal-radar's
deployed remote MCP is now a seeded connector row: `https://sr-icp-connector
.fly.dev/mcp`, members-visible, scoped research/targeting/commercial, tools
EMPTY until ticked. Probed live before seeding — "CTG Lead Finder" v1.29.0,
three tools (`ping`, `find_icp_leads`, `check_lead_search`), **no auth header
of any kind**, so the row carries no `${ENV:…}` reference and needed no
secret. `find_icp_leads`/`check_lead_search` are an async start/poll pair —
an agent that calls the first and stops gets nothing; tell it to poll.
Scoring caveat for prompts: that service scores server-side against the
registry baked into ITS deployment — **re-exported to sr-icp-v6 on
2026-08-14**, so it currently matches the canvas. It can drift again the
next time the canvas registry moves: re-deploy the fly.dev service, and
note that Radar can only report the live version if the owner has ticked
`ping` alongside the two search tools.

Seeding pattern, now versioned: `name` is UNIQUE and the insert is
`OR IGNORE`, so adding a connector is "append to `SEED_SERVERS` + bump the
`seed_mcp_vN` key" — the loop re-runs on a live workspace and only new rows
land. The audit line reports rows actually inserted.

**Wave 2 — enrichment lane (2026-08-14).** `server/enrichment/dispatch.js` is
a thin READ client of Pete's `ctg-enrichment-dispatch` Cloud Run service, same
shape as `hubspot/opsrunner.js`: no credential of its own, keyless service
identity, named operations only, every call audited. Four tools —
`enrich_contact`, `enrich_company`, `verify_email`, `get_enriched_contact`
(the last is free, zero credits; agents are told to try it first).

Three properties worth not re-litigating:
- **There is no commit tool and there must never be one.** Results return to
  the agent as data; anything CRM-bound goes through
  `hs_preview_change`/`hs_apply_change` (ADR-0041). A test asserts that every
  commit-shaped operation name is rejected before any network call.
- **Spend is clamped client-side to 3 credits per call**, whatever the model
  asks for, including when it asks for nothing. Agents loop; humans don't.
- **Disabled by default via absence.** `ED_DISPATCH_URL` unset → the tools are
  not in the model's tool list at all, the same rule the Gmail scope already
  follows ("a model should never see a tool the deployment cannot honor").
  They are further scoped to research/targeting/commercial, re-checked at call
  time, and refused outright in a run with no directing user.

**To turn it on** (in this order — line 1 is the IAM grant, and it is the part
this session could not do):
1. Grant the canvas runtime SA invoker on the service, from an identity with
   admin on `ctg-hs-exec-tool`:
   `gcloud run services add-iam-policy-binding enrichment-dispatch --project ctg-hs-exec-tool --region us-central1 --member serviceAccount:agent-canvas-run@agent-canvas-ctg-0811.iam.gserviceaccount.com --role roles/run.invoker`
2. Add `ED_DISPATCH_URL=https://enrichment-dispatch-874411154198.us-central1.run.app`
   to the redeploy export block above (env vars are set WHOLESALE — it must be
   exported on every subsequent deploy or it silently disappears).
3. Redeploy, then confirm the tools appear for a research-role agent.

**Do NOT set `ED_DAILY_BUDGET_CREDITS`.** The fold-in spec's instruction to
set it to 150 was checked against the service's source and is wrong on two
counts: the figure does not exist there (`scripts/deploy.sh:38` has no
default; the documented value is **25**, already live), and an unset budget
**fails closed** — `app/company.py:246-254` refuses paid enrichment rather
than uncapping it. Leave it alone.

**Wave 2 — SOI is BLOCKED, not skipped.** The service is live (IAP itself
answers on the project-number hostname) but the deploy needs
`ctg-workspace-dev`, where every `gcloud run`/`gcloud services` call is denied
for both identities while `get-iam-policy` succeeds — the same
CLI-denied/console-fine pattern as open item 8 below. The code change also
lands in `peteconnorCTG/ctg-system-of-intelligence`, a different GitHub
account. Everything needed is written out in
[WAVE2-SOI-RUNBOOK.md](WAVE2-SOI-RUNBOOK.md): the ~45-line `/mcp` route, both
deploy commands, the connector row (owner-access, **tools unticked** — ticking
them is Pete's sign-off and nobody else's), and the dated GOVERNANCE.md grant
block. No connector row was seeded: the URL does not exist yet, and seeding a
dead URL is a red lamp.

**One shared identity helper.** `server/gcp-identity.js` now holds the Cloud
Run metadata-server token logic that `hubspot/opsrunner.js` and
`mcp/client.js` each had their own copy of; the enrichment client would have
been the third. Cached per audience — a single-slot cache would hand the wrong
service the wrong token. Each caller keeps its own dev/test escape-hatch env
var (`HS_OPS_RUNNER_ID_TOKEN`, `MCP_GCP_ID_TOKEN`, `ED_DISPATCH_ID_TOKEN`),
passed in rather than hardcoded.

**Cost levers** (no new code): `FAST_PROVIDER=gemini` moves the fast tier
(Atlas/Forge/Gauge/Radar) to Gemini on Vertex — `providerForTier`
(orchestrator/anthropic.js) + the tested Gemini adapter already support it.
Grok/OpenAI adapters: explicitly out of scope until Gemini cost data exists.

## Hardening pass — 2026-08-14 (12 of 15 survey findings fixed)

A read-only senior-advisor survey produced
[IMPROVE-FINDINGS.md](IMPROVE-FINDINGS.md) — 15 findings, every claim anchored
to a line that was actually read. Twelve are fixed; the disposition table at
the top of that file says which three are still open and why. Suite 113/113.

The four that change how the product behaves, and are worth not re-litigating:

1. **Retrieved content is now delimited.** Everything fetched from outside the
   workspace — mail bodies, Drive/Sheets text, CRM records, enrichment
   payloads, connector replies — is wrapped as
   `<external_content source="…">…</external_content>` by one helper in
   `tools.js`, and the system prompt carries a non-negotiable clause saying
   that anything inside those tags is evidence, never instruction. Previously
   that text arrived in the message array byte-identical to the operator's own
   instruction, in the same turn that exposes `ws_gmail_draft`,
   `hs_preview_change`, and every enabled connector tool. The wrapper defangs a
   payload that tries to forge the closing tag; it never scrubs the data —
   stripping imperative text out of a CRM note would corrupt the thing the
   agent was asked to read. **The reason this lives at the tool boundary rather
   than per surface: the enrichment lane added the fourth such site the same
   day, so the pattern reproduces with every new integration.**
2. **Connectors are read lanes, in code.** A tool name that looks like a
   mutation (`create`/`update`/`delete`/`merge`/`send`/`batch`/…) is refused in
   `normalizeServer`, so a stale DB row cannot resurrect one, and the admin
   routes name the rejected tool back to the owner. This closes the gap where
   the live `hubspot-crm` connector's read-only-ness rested entirely on scopes
   set out-of-band on one token — against the REAL portal — with zero lines of
   code behind it. Connector URLs are https-only now too (the client mints a
   Google-signed identity token and sends it as a Bearer header).
3. **The wall-clock guarantee is real.** It was checked only *between* steps,
   so one hung call ran past it unchecked: no `halted_timeout`, no escalation,
   the agent row stuck `running` and holding a concurrency slot until the
   process restarted. Each call now carries
   `AbortSignal.any([controller, AbortSignal.timeout(remaining)])`, a deadline
   abort routes to `halted_timeout` plus a tray escalation, and every outbound
   `fetch` in `server/` finally has a `signal`.
4. **A run finishes exactly once.** A throw from `createEscalation` used to
   unwind to the outer catch and overwrite a `halted_budget`/`halted_steps`
   halt with `failed` — mislabelling a run awaiting a human decision as a
   crash and losing the tray item. Latch plus a try/catch that audits the
   failure. Related: both `dispatchRun` callers (handoff, escalation-resolve)
   now dispatch *before* writing their bookkeeping row, because `dispatchRun`
   throws 429 on a spent daily budget — a designed state — and the old order
   silently lost a human's decision or left an orphan handoff that made every
   retry answer "they are working on it", which was false.

**The review pass caught six things in the fixes above** — the new agent was
pointed at the hardening diff and earned its keep, so these are recorded
rather than quietly corrected:

- **The wrapper had an escape *around* the tag, not through it.** Every
  external surface's `catch` branch returned the raw error string, and those
  strings are attacker-authored: Google interpolates the **Drive file name**
  into its error text, so a shared `.xlsx` named as an instruction landed
  outside the tags. All four catch branches are wrapped now.
- **Web search results cannot be tagged at all** — they arrive as provider
  blocks that never pass through `executeTool`. The prompt clause now names
  them explicitly instead of enumerating a list they fell outside of.
- **Memory laundered untrusted text into instruction position.** `handoff`
  interpolates memory entries into the child run's *instruction* — the one
  slot the new clause declares authoritative — and the memory contract tells
  agents to store the quoted passage. The payload block is wrapped now.
- **Dispatch-before-bookkeeping was the wrong fix.** It traded data loss for
  authorization-record loss, which is worse in kind: a live run carrying
  `trigger_kind='escalation_resume'` — the only gate `hs_apply_change` checks
  — while the escalation still read `open` with no `resolved_by` and no audit
  line. Both paths are now one transaction; a 429 rolls back the pair.
- **The finish latch was set before the write it guards**, so a failed
  `UPDATE runs` would have stuck the run `running` forever with the retry
  no-op'd. Latch after the write: only a finish that landed is final.
- **The mutating-tool filter was mostly decorative** — substring-and-underscore
  matching missed `createContact`, `manage_landing_page` and
  `manage_campaign_objects` (HubSpot's own write tools) while eating
  `hubspot-batch-read-objects` and `get_post`. It tokenises now, splits
  camelCase, and lets a read verb win; drops are reported through
  `configError()` instead of silently un-enabling an owner's tool. The comment
  is corrected too: this is a **name-shaped backstop**, the owner allowlist is
  the control.

**Two committed context registries** (`server/config/supplier-catalog.json`,
`server/config/org-context.json`, regenerated by
`scripts/build-registries.js`). 420 suppliers — names, categories, taxonomy
tags — and 84 distilled org facts (entities, decision rights, business
governance). Both filter at **ingress**: the excluded-vendor list is applied
to every field before a row is kept, commission terms are stripped, and
org-context takes only FACT nodes with no unresolved contradiction. The
supplier CSV — 420 emails, 406 phones, 402 commission rates — is never read
and must never enter this repo.

Agents reach them through one `read_registry` tool, **not** a canvas note:
`read_notes` returns every note's full content, so parking 130KB there would
tax every `read_notes` call on the canvas — the same reasoning that keeps the
ICP registry unpinned, one step further. `org_context` results always carry
their freeze date and the rule that a live source wins on recency.

**Two agents were added** (`.claude/agents/`, repo root — they load at session
start, so a session that predates them cannot dispatch them):
`canvas-integration-auditor` (verifies deployment/reachability claims with
probes that actually discriminate — including the 401-vs-404 control that
distinguishes an IAM-gated service from an absent hostname — and is required to
answer UNVERIFIABLE rather than round up) and `canvas-tool-surface-reviewer`
(reviews tool-surface changes against consent / one-write-lane /
data-instruction-boundary / disabled-by-absence).

## Session log — 2026-08-13 evening (roster + heal)

What shipped, in order, so the next session can reconstruct the reasoning:

1. **Agent Roster (PR #105, merged, live on 00023-xhf).** Nine CTG-tuned
   templates, canvas staffing at create-time and after, owner-only Roster
   admin tab, resync. Includes the committed sr-icp-v5 registry.
2. **Two corrections found by reading the code against the plan**, both
   shipped inside #105: Darren's seeded prompt carried the stale ICP the plan
   itself said to supersede, and Atlas had no confidentiality guard while the
   plan claimed all entries carried it. The seed constants are now correct —
   which is why fresh databases are fine and only the *existing* live rows
   need the heal.
3. **Deployed** to `00023-xhf` and verified: `HS_OPS_RUNNER_URL`,
   `MODEL_PROVIDER`, `GOOGLE_CLIENT_ID` intact through the wholesale env set;
   `workspace.seed_roster` in the audit log.
4. **The heal branch** (`claude/agent-canvas-roster-heal`) — written after
   realizing the fix handed to Pete ("resync from Admin → Roster") was
   impossible for exactly the two agents that needed it. Simulating the live
   database showed `Darren=UNLINKED  Atlas=UNLINKED`, stale ICP, stale memory
   anchor; after the migrations, all four linked and all three defects gone.

**Decision worth preserving:** the heal refreshes an agent **only** when its
prompt is byte-for-byte a known previous template
(`server/config/legacy-exec-prompts.json`, generated from git `2ab68e3`).
That is proof no human edited it. Anything hand-written is left verbatim and
is not adopted into the roster. This is the same shape as the existing
`recolorLegacyAgents` migration: exact-match old → new, guarded, idempotent.
If you ever change a roster prompt and want live agents to follow, append the
superseded text to that file rather than loosening the match.

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
4. **MCP.** ~~no connector configured~~ **CLOSED (stale by 2026-08-14):**
   four connectors live — `hubspot-crm`, `sr-icp-leadfinder`,
   `gtm-mcp-bridge`, `enrichment-dispatch`. Only the SOI row remains
   (WAVE2-SOI-RUNBOOK.md).
5. **xlsx parsing.** Darren found the real HubSpot CRM export in Drive and
   could not read it (Office file). Error now explains the convert-to-Sheet
   workaround; native parsing is the queued feature.
6. **PR #99 — MERGED 2026-08-13** (squash, auto-merge after branch update).
   Final review added: deploy.sh credential paste-guard, shared state-JWT
   secret (dropped the hardcoded dev fallback), X-Content-Type-Options:
   nosniff on all responses.
7. **Loose ends — mostly DONE 2026-08-13.** CUE mascot: live (committed as
   `frontend/public/mascot.png`, baked into revision 00022; sign-in card +
   tray, both with onError fallbacks). Old Anthropic keys: deleted at
   console.anthropic.com. Still open: billing-swap verification (item 1), the
   2.1 MB mascot could be downsized to ~512px for a lighter sign-in page, and
   Dependabot alert #14 (1 high) on master.
8. **ctg-hs-exec-tool / ctg-workspace-dev CLI denial — the "perimeter"
   diagnosis (PR #130) was WRONG. Corrected 2026-08-14 evening. Root cause is
   identity, and pete@'s access is UNTESTED from this Mac, not denied.**

   PR #130 claimed a VPC-SC perimeter blocking every service API for pete@. It
   is withdrawn. `tokeninfo` on the token from `gcloud auth print-access-token
   --account pete@cloudtechgurus.com` — the *active* account — resolves to
   **`cpeteconnor@gmail.com`**, and so does the gmail account's. **Both
   accounts mint a gmail-identity token; this Mac's gcloud cannot produce a
   pete@ token at all** (gmail was the bootstrap identity and holds the only
   usable stored credential here).

   So every "as pete@" CLI probe behind #130 — the `run.services.list` 403s,
   the `datasets.get` 403, the "zero datasets" — actually **ran as gmail**.
   Gmail holds `roles/owner` on `agent-canvas-ctg-0811` but need hold *nothing*
   on these two org projects, so "403 on every service API" is the mundane
   "gmail isn't authorized here" — **not** a perimeter, **not** an anomaly.
   pete@ — who does hold owner — was never actually tested from the CLI.

   **What is true:**
   - This Mac's gcloud/bq cannot act as pete@. Do not cite any local CLI 403 as
     evidence about pete@'s access; it is gmail's.
   - The **console and Cloud Shell, signed in as pete@**, are the only surfaces
     that test pete@'s real access — and the console is how the ops-runner
     invoker grant was already made (item 2).
   - The enrichment invoker grant, the GTM dataViewer question, and the SOI
     deploy are all still owner-actions to do in the console as pete@. They
     were never proven blocked *by a perimeter* — that framing was an artifact
     of the identity bug.

   **A correction worth recording, because the rule it broke is a named hard
   rule.** While attempting the GTM grant this session, a **project-level**
   `roles/bigquery.dataViewer` binding was briefly added to `ctg-hs-exec-tool`
   for pete@ — precisely the shortcut-grant the fold-in spec forbids (it reads
   `ctg_gtm_raw`, 44k people's emails and phones; the spec says per-dataset on
   `ctg_gtm_marts` ONLY, never shortcut-grant raw). Removed within the minute,
   absence verified. **No data was read at any point** — every BigQuery call
   this session returned Access Denied (and, per the above, as gmail).

   **GTM is UNTESTED, not blocked.** Pete's own diagnosis is unrefuted: a
   dataset-level `dataOwner` grants `datasets.get` but not project-scoped
   `datasets.list`, so the console (dataset ACL) and a `list` call answer
   different questions. The one call that settles it must run **as pete@**:
   `bq show ctg-hs-exec-tool:ctg_gtm_marts` in Cloud Shell. Succeeds → GTM is
   not blocked and the bridge can be built. 403s → the console shows a binding
   not in effect; screenshot it.

9. **This bit twice — see `tasks/lessons.md`.** The same two-identity trap
   produced both a wrong "bq denies pete@" reading (bq/ADC → gmail) and the
   wrong #130 perimeter diagnosis. Rule now recorded: never cite a gcloud/bq
   403 as evidence about pete@ without `tokeninfo`-confirming the token's
   `email` first — `--account` does not guarantee the minted identity here.
9. **Parked idea — let Claude close/merge PRs directly.** The GitHub MCP tools
   were unavailable for stretches of 2026-08-13, so PR housekeeping fell to
   manual clicks. A `Bash(curl https://api.github.com/*)` allow-rule in
   `.claude/settings.json` would let an agent session do it (GH_TOKEN and
   GITHUB_TOKEN are already in the environment; api.github.com is reachable).
   NOT implemented — deliberately deferred. Note the tradeoff before adopting:
   prefix-matched curl rules constrain only the start of the command, so
   everything after the URL is unconstrained (curl accepts additional URLs and
   `-o` writes). A repo-scoped prefix
   (`https://api.github.com/repos/UsernameTron/second-brain/`) is tighter.

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

# Portfolio Fold-In — mission brief for a fresh session

Self-contained instruction: analyze the CTG project portfolio and fold its
functional capabilities into Agent Canvas. Written 2026-08-14 from a live
inventory of `/Users/cpconnor/projects/CTG-Workspace-Build/projects`
(~60 entries). Start a session with: *"Read
agent-canvas/docs/PORTFOLIO-FOLD-IN.md and execute it."*

## Mission

Integrate the portfolio's functional capabilities into Agent Canvas
(`~/projects/second-brain/agent-canvas`, Cloud Run project
`agent-canvas-ctg-0811`). Success = agents on the canvas can **use** these
capabilities in runs — scored ICP lookups, CRM intelligence, enrichment,
outreach queues, org knowledge — making the canvas the single proprietary
intelligence tool for cloudtechgurus.com. Analysis alone is failure; the end
state is merged, deployed, verified integrations.

## Orient first (read, in order)

1. [HANDOFF.md](HANDOFF.md) — deployed state; all phases closed 2026-08-14.
2. [../CLAUDE.md](../CLAUDE.md) + [DEPLOY.md](DEPLOY.md) — house rules, deploy.
3. The shortlist below — do NOT re-inventory all 60 projects; spot-verify
   the shortlist instead (does it still run? where's the entry point?).

## Proven integration patterns (reuse, do not invent)

- **MCP connector row** — any Streamable-HTTP MCP service plugs in via
  Admin → Connectors with per-tool consent (`server/mcp/client.js`).
  `${ENV:NAME}` and `${GCP_IDTOKEN}` header auth both supported. Live
  examples: `hubspot-crm` (via bridge), two RapidAPI LinkedIn connectors.
- **IAM-gated bridge** — stdio-only or private services get a thin Cloud Run
  front: `hubspot-mcp-bridge/` is the template (raw JSON-RPC HTTP→stdio
  pass-through, ~120 lines, IAM-gated, sole invoker `agent-canvas-run@…`).
- **Ops-runner client** — policy-gated writes via identity tokens
  (`server/hubspot/opsrunner.js`). ALL HubSpot CRM writes stay on this lane
  (ADR-0041). Never mint new HubSpot tokens.
- **Committed data registry** — data ships as committed JSON interpolated
  into prompts (`server/config/icp-sr-icp-v5.json` + Radar in
  `server/roster.js`). Fresh export = new commit, not live sync. Vendor
  names live in data, never in prompts (test-enforced).
- **Roster template** — new agent capabilities = roster entries
  (`server/roster.js`), seeded `enabled=0` when risky (the Gauge pattern).

## Portfolio shortlist (spot-verify before building)

1. **ctg-signal-radar** — signal scan, sr-icp-v5 composite scoring, outreach
   queue, MCP server, dashboard behind IAP. The crown jewel; the canvas
   already carries its ICP export.
2. **sr-icp-connector** — DEPLOYED remote MCP (`sr-icp-connector.fly.dev`):
   LinkedIn people search scored against sr-icp-v5. Cheapest win — possibly
   a single connector row.
3. **ctg-ai-platform** (v2.0, FastAPI, deployed) — ICP intent scoring with
   decay, churn/loyalty, email→opportunity classifier, HubSpot dedupe.
4. **ctg-gtm-automation** — HubSpot→BigQuery mirror + enrichment run ledger
   + DQ observability; the data spine.
5. **ctg-ops-automation** — LIVE scheduled ops (hygiene scan, pipeline
   digest, support triage).
6. **advisor-match** — supplier matching/ranking engine (Postgres, deployed).
7. **ctg-enrichment-dispatch** — per-field arbitration + confidence gate +
   provenance write-back (prototype, tests green).
8. **ctg-hs-exec-tool / ctg-hs-ops-runner** — the sanctioned CRM read and
   write lanes (write lane already wired to the canvas).
9. **AI-google** — org RAG over three Shared Drives with citations
   (Drive ONLY — no email/Meet is indexed; M03 mail ingest never shipped and
   is governance-gated). See deep-dive spec below.
10. **ctg-google-workspace-hubspot-automation** — consent/suppression/fit
    rules engine (TS monorepo, 931 tests, built-not-activated).

Skip: planning-only projects (`Jess-SDR`, `ctg-hubspot-SDR`, `ctg-CX-Ray`,
`ctg-account-intelligence`, `hubspot-audit`), empty dirs (`ctg-zero-egress`,
`advisor-plans`), vendored samples (`gcp-ps`,
`google-workspace-resources`), `_archive/`. `ctg-pe-radar` is a
signal-radar fork — one engine, two domains, integrate once.

## Method

1. **Score the shortlist** (half a day, not a week). Per candidate: does it
   run today; integration surface (MCP / HTTP+IAM / data export); what
   canvas capability it adds; effort S/M/L. Present a ranked fold-in
   roadmap to Pete with a recommendation BEFORE building anything.
2. **Integrate in waves, cheapest-first, ONE PR per wave** — Pete wants few
   PRs; batch related changes. Wave 1 is likely sr-icp-connector as a
   connector row plus a signal-radar MCP/bridge; later waves per Pete's
   picks from the roadmap.
3. **Each wave ends deployed and verified in-app** — probe green, one agent
   smoke run, lamps honest (the Phase 3 playbook in HANDOFF.md).

## Hard rules

- Read broadly, write reasonably, destroy never. Lamps never fake green.
  Every claim verified against a tool result.
- Consent model holds: connector tools stay unticked until Pete enables
  them; risky roster agents ship `enabled=0`.
- CRM writes: ops-runner only (ADR-0041). Reads: the read-only bridge /
  exec-tool lanes. No new HubSpot credentials, ever.
- Never surface ISPN/Genesys/Asana content. No vendor names in prompts.
  The CTG Context Intelligence Brief is never seeded into the workspace.
- Don't rebuild what exists: memory (canvas memory contract + second-brain
  recall), scoring (signal-radar), CRM write lane (ops-runner). Folding in
  = wiring, not rewriting.
- Secrets: Secret Manager via deploy scripts with shape guards; never paste
  keys into runbooks or commit them. Cloud Run env vars are set WHOLESALE —
  export everything on redeploy (see HANDOFF.md).
- Branch per wave; never commit to master; `npm test` green before push.

## Context intelligence (second exercise, 2026-08-14)

Five non-application directories were assessed separately — knowledge and
inference artifacts, not apps. The bar Pete set: they must make existing or
planned canvas capability **measurably better**, or stay out. Verdicts are
final; do not re-explore the rejects.

**QUALIFIES — `~/projects/ctg-model-forge/data/judgment.jsonl` (the dataset,
NOT the pipeline).** The LoRA fine-tune pipeline is a stalled prototype
(training never ran, `adapters/` empty). Its dataset is the prize: **266
human-ACCEPTED, categorized knowledge items** mined from the second-brain
memory-proposal queue — real business-ops facts. Two representative
accepts: the HubSpot enrichment gap map (no vendor writes Account Type /
Company Owner / Lead Source on companies; QuickBooks→HubSpot sync errors
decode to duplicate collisions + validation error -11622), and the
Jess-signed company-record backfill defaults (ownerless → Darren; missing
Account Type → Prospective Client unless an attached deal's type wins).
Densest curated CTG knowledge on disk; directly sharpens Darren / Jess /
Gauge runs.
*Fold-in:* mine a filtered subset into canvas workspace memory through the
normal memory path — epistemic state `verified` (human-confirmed) with
source citation per entry. Content-policy exclusions still apply at
ingress. **Excluded outright: `data/r2_leakage_labels.jsonl`** — 1,835 rows
of real prospect PII. The 421 human REJECTS are also valuable as a negative
set (what this operator deems not worth remembering) — useful for tuning
extraction, not for ingestion.

**QUALIFIES CONDITIONALLY — `CTG-Workspace-Build/ontology/`** (451-node,
8-layer graph; 94 typed edges). Its entities / decision-rights / governance
/ dependency layers encode who owns which lane, which rules gate what, and
how systems relate — the context that sharpens the exec personas. Caveats
that gate it: frozen 2026-07-28, still names **`sr-icp-v1`** (live is
sr-icp-v5), and carries an unresolved headcount contradiction (5 vs 7 vs 10).
*Fold-in:* after a refresh pass fixing stale references, distill ~40-60
**FACT-tagged** decision-rights + governance + entity nodes into a small
committed registry note using the proven ICP-registry pattern (unpinned,
read on demand via `read_notes`). Never ingest the 77 contradictions or 27
UNKNOWNs — they are the workspace's open questions, not canvas facts.

**DOES NOT QUALIFY — `context-layer-package/`.** Genuinely high quality
(667 elements, epistemic tags, path§section citations), but it is
epistemics *about the workspace repo* — ADR ledger, repo topology, audit
method. Canvas agents do revenue work, not repo archaeology. Its best idea,
FACT/INFERENCE/BELIEF tagging, already exists in the canvas memory contract
as verified/inference/assumption. Where its governance content overlaps
`ontology/`, that directory is the better-structured source.

**DOES NOT QUALIFY — `technology-estate/`.** The freshest and
best-evidenced of the five (console-derived, Aug 2-7), and the right
reference for Pete's ops work — but it is infrastructure meta-knowledge
(which GCP project hosts what, silent vendor-quota traps). No bearing on
agents scoring leads or drafting outreach. Leave it where it lives.

**DOES NOT QUALIFY — `CTG-Workspace-Build/scripts/`.** Execution tooling
for the estate (GAM/gcloud audits, portfolio validation, weekly-refresh
cron). Its one knowledge artifact is a lineage taxonomy hardcoded in
`portfolio/validate.py` whose real home is `portfolio/MANIFEST.json`.
Application code by the same bar everything else was judged against.

**Authority note.** That workspace has two `glossary.md` and two
`ontology.json` files with no stated authority order — its own #1 open
decision, still open. For canvas purposes, `ontology/ontology.json` is the
source. Recorded here so it is not relitigated.

**Sequencing.** Treat this as a **Context Wave** in the same wave method:
it is cheap (data work, no new services), it compounds every other wave
(better context makes every integration's output better), and it touches no
production system. Reasonable as wave 1 or 2 — include it in the ranked
roadmap Pete approves, with the ontology refresh called out as its
prerequisite.

## Deep-dive fold-in specs (fourth exercise, 2026-08-14)

Six shortlist projects re-read at code level by parallel agents, each
verdict verified against source (not READMEs). These specs supersede the
one-line shortlist entries above for these six. Wave order at the end.

### ctg-enrichment-dispatch — FOLD IN via client lane. Effort S.
Code at `ctg-enrichment-dispatch/enrichment-dispatch/` (nested; own repo,
gitignored from the monorepo). FastAPI fan-out enrichment: tiered vendor
orchestration (Apollo/PDL/Explorium/Hunter/Enrichley), deterministic
`merge.py` fusion (pure, order-independent), two-axis gating (AUTO_COMMIT/
FLAG/REVIEW × `do_not_send`), full per-field lineage incl. dropped
candidates and `echoed_input` honesty flag. CI green (834 passed); deployed
per docs in `ctg-hs-exec-tool` (rev 00027-prt) but UNVERIFIED — pete@ lacks
IAM to describe; confirm before the wave. **Integration: copy
`server/hubspot/opsrunner.js` → `server/enrichment/dispatch.js`** (same
keyless ID-token pattern), cross-project `run.invoker` for
`agent-canvas-run@…`, 3-4 tools in `orchestrator/tools.js`:
`enrich_contact`, `enrich_company`, `verify_email`, `get_enriched_contact`
(zero-credit re-read). Role-scope research/targeting/commercial. **Rules:**
never build a `commit` tool — results return to the agent; CRM-bound
changes go through the existing preview/apply ops-runner lane. The
`ED_HUBSPOT_TOKEN` write credential must never be minted (writer fails
closed without it). **Precondition:** set `ED_DAILY_BUDGET_CREDITS` to a
real number on next deploy (empty today = no daily ceiling) and keep
`max_credits` conservative in tool schemas — agents loop, humans don't.
NOT taken: `web/` UI, stdio `mcp_client/`, writeback+`/v1/commit`, its
`icp.py` (sr-icp-v5 already canonical), outcomes/brief/ledger/memo modules.

### ctg-gtm-automation — FOLD IN the data, not the code. Effort S→M.
11/12 milestones built; mirror LIVE daily 06:00 CT in `ctg-hs-exec-tool`
BigQuery (`ctg_gtm_raw/marts/ops`): 50k contacts, 25k companies, 15.5k
`account_scores` rows with plain-English `reasons`, provider scorecards, DQ
metrics. Zero HubSpot write token has ever existed — leave it that way.
**Integration: a ~150-line Streamable-HTTP MCP bridge (no stdio child)
exposing 4 NAMED parameterized queries** — `gtm_account_lookup`,
`gtm_tier_list`, `gtm_enrichment_spend`, `gtm_dq_snapshot` — marts-only
allowlist; free-form SQL only when a named tool provably falls short. IAM:
`bigquery.jobUser` on the canvas project (billing stays ours),
per-dataset `dataViewer` on `ctg_gtm_marts` ONLY. **Hard excludes:**
`ctg_gtm_raw.contacts` (44k people's emails/phones), `contacts_normalized`,
`contacts_embeddings`, review/merge/inbound tables, `aisdr_campaign_leads`.
**Risks:** (1) some marts views read through to raw — dataset-level grant
fails; v1 sticks to physical tables or registers authorized views; never
shortcut-grant raw. (2) staleness — every tool must return
`scored_at`/`_synced_at`; nightly cadence means 09:00 reads are
yesterday's. Tier is a SOURCING FILTER, not buy-probability (measured:
score 0 wins 22.2%, score 100 wins 22.4%) — prompts must say so.

### AI-google (SOI) — FOLD IN behind an owner gate. Effort S; decision M.
Live Vertex RAG (corpus `soi-m01`, 1,462 files, three Shared Drives — NO
email), `soi-query` Cloud Run in `ctg-workspace-dev`, double-gated answers
(distance floor + grounding judge → honest "Not found in the corpus."),
p50 2.05s. **Integration: add `POST /mcp` (~40 lines) to
`service/main.py`, deploy same image as second service `soi-mcp` WITHOUT
IAP,** `--no-allow-unauthenticated`, sole invoker the canvas SA; one
connector row with `${GCP_IDTOKEN}`; tool `org_knowledge_search`. Agents
treat "Not found in the corpus." as a valid answer (recall@5 = 0.83).
**The real decision (Pete/Fred, before enabling):** a service-identity call
bypasses the per-user IAP gate — every canvas agent would see soi-users@-
level content (exec briefs, ARR targets, funding thesis) regardless of
directing user. Ship owner-access, tools unticked, pass the directing
user's email as an argument for the audit line, and record the grant in
AI-google's GOVERNANCE.md. Rate-limit risk: each answer = 2 Gemini calls +
a ~60 req/min RAG ceiling with no service-side limiter — keep it
owner-scoped until usage data exists. NOT taken: the sync/DWD pipeline,
the catalog Sheet (D-01 rejected it: 0/1,049 ids overlap the corpus),
`/` and `/c` human surfaces, the locked retrieval config, M03 mail.

### ctg-google-workspace-hubspot-automation — HARVEST 2 files. Effort S.
Built-not-activated (0/52 go-live boxes ticked; dev Cloud Run live, prod
404). The crown jewel is `qualification-engine.ts` — 144 lines, zero
runtime imports (3.4KB compiled), a pure fail-closed decision table
(hard-reject rails: email_valid/opted_out/do_not_contact/active_sequence/
existing_customer; thresholds 80/60) + zod contracts and 20 reason codes.
**Integration: lift the two files as a canvas consent/qualification module
(policy as committed-registry data). PARKED until a read lane exists for
its evidence inputs** — five booleans need HubSpot communication-
preferences/sequence reads the canvas doesn't have; fail-closed without
them the engine just returns REJECTED. Also harvest as documentation: the
corrected v4 comm-preferences endpoints (v3 paths 400). Do NOT call its
deployed service (auth = HubSpot v2 signature → would require holding the
client secret = new-credential violation). NOT taken: Terraform estate,
OAuth stack (second token estate), Firestore idempotency, HubSpot app,
52-gate governance apparatus.

### ctg-prospect-intel-panel — DO NOT FOLD. Harvest 1 taxonomy. 
Thin Chrome client over ctg-ai-platform's `/intel/*` (panel-exclusive
routes). Canvas already covers it better: CRM known-check via the
hubspot-crm connector (real portal vs the panel's sandbox), LinkedIn via
the RapidAPI connectors (the panel can't resolve LinkedIn at all), ICP via
sr-icp-v5 — the panel runs a hand-ported `sr-icp-v1-lite` that scores
BPO at 1.15 where v5 EXCLUDES it (weight 0.1): folding it in would import
a contradiction the canvas test-enforces against. "What's the play" is
README framing, not logic — no recommendation engine exists. Its
`add-to-hubspot` is a direct CRM write on its own credential (ADR-0041
violation) — never fold. **The one lift:** `TITLE_TIERS` /
`TITLE_EXCLUSIONS` / `filter_icp_contacts` from
`ctg-ai-platform/src/intel/icp.py` (encodes live failures: "Chief of Staff
to the CTO", "President Medicare Advantage") — upstream into
signal-radar's `icp_registry.py`, re-export as v6, new commit here.

### advisor-match — DO NOT FOLD the system. Harvest 2 files. Effort S-M.
Reality check: it's a deal→single-supplier scorer (no requirements→ranked
list exists anywhere), it never served a real deal (webhook never
registered), and its GCP project `carbon-minutia-494714-i1` is not visible
from either of Pete's accounts — the "deployed" claim is dead. **Harvest
(a):** the tolerant-regex ICP classifiers in `worker/services/icp.py`
(survive raw HubSpot enums, "Hospitality"≠hospital, `(?<!new )mexico`) +
22 extra blocklist domains — merge UPSTREAM into signal-radar's
`export_icp.py` so `icp-sr-icp-v5.json` stays the single generated truth.
**Harvest (b):** `docs/suppliers/catalog.md` (PII-free: names/categories/
tags only) → committed `server/config/` supplier registry (the ICP-
registry pattern); with the L2 `output_validator.py` idea (category-enum
then membership check) a `recommend_supplier` capability is prompt + data,
no Postgres. **Never copy `data/suppliers/catalog.csv`** — 420 supplier
emails, 406 phones, 402 commission rates; it stays out of this repo.
NOT taken: Flask worker, Cloud SQL/pgvector, Cloud Tasks/webhook lane,
HubSpot writeback (ADR-0041), dashboard, dormant advisor-era code.

### Revised wave order (supersedes Method §2's wave-1 guess)
1. **Wave 1 (S, no decisions pending):** sr-icp-connector row +
   GTM named-query bridge (physical tables only).
2. **Wave 2 (S, each behind its named precondition):** enrichment-dispatch
   client lane (after budget cap set + LIVE confirmed) · SOI `soi-mcp`
   connector (after Pete/Fred access sign-off).
3. **Wave 3 (S-M, upstream-first harvests):** title taxonomy + advisor-
   match regex classifiers → signal-radar v6 export → recommit registry ·
   supplier-catalog registry · Context Wave items (exercise 2).
4. **Parked:** qualification-engine lift (until a comm-prefs/sequence read
   lane exists) · signal-radar full integration + ctg-ai-platform's other
   surfaces (scope in their own pass; the panel dive covered only
   `/intel/*`).

## Apps Script URL audit (third exercise, 2026-08-14)

All deployed `script.google.com/**/exec` web apps referenced across the
estate were audited through the executive lens: execs won't track more
URLs, so an Apps Script app earns a canvas seat only if it adds capability
the canvas lacks. **Result: none does — and canvas retires two of them.**
Do not re-audit.

- **ctg-hs-exec-tool `/exec` Q&A page** (5 locked buttons; also embedded in
  ctg-l10-eos HubspotChatView) — **superseded by canvas**: the
  `hubspot-crm` connector's 21 read tools + exec personas answer the same
  questions conversationally against the real portal. Retire the URL after
  a parity check (each locked button's question answered correctly in a
  canvas run).
- **ctg-hs-ops-runner Exec UAT front** (`AKfycbzOgUPWl…`, most-referenced)
  — UAT/provisioning harness for the CRM write lane. Canvas is the
  production exec surface for that lane (preview-first writes, tray
  approval). Stays Pete-internal; never exec-facing. No seat.
- **automation-google M06 Dev Drive Portal** — well-built, read-only by
  construction, but it fronts Pete's dev drive, not exec work. Its asset is
  the M03 catalog Sheet (`18Z6DNKHtxJXDQO5YnieXVidbiWkS__8I6nv-S5px2I0`,
  tab `catalog`: file/abstract/tags index) — canvas agents can already
  read it via their existing per-user Sheets access; nothing to build. The
  portal URL remains a human-preference UI, not a canvas gap.
- **`simpleTasks` sample `/exec`** — vendored Google sample code
  (google-workspace-resources), not a CTG deployment. Noise.

Net effect: the canvas *reduces* the executive URL count (exec-tool Q&A
absorbed, UAT front de-scoped from execs) rather than adding integrations.

## Decision rights

The ranked roadmap, and anything touching production CRM, spend, or new
external services → Pete decides. Wiring already-approved waves, tests,
docs → proceed autonomously.

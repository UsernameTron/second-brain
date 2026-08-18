# Activation runbook — lighting up what is already built

Owner actions only. Nothing in this file is performed by code, and nothing in
it authorizes a deploy, scheduler change, or production-data mutation on its
own. Every step ends in a probe (Admin lamp, `canvas-ops-monitor`, or
`canvas-integration-auditor`), never in a doc claim. [HANDOFF.md](HANDOFF.md)
stays the current-state authority; when this file and a fresh probe disagree,
the probe wins.

Why this file exists: the deployment pattern here is capabilities landing
built-but-dark — deployed bridges with zero ticked tools, seeded connectors
with empty tick lists, a paused scheduler. The consent gates are design, not
debt; this runbook is the enumerated list of deliberate owner actions that
light each lane, so the knowledge stops living in deploy-script stdout and
session history.

## Preconditions (verify, don't re-do)

| Item | State when last verified | Verify with |
|---|---|---|
| Enrichment lane (`ED_DISPATCH_URL`) | LIT since 2026-08-14 — Pete released the F-01 hold; end-to-end paid `enrich_company` proven (HANDOFF-HISTORY.md) | `deploy/deploy.sh` live-env listing shows the name; ENRICHMENT · DISPATCH lamp green after probe. Budget guard (`ED_DAILY_BUDGET_CREDITS=25`) lives on the dispatch service, fails closed — do not set it canvas-side |
| `hubspot-crm` connector row | EXISTS in the live workspace DB (added manually in Phase 3; probed 85ms, 14 read tools) | Admin → Connectors → Probe |
| `gtm-marts`, `sr-icp-leadfinder`, `linkedin-fresh`, `linkedin-blitz` | Seeded, enabled, **zero tools ticked** (inert by design) | Admin → Connectors |
| Cloud Scheduler `agent-canvas-standing-rules` | PAUSED | `gcloud scheduler jobs describe` |
| Gauge roster entry | Staffable (enabled, #213) and least-authority (14 HubSpot ceremony tools, no `ws_*`, #214); `default_on` 0 | Admin → Roster |
| Quill roster entry + content lane | Merged (#214); appears via additive seed on the first boot of a deployment carrying it; not yet deployed | Admin → Roster |

## 1. Connector tool ticks (Admin → Connectors → Probe → tick)

A ticked tool's schema rides in every model call of every agent it is offered
to — tick minimally, per named consumer.

**`gtm-marts`** (access `members`; roles research/targeting/commercial →
Scout, Radar, Darren, Enrichment-via-targeting-alias, SDR-by-allowlist):

- Tick `gtm_account_lookup` — consumers: SDR (DEDUPE stage + pre-call briefs,
  via its allowlist), Radar, Darren, Scout.
- Tick `gtm_tier_list` — consumers: Radar (ranked-list lane), Darren.
- Leave `gtm_enrichment_spend` and `gtm_dq_snapshot` unticked until a named
  agent protocol needs them — their audience today is ops, not agents.

**`sr-icp-leadfinder`**: tick all three (`ping`, `find_icp_leads`,
`check_lead_search`). Radar's prompt is built around the pair and uses `ping`
to version-stamp scores; it already handles the unticked state honestly.

**`linkedin-fresh` / `linkedin-blitz`**: leave unticked. No agent protocol
names them yet, and the RapidAPI tool inventory is unverified — probe first if
a consumer emerges.

**`hubspot-crm`** (owner-only): tick READ tools only, from the probe
inventory. **Never re-tick the seven write-shaped tools**
(`hubspot-batch-create-associations`, `hubspot-batch-create-objects`,
`hubspot-batch-update-objects`, `hubspot-create-property`,
`hubspot-update-property`, `hubspot-create-engagement`,
`hubspot-update-engagement`) — they were mis-ticked once during first
activation; the bridge refuses them in code and the lamp goes amber naming
them, but the tick list must not depend on that backstop. Leave
`hubspot-list-workflows` / `hubspot-get-workflow` unticked: the read token has
no `automation` scope and they 403.

## 2. hubspot-crm connector add (fresh database / disaster recovery only)

The live workspace already carries the row — this section exists so the
procedure stops living only in `hubspot-mcp-bridge/deploy.sh` stdout.

1. Deploy the bridge: `hubspot-mcp-bridge/deploy.sh` (the secret paste-guard
   requires a `pat-*` read-only private-app token).
2. Admin → Connectors → add: name `hubspot-crm`, url `<bridge URL>/crm`,
   header `authorization` = `${GCP_IDTOKEN}`, access `owner`.
3. Probe, then tick per §1.

## 3. Gauge

Admin → Roster shows Gauge staffable after the activation-wiring PR (fresh
databases seed it enabled; the live DB row is flipped by the owner in Admin if
it predates the PR). Staff it per canvas deliberately — `default_on` stays 0.
Its CRM lane is the sandbox-locked, preview/apply-gated ops-runner, and its
authority map is HubSpot-only (`seed_gauge_tools_v1` fills the legacy NULL map
on first boot of a deployment carrying #214 — no Workspace writes ride along).

## 4. Content lane first run (after the content-lane PR deploys)

1. Confirm Quill in Admin → Roster (role `content`, tools
   `ws_docs_create`/`ws_gmail_draft` only).
2. Staff the Marketing & content template on a test canvas (Scout, Quill,
   Sentinel, Fred).
3. Dispatch: "Draft a LinkedIn post on AI readiness in CTG voice,
   gate-checked." Expect: pillar/blueprint named from the registry, a
   `content_gate_check` receipt in the run, copy in the summary (LinkedIn) or
   a new Doc (article), and no publish/send anywhere.
4. `read_registry(registry: "content_policy")` answers from any agent — the
   policy is committed data, refreshed only by a new commit.

## 5. Scheduler resume — LAST, and only with separate operator intent

Precondition (HANDOFF.md release gate 2): exercise P5 expiry with an
explicitly bounded fixture first. Then:

```
gcloud scheduler jobs resume agent-canvas-standing-rules --project agent-canvas-ctg-0811 --location us-central1
```

Watch the first scheduler-signed tick's occurrence rows before walking away.
Wiring reference: DEPLOY.md §P5.

## 6. Parked: the qualification engine, and its scope probe

`docs/PORTFOLIO-FOLD-IN.md` verdict stands: harvest
`qualification-engine.ts` + contracts (2 files, effort S) but **PARKED until a
read lane exists for its eligibility inputs**, and never call its deployed
service (HubSpot v2 signature auth would require holding the client secret — a
new-credential violation).

The cheap unblocking step is a scope probe no code can run: the two unknown
scopes are `communication_preferences.read` and `automation.sequences.read` on
the canvas read-only private app. (The token provably lacks `automation` —
workflows tools 403.) Pete reads HubSpot → Settings → Integrations → Private
Apps → the read-only app → Scopes, and reports the two booleans;
`canvas-integration-auditor` records VERIFIED/REFUTED with the quoted scope
names (names only, never the token). Record the result as one evidence-labeled
line in HANDOFF.md and update the row here:

| Scope | Present? | Recorded |
|---|---|---|
| `communication_preferences.read` | unknown | — |
| `automation.sequences.read` | unknown | — |

Either answer leaves the engine parked until a read lane exists; a "yes, yes"
makes the fold-in a candidate for a future phase instead of a dead end.

## 7. Optional commercial context (owner-authored)

Pin a note on commercial canvases carrying the four-part battlecard structure
from the revenue-squad's competitive-analyst: strongest claim → exploitable
weakness → neutral counter → trap question. It is a working method, not an org
fact — which is why it is a note, not a registry row.

## Pointers, not duplicates

- SOI connector: its own decision gate and runbook — WAVE2-SOI-RUNBOOK.md.
- Deploy and env procedure: DEPLOY.md.
- Cross-repo items surfaced by the 2026-08-18 portfolio assessment (owner
  decisions in OTHER repos, listed here so they are not lost): (a)
  `ctg-hs-exec-tool.ctg_gtm_marts.v_contract_window_signals` held 22 live
  renewal signals (~$44k commission) invisible to the canvas — the bridge
  refuses views by construction (PII fence); unblocking requires a GTM-side
  physical mart table or a provably raw-free authorized view, then a fifth
  bridge tool becomes eligible as its own reviewed change; (b) the
  content-engine's M02 autonomy layer sits complete and undeployed on an
  unmerged branch in its own repo; (c) the GTM program's STATE.md and the
  workspace-hubspot evidence ledgers carry stale rows their own audits
  flagged.

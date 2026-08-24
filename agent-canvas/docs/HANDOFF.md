# Agent Canvas — Current Handoff (2026-08-19, close-out sync)

This file is the concise current-state authority. Historical implementation and
incident detail lives in [HANDOFF-HISTORY.md](HANDOFF-HISTORY.md); phase intent
lives in [ROADMAP.md](ROADMAP.md); release commands live in
[DEPLOY.md](DEPLOY.md); the non-technical product guide is
[../USER-GUIDE.md](../USER-GUIDE.md).

Every claim below is labeled **git-proven**, **test-proven**,
**live-proven**, **historical acceptance evidence**, or **unverified**. Live
evidence is an observation at one instant, not a permanent property.

## Current production state

**Live-proven at 2026-08-20 (~15:40Z):** Cloud Run revision
`agent-canvas-00068-lzs` serves 100% of traffic (superseding `00064-nq9`
after the 2026-08-20 schema/grant fixes and the reverted vertex experiment); `/api/healthz` 200
`{"ok":true,"paused":false}`; zero ERROR logs post-deploy. Provider is
`MODEL_PROVIDER=gemini` (Gemini on Vertex, keyless ADC) — `/api/config`
reports `gemini-2.5-flash` (fast) / `gemini-2.5-pro` (strong). The systems
board read fully green in a signed-in session: MODEL probe OK, all four
Workspace surfaces probe OK, HubSpot ops-runner and enrichment-dispatch
wired, all six MCP connector rows enabled with owner-ticked tools.

**Live-proven:** Cloud Scheduler job `agent-canvas-standing-rules` was
RESUMED by operator approval on 2026-08-19; its first tick after resume
returned HTTP 200 at `2026-08-19T18:10:01Z` and the STANDING RULES lamp
earned green. `sr-icp-connector.fly.dev` pings `sr-icp-v7`; estate-sentinel's
ICP pins agree across signal-radar (canonical), the connector, and
enrichment-dispatch.

**Vertex Claude is quota-blocked (2026-08-20):** `STRONG_PROVIDER=vertex` was
deployed and immediately 429'd —
`Quota exceeded for aiplatform.googleapis.com/global_online_prediction_requests_per_base_model
with base model: anthropic-claude-sonnet`. The project has NO Claude quota
buckets at all; Model Garden enablement does not grant quota, and a
quota-increase request (quota id
`GlobalOnlinePredictionRequestsPerMinutePerProjectPerBaseModel`) is the only
path. Reverted to both tiers on Gemini in revision `agent-canvas-00068-lzs`;
service healthy. **Do not set `STRONG_PROVIDER=vertex` again until that quota
is granted** — every strong-tier agent (Scout, Sentinel, Quill, the three
personas) fails while it is set.

**Deliberate state, not cruft:** the `ANTHROPIC_API_KEY` secret binding stays
mounted — it is the one-env-flip fallback (`MODEL_PROVIDER=anthropic`).
**Known Gemini-tier regressions:** provider-side `web_search` is ineligible
(Scout's prompt and Wedge degrade honestly; the new server-side `web_fetch`
covers exact-URL reads on every provider); no prompt-cache discount; no
cross-provider refusal fallback. The `STRONG_PROVIDER=vertex` lever is
UNAVAILABLE (quota-blocked, above); the only working web-search fallback
today is `STRONG_PROVIDER=anthropic`, which leaves the GCP perimeter for
strong-tier calls and is deliberately not in use.

## Estate hub integration (2026-08-24, DEPLOYED)

**Deployed (2026-08-24, later the same day):** `deploy/deploy.sh` run from master
(`79ebb63`, PR #236) with `SEO_MONITOR_URL`, `OPS_AUTOMATION_URL`, and
`STATUS_INVOKER_SA=553976212013-compute@developer.gserviceaccount.com` (the L10
functions runtime SA) set, so both lanes below are LIVE. Probe evidence:
`/api/healthz` returned `{"ok":true,"paused":false}` and an unauthenticated
`GET /api/service/attention-count` returned 401 (fail-closed verified). The
canvas runtime SA holds `roles/run.invoker` on both estate services in
`ctg-ops-prod`, granted the same day.

**Test-proven (2026-08-24, `feat/estate-integration`):** two additive canvas-side
pieces for the CTG hub integration.

1. **Estate read tools** - `server/estate/reads.js`, a thin READ client of the
   seo-monitor and ops-automation services (the enrichment thin-read-client
   precedent: keyless OIDC via `identityToken`, fixed GET paths only, audited,
   30k output cap). Three agent tools - `estate_seo_metrics`,
   `estate_ops_hygiene`, `estate_pipeline_digest` - offered to the enrichment
   role set (research/targeting/commercial/enrichment), read-only, no approval
   ceremony, absent when the backing URL env is unset, results wrapped as
   `external_content` with evidence refs (new evidence source kind `estate`).
   Env: `SEO_MONITOR_URL` (audience = itself), `OPS_AUTOMATION_URL` (audience =
   itself). Sealed-lane check re-verified in this change: no path from the tool
   layer reaches enrichment `/v1/commit` (the only mention is dispatch.js's own
   comment forbidding it).
2. **Service "Needs You" count** - `GET /api/service/attention-count`,
   registered above `requireAuth` in the tick's lane shape: Google-signed OIDC
   ID token verified against `TICK_AUDIENCE` (shared audience for both service
   lanes), caller must BE `STATUS_INVOKER_SA`; either unset returns 503.
   Response `{ needsYou, generatedAt }`, computed by the same
   `attention.listAttention` projection the signed-in `/api/attention` route
   uses (all non-archived canvases, scope `all`) - no duplicated SQL.

**Auth posture (hub integration):** the L10 hub (l10ctg.web.app) LINKS OUT to
Agent Canvas; same Google account, separate `ac_session` cookie. Embedding via
SameSite=None cookies / CORS-with-credentials was considered and deliberately
rejected. Recorded upgrade path if an embedded future is ever demanded:
accept Firebase ID tokens (issuer securetoken.google.com/l10ctg) as a second
verified principal - not built, not planned.

## What shipped 2026-08-19 (all merged and deployed)

1. **#221 WS3 UI fixes** — theme-token legibility (no dark-on-dark literals),
   NEEDS YOU dismiss for projected cards (`attention_dismissals` table),
   rooms take `member_emails` at creation so players see a room immediately.
2. **#224 ICP v7** — committed registry `server/config/icp-sr-icp-v7.json`
   (Education → Higher Education, tier 3; CEO ruling 2026-08-17; upstream
   CTG_Signal_Detection_App#129).
3. **#225 revenue-squad roster port** — 16 roster templates: Dossier
   (commercial dossiers), Qualifier (A/B/C routing off live scorers only),
   Pitch (placeholdered proposal docs, draft-only cover), Wedge (gated
   battlecards); additive seeder `seed_roster_revenue_squad_v1`, all
   `default_on: 0`.
4. **#227 plain-English systems lamps** + probe-gated MODEL status (a failed
   model probe reads down, config alone reads amber).
5. **#228 escalation hygiene** — one open escalation per stuck run family
   (coalescing walks the handoff parent/child chain; resolve surfaces folded
   questions); new governed read-only `web_fetch` tool (research role,
   `ENABLE_WEB_FETCH` kill switch, SSRF guards with connect-time DNS pinning,
   every attempt audited, query strings redacted); process-note epistemics in
   the shared memory contract; NEEDS YOU defaults to **Mine** for members
   (owner keeps All) with all badges on the same predicate. Tool-surface
   security review ran pre-merge; its three findings are fixed in the PR.
6. **USER-GUIDE.md** — plain-English product guide at the subtree root.

`RESEED_KEY` is `seed_roster_prompts_v8` (Scout's web_fetch lane discipline);
the legacy prompt snapshot was refreshed before each prompt edit, so
byte-match healing propagates to seeded workspaces.

## Repository and verification

**Git-proven (observed 2026-08-19):** canonical repository
`/Users/cpconnor/projects/second-brain`; application subtree `agent-canvas/`.
`master` == `origin/master` at `defa7f8` (#228). Merge chain today:
#221 → #223 (Gemini flip, parallel session) → #224 → #225 → #226 → #227 →
#228, all squash-merged.

**Test-proven (2026-08-19, `master` at `defa7f8`):** `npm run verify` passes
**420 backend tests** and **112 frontend tests**, the frontend production
build, deploy-script syntax, and the deploy preflight self-test. Both
production dependency audits report zero vulnerabilities. CodeQL is clean
(the web_fetch HTML stripper survived three scan rounds; regression tests
cover the flagged tag-filter and entity-order cases).

**Recorded gaps (decision items, deliberately unchanged):** the production
image is tagged `:latest` with no git-SHA provenance — "which commit is
running" is inferable only from bundle fingerprints and build timing.

## Released workspace cleanup (stable since 00057)

**Git/test/replica-proven:** demo content retired recoverably (8 canvases);
fresh databases create access, roster, and inert connector configuration
only. Notes are a user-managed context surface with recoverable removal;
Canvas Files accept TXT/MD/CSV/JSON/XLSX up to 5 MB with agent access via
`read_canvas_files` marked as external evidence. Details in
[HANDOFF-HISTORY.md](HANDOFF-HISTORY.md).

## Phase classification

| Phase | Source state | Release evidence |
|---|---|---|
| Gate 0, P1, P2 | Merged | Historical acceptance evidence |
| P3 Evidence Rooms | Merged | Historical live acceptance incl. #194 |
| P4 Agent Builder | Merged | Historical live acceptance 2026-08-16 |
| P5 Standing Rules | Merged | Scheduler RESUMED 2026-08-19; post-resume tick 200 live-proven; **expiry still unproven** |
| Workspace cleanup + teams/enrichment/documents | Merged, deployed | Replica/bundle/health proven; signed-in journey partially replayed (systems board green observed) |
| Activation wiring + content lane (#213/#214) | Merged, deployed | Deployed since `00059`; owner steps in [ACTIVATION-RUNBOOK.md](ACTIVATION-RUNBOOK.md) |
| ICP v7 + revenue squad (#224/#225) | Merged, deployed in `00062+` | Connector tools owner-ticked (board observed); signed-in agent-run acceptance outstanding |
| Lamps + escalation hygiene + web_fetch (#227/#228) | Merged, deployed in `00063`/`00064` | Board green observed; web_fetch live-run acceptance outstanding |
| P6 Outcomes and reviewed learning | Planned only | Not implemented |
| P7 Selective integrations and portability | Planned only | Not implemented |

## Release gates (what's still owed)

1. Signed-in acceptance of the new lanes: one Dossier ask (tier cites
   `gtm_account_lookup`), one Qualifier batch (A/B/C + "needs scoring",
   never a computed score), one Scout `web_fetch` of a real URL, one Wedge
   battlecard passing `content_gate_check`.
2. Exercise P5 expiry with a bounded fixture before calling P5 complete.
3. Six pre-hygiene NEEDS YOU cards from 2026-08-18 await the owner's
   30-second triage (answer the one real ccaas-article question, dismiss the
   echoes).

No push, merge, deployment, scheduler change, or production-data mutation is
authorized by this handoff alone.

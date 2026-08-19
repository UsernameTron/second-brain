# Agent Canvas — Current Handoff (2026-08-19)

## Provider flip (2026-08-19)

**Live-proven at 2026-08-19:** revision `agent-canvas-00061-zz4` serves 100%
of traffic with `MODEL_PROVIDER=gemini` — Gemini on Vertex, keyless ADC,
inside the GCP perimeter. `/api/config` reports
`gemini-2.5-flash` (fast) / `gemini-2.5-pro` (strong); `/api/healthz` 200;
zero ERROR logs post-deploy. Hardening merged as #222: BLOCK_ONLY_HIGH
safety settings, thinking budget 2048, explicit `responseFormat:'json'` on
the four parse routes, MODEL lamp/config read per-tier `tierConfig()` truth.

**Deliberate state, not cruft:** the `ANTHROPIC_API_KEY` secret binding stays
mounted — it is the one-env-flip fallback (`MODEL_PROVIDER=anthropic`).
**Known regressions on Gemini tiers:** no web search (Scout; standing rules
with web sources refuse to activate) — fallback lever `STRONG_PROVIDER=vertex`
(Claude-on-Vertex, requires Model Garden enablement); no prompt-cache
discount; no cross-provider refusal fallback. **Outstanding:** signed-in
model probe + journey re-check on Gemini (provider-specific per DEPLOY.md).

## ICP v7 + revenue-squad wave (2026-08-19)

**Git-proven:** the committed ICP registry is `server/config/icp-sr-icp-v7.json`
(`sr-icp-v7`: Education → Higher Education, tier 3 — CEO ruling 2026-08-17,
upstream CTG_Signal_Detection_App#129). The roster holds **16 templates**: the
prior 12 plus the revenue-squad port — Dossier (commercial, account dossiers),
Qualifier (targeting, A/B/C routing off live scorers only), Pitch (commercial,
placeholdered proposal docs, draft-only cover), Wedge (research, gated
battlecards) — seeded additively by `seed_roster_revenue_squad_v1`, all
`default_on: 0`. `RESEED_KEY` bumped to `seed_roster_prompts_v7` with the
legacy prompt snapshot refreshed pre-swap.

**Live-proven at 2026-08-19:** `sr-icp-connector.fly.dev` ping reports
`sr-icp-v7` (redeployed; state.json reset accepted — company-search credits
re-spend). estate-sentinel ICP pins agree: canonical, connector, and
enrichment-dispatch all `sr-icp-v7`. **Live-proven at 2026-08-19T17:45Z:** revision
`agent-canvas-00062-hfs` serves 100% with the served bundle fingerprints
(`index-CIrliqYi.css` / `index-CoM3z8Nn.js`) matching `master`'s build through
#225 — the v7 registry, the 16-template roster, and the #221 UI fixes are
deployed; `/api/healthz` 200, zero ERROR logs post-deploy. **Unverified:**
signed-in journey on the new agents; connector tools require an owner Admin
tick per deployment before Dossier/Qualifier can use them; Wedge's
`web_search` is ineligible on Gemini tiers (degrades honestly per its
prompt).

This file is the concise current-state authority. Historical implementation and
incident detail lives in [HANDOFF-HISTORY.md](HANDOFF-HISTORY.md); phase intent
lives in [ROADMAP.md](ROADMAP.md); release commands live in
[DEPLOY.md](DEPLOY.md).

Every claim below is labeled **git-proven**, **test-proven**,
**live-proven**, **historical acceptance evidence**, or **unverified**. Live
evidence is an observation at one instant, not a permanent property.

## Repository and verification

**Git-proven (observed 2026-08-18):** canonical repository
`/Users/cpconnor/projects/second-brain`; application subtree `agent-canvas/`.
`master` and `origin/master` are at `6f09242`. PR #213 (activation wiring:
SDR marts grant, Gauge staffable + least-authority map, org-context 86 facts)
merged as `0b11d6a`; PR #214 (content lane: Quill, `content_policy` registry,
`content_gate_check`) merged as `b953a49`; PR #215 (activation runbook + docs
truth) merged as `3b992c5`; PR #216 (user-menu scroll-clip fix) merged as
`6f09242`. The working branch `agent/agent-canvas-enrichment-documents` is a
stale pre-squash subset of #207 and must not be used as a base.

**Test-proven (2026-08-18, `master` at `6f09242`):** `npm run verify` passes
**404 backend tests** and **109 frontend tests**, the frontend production
build, deploy-script syntax, and the deploy preflight self-test. Both production
dependency audits report zero vulnerabilities.

## Latest production observation

**Live-proven at 2026-08-18T16:58Z:** Cloud Run revision
`agent-canvas-00059-hqb` (created 2026-08-18T16:44:47Z; "Deploying revision
succeeded in 14.92s") serves 100% of traffic. `/api/healthz` returns 200
`{"ok":true,"paused":false}` and `/api/config` returns 200; the revision
restored the replicated database (`seeded=false` boot line) and produced zero
ERROR-severity logs all day, verified against a positive-control query that
did return rows. Cloud Scheduler job `agent-canvas-standing-rules` remains
**PAUSED** (last operator update 2026-08-17T15:49Z); the deploy did not
change it.

**Live-proven + build-proven bundle identity:** the service serves
`index-CVFOB6zI.css` and `index-DvYGXaHp.js`, and the frontend production
build from `master` at `6f09242` emits exactly those content-hashed names —
the deployed FRONTEND is `master`'s through #215 and #216 (the user-menu
scroll-clip fix rides in this bundle). With `00059-hqb` the #213/#214
activation wiring and content lane are deployed. Backend identity is
corroborated by build timing (Cloud Build `e56324de` succeeded
2026-08-18T16:42:53Z; the revision was created ~2 minutes later) but not
proven — the image carries no git-SHA provenance (see gaps below). Signed-in
journey acceptance, including the newly deployed lanes, remains outstanding.

**Recorded gaps (decision items, deliberately not changed here):** the
production image is tagged `:latest` with no git-SHA provenance, so "which
commit is running" is only inferable from bundle fingerprints and build
timing; production runs `MODEL_PROVIDER=anthropic` while `deploy/deploy.sh`
prose still describes a `vertex` default (the divergence is guarded —
`deploy.sh` inherits the live provider and will not silently move it).

## Released workspace cleanup

**Git-proven and test-proven:** the cleanup removes the hardcoded Workbook,
Run cleanup command, sample-row flow, demo kickoff route, demo changeset
attention cards, demo tools, and active Explain Map changeset nodes. A fresh
database creates access, roster, and inert connector configuration but no user
canvas, sample rows, fabricated memories, pinned instructions, or kickoff task.
Legacy tables remain only for export and audit continuity.

Notes are now an honest user-managed context surface: editors can create, edit,
include in future runs, unpin, and remove them; viewers cannot mutate them.
Removal is a recoverable tombstone, immediately excludes the note from canvas
loads, `read_notes`, and future system prompts, and retains an audit record
without copying note content into the audit log.

Canvas Files are now the actual local document path. Editors can upload TXT,
Markdown, CSV, JSON, and XLSX files up to 5 MB, open or download them, and
remove them recoverably. Authorized agents use `read_canvas_files`; file text
is marked as external evidence, bounded, and excluded after removal. View-only
users can download but cannot upload or remove.

**Live-proven from a fresh production replica:** the cleanup ran once at
`2026-08-17T19:29:24.865Z` and recoverably retired the 8 proven demo/test
canvases. One real canvas remains active. A pre-`00057` backup passed SQLite
integrity checking and was copied to the release-backups prefix. Re-running the
retirement against its disposable copy changed zero rows, proving the live
migration is idempotently complete.

## Phase classification

| Phase | Source state | Release evidence |
|---|---|---|
| Gate 0, P1, P2 | Merged on `master` | Historical acceptance evidence; not replayed in this cleanup |
| P3 Evidence Rooms | Merged | Historical live acceptance including #194; not replayed |
| P4 Agent Builder | Merged | Historical live acceptance on 2026-08-16; not replayed |
| P5 Standing Rules | Merged | Scheduler delivery is live-proven; manual path historically accepted; remaining scenarios below |
| Cleanup: truthful workspace content | Merged and deployed | Bundle, replica, health, and log checks pass; signed-in journey not replayed |
| Recommended teams, Enrichment, document intake, agent removal | Merged and deployed | Bundle/replica proven; signed-in journey not replayed |
| Activation wiring + content lane (SDR marts grant, Gauge least-authority, Quill, content-policy registry, gate) | Merged on `master` (#213, #214) | Deployed in `00059-hqb` (2026-08-18; frontend fingerprint-proven, backend corroborated by build timing); signed-in acceptance outstanding; owner activation steps in [ACTIVATION-RUNBOOK.md](ACTIVATION-RUNBOOK.md) |
| P6 Outcomes and reviewed learning | Planned only | Not implemented |
| P7 Selective integrations and portability | Planned only | Not implemented |

P5 is not complete. Scheduled dispatch/card and pause behavior have historical
live evidence. **Replica- and log-proven:** on revision `00054-9cs`, a
scheduler-signed tick at `2026-08-17T02:00:32Z` created rule-B occurrence
`2026-08-17T02#v2`, which completed with `matched_count=0` and
`needs_attention=0`; later hourly occurrences repeated that clean-zero result.
Expiry under scheduler operation remains unproven. The scheduler is currently
paused, so no unattended rule can run until an operator deliberately resumes it.

## Release gates

1. In a signed-in production session, verify: no Workbook or
   Run cleanup surface; create/edit/pin/remove note; upload/read/remove a file;
   view-only restrictions; a new agent run whose receipt names the canvas file;
   removed note/file text absent from subsequent agent context; recommended-team
   creation; Enrichment availability; and safe agent removal.
2. Exercise P5 expiry with an explicitly bounded fixture before calling P5
   complete. Resume Cloud Scheduler only with separate operator intent.
3. After the cleanup migration, use forward fixes rather than routing traffic
   to a pre-cleanup reader.

No push, merge, deployment, scheduler change, or production-data mutation is
authorized by this handoff alone.

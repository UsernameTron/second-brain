# Agent Canvas — Session Handoff (2026-08-13, end of day)

Fresh-context orientation for the next session. Everything here was true at
handoff time; verify anything load-bearing with a probe or a gcloud describe
before depending on it.

## START HERE — deploy the connectors, then two owner actions in the app

**Live:** revision `agent-canvas-00023-xhf`+heal (#106 merged — verify
`workspace.roster_heal` appeared in the audit log if not yet confirmed).
**Waiting:** the MCP Connectors platform (branch
`claude/agent-canvas-workspace-1qquiu`, this session) — merge + redeploy.

1. **Redeploy** with the block below — note the NEW optional export
   `RAPIDAPI_KEY` (get it from rapidapi.com → your app; it feeds both
   LinkedIn connectors as `${ENV:RAPIDAPI_KEY}`). Without it the connectors
   probe fine but calls fail loudly.
2. **Admin → Connectors** (new tab): Probe `linkedin-fresh` and
   `linkedin-blitz`, then tick the lookup tools you want agents to have —
   connectors are inert until tools are explicitly enabled (consent model).
   Access/roles are editable there too (both seeded members-visible, scoped
   to research/targeting/commercial agent roles).
3. **Phase 2 (Claude-side HubSpot Agent CLI):** follow
   [HUBSPOT-AGENT-CLI.md](HUBSPOT-AGENT-CLI.md) — two environment settings
   (`npm install -g @hubspot/cli` setup command + `HUBSPOT_PERSONAL_ACCESS_KEY`),
   then a fresh session verifies with `hs account info`.

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
- **Tests:** 84/84 (`cd agent-canvas && npm test`). CI job `agent-canvas-test`.
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
you want CRM legwork); **Radar** (ICP scoring against sr-icp-v5).

**Where things live.**
- `server/roster.js` — the library, seeding, healing, instantiation.
- `server/config/icp-sr-icp-v5.json` — the ctg-signal-radar ICP export
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

## MCP Connectors (this session — Phase 1+2 of the connector plan)

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

**Cost levers** (no new code): `FAST_PROVIDER=gemini` moves the fast tier
(Atlas/Forge/Gauge/Radar) to Gemini on Vertex — `providerForTier`
(orchestrator/anthropic.js) + the tested Gemini adapter already support it.
Grok/OpenAI adapters: explicitly out of scope until Gemini cost data exists.

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
4. **MCP.** Layer built+tested (Streamable HTTP, per-tool enablement); no
   connector configured. `MCP_SERVERS` env or `config/mcp.json`.
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
8. **ctg-hs-exec-tool CLI mystery — cosmetic, lamp is green regardless.**
   Every `gcloud run` / `gcloud services` call against that project is denied
   from Pete's Mac for BOTH identities even though pete@ is roles/owner and
   billing is healthy; the console works fine (that is how the Invoker grant
   was made). Ruled out: quota-project (unset, no change), billing, ownership.
   Remaining suspect: an org policy or context-aware access rule that treats
   external CLI clients differently. Cheapest probe: run the same command in
   **Cloud Shell** (console → `>_`), which runs inside Google's trusted
   context. If it works there, it is a perimeter rule, not a project defect.
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

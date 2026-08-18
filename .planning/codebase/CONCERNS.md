# Codebase Concerns

**Analysis Date:** 2026-08-18

Scope: `agent-canvas/` (application subtree of this repo) plus a scan of the
root pipeline (`src/`, `scripts/`, `.planning/backlog.md`). Every item below
was checked against the file/line cited, or against `agent-canvas/docs/HANDOFF.md`
(dated 2026-08-18, labels its own claims git/test/live-proven vs unverified).

## High Severity

**`server/routes.js` is a 2,532-line, 147KB route monolith**
- `agent-canvas/server/routes.js` — 150,858 bytes, 2,532 lines, one file for every
  HTTP route in the service (canvases, agents, runs, notes, files, roster,
  standing rules, auth-adjacent config, admin). Confirmed by direct `wc -l`/`ls -la`.
- Impact: any route change risks touching unrelated handlers in the same diff;
  code review has no natural seam; merge conflicts concentrate here (this file
  is also the most-cited file in `docs/IMPROVE-FINDINGS.md`'s prior audit).
- Fix approach: split by resource (`routes/canvases.js`, `routes/agents.js`,
  `routes/runs.js`, `routes/notes.js`, `routes/files.js`, `routes/standing-rules.js`)
  mounted from a thin `routes/index.js`. Mechanical, not urgent — do it the next
  time a route file touches more than one resource area, not as a standalone
  refactor PR.

**Squash-merge workflow leaves stale pre-squash branches that look ahead but are behind**
- `agent-canvas/docs/HANDOFF.md`: *"The working branch
  `agent/agent-canvas-enrichment-documents` is a stale pre-squash subset of #207
  and must not be used as a base."* This is a live, dated incident note
  (2026-08-18), not a hypothetical — the branch's own history reads as ahead of
  `master` by commit count while being behind it in actual content, because
  PR #207 squash-merged.
- Impact: any agent or operator that branches from a stale pre-squash head
  silently drops merged work and reintroduces already-fixed code. This already
  happened once (2026-08-18).
- Fix approach: no code fix — this is a process trap inherent to squash-merge.
  Mitigation: always branch from `origin/master` after confirming
  `git log origin/master -1` matches the latest merged PR, never from a
  same-named local/agent branch that predates a squash-merge.

## Medium Severity

**Production image tagged `:latest`, no git-SHA provenance**
- `agent-canvas/deploy/deploy.sh:77` — `IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:latest"`.
  Every deploy overwrites the same tag; nothing in the image name or Cloud Run
  revision ties it to a commit SHA.
- `docs/HANDOFF.md` confirms this is a known, accepted gap: *"the production
  image is tagged `:latest` with no git-SHA provenance, so 'which commit is
  running' is only inferable from bundle fingerprints."* The doc's own
  workaround — matching the frontend's content-hashed bundle filename
  (`dist/assets/index-3gl5dacv.js`) against a fresh `master` build — is the only
  current way to answer "what's live."
- Impact: incident response and rollback both require an out-of-band bundle-hash
  comparison instead of reading the revision metadata directly.
- Fix approach: tag the image with the git SHA in `cloudbuild.yaml`'s `_IMAGE`
  substitution (`deploy.sh:343,348,370`) in addition to `:latest`, and have
  `deploy.sh` print it post-deploy. Small, deliberately deferred so far.

**`docs/HANDOFF.md` misstates that no server code reads `FAST_PROVIDER`/`STRONG_PROVIDER`**
- The doc's "Recorded gaps" section says these are *"set by `deploy.sh` but no
  server code reads them."* That's incorrect as written: `providerForTier()` in
  `agent-canvas/server/orchestrator/anthropic.js:56` reads
  `process.env.FAST_PROVIDER` / `STRONG_PROVIDER` directly, and `tierConfig()`
  (which calls it) is invoked from `server/routes.js:410,1048,1265,2281,2378`,
  `server/orchestrator/runner.js:97`, and `server/orchestrator/tools.js:801`.
- What's actually true: `deploy.sh:378-381` only *sets* those two env vars when
  `MODEL_PROVIDER != anthropic`, and production currently runs
  `MODEL_PROVIDER=anthropic` (live-proven in the same HANDOFF.md), so the vars
  are unset in the live environment today — the mechanism is dormant, not unread.
- Impact: low on its own, but it's a docs-vs-code drift in the file explicitly
  billed as *"the concise current-state authority"* — the kind of claim that
  gets copy-pasted into a future incident writeup.
- Fix approach: correct the HANDOFF.md line to say the vars are read but
  currently unset (mixed-fleet path is dormant under `MODEL_PROVIDER=anthropic`),
  not unread.

**`MODEL_PROVIDER` live value (`anthropic`) diverges from `deploy.sh`'s documented default (`vertex`)**
- `agent-canvas/deploy/deploy.sh:12-14` describes the default as `vertex`
  (Claude on Vertex AI) and line 91 hard-codes `MODEL_PROVIDER="${MODEL_PROVIDER:-vertex}"`.
  Production is live-proven running `MODEL_PROVIDER=anthropic` (`docs/HANDOFF.md`).
- This divergence is guarded, not accidental: `deploy.sh:254-261` refuses to
  silently move a live service off its current provider unless
  `DEPLOY_PROVIDER_CHANGE=1` is set, and inherits the live value when
  `MODEL_PROVIDER` isn't explicitly exported. So a redeploy today keeps
  `anthropic` correctly — the risk is purely in the header prose reading as if
  a fresh/unset deploy would land on Vertex, when in practice it inherits
  whatever's live.
- Fix approach: none code-side (the guard already does the right thing).
  Update the comment block (`deploy.sh:12-14`) to state the *live* default is
  operator-observed, not script-declared, so a reader doesn't assume Vertex.

**Cloud Scheduler `agent-canvas-standing-rules` is PAUSED; P5 expiry is unproven**
- `docs/HANDOFF.md`: *"Cloud Scheduler job `agent-canvas-standing-rules`
  remains PAUSED... Expiry under scheduler operation remains unproven. The
  scheduler is currently paused, so no unattended rule can run until an
  operator deliberately resumes it."*
- This is deliberate (a safety default, not a bug) but it means P5 Standing
  Rules is explicitly marked "not complete" in the same doc's phase table —
  scheduled dispatch/pause has historical live evidence, but expiry behavior
  under real scheduler ticks has never been exercised end to end.
- Fix approach: per HANDOFF's own release gate #2 — exercise expiry with an
  explicitly bounded fixture before calling P5 complete, and resume the
  scheduler only on separate, deliberate operator action.

**Signed-in journey acceptance is outstanding (release gate, not yet exercised)**
- `docs/HANDOFF.md` repeats this at three points: the live-observation section
  ("Signed-in journey acceptance remains outstanding"), the phase table (every
  recently-merged/deployed row notes "signed-in journey not replayed"), and
  release gate #1, which lists the full manual checklist (no Workbook/Run
  cleanup surface, note CRUD, file upload/read/remove, view-only restrictions,
  a new agent run whose receipt names the canvas file, removed content absent
  from subsequent agent context, recommended-team creation, Enrichment
  availability, safe agent removal).
- Impact: everything shipped since the workspace cleanup is bundle- and
  replica-proven but not human-verified in a real signed-in session. That's the
  actual gap between "deployed" and "accepted."
- Fix approach: no code change — this is a manual QA pass HANDOFF.md already
  scopes precisely; run it before treating the cleanup/Enrichment/document-intake
  work as fully accepted.

## Low Severity / Unverified

**Cloud Run `maxScale` annotation claim could not be confirmed in this repo**
- The only autoscaling ceiling found anywhere in `agent-canvas/` is
  `--max-instances 1` in `deploy/deploy.sh:443` (documented and deliberate —
  SQLite single-writer, `deploy.sh:373`, `docs/DEPLOY.md:204`: *"`--max-instances 1`
  is required (single writer). If the workspace ever outgrows this, the storage
  layer is isolated in `server/db.js` for a Cloud SQL migration."*).
- A repo-wide search (including hidden files, `cloudbuild.yaml`, and all
  `docs/*.md`) found no `maxScale` string and no reference to a `maxScale=20`
  service-level default anywhere in the checked-out tree. The claimed
  "annotation contradicts service-level maxScale=20" could not be verified —
  it may describe GCP project-level defaults not captured in this repo, or may
  be stale. Flagging as unverified rather than asserting it.
- Fix approach: if a real `maxScale=20` annotation exists on the live Cloud Run
  service (outside this repo, e.g. set via console or a prior `gcloud` call not
  scripted here), reconcile it against the intentional `--max-instances 1` in
  `deploy.sh` so a future `gcloud run services update` doesn't silently widen it.

**`docs/IMPROVE-FINDINGS.md` — one partially-open item from the prior 15-finding audit**
- All 15 findings in that survey are marked FIXED as of 2026-08-14 except
  #11 (`PATCH /canvases/:id/agents/:id` lets any member rewrite an agent's
  `system_prompt` unaudited): audit logging was added, but whether the route
  should be `requireOwner`-gated (matching the sibling `resync` route) is
  explicitly left as "Pete's decision," unresolved.
- Impact: low — ~10 allowlisted workspace members, accountability gap not an
  attack path.
- Fix approach: gate `system_prompt` PATCH behind `auth.requireOwner` if members
  aren't relied on to edit prompts through the UI; otherwise accept as-is.

**Root pipeline (`src/`, `scripts/`) — three prior concerns remain open (carried from the 2026-07-31 map)**
- `src/utils/classifier-health.js` increments are read-modify-write, not
  atomic — OPEN. State is cross-invocation by design (interactive session,
  23:45 sweep, monthly dream share `~/.cache/second-brain/classifier-health.json`),
  so concurrent lost updates are the expected case, not the exotic one.
- `scripts/daily-sweep.js` has no overall wall-clock deadline — OPEN. Fix
  approach: pass a `timeoutMs` budget into `extractMemories` (mechanism landed
  in PR #96; the sweep is the caller that should use it).
- Interactive `/today` echo can print pre-redaction text — ACCEPTED RESIDUAL.
- No NEW root-pipeline concerns found in this refresh:
- `.planning/backlog.md` is fully dispositioned as of the 2026-07-21 audit
  (13 resolved, 2 partial-deferred, 4 open-but-accepted, 2 dropped) — nothing
  agent-canvas-related lives there; it tracks the second-brain memory pipeline,
  a separate subtree.
- A grep for `TODO|FIXME|HACK|XXX` across `agent-canvas/server`,
  `agent-canvas/frontend/src`, and `agent-canvas/scripts` returned no bare
  markers. Ten `ponytail:` comments exist instead (`server/google/workspace.js:302`,
  `server/routes.js:351,2477`, `server/standing-rules.js:111,298,412`,
  `server/orchestrator/tools.js:34`, `server/orchestrator/runner.js:24`,
  `frontend/src/format.jsx:9,125`) — each names its ceiling and upgrade
  trigger inline (e.g. runner.js:24's flat char cap → "per-tool budgets if a
  tool ever needs more"). These read as intentional scope decisions, not debt.

---

*Concerns audit: 2026-08-18*

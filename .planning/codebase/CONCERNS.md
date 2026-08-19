# Codebase Concerns

**Analysis Date:** 2026-08-19

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

## Medium Severity (Root Pipeline)

**`CLAUDE.md` Project Status block is stale — dated 2026-07-31, ~19 days behind current date (2026-08-19)**
- `CLAUDE.md:25` — `> Last verified: 2026-07-31 <!-- refresh at each /gsd:sync-docs; read by the SessionStart staleness hook (.claude/hooks/staleness-check.js, v1.6 REQ-CTX-01) -->`.
  Test count (1568/82 files), coverage percentages, and the v1.8 phase-completion
  narrative are all frozen at the 2026-07-31 PR #96 state; twenty PRs have
  landed since then (agent-canvas subtree, `#194`-`#217`) but none touch this
  block.
- Impact: the SessionStart staleness hook exists specifically to catch this
  drift (REQ-CTX-01) — if it isn't firing or isn't being acted on, the doc's
  own enforcement mechanism is silently no-op. Anyone trusting the quoted test
  count or coverage numbers gets 2026-07-31 data, not today's.
- Fix approach: run `/gsd:sync-docs` to regenerate the block from live
  `npm test` / coverage output and bump the verified date. Root pipeline
  (`src/`, `scripts/`) itself shows no code changes since #96 in the sampled
  git log (only `agent-canvas/*` commits are recent), so the staleness is
  administrative (unrefreshed date/PR narrative), not a sign of undocumented
  pipeline changes.

**Root pipeline TODO/FIXME density: effectively zero**
- `grep -rn "TODO\|FIXME\|HACK\|XXX" src/ scripts/ --include="*.js"` returns
  one hit, and it's a string literal inside `memory-extractor.js:163`
  (`'- TODO items and task lists'` — an extraction-prompt instruction, not a
  code marker). No real TODO/FIXME/HACK/XXX markers exist in `src/` or
  `scripts/`. Not a concern; recorded because the audit scope asked for
  density and zero is a meaningful data point (debt is either paid down or
  tracked elsewhere, e.g. `.planning/backlog.md`).

**Largest root-pipeline files by line count — size alone, not yet flagged as fragile**
- `src/dream.js` (1005 lines), `src/pipeline-infra.js` (731), `src/promote-memories.js`
  (719), `src/vault-gateway.js` (675), `src/memory-extractor.js` (649),
  `src/semantic-index.js` (623), `src/daily-stats.js` (606),
  `src/memory-proposals.js` (541), `src/wikilink-engine.js` (539),
  `src/today-command.js` (523), `src/classifier.js` (519).
- None of these were flagged with a specific split-seam concern in this pass
  (unlike `agent-canvas/server/routes.js` above, which has a demonstrated
  multi-resource blast-radius problem). Worth a closer read if any of them
  needs a second unrelated feature added in the same PR — that's the trigger
  for a split, not size in isolation.

**Operational risk — single points of failure in the launchd scheduling chain**
- `config/scheduling.json` documents the fallback chain: macOS launchd
  (`com.secondbrain.today` weekday 06:45, `com.secondbrain.daily-sweep` 23:45,
  `com.secondbrain.dream` 1st-of-month 07:15) is the *only* path that reaches
  the local vault — `RemoteTrigger` is disabled by design because its cloud
  environment can't reach `VAULT_ROOT` (`~/Claude Cowork`). Confirmed live via
  `launchctl list | grep secondbrain`: all three jobs are loaded (exit code 0
  for each), but launchd jobs are single-machine, silently deregister on
  machine rebuild/user-profile changes, and have no external alerting if a
  scheduled run fails or launchd itself fails to fire.
- Impact: if this Mac is offline, decommissioned, or the LaunchAgents plist
  goes missing, `/today`, the nightly sweep, and monthly dream-consolidation
  all silently stop — there is no secondary scheduler that can reach the
  vault. PR #96 already added a non-zero exit when a scheduled `/today`
  produces no briefing, which surfaces failures *if something checks the exit
  code*, but nothing in this repo appears to alert on missed exit codes.
- Fix approach: none required immediately — this is an accepted single-machine
  design (RemoteTrigger's cloud path is architecturally blocked, not merely
  unconfigured). If uptime becomes a requirement, the fix is a heartbeat
  check (e.g. a daily `launchctl list` + last-run-timestamp assertion) rather
  than a new scheduler.

**Operational risk — local LLM fallback (LM Studio) has no verified automatic recovery path**
- `config/pipeline.local.json` sets `localModel: qwen/qwen3.6-27b` with
  `localTimeoutMs: 900000` (15 minutes) as the classifier's local fallback.
  `src/utils/classifier-health.js` and `src/utils/voyage-health.js` are the
  Pattern 7 adaptive denial trackers that persist degraded-mode state to
  `~/.cache/second-brain/*.json` — flagged in the prior audit (still OPEN,
  carried below) as read-modify-write, non-atomic. That's an accepted
  concurrency tradeoff for interactive/cron-shared state, not a correctness
  bug on its own.
- Impact: the 900s timeout is tuned to measured cold-prefill throughput
  (~86 tok/s) on this specific M4 Pro / 48GB box; if LM Studio isn't running,
  the model isn't loaded, or the box's memory pressure changes (other apps
  competing for the ~16.3 GiB the model occupies), classifier calls block for
  up to 15 minutes before failing, with no separate fast-fail health check
  distinguishing "LM Studio unreachable" from "model is just slow." Compounded
  by the launchd single-machine risk above: this is the same physical machine
  a scheduled `/today` or `daily-sweep` run depends on.
- Fix approach: none required now — flagging as an operational dependency
  worth knowing about, not a code defect. If timeout-driven failures become
  frequent, add a cheap pre-flight ping to the LM Studio endpoint before
  committing to the full 900s budget.

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

*Concerns audit: 2026-08-19*

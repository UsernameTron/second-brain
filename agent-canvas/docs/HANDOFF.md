# Agent Canvas — Session Handoff (2026-08-16)

Fresh-context orientation, and **this file is now the current-state block and
nothing else** — the implementation and incident history it used to carry moved
verbatim to [HANDOFF-HISTORY.md](HANDOFF-HISTORY.md) on 2026-08-16, because at
1666 lines the live claim was buried under its own past. Use
[ROADMAP.md](ROADMAP.md) for phase intent, [DEPLOY.md](DEPLOY.md) for commands,
and [README.md](README.md) for the evidence hierarchy.

**How to read a claim here.** Every statement below is one of: **git-proven**
(from this repository), **test-proven** (from a suite run whose output was
read), **live-proven** (from a production probe, with the instant it was taken),
**historical acceptance evidence** (recorded when it happened, not replayed
since), or **unverified**. A live claim decays — re-probe before depending on it.

## WHERE THINGS STAND (2026-08-16)

**Canonical checkout (git-proven):** `/Users/cpconnor/projects/second-brain`, app
subtree `agent-canvas/`. `master`, `origin/master`, and `HEAD` all resolve to
`92fb427ef491a5431740f571bdaf66ae7a45c62f`. PRs #194 through #198 are
represented on `master`. The truth-up branch merged as
PR #199, squashed to `62eae86`; the pre-integration dirty state is preserved in
`stash@{0}` on the canonical checkout.

**Verification after this truth-up (`npm run verify`, 2026-08-16):** **362
backend tests / 0 failures**, **39 frontend tests / 0 failures**, a clean
frontend production build, valid deploy-script shell syntax, a passing deploy
preflight self-test, and **0 production-dependency vulnerabilities** in both npm
trees. These are source/build facts, not production acceptance.

**The frontend suite was not continuously green, and saying otherwise would be
the exact failure this truth-up exists to stop.** Two tests
(`owner activates a rehearsed rule`, `keeps the authorization block through
pause and resume`) began failing on 2026-08-16 at 08:00 UTC — not from any code
change, but because their fixtures hardcode `2026-08-16T08:00:00Z` and
`RulesView` marks a rule overdue by comparing `next_run_at` against `Date.now()`.
The wall clock passed the fixture. Resolved by pinning `Date.now` in
`frontend/test/setup.js`; `setTimeout`/`setInterval` are deliberately left real
so `userEvent` and `waitFor` still work. The suite is now a function of its
fixtures rather than of the day it runs.

**Production evidence — OBSERVED 2026-08-16, NOT re-verified since.** A past
probe is not proof of present state; treat every line in this paragraph as
decaying until re-run. At the time of observation, `master` at `92fb427` was
deployed and the active revision was **`agent-canvas-00051-94w`, serving 100%
traffic**, probed via Cloud SDK using application-default credentials. It
carries #194 through #198. All 11 env vars survived the wholesale set;
`TICK_AUDIENCE` and `TICK_INVOKER_SA` were **deliberately absent**, so the OIDC
scheduler lane is off. Zero error-severity log entries after deploy.

**Deployed and live-proven (2026-08-16 ~18:30Z):** `master` at `62eae86`
(PR #199) deployed as revision **`agent-canvas-00052-nbf` at 100% traffic** —
the first run of the preservation-first deploy script, preceded by a
`DEPLOY_DRY_RUN=1` rehearsal that listed the five live-only variables it would
preserve (ED_DISPATCH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
HS_OPS_RUNNER_URL, RAPIDAPI_KEY — exactly the ones the old wholesale set would
have deleted). Post-deploy probes: all eleven env-var names intact,
`MODEL_PROVIDER=anthropic` inherited (not overwritten), **`/api/healthz` 200**
with `{"ok":true,"paused":false}`, `/api/config` 200, the live bundle carrying
both the `Export operational ledger (JSON)` and `Previously authorized by`
strings, zero error-severity log entries since deploy. `TICK_AUDIENCE` /
`TICK_INVOKER_SA` remain absent — scheduler lane dark by intent.

**Resolved: the live `MODEL_PROVIDER` is `anthropic` (live-proven 2026-08-16).**
The wholesale-set hazard did NOT fire on the last deploy — the value survived.
The hazard itself is retired on this branch: the script now inherits the live
value and requires `DEPLOY_PROVIDER_CHANGE=1` to depart from it. Note the deploy
script's first-deploy default (`vertex`) differs from what production actually
runs; inheritance is what keeps that difference harmless.

Deploy provenance, recorded as evidence rather than certainty: a concurrent
documentation truth-up left files uncommitted while the build ran. The live
frontend bundle contains the committed string `Export workspace JSON` and not the
uncommitted `Export operational ledger (JSON)`, which proves that edit did not
enter the build context. `cloudscheduler.googleapis.com` remains disabled, which
supports the same timing conclusion for the deploy-script edit. The only
uncommitted server edit is comment-only, so there is no behavioural ambiguity —
but this is not a byte-for-byte claim about every server file.

| Phase | Repository state | Deployment/acceptance state |
|---|---|---|
| Gate 0, P1, P2 | Implemented, merged | Recorded as deployed and live-accepted in [HANDOFF-HISTORY.md](HANDOFF-HISTORY.md); not replayed since |
| P3 Evidence Rooms | Implemented, merged | Core journey recorded live-accepted; #194 export screen **deployed** (now on `00052-nbf`); dedicated post-#194 acceptance not recorded |
| P4 Agent Builder | Implemented, merged, hardened by #197 | **Deployed** (now on `00052-nbf`); dedicated signed-in builder/publish/version/rollback acceptance still outstanding |
| P5 Standing Rules | Implemented, merged, all 14 follow-up findings closed by #198 | **Deployed; manual execution path accepted** (next section). Unattended scheduling intentionally dark and **unaccepted** |
| P6 Outcomes & reviewed learning | Planned only | Not implemented |
| P7 Selective integrations | Planned only | Not implemented |

### P5 manual-path acceptance — observed 2026-08-16 on `00051-94w`

**Historical acceptance evidence, recorded when it happened and not replayed
since.** Signed in as `pete@cloudtechgurus.com` on canvas `Smoke Test`, the
manual execution path passed end to end: the ten-field interpretation card, the
rehearsal gate holding Activate disabled, a settings edit resetting the rule to
draft, both rehearsals reporting read-only, a two-tick dispatch/finalize
lifecycle with no duplicate dispatch on a third tick, attention cards whose
`sourceRef.id` matched the finalized occurrences, and acknowledgment writing
`acknowledged_at`/`acknowledged_by` idempotently. The `STANDING RULES · TICK`
lamp rendered **dark**, correctly reporting the scheduler lane unwired.

Two things that did NOT pass and remain open: the **clean-zero alert path** was
never exercised, because the model omitted its `MATCHED:` contract line on a
real run and the honest-unknown path fired instead (correct behaviour, and
direct evidence for why that backstop exists — do not infer zero from prose, do
not append `NOTHING MATCHED` server-side, do not add a second model call); and
**no scheduler-signed tick has ever occurred**, so the unattended lane is
unproven. A manual owner tick does not satisfy scheduler capability evidence.

The full run-by-run transcript is preserved verbatim in
[HANDOFF-HISTORY.md](HANDOFF-HISTORY.md).

### What PR #199 changed (deployed on `00052-nbf`)

1. **Stale authorization after an edit — fixed.** Editing an active rule now
   retires its grant in the same transaction as the flip to draft, both edit
   routes return `{ rule, authorization }`, and the UI renders a retired grant
   as history rather than as a live one. Detail in [ROADMAP.md](ROADMAP.md).
2. **The deploy script can no longer silently mutate live configuration.**
   Environment and secrets are applied additively; the running revision is read
   before anything is computed; `MODEL_PROVIDER` is inherited unless
   `DEPLOY_PROVIDER_CHANGE=1`; a failure to READ the live service aborts rather
   than deploying over a configuration it could not see. `DEPLOY_DRY_RUN=1`
   prints the comparison without deploying.
3. **Documentation is classified.** [README.md](README.md) is the index and
   evidence hierarchy; this file is the current block only; history moved
   verbatim to [HANDOFF-HISTORY.md](HANDOFF-HISTORY.md). `test/docs-contract.test.js`
   fails the build if a document goes unclassified, a local link breaks, a
   historical file loses its banner, or this file grows past 200 lines again.
4. **`npm run verify` is the gate.** Backend, frontend, frontend build, deploy
   syntax, deploy preflight self-test. `npm test` is backend-only and was never
   sufficient.
5. **`/api/healthz`** — the GFE-reachable liveness alias (next section), with
   `test/healthz.test.js` covering both paths unauthenticated.

Feature flags default on in source for Inquiry Home, Needs You, Rooms, Agent
Builder, and Standing Rules. A default is not proof of a live setting. P5's UI
can be visible while its scheduler lane is dark; only a recent scheduler-signed
tick earns a green capability status.

### Resolved: the `/healthz` 404 — the platform, not the app (live-proven 2026-08-16)

The discriminating probe settled it. On the exact serving hostname,
`/api/config` returned **200 anonymously** with the real config payload — so
Express is reachable and there is no IAM gate — while `/healthz` returned
**Google's own GFE error page** (the branded "Error 404 (Not Found)!!1" HTML),
identically on both hostnames and identically with and without an identity
token. A request the app had refused would carry Express's response; this one
never reached the container. **Cloud Run's Google Frontend reserves the
`/healthz` path and answers it itself.**

The route in `server/index.js` was always correct, and per the rule above no
routing was touched until this was proven. The fix on this branch is one alias:
the same handler now also answers at **`/api/healthz`**, which rides the `/api`
prefix the GFE forwards untouched, registered before the `/api` router so it
stays unauthenticated. `/healthz` is kept for local runs. Covered by
`test/healthz.test.js`, including a guard that both paths share one handler.
**Deployed on `00052-nbf` and probed live: `/api/healthz` answers 200.**

### Release gates, in order

0. ~~**Restore Cloud SDK access.**~~ **DONE 2026-08-16** — `gcloud auth login`
   run interactively; the probes in this file are from the restored session.
1. ~~**Probe before changing anything.**~~ **DONE and REFRESHED 2026-08-16.**
   Now `agent-canvas-00052-nbf` at 100% traffic (post-deploy), eleven env-var
   names confirmed, `MODEL_PROVIDER=anthropic` live-proven, `/api/healthz` and
   `/api/config` both 200 (the `/healthz` question closed — section above).
2. **Wire P5 scheduling. STILL OUTSTANDING and deliberately not done.** Create
   the dedicated tick service account and Cloud Scheduler job, and set both
   `TICK_AUDIENCE` and `TICK_INVOKER_SA`; one without the other deliberately
   disables the OIDC lane. Both are absent today, which is why the lane is dark.
   This is the step where unattended runs against real data begin.
3. ~~**Deploy current `master` once.**~~ **DONE 2026-08-16, twice.** `master`
   at `62eae86` is deployed as `00052-nbf`; production is NOT behind. The second
   deploy was the first run of the preservation-first script, rehearsed with
   DEPLOY_DRY_RUN=1 first; the environment contract was preserved additively.
4. **Accept P4 in-app.** Build from plain language, inspect the generated role,
   rehearse, publish as owner, verify version history/rollback, and confirm no
   authority widens.
5. **Accept P5 end to end.** Parse, edit, rehearse, activate, receive a real
   scheduler-signed tick, inspect the run/attention card, then exercise pause,
   revoke, expiry, and rollback. A manual owner tick does not prove scheduling.
6. **Truth-up this block again** with the observed revision, timestamp, test
   evidence, and acceptance result before beginning P6.

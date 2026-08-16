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

**Repository provenance (git-proven, observed 2026-08-16):** this
documentation truth-up was prepared against synchronized base `72db799`.
Application code last changed at `62eae86`. Canonical checkout:
`/Users/cpconnor/projects/second-brain`, app subtree `agent-canvas/`.
PRs #194 through #198 are represented on `master`. The truth-up branch merged as
PR #199, squashed to `62eae86` — **the last commit containing application
changes** (`92fb427` is PR #198, P5 application code, and precedes it).
Everything after `62eae86` (`127f593` #200, `34ab055` #201, and `72db799` #202)
is documentation-only; the code deployed to production is `62eae86`'s. The
pre-integration dirty state is preserved in `stash@{0}` on the canonical
checkout.

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

**Production — LATEST LIVE OBSERVATION (2026-08-16, direct verification):**
active revision **`agent-canvas-00053-h2n` at 100% traffic**, running `62eae86`
code with the two tick env vars added additively (13 env-var names present in
total). Cloud Scheduler job enabled at `*/10 * * * *`; the dedicated OIDC
identity holds `run.invoker`; scheduler requests returned **200 at 19:04, 19:10,
and 19:20 UTC**. `/api/healthz` and `/api/config` both 200. Zero error-severity
logs since activation. 362 backend and 39 frontend tests pass. A live claim
decays — re-probe before depending on it.

**Historical observations (superseded by `00053-h2n`, preserved as evidence
only):** earlier on 2026-08-16, `00051-94w` served 100% traffic carrying
#194–#198 with the scheduler lane deliberately off; then `62eae86` (PR #199)
deployed as `00052-nbf` via the first run of the preservation-first deploy
script (dry-run rehearsed; the five live-only env vars preserved;
`MODEL_PROVIDER=anthropic` inherited, not overwritten; `/api/healthz` and
`/api/config` 200; zero error logs). The wholesale-set hazard is retired: the
script inherits the live provider and requires `DEPLOY_PROVIDER_CHANGE=1` to
depart from it. Full detail in [HANDOFF-HISTORY.md](HANDOFF-HISTORY.md).

| Phase | Repository state | Deployment/acceptance state |
|---|---|---|
| Gate 0, P1, P2 | Implemented, merged | Recorded as deployed and live-accepted in [HANDOFF-HISTORY.md](HANDOFF-HISTORY.md); not replayed since |
| P3 Evidence Rooms | Implemented, merged | **Live-accepted incl. #194** (2026-08-16, `00052-nbf`): the room's Disclosure Review rendered included/excluded counts, held 3 private-surface Drive sources internal, and content-flagged the fact whose wording names them |
| P4 Agent Builder | Implemented, merged, hardened by #197 | **Live-accepted** (2026-08-16, `00052-nbf`) — see the P4 acceptance section below |
| P5 Standing Rules | Implemented, merged, all 14 follow-up findings closed by #198 | **Deployed; manual path accepted; scheduler lane WIRED and live-proven** (2026-08-16 — section below). Outstanding: a due rule dispatched by a scheduled tick, pause/expiry under the scheduler, clean-zero alert path |
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

### P4 acceptance — 2026-08-16, revision `00052-nbf`, signed in as pete@cloudtechgurus.com

Driven in a real Chrome session against production. Observed live: a
plain-language job description produced a full generated configuration
("Renewal Risk Analyst", research role, strong tier) with business purpose,
inputs/outputs, operating instructions, escalation contract, and the authority
map showing every governed tool — only the three read tools checked, every
write/draft/MCP tool unchecked, matching the read-only request. **Publish was
disabled until a rehearsal completed** (the gate held). The rehearsal ran
read-only end to end and its report recorded `memory_write`/`memory_correct`
refused per rehearse mode, no records modified, no communications sent. Owner
publish succeeded; the agent appeared on the canvas. Version history showed the
publish entry (actor, tier, purpose); **Rollback executed and recorded
honestly** — "Restored: no fields differed" appended as a new `rollback`
version with the original publish preserved, no authority widened.

Still outstanding for P5 after the scheduler wiring (2026-08-16): (1) a DUE
rule dispatched by a scheduled (not forced, not manual) tick, including the
resulting run and attention card — this needs a rule actually due at a tick,
not just the cadence running; (2) **pause under scheduler operation** — pause
is not passive and will not exercise itself; (3) **expiry under scheduler
operation** — requires an active fixture or a naturally expiring rule; (4) the
clean-zero alert path live (currently test-only). The scheduler cadence alone
does not prove these acceptance scenarios. Each requires an eligible rule state
and observed evidence; pause requires explicit operator action.

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
2. ~~**Wire P5 scheduling.**~~ **DONE 2026-08-16 ~19:00Z (live-proven).**
   `agent-canvas-tick@` SA created, granted `roles/run.invoker`; both tick env
   vars set additively (revision `agent-canvas-00053-h2n`); Cloud Scheduler job
   `agent-canvas-standing-rules` ENABLED at `*/10 * * * *` with OIDC audience =
   the tick URL. A forced first execution reached the app and returned **200**
   at 19:04:37Z (request log + WAL write), zero error logs, and the
   `STANDING RULES · TICK` lamp turned **green**: "Last scheduler-signed tick
   2026-08-16T19:04:37.676Z". Unattended runs against real data are now on.
3. ~~**Deploy current `master` once.**~~ **DONE 2026-08-16** — `62eae86`
   deployed as `00052-nbf` via the preservation-first script (dry-run
   rehearsed); env contract preserved additively.
4. ~~**Accept P4 in-app.**~~ **DONE 2026-08-16** — full journey observed live
   on `00052-nbf` (section above), including the rehearse gate, version
   history, rollback, and authority non-expansion. P3 #194 screened export
   accepted in the same session.
5. **Finish P5 end-to-end acceptance.** The scheduler-signed tick is done
   (gate 2). Remaining: watch a due rule produce its run and attention card
   from a scheduled tick, then exercise pause, revoke, and expiry under the
   scheduler. Fastest rollback stays: pause the Scheduler job.
6. **Truth-up this block again** with the observed revision, timestamp, test
   evidence, and acceptance result before beginning P6.

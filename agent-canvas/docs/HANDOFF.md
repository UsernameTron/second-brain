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
represented on `master`. This truth-up sits on the branch
`fix/agent-canvas-truth-up`, cut from `92fb427`; the canonical checkout was left
dirty and untouched so the pre-integration state stays inspectable.

**Verification after this truth-up (`npm run verify`, 2026-08-16):** **354
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

**Re-probing is currently BLOCKED (observed 2026-08-16).** `gcloud` returns
`Reauthentication failed. cannot prompt during non-interactive execution`, so no
live claim in this file could be refreshed during the truth-up. Restoring it
requires an interactive `gcloud auth login` by the operator. Until that happens,
every production statement here is **historical observation, not current fact** —
including the revision, the traffic split, and the env-var inventory.

**Unverified: the live `MODEL_PROVIDER` value.** Before this truth-up the deploy
script defaulted `MODEL_PROVIDER` to `vertex` whenever the variable was unset and
then wrote the environment wholesale, so a redeploy that forgot to export it
would have moved the whole fleet between providers with nothing in the output to
say so. History records `anthropic` as a previously deployed value and a planned
switch to `vertex`; which one `00051-94w` actually runs was not readable while
auth was down. The script no longer permits this class of change — it inherits
the live value and requires `DEPLOY_PROVIDER_CHANGE=1` to depart from it — but
the *current* value remains an open question to answer with the first probe.

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
| P3 Evidence Rooms | Implemented, merged | Core journey recorded live-accepted; #194 export screen **deployed** on `00051-94w`; dedicated post-#194 acceptance not recorded |
| P4 Agent Builder | Implemented, merged, hardened by #197 | **Deployed** on `00051-94w`; dedicated signed-in builder/publish/version/rollback acceptance still outstanding |
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

### What `fix/agent-canvas-truth-up` changes (test-proven, NOT deployed)

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

Feature flags default on in source for Inquiry Home, Needs You, Rooms, Agent
Builder, and Standing Rules. A default is not proof of a live setting. P5's UI
can be visible while its scheduler lane is dark; only a recent scheduler-signed
tick earns a green capability status.

### Open, evidenced release blocker: `/healthz` answered 404

A probe reported 404 from `/healthz` on the live service. The route **exists and
is correctly ordered in source** (git-proven): `server/index.js:39` registers it
before the `/api` router, and the SPA catch-all at `:66` explicitly excludes it.
So this is **not** an application-routing defect unless a probe proves the
request reached Express and was refused there. **No application routing has been
changed, and none should be, until the failing layer is identified.**

Two candidate explanations, both of which have precedent in this project's
history and neither of which is an app bug:

- **The IAM gate.** An IAM-gated Cloud Run service in this organization answers
  unauthorized callers **GFE 404, not 403** — a 404 is the gate working. If the
  `--allow-unauthenticated` binding did not take (organization policy on
  `allUsers` is the usual cause), every unauthenticated path 404s.
- **The wrong hostname.** Cloud Run issues two hostnames per service
  (`service-projectnumber.region.run.app` and a legacy `service-hash.a.run.app`);
  `deploy.sh` documents this and computes both. A probe against the non-serving
  one 404s regardless of the app.

The discriminating probe, once `gcloud auth login` is restored — run it against
the exact serving hostname:

```bash
curl -s -o /dev/null -w 'anon:%{http_code}\n' https://<serving-host>/healthz
curl -s -o /dev/null -w 'auth:%{http_code}\n' -H "Authorization: Bearer $(gcloud auth print-identity-token)" https://<serving-host>/healthz
```

`anon:404` + `auth:200` ⇒ IAM gate. Both 404 ⇒ hostname. `anon:200` ⇒ the
original probe hit something else and the blocker closes. Only if the request
demonstrably reaches Express and still 404s is there anything to fix in code.

### Release gates, in order

0. **Restore Cloud SDK access.** `gcloud auth login`, interactively, by the
   operator. Every gate below needs it, and no live claim in this file can be
   refreshed without it.
1. ~~**Probe before changing anything.**~~ **DONE 2026-08-16, and now stale.**
   At observation the active revision was `agent-canvas-00051-94w` at 100%
   traffic, carrying #194–#198, with all 11 env vars intact and no
   error-severity logs. Re-probe before relying on any of it; also capture the
   live `MODEL_PROVIDER`, which is currently unverified.
2. **Wire P5 scheduling. STILL OUTSTANDING and deliberately not done.** Create
   the dedicated tick service account and Cloud Scheduler job, and set both
   `TICK_AUDIENCE` and `TICK_INVOKER_SA`; one without the other deliberately
   disables the OIDC lane. Both are absent today, which is why the lane is dark.
   This is the step where unattended runs against real data begin.
3. ~~**Deploy current `master` once.**~~ **DONE 2026-08-16.** `master` at
   `92fb427` is deployed; production is NOT behind. Do not redeploy to satisfy
   this gate. The environment contract was preserved through the wholesale set.
4. **Accept P4 in-app.** Build from plain language, inspect the generated role,
   rehearse, publish as owner, verify version history/rollback, and confirm no
   authority widens.
5. **Accept P5 end to end.** Parse, edit, rehearse, activate, receive a real
   scheduler-signed tick, inspect the run/attention card, then exercise pause,
   revoke, expiry, and rollback. A manual owner tick does not prove scheduling.
6. **Truth-up this block again** with the observed revision, timestamp, test
   evidence, and acceptance result before beginning P6.

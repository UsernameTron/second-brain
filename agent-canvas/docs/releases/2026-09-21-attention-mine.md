# Agent Canvas release — "mine" attention summary, 2026-09-21

**Status: deployed and verified live.** The rollout ran 2026-09-21 18:44–18:51
UTC; see [Observed rollout](#observed-rollout--2026-09-21). A follow-on incident
on 2026-09-22 took the service to zero instances for 14 minutes and is recorded
in [2026-09-22 — service scaled to zero again](#2026-09-22--service-scaled-to-zero-again).
The maintenance-window commands (Scheduler pause, scale to zero, image update)
are refused to the agent session by a permission check, so Pete ran them one at
a time.

## Live baseline, read 2026-09-21 18:38 UTC (before any change)

- Revision `agent-canvas-ui-20260914-review2` serves 100% of traffic, service
  generation 75, no tagged revisions.
- Live image — **the rollback image** —
  `us-central1-docker.pkg.dev/agent-canvas-ctg-0811/app/agent-canvas@sha256:5d80f91078ed82a74632003ac29c300028dbb717a651fc18c3467dd7441aaaa5`.
- 18 environment/secret bindings (4 secret references), `MODEL_PROVIDER=gemini`,
  service account `agent-canvas-run@`, 1 CPU / 1 GiB, concurrency 80, timeout
  300 s, revision maximum one instance, scaling mode automatic. Fingerprint of
  everything except image and revision name:
  `8f0c95d85b1cff419908b5d8ce7ddc6e8d424961caa840e201355a56f61ee134`.
- Scheduler `agent-canvas-standing-rules` ENABLED, `*/10 * * * *`.
- 18:00–18:45 UTC the only requests were Scheduler ticks (HTTP 200): no signed-in
  users, no runs. Litestream replication current, generation `3d7d55ace9544fcf`.
  The in-app Pause step was therefore skipped: nothing was in flight and no
  signed-in browser session was available to the agent.
- Shipped-code difference from the live release commit `cd6cdf8`: 20 added lines
  in `server/routes.js`. No schema, dependency, frontend or start-script change.

Pushed 18:40 UTC; the registry returns index digest
`sha256:05739e588cbcd71a88d2cb061d965d9de419fde0ed4ce81911a2d3bdbf9bc8b5` for
tag `mine-20260921-17fbd4e`, matching the local build.

## What ships

`origin/master` at `17fbd4e`, the merge of PR
[#256](https://github.com/UsernameTron/second-brain/pull/256). The
service-to-service status lane `GET /api/service/attention-count` — the endpoint
L10's `getCanvasStatus` reads — now accepts an optional `X-Actor-Email` header
and returns that person's own items: `{ count, mine: true, items[≤5], generatedAt }`.
The address travels in the header, never the URL, is validated strictly
against the allowed domain, and is never echoed. Without the header the
response is unchanged (`{ needsYou, generatedAt }`).

## Exact candidate

| Item | Value |
|---|---|
| Source | `17fbd4e` (clean worktree of `origin/master`, no local changes) |
| Local image | `agent-canvas:mine-20260921-17fbd4e` |
| Registry tag | `us-central1-docker.pkg.dev/agent-canvas-ctg-0811/app/agent-canvas:mine-20260921-17fbd4e` |
| Image index digest | `sha256:05739e588cbcd71a88d2cb061d965d9de419fde0ed4ce81911a2d3bdbf9bc8b5` |
| Linux/amd64 manifest | `sha256:0a6fabcebd2e94b9db6347350ce5fe19e91bd666e85d67d5cf212f257b1ce9f5` |
| Base image | `node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5` — Node `22.23.2`, same as the live image |
| Planned revision | `agent-canvas-mine-20260921-17fbd4e` |

## Verification before build

| Gate | Result |
|---|---|
| `npm run verify` (worktree) | Passed, exit 0: 434 backend + 299 frontend tests, frontend build, `deploy.sh` syntax and preflight self-test; no skipped tests |
| Container build | Passed, Linux/amd64, base pinned by digest |
| Offline startup (`--network none`) | Health 200 `paused:false`; private route 401; status lane 503 with its env unset (closed by default); dev sign-in 403 even with `DEV_AUTH=1` |

## Rollback

The rollback image is the currently live one, revision
`agent-canvas-ui-20260914-review2`:
`us-central1-docker.pkg.dev/agent-canvas-ctg-0811/app/agent-canvas@sha256:5d80f91078ed82a74632003ac29c300028dbb717a651fc18c3467dd7441aaaa5`.
That digest was re-read from the live service before any change (baseline
above) and matches the locally cached registry tag `ui-20260914-review2`.

The rollout follows the image-only procedure in
[2026-09-14-ui.md](2026-09-14-ui.md): only the image and the revision name
change; every environment variable, secret binding and `MODEL_PROVIDER` stay as
they are. `deploy/deploy.sh` is not used.

## Observed rollout — 2026-09-21

All times UTC, read from the Cloud Run admin activity log and the revision's
own logs. Every service change was made by `pete@cloudtechgurus.com`.

| Step | Time | Observed result |
|---|---|---|
| Scheduler paused | before 18:44 | `agent-canvas-standing-rules` PAUSED |
| Scale to zero | 18:44:14 | old instance logged `litestream shut down` at 18:44:20 |
| Image update | 18:47:45 | revision `agent-canvas-mine-20260921-17fbd4e` created with `--no-traffic --scaling=0`; traffic still pinned to `ui-20260914-review2` |
| Traffic cutover | 18:48:58 | 100% to `agent-canvas-mine-20260921-17fbd4e` |
| Scaling restored | 18:51:14 | scaling mode automatic; instance up at 18:51:28, restored replica generation `3d7d55ace9544fcf` index 301 |

Two further service replaces at 18:51:02 and 18:51:21 repeated the traffic and
scaling state already in force and changed nothing.

**Image.** Cloud Run resolved the index digest `05739e58…` to its linux/amd64
manifest `sha256:0a6fabcebd2e94b9db6347350ce5fe19e91bd666e85d67d5cf212f257b1ce9f5`
— the manifest recorded in *Exact candidate* above, so the running container is
the built and tested image.

**Configuration.** A field-by-field comparison of the new revision's spec
against the baseline revision's, with only the image removed, is empty: 18
environment/secret bindings (4 secret references), `MODEL_PROVIDER=gemini`,
service account `agent-canvas-run@`, 1 CPU / 1 GiB, concurrency 80, timeout
300 s, revision maximum one instance. The `8f0c95d8…` fingerprint quoted in the
baseline has no recorded recipe, so this diff replaces it as the reproducible
check:

```bash
for r in agent-canvas-ui-20260914-review2 agent-canvas-mine-20260921-17fbd4e; do
  gcloud run revisions describe "$r" --project agent-canvas-ctg-0811 --region us-central1 \
    --format=json | jq -S '.spec | del(.containers[].image) | .containers[].env |= sort_by(.name)' \
    > "/tmp/$r.spec.json"
done
diff /tmp/agent-canvas-ui-20260914-review2.spec.json \
     /tmp/agent-canvas-mine-20260921-17fbd4e.spec.json   # exits 0, no output
```

**Traffic after cutover.** Requests on the new revision through to the next
morning, all HTTP 200, no ERROR-severity log in the window: `/` at 18:51:21,
then `/api/service/attention-count` at 18:55:33, 22:41:28, and 2026-09-22
03:52:49 and 04:03:01. The request log does not record headers, and none of
those calls came from a caller that sends one — see *Status lane verified
live* below.

Instances started and stopped on demand across that period, each restoring the
replica the previous one left behind — generation chain `3d7d55ace9544fcf` →
`09da4d7052aa185b` → `5fbaa4407b5f8e0f` → `251261bdac178897` →
`d8ea9f4c098d1e2d`, no gap.

## 2026-09-22 — service scaled to zero again

At 16:27:14 the image-update command above was run a second time from the
terminal. Because the revision already existed with the same image, no revision
was created and traffic was untouched, but `--scaling=0` returned the service to
manual scaling with zero instances. `/api/healthz` returned 503 until the fix.
No instance was running at the time — the last one shut down cleanly at 04:18:04
(`litestream shut down`) — so no request was interrupted and no write was lost.

Recovery, same day:

| Time | Action | Result |
|---|---|---|
| 16:41 | `gcloud run services update agent-canvas --scaling=auto` | generation 81, scaling mode automatic, traffic unchanged at 100% to `mine-20260921-17fbd4e` |
| 16:42:00 | instance started (AUTOSCALING) | restored replica generation `d8ea9f4c098d1e2d`, new generation `929e073e207c4c57` |
| 16:41:55–16:42:08 | `/api/healthz` ×3 | 200 `{"ok":true,"paused":false}` |
| 16:43 | `gcloud scheduler jobs resume agent-canvas-standing-rules` | ENABLED |
| 16:50:01 | first scheduler tick | `/api/standing-rules/tick` 200, no errors |

The scheduler had stayed PAUSED from the maintenance window until 16:43 — about
22 hours in which no standing-rules tick ran. Nothing in the rollout depends on
it, but it was not part of the plan.

## Status lane verified live — 2026-09-22 17:02 UTC

Four probes against the live service, run from Pete's terminal with an OIDC
token minted by impersonating `553976212013-compute@developer.gserviceaccount.com`
(the `STATUS_INVOKER_SA`). Impersonation needed a temporary
`roles/iam.serviceAccountTokenCreator` grant on that account in project
`l10ctg`, revoked immediately after.

| Probe | Response | Status |
|---|---|---|
| No token | `{"error":"missing bearer token"}` | 401 |
| Token, no header | `{"needsYou":3,"generatedAt":"…"}` | 200 |
| Token + `X-Actor-Email: pete@cloudtechgurus.com` | `{"count":0,"mine":true,"items":[],"generatedAt":"…"}` | 200 |
| Token + `X-Actor-Email: pete@example.com` | `{"error":"invalid email"}` | 400 |

The header is honoured, the response switches to the `mine:true` shape, the
address is not echoed in the body, and an out-of-domain address is rejected
before any query runs. The headerless response is unchanged.

**Two caveats.**

1. `ctg-l10-eos` does not send the header yet — neither
   `functions/src/getCanvasStatus.ts` nor the compiled `functions/lib/getCanvasStatus.js`
   contains `X-Actor-Email`. Until L10 ships that, production traffic exercises
   only the headerless branch; the `mine` branch is live but dormant.
2. Pete's own count came back 0 while three items need attention overall, so
   the ≤5 item cap and the 120-character title truncation were not exercised
   against real rows — `scope: 'mine'` matches `owner.email` exactly
   (`server/attention.js:249`), and none of the three open items is owned by
   that address. Whether any current card carries an owner address at all is
   unconfirmed.

**Two things to carry into the next window.** Re-running the image-update
command is not idempotent: the image and traffic flags no-op, `--scaling=0` does
not. And a rollout is not finished when traffic moves — close it only after
scaling mode, the scheduler and a live health check are each re-read and
recorded here.

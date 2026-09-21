# Agent Canvas release — "mine" attention summary, 2026-09-21

**Status: image published to the private registry. Not yet deployed.** The
maintenance-window commands (Scheduler pause, scale to zero, image update) are
refused to the agent session by a permission check, so Pete runs them one at a
time. This record is updated with the observed live results once the rollout
runs.

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

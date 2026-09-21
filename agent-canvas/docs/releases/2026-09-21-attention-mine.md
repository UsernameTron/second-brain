# Agent Canvas release — "mine" attention summary, 2026-09-21

**Status: prepared locally. Not yet published or deployed.** The registry push
and the service update are blocked on an expired `gcloud` login
(`pete@cloudtechgurus.com`, reauthentication required). This record is updated
with the observed live results once the rollout runs.

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
That digest matches the locally cached registry tag `ui-20260914-review2`; the
re-read from the live service is pending the login above.

The rollout follows the image-only procedure in
[2026-09-14-ui.md](2026-09-14-ui.md): only the image and the revision name
change; every environment variable, secret binding and `MODEL_PROVIDER` stay as
they are. `deploy/deploy.sh` is not used.

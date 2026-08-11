# Deploying the Agent Canvas Workspace

The app is one Cloud Run service (Node 22 + SQLite + Litestream→Cloud Storage) serving the API, WebSocket hub, and the built frontend. Deploy takes three steps; only step 2 needs the Google Cloud console UI (OAuth clients cannot be created by CLI).

## Step 1 — run the deploy script

From a machine with `gcloud` where a cloudtechgurus.com admin (Pete) is signed in:

```bash
gcloud auth login                       # keyless user auth — no service-account keys anywhere
gcloud billing accounts list            # note the billing account ID

export BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX
export ANTHROPIC_API_KEY=sk-ant-...     # console.anthropic.com → API keys
./agent-canvas/deploy/deploy.sh
```

The script is idempotent. It creates a **new dedicated project** `agent-canvas-ctg` inside the cloudtechgurus.com organization, enables Cloud Run / Cloud Build / Artifact Registry / Secret Manager / Cloud Storage, creates a least-privilege runtime service account, stores the Anthropic key and a JWT secret in Secret Manager, builds the image with Cloud Build, and deploys. It prints the service URL at the end (like `https://agent-canvas-XXXXXXXX-uc.a.run.app`).

## Step 2 — create the Google OAuth client (one-time, ~2 minutes)

1. Console → the `agent-canvas-ctg` project → **APIs & Services → OAuth consent screen**: User type **Internal** (this alone restricts sign-in to cloudtechgurus.com accounts at Google's side; the app additionally verifies the `hd` claim and its own allowlist server-side). App name "Agent Canvas", support email Pete's.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorized JavaScript origins: the service URL from step 1.
   - No redirect URIs needed (Google Identity Services popup flow).
3. Copy the client ID and attach it:

```bash
gcloud run services update agent-canvas --project agent-canvas-ctg --region us-central1 \
  --update-env-vars GOOGLE_CLIENT_ID=<the-client-id>.apps.googleusercontent.com
```

## Step 3 — sign in and check the seed

Open the service URL, sign in with a cloudtechgurus.com Google account. The allowlist is seeded with pete@ (owner), fred@, darren@, jessica@ — **if the real mailbox names differ, the owner fixes them in-app** (top bar → Admin → Allowlist) or pre-seeds via `OWNER_EMAIL` / `SEED_MEMBERS` env vars. Remaining domain users are added from the same Admin panel — no redeploy.

## Operations notes

- **Models**: strong tier defaults to `claude-sonnet-5` (the workhorse), fast tier `claude-haiku-4-5` for routing/classification; frontier models (`claude-opus-5`, `claude-fable-5`) are deliberate opt-ins via `STRONG_MODEL` for canvases that need them. Costs — including web searches at $10/1k — are metered per run/agent/day inside the app; the daily budget (default $25, owner-adjustable in the UI) suspends new runs when reached. Research agents get server-side web search (disable with `ENABLE_WEB_SEARCH=0`); web-sourced memory entries must carry URL + retrieval-time provenance (enforced by the agent contract).
- **Authoritative audit record**: every audit entry is hash-chained in SQLite (the queryable index) *and* mirrored as structured JSON to stdout, which Cloud Run delivers to Cloud Logging — a store the application runtime cannot update or delete. For regulator-grade immutability, route these entries to a dedicated log bucket with a **locked** retention policy (locking is deliberately irreversible — run this only once you're sure of the retention window):

  ```bash
  gcloud logging buckets create audit-locked --location=us-central1 --retention-days=365 --project agent-canvas-ctg
  gcloud logging sinks create agent-canvas-audit \
    logging.googleapis.com/projects/agent-canvas-ctg/locations/us-central1/buckets/audit-locked \
    --project agent-canvas-ctg \
    --log-filter='resource.type="cloud_run_revision" jsonPayload.audit=true'
  # After validating entries arrive, lock it (IRREVERSIBLE):
  # gcloud logging buckets update audit-locked --location=us-central1 --locked --project agent-canvas-ctg
  ```
- **Database durability**: SQLite on the instance disk, restored from `gs://agent-canvas-ctg-db` on cold start and continuously replicated by Litestream. `--max-instances 1` is required (single writer). If the workspace ever outgrows this, the storage layer is isolated in `server/db.js` for a Cloud SQL migration.
- **Auth model**: the Cloud Run service allows unauthenticated ingress, and the app itself enforces Google sign-in (`hd=cloudtechgurus.com` + email_verified + allowlist, re-checked on every request) with signed httpOnly session cookies. Roles: owner / member, enforced server-side.
- **Global pause**: any member can pause (kills in-flight model calls); only the owner can resume.
- **Export**: owner → top bar → Export downloads the full workspace (memory, canvases, runs, audit log) as JSON.
- **Dev auth (`DEV_AUTH=1`) is never set in production** — the Dockerfile doesn't set it and deploy.sh doesn't pass it. It exists only for local development and tests.

## Image build notes

- The Dockerfile vendors the Mozilla CA bundle (`deploy/cacert.pem`, from python-certifi) for Litestream's TLS to Cloud Storage — `node:22-slim` ships no system CA store. Refresh it occasionally (`pip download certifi` or copy from any current certifi release).
- `--build-arg BASE_IMAGE=mirror.gcr.io/library/node:22-slim` substitutes a mirror of the official base image in environments where Docker Hub is blocked; Cloud Build uses the default `node:22-slim`.
- `--secret id=build_ca,src=<ca.pem>` supplies an extra CA to npm during the build for TLS-intercepting corporate networks; unused on Cloud Build.

## Local development

```bash
cd agent-canvas && npm install
(cd frontend && npm install && npm run build)
ANTHROPIC_API_KEY=sk-ant-... DEV_AUTH=1 node server/index.js   # http://localhost:8080
npm test
```

## Expected cost at ~10 seats

- Cloud Run: scale-to-zero, 1 vCPU/1 GiB — normal light internal use stays inside the free tier or low single dollars/month.
- Cloud Storage (database replica): pennies.
- Anthropic API: dominated by agent runs. The verified demo workflow (three agents, 12 rows, ~19 model steps) cost ≈ $1.00 on Haiku-only; with `claude-sonnet-5` as the strong tier expect roughly $2–4 per full enrichment batch (plus $0.01 per web search). The in-app daily budget caps the blast radius.

# Deploying the Agent Canvas Workspace

The app is one Cloud Run service (Node 22 + SQLite + Litestream→Cloud Storage) serving the API, WebSocket hub, and the built frontend. The current production target is project `agent-canvas-ctg-0811`, service `agent-canvas`, region `us-central1`. Treat that target as an explicit input even though the script has the same safe default.

Before deploying, read the current-state block in [HANDOFF.md](HANDOFF.md) and
describe the live service. A last-known revision in a document is evidence from
that probe, not proof of what is serving now. If production already matches the
intended commit, do not redeploy it.

Deploy takes three steps; only step 2 needs the Google Cloud console UI (OAuth
clients cannot be created by CLI).

## Step 1 — run the deploy script

From a machine with `gcloud` where a cloudtechgurus.com admin (Pete) is signed in:

```bash
gcloud auth login                       # keyless user auth — no service-account keys anywhere
gcloud billing accounts list            # note the billing account ID

export BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX
export PROJECT_ID=agent-canvas-ctg-0811
export REGION=us-central1
export SERVICE=agent-canvas
./agent-canvas/deploy/deploy.sh         # default: Claude via Vertex AI — inside the perimeter, keyless
```

**Redeploys preserve configuration; they no longer replace it.** As of
2026-08-16 `deploy/deploy.sh` applies environment variables and secret bindings
with `--update-env-vars` / `--update-secrets`, reads the running revision before
it changes anything, and prints any live-only variable it is preserving (names
only — never values). Two consequences worth knowing before you run it:

- **Removing a variable is now deliberate**, never a side effect of forgetting
  to export it:
  `gcloud run services update agent-canvas --region us-central1 --remove-env-vars NAME`
- **The model provider is inherited from the live service.** Leaving
  `MODEL_PROVIDER` unset keeps whatever is running. Setting it to something
  different aborts unless you also pass `DEPLOY_PROVIDER_CHANGE=1` — moving the
  fleet between providers changes the model, the perimeter, and the invoice, so
  it must be typed on purpose.

Run `DEPLOY_DRY_RUN=1 ./deploy/deploy.sh` to execute every check and print the
configuration comparison without deploying, and `./deploy/deploy.sh --selftest`
to exercise the preflight's name parsing against fixtures with no cloud access
at all.

**Model provider — inside the perimeter by default.** On a FIRST deploy the script defaults to `MODEL_PROVIDER=vertex` (thereafter it inherits the live value, as above): agent conversations go to Claude served on **Vertex AI inside this Google Cloud project** — no data leaves the Google perimeter, there is no model API key anywhere in the system (the runtime service account authenticates), and model usage lands on the Google invoice under Google's Vertex data-use terms. Two one-time steps apply, and **both** are required: (1) in the console, **Vertex AI → Model Garden → search "Claude" → Enable** on claude-sonnet-5, claude-haiku-4-5, and claude-opus-4-8; (2) **confirm the project actually has Anthropic serving quota** — enablement does NOT grant it. Check with `gcloud alpha quotas info list --service=aiplatform.googleapis.com --project=$PROJECT_ID | grep -i claude`; if no Claude base-model bucket exists, request an increase on quota id `GlobalOnlinePredictionRequestsPerMinutePerProjectPerBaseModel` (base model `anthropic-claude-sonnet`) and wait for it to be granted before deploying a Claude tier. **This was not hypothetical:** on 2026-08-20 `agent-canvas-ctg-0811` had Model Garden enabled and zero Claude quota, so `STRONG_PROVIDER=vertex` 429'd every strong-tier run until it was reverted. To use Anthropic's first-party API instead, deploy with `MODEL_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=sk-ant-...` (stored in Secret Manager). Switching later is one redeploy with the other values. **Gemini and mixed fleets** are built in behind the same seam: `MODEL_PROVIDER=gemini` runs everything on Gemini via Vertex (same keyless service-account auth, same perimeter), and the per-tier overrides `FAST_PROVIDER` / `STRONG_PROVIDER` mix providers — e.g. `STRONG_PROVIDER=vertex FAST_PROVIDER=gemini` keeps the verified Claude behavior on the judgment-heavy agents while Gemini Flash handles routing and light work — **but only if the Claude quota check above passes; without quota this mix fails every strong-tier run.** Gemini tier models default to `gemini-2.5-flash` / `gemini-2.5-pro` (override with `GEMINI_FAST_MODEL` / `GEMINI_STRONG_MODEL` — check them against Google's current lineup). Two v1 limits on the Gemini path: research agents skip web search (Google's grounding tool has a different result shape), and safety blocks surface as escalations rather than retrying on a fallback model. **Verification status is provider-specific:** the workflow behaviors were verified on Claude models; moving a tier to Gemini needs representative signed-in inquiry, document-read, escalation, and memory-receipt journeys re-checked before trusting it with real work — the adapter's translation layer is unit-tested offline, and its first live call happens on your deploy.

After the first Vertex deploy, probe it end to end before inviting the team:
sign in, create or open a canvas, upload a small TXT or Markdown file, and ask
an authorized agent to summarize a named fact from it. Confirm the completed
run's receipt identifies the canvas file. That proves the signed-in inquiry,
model, document-read, evidence, and receipt path without manufacturing a memory
write. A 403/404 model error means the Model Garden enablement step is still
pending. A **429 `Quota exceeded for ...global_online_prediction_requests_per_base_model`**
means enablement succeeded but the project has no serving quota for that base
model — a different failure with a different fix: request the quota increase
above, and until it is granted run that tier on another provider.

The script is idempotent and operates on `PROJECT_ID` (current default:
`agent-canvas-ctg-0811`). It creates the project only when it does not exist,
enables the required APIs, creates a least-privilege runtime service account,
stores required secrets in Secret Manager, builds the image, and deploys. It
prints the service URL at the end. Never rely on an implicit project when
working on production: keep the explicit exports above in the operator paste.

## Step 2 — create the Google OAuth client (one-time, ~2 minutes)

1. Console → the deployed project → **APIs & Services → OAuth consent screen**. App name "Agent Canvas", support email Pete's. **User type depends on where the project lives, and Internal is not always offered:**

   - **Internal** — available *only* when the project sits inside the cloudtechgurus.com Cloud organization. Prefer it when offered: Google itself then refuses every non-cloudtechgurus.com account, so sign-in has two independent gates.
   - **External** — the only option for a project outside the organization, including one created under a personal account. The Internal radio is greyed out there; this is a property of the project's parent, not a misconfiguration. Sign-in stays restricted, but by one gate instead of two: `signInWithGoogle` verifies the ID token's signature and audience, requires `email_verified`, requires the `hd` claim to equal `cloudtechgurus.com`, and re-checks the allowlist on *every request* — so a personal Gmail is refused by the app even though Google will let it reach the consent screen. The app requests only `openid email profile`, which are non-sensitive scopes, so publishing requires no Google verification review. While the app is in **Testing**, add each member as a test user; **Publish** removes both the 100-user cap and the unverified-app interstitial for these scopes.

   If the project is outside the org, moving it in later (`gcloud beta projects move`, an Organization Administrator, non-destructive) restores the Internal option; switch the consent screen afterwards and nothing else changes.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.** (The client may live in a different project from the Cloud Run service — an org-resident project can issue an *Internal* client that an outside-the-org deployment then uses, which recovers the second gate without moving anything.)
   - Authorized JavaScript origins: the service URL from step 1.
   - Authorized redirect URIs: `<service-url>/api/google/oauth/callback` (required for the Workspace tools; sign-in itself uses the popup flow and needs none).
3. Copy the client ID and attach it:

```bash
gcloud run services update agent-canvas --project agent-canvas-ctg-0811 --region us-central1 \
  --update-env-vars GOOGLE_CLIENT_ID=<the-client-id>.apps.googleusercontent.com
```

## Step 3 — sign in and check access bootstrap

Open the service URL, sign in with a cloudtechgurus.com Google account. The allowlist is seeded with pete@ (owner), fred@, darren@, jessica@ — **if the real mailbox names differ, the owner fixes them in-app** (top bar → Admin → Allowlist) or pre-seeds via `OWNER_EMAIL` / `SEED_MEMBERS` env vars. Remaining domain users are added from the same Admin panel — no redeploy.

## P5 — wire the standing-rules scheduler

Standing Rules are not operational merely because the Rules screen is visible.
The server requires a dedicated OIDC caller, both tick environment variables,
and evidence that a scheduler-signed tick reached the app. A manual owner tick
is a recovery path and does not prove this lane.

For the existing production service, prepare the stable endpoint and dedicated
caller before the source deploy:

```bash
export PROJECT_ID=agent-canvas-ctg-0811
export REGION=us-central1
export SERVICE=agent-canvas
export TICK_JOB=agent-canvas-standing-rules

SERVICE_URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
export TICK_AUDIENCE="${SERVICE_URL}/api/standing-rules/tick"
export TICK_INVOKER_SA="agent-canvas-tick@${PROJECT_ID}.iam.gserviceaccount.com"

if ! gcloud iam service-accounts describe "$TICK_INVOKER_SA" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create agent-canvas-tick --project "$PROJECT_ID" --display-name="Agent Canvas standing-rules tick"
fi

gcloud run services add-iam-policy-binding "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --member="serviceAccount:${TICK_INVOKER_SA}" --role=roles/run.invoker
```

Export `TICK_AUDIENCE` and `TICK_INVOKER_SA` when running `deploy/deploy.sh` to
SET them the first time. Since 2026-08-16 the script updates the environment
**additively**, so a later redeploy that forgets them preserves the values
rather than dropping them and darkening the lane. After that deployment is
healthy, create or update the job:

```bash
if gcloud scheduler jobs describe "$TICK_JOB" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$TICK_JOB" --project "$PROJECT_ID" --location "$REGION" --schedule="*/10 * * * *" --time-zone="Etc/UTC" --uri="$TICK_AUDIENCE" --http-method=POST --oidc-service-account-email="$TICK_INVOKER_SA" --oidc-token-audience="$TICK_AUDIENCE"
else
  gcloud scheduler jobs create http "$TICK_JOB" --project "$PROJECT_ID" --location "$REGION" --schedule="*/10 * * * *" --time-zone="Etc/UTC" --uri="$TICK_AUDIENCE" --http-method=POST --oidc-service-account-email="$TICK_INVOKER_SA" --oidc-token-audience="$TICK_AUDIENCE"
fi
```

Acceptance requires all of the following: the Cloud Run revision contains the
two env **names**; the job is enabled; a scheduler execution returns success;
the Capabilities surface reports a recent scheduler-signed tick; and a due test
rule produces the expected run and attention card. Do not print secret values
while inspecting the revision. Pause the Scheduler job and switch off the
`standing_rules` setting for the fastest no-deploy rollback.

## Workspace tools (agents' hands — optional but recommended)

Agents can read and act in Google Workspace **as the person who directed the run** — per-user OAuth, no service-account key, no domain-wide delegation. The contract is read broadly / write reasonably / destroy never: search+read Gmail but only *draft* (send is never granted), read Drive/Docs but create-only (no edits/deletes), read+append+update Sheets (blanking writes refused server-side), read+create Calendar (no modify/cancel). The full matrix lives in the app under **Capabilities**, rendered from the same object the server enforces; `test/workspace-guardrails.test.js` proves the destructive operations are structurally absent.

Enable it:

1. On the OAuth client from step 2, add the redirect URI `<service-url>/api/google/oauth/callback` and note the client secret.
2. Redeploy with `GOOGLE_CLIENT_SECRET=<secret>` (stored in Secret Manager as `google-oauth-secret`), or attach it later:
   `gcloud run services update agent-canvas --project <project> --region us-central1 --update-secrets GOOGLE_CLIENT_SECRET=google-oauth-secret:latest` (after `printf '%s' '<secret>' | gcloud secrets create google-oauth-secret --data-file=-`).
3. The deploy enables the Workspace data APIs (gmail, drive, sheets, calendar) — three separate switches exist: per-project APIs (this), OAuth scopes (the user grant), and Model Garden (models). Missing any one fails differently.
4. Each user clicks **Capabilities → Connect Google Workspace** once and grants the six scopes (drive.readonly, drive.file, spreadsheets, gmail.readonly, gmail.compose, calendar.events).

Scope review note: gmail.readonly/compose and drive.readonly are *restricted* scopes. On an **Internal** consent screen (project inside the org) no Google verification is needed. On an External screen in Testing mode they work for up to 100 test users — add each member as a test user; that covers this team, but it is one more reason to move the project into the cloudtechgurus.com organization and flip to Internal.

## HubSpot (via the CTG Ops Runner — optional)

Agent Canvas does not hold any HubSpot credential. Agents are IAM-authenticated
clients of `ctg-hs-ops-runner` (project `ctg-hs-exec-tool`) — the estate's
policy-gated, sandbox-locked execution service (ADR-0041 Rev A). Reads are
free; changes are preview-first (`hs_preview_change` always dry-runs) and apply
only in a run resumed from a human-approved escalation. Destructive verbs are
refused client-side and policy-denied at the runner; the real customer portal
is unreachable by design (sandbox 246460341 portal guard).

Wire it: grant `roles/run.invoker` on the runner to the canvas service account,
then set `HS_OPS_RUNNER_URL` (the deploy checklist prints both commands). The
HUBSPOT lamp flips from dark to green, with a live `whoami` probe.

## MCP connectors (optional)

Agents can call tools on external Model Context Protocol servers (Streamable
HTTP). Configuration is owner-only, with **per-tool explicit enablement** —
a server offering fifty tools exposes exactly the ones you name:

```bash
gcloud run services update agent-canvas --project <project> --region us-central1 \
  --update-env-vars 'MCP_SERVERS=[{"name":"crm-intel","url":"https://mcp.example.com/mcp","authHeader":"Bearer <token>","enabledTools":["search_signals"]}]'
```

(or commit the same JSON as `config/mcp.json`). Each server gets its own lamp
on the systems board with a live handshake probe. Honesty note: unlike the
Google/HubSpot surfaces, we cannot make third-party tool semantics structurally
safe — the guardrails here are owner consent per tool, the directing-user
requirement, and the audit trail. Enable only servers you trust.

## Brand assets (optional, before building)

Copy the approved CTG mascot into the frontend so CUE appears on the sign-in card and the clear needs-you tray:

```bash
cp "<design-system>/assets/mascot-full.png" agent-canvas/frontend/public/mascot.png
```

The UI hides the slot when the file is absent, so skipping this never breaks a build.

## Operations notes

- **Models**: strong tier defaults to `claude-sonnet-5` (the workhorse), fast tier `claude-haiku-4-5` for routing/classification; frontier models (`claude-opus-5`, `claude-fable-5`) are deliberate opt-ins via `STRONG_MODEL` for canvases that need them. Costs — including web searches at $10/1k — are metered per run/agent/day inside the app; the daily budget (default $25, owner-adjustable in the UI) suspends new runs when reached. Research agents get server-side web search (disable with `ENABLE_WEB_SEARCH=0`); web-sourced memory entries must carry URL + retrieval-time provenance (enforced by the agent contract).
- **Authoritative audit record**: every audit entry is hash-chained in SQLite (the queryable index) *and* mirrored as structured JSON to stdout, which Cloud Run delivers to Cloud Logging — a store the application runtime cannot update or delete. For regulator-grade immutability, route these entries to a dedicated log bucket with a **locked** retention policy (locking is deliberately irreversible — run this only once you're sure of the retention window):

  ```bash
  gcloud logging buckets create audit-locked --location=us-central1 --retention-days=365 --project agent-canvas-ctg-0811
  gcloud logging sinks create agent-canvas-audit \
    logging.googleapis.com/projects/agent-canvas-ctg-0811/locations/us-central1/buckets/audit-locked \
    --project agent-canvas-ctg-0811 \
    --log-filter='resource.type="cloud_run_revision" jsonPayload.audit=true'
  # After validating entries arrive, lock it (IRREVERSIBLE):
  # gcloud logging buckets update audit-locked --location=us-central1 --locked --project agent-canvas-ctg-0811
  ```
- **Database durability**: SQLite on the instance disk, restored from `gs://agent-canvas-ctg-0811-db` on cold start and continuously replicated by Litestream. `--max-instances 1` is required (single writer). If the workspace ever outgrows this, the storage layer is isolated in `server/db.js` for a Cloud SQL migration.
- **Cleanup-release rollback boundary**: the workspace cleanup uses additive
  tombstone columns that pre-cleanup revisions do not filter. After the first
  cleanup revision migrates production, do **not** route traffic back to an
  older image: its Archived view can reveal retired artifacts. Take and verify
  the database backup before deployment and use a forward fix on the cleanup
  code line. The ledger remains recoverable; this is a reader-compatibility
  boundary, not physical deletion.
- **Auth model**: the Cloud Run service allows unauthenticated ingress, and the app itself enforces Google sign-in (`hd=cloudtechgurus.com` + email_verified + allowlist, re-checked on every request) with signed httpOnly session cookies. Roles: owner / member, enforced server-side.
- **Global pause**: any member can pause (kills in-flight model calls); only the owner can resume.
- **Export**: owner → top bar → Export downloads an operational-ledger JSON
  snapshot: canvases, agents, notes, tasks, file metadata, memory and lineage,
  runs/events, handoffs, escalations, audit, usage, and allowlist. Retired sheet
  rows and changesets/changes remain in the export as a historical ledger; they
  are not active product surfaces. It is **not a complete workspace backup**:
  among other
  things, product settings, memberships, inquiries, Rooms, Builder versions,
  Standing Rules, feedback/retrieval telemetry, and credentials are not in this
  export. Credentials and token material must remain excluded. See
  [ROADMAP.md](ROADMAP.md) for the P7 completeness decision.
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
- Model usage is dominated by agent runs and varies with provider, tier, tool calls, and document size. Use the in-app per-run spend and daily budget meter as the authoritative operating signal; do not estimate production cost from the retired sample workflow. The daily budget caps the blast radius.

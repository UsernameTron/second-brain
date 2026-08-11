#!/usr/bin/env bash
# One-command deploy of the Agent Canvas Workspace to Google Cloud Run, inside
# a NEW dedicated project in the cloudtechgurus.com organization.
#
# Prerequisites (run once, interactively, as a cloudtechgurus.com admin):
#   gcloud auth login                      # keyless user credentials — never a service-account key
#   gcloud auth application-default login  # ADC for local tools if needed
#   gcloud billing accounts list           # note the open billing account ID
#
# Required environment:
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX   # from `gcloud billing accounts list`
# Model provider (default: vertex — Claude on Vertex AI, inside the Google
# perimeter, keyless via the runtime service account; no model API key exists):
#   MODEL_PROVIDER=vertex|gemini|anthropic   (vertex = Claude on Vertex; gemini = Gemini on Vertex)
#   FAST_PROVIDER / STRONG_PROVIDER          # optional per-tier override for mixed fleets
#   ANTHROPIC_API_KEY=sk-ant-...           # required ONLY when MODEL_PROVIDER=anthropic
# Optional:
#   GOOGLE_CLIENT_ID=....apps.googleusercontent.com   # OAuth web client (see step 2 of docs/DEPLOY.md);
#                                                      # can be added later with a `gcloud run services update`
#   PROJECT_ID (default agent-canvas-ctg), REGION (default us-central1), OWNER_EMAIL
#
# Everything here is idempotent: re-running updates in place.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-agent-canvas-ctg}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-agent-canvas}"
OWNER_EMAIL="${OWNER_EMAIL:-pete@cloudtechgurus.com}"
BUCKET="gs://${PROJECT_ID}-db"
REPO="app"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:latest"
SA_NAME="agent-canvas-run"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

MODEL_PROVIDER="${MODEL_PROVIDER:-vertex}"
case "${MODEL_PROVIDER}" in vertex|gemini|anthropic) ;; *) echo "MODEL_PROVIDER must be vertex|gemini|anthropic" >&2; exit 1;; esac
VERTEX_REGION="${VERTEX_REGION:-global}"
if [ "${MODEL_PROVIDER}" = "anthropic" ]; then
  : "${ANTHROPIC_API_KEY:?MODEL_PROVIDER=anthropic requires ANTHROPIC_API_KEY (console.anthropic.com)}"
fi

# gcloud must never stop to ask a question mid-deploy, and it must never bill
# API quota to a stale project the caller cannot access. A leftover quota
# project in the caller's config or ADC is what produces the
# "API [cloudbilling.googleapis.com] not enabled on project <numeric id>.
# Would you like to enable and retry?" prompt that hangs an unattended run on a
# project the caller has no rights to. Pin quota to the project we are building.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1
export CLOUDSDK_BILLING_QUOTA_PROJECT="${PROJECT_ID}"

ACTIVE_ACCOUNT="$(gcloud config get-value account 2>/dev/null || echo unknown)"
echo "==> Authenticated as ${ACTIVE_ACCOUNT}"

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Deploying ${APP_DIR} to project ${PROJECT_ID} (${REGION})"

# 1. Dedicated project inside the cloudtechgurus.com organization.
# An organization is preferred (the project lands under cloudtechgurus.com
# governance) but is not required: a Workspace domain only has a Cloud
# organization once someone sets Cloud up for it. Without one, create a
# standalone project so the deploy still works.
ORG_ID="${ORG_ID:-$(gcloud organizations list --format='value(ID)' --filter='displayName=cloudtechgurus.com' 2>/dev/null | head -1)}"
if ! gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
  if [ -n "${ORG_ID}" ]; then
    gcloud projects create "${PROJECT_ID}" --organization="${ORG_ID}" --name="Agent Canvas Workspace"
  else
    echo "!! No cloudtechgurus.com Cloud organization visible to this account."
    echo "   Creating a standalone project instead. To place it under the org later,"
    echo "   an Organization Administrator can move it (gcloud beta projects move)."
    gcloud projects create "${PROJECT_ID}" --name="Agent Canvas Workspace"
  fi
fi
# Bootstrap APIs, before anything that depends on them. Cloud Resource Manager
# backs every `gcloud projects add-iam-policy-binding` call -- step 5 uses one to
# grant the runtime service account Vertex AI access -- and Service Usage backs
# every `services enable`. Neither is reliably on in a brand-new project, and a
# missing Resource Manager API does not fail here: it fails much later, as an
# opaque SERVICE_DISABLED on the IAM binding, after the image has already built.
for api in cloudresourcemanager.googleapis.com serviceusage.googleapis.com cloudbilling.googleapis.com; do
  gcloud services enable "${api}" --project "${PROJECT_ID}" >/dev/null 2>&1 || true
done

# Billing. Already-linked is the common case on a re-run, and it needs no
# BILLING_ACCOUNT at all, so check before asking for one.
CURRENT_BILLING="$(gcloud beta billing projects describe "${PROJECT_ID}" \
  --format='value(billingAccountName)' 2>/dev/null | sed 's|billingAccounts/||' || true)"
if [ -n "${CURRENT_BILLING}" ]; then
  echo "==> Billing already linked (${CURRENT_BILLING})."
else
  # Resolve the account: explicit wins; otherwise auto-select only when the
  # choice is unambiguous. Guessing which account to spend from is not ours.
  if [ -z "${BILLING_ACCOUNT:-}" ]; then
    OPEN_ACCOUNTS="$(gcloud billing accounts list --filter='open=true' \
      --format='value(name)' 2>/dev/null | sed 's|billingAccounts/||' | grep '[^[:space:]]' || true)"
    OPEN_COUNT="$(printf '%s\n' "${OPEN_ACCOUNTS}" | grep -c '[^[:space:]]' || true)"
    if [ "${OPEN_COUNT}" = "1" ]; then
      BILLING_ACCOUNT="$(printf '%s' "${OPEN_ACCOUNTS}" | tr -d '[:space:]')"
      echo "==> Using the only open billing account visible to ${ACTIVE_ACCOUNT}: ${BILLING_ACCOUNT}"
    else
      echo "!! Set BILLING_ACCOUNT -- ${ACTIVE_ACCOUNT} can see ${OPEN_COUNT} open billing accounts:" >&2
      printf '%s\n' "${OPEN_ACCOUNTS}" >&2
      exit 1
    fi
  fi
  if ! gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}" >/dev/null 2>&1; then
    echo "!! Could not link billing from the CLI." >&2
    echo "   Linking needs two permissions held by two different resources:" >&2
    echo "     - on the project ${PROJECT_ID}: resourcemanager.projects.createBillingAssignment" >&2
    echo "     - on the billing account ${BILLING_ACCOUNT}: billing.resourceAssociations.create" >&2
    echo "   If one identity does not hold both, link it in the browser (2 clicks) and re-run:" >&2
    echo "   https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT_ID}" >&2
    exit 1
  fi
  echo "==> Billing linked."
fi

# 2. APIs.
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com iam.googleapis.com aiplatform.googleapis.com \
  cloudresourcemanager.googleapis.com --project "${PROJECT_ID}"

# 3. Artifact Registry + database bucket.
gcloud artifacts repositories describe "${REPO}" --location="${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "${REPO}" --repository-format=docker --location="${REGION}" --project "${PROJECT_ID}"
gcloud storage buckets describe "${BUCKET}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud storage buckets create "${BUCKET}" --project "${PROJECT_ID}" --location="${REGION}" --uniform-bucket-level-access

# 4. Secrets (Anthropic key + JWT signing secret).
create_or_update_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "${name}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    printf '%s' "${value}" | gcloud secrets versions add "${name}" --project "${PROJECT_ID}" --data-file=-
  else
    printf '%s' "${value}" | gcloud secrets create "${name}" --project "${PROJECT_ID}" --data-file=-
  fi
}
if [ "${MODEL_PROVIDER}" = "anthropic" ]; then
  create_or_update_secret anthropic-api-key "${ANTHROPIC_API_KEY}"
fi
gcloud secrets describe jwt-secret --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  create_or_update_secret jwt-secret "$(head -c 32 /dev/urandom | xxd -p -c 64)"
# Workspace OAuth client secret (enables the agents' Google Workspace tools;
# optional — without it the app runs with canvas-only capabilities).
if [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  create_or_update_secret google-oauth-secret "${GOOGLE_CLIENT_SECRET}"
fi

# 5. Runtime service account (least privilege: bucket objects + the two secrets).
gcloud iam service-accounts describe "${SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${SA_NAME}" --project "${PROJECT_ID}" --display-name="Agent Canvas Cloud Run"
gcloud storage buckets add-iam-policy-binding "${BUCKET}" --member="serviceAccount:${SA_EMAIL}" --role=roles/storage.objectAdmin >/dev/null
SECRETS_TO_GRANT="jwt-secret"
if [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then SECRETS_TO_GRANT="${SECRETS_TO_GRANT} google-oauth-secret"; fi
if [ "${MODEL_PROVIDER}" = "anthropic" ]; then SECRETS_TO_GRANT="anthropic-api-key jwt-secret"; fi
for secret in ${SECRETS_TO_GRANT}; do
  gcloud secrets add-iam-policy-binding "${secret}" --project "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" --role=roles/secretmanager.secretAccessor >/dev/null
done
# Vertex modes (claude-on-vertex or gemini): the runtime service account calls
# Vertex AI directly — keyless, no model API key anywhere in the system.
if [ "${MODEL_PROVIDER}" != "anthropic" ]; then
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" --role=roles/aiplatform.user >/dev/null
fi

# 6. Build the image with Cloud Build (no local docker needed).
# Projects created recently do not get the legacy Cloud Build service account
# (PROJECT_NUMBER@cloudbuild.gserviceaccount.com), and they only have a Compute
# Engine default service account if the Compute API happens to be on. When
# neither exists, `builds submit` fails with a bare "PERMISSION_DENIED: The
# caller does not have permission" that names no principal and misleadingly
# implicates the human caller, who is usually a project Owner. Rather than
# depend on whichever default a given project happens to have, build as a
# service account we create and grant explicitly.
BUILD_SA_NAME="agent-canvas-build"
BUILD_SA_EMAIL="${BUILD_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "${BUILD_SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${BUILD_SA_NAME}" --project "${PROJECT_ID}" --display-name="Agent Canvas Cloud Build"
# builds.builder bundles what a build needs: write logs, pull/push Artifact
# Registry, read the source bucket.
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" --role=roles/cloudbuild.builds.builder >/dev/null

submit_build() {
  # --config, not --tag: the build must run under cloudbuild.yaml so BuildKit is
  # on (the Dockerfile's optional build_ca secret mount is BuildKit-only syntax).
  # A user-specified build service account also requires an explicit bucket
  # policy; without it Cloud Build refuses to write logs to a Google-owned bucket.
  gcloud builds submit "${APP_DIR}" --project "${PROJECT_ID}" \
    --config "${APP_DIR}/cloudbuild.yaml" --substitutions=_IMAGE="${IMAGE}" \
    --service-account="projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA_EMAIL}" \
    --default-buckets-behavior=regional-user-owned-bucket
}

# Enabling cloudbuild.googleapis.com provisions a service agent asynchronously,
# so the first submit after a fresh enable can lose a race it will win a minute
# later. Retry before concluding anything is actually wrong.
BUILD_OK=0
for attempt in 1 2 3; do
  if submit_build; then BUILD_OK=1; break; fi
  if [ "${attempt}" -lt 3 ]; then
    echo "==> Build attempt ${attempt} failed; waiting 45s for API/service-agent propagation and retrying." >&2
    sleep 45
  fi
done
if [ "${BUILD_OK}" -ne 1 ]; then
  # Older gcloud releases do not know --service-account/--default-buckets-behavior
  # on `builds submit`. Fall back to project defaults before giving up, so an
  # out-of-date CLI is not mistaken for a permissions problem.
  echo "==> Retrying the build with project default service accounts." >&2
  gcloud builds submit "${APP_DIR}" --project "${PROJECT_ID}" \
    --config "${APP_DIR}/cloudbuild.yaml" --substitutions=_IMAGE="${IMAGE}"
fi

# 7. Deploy. max-instances=1 because SQLite is single-writer (Litestream replicates
#    to the bucket; a cold start restores it). The app enforces sign-in itself, so
#    the service is publicly reachable but every API call requires an allowlisted
#    cloudtechgurus.com Google account.
ENV_VARS="NODE_ENV=production,OWNER_EMAIL=${OWNER_EMAIL},LITESTREAM_REPLICA_URL=gcs://${PROJECT_ID}-db/agent-canvas,MODEL_PROVIDER=${MODEL_PROVIDER}"
if [ "${MODEL_PROVIDER}" != "anthropic" ]; then
  ENV_VARS="${ENV_VARS},VERTEX_PROJECT_ID=${PROJECT_ID},VERTEX_REGION=${VERTEX_REGION}"
  if [ -n "${FAST_PROVIDER:-}" ]; then ENV_VARS="${ENV_VARS},FAST_PROVIDER=${FAST_PROVIDER}"; fi
  if [ -n "${STRONG_PROVIDER:-}" ]; then ENV_VARS="${ENV_VARS},STRONG_PROVIDER=${STRONG_PROVIDER}"; fi
  SECRET_FLAGS="--set-secrets JWT_SECRET=jwt-secret:latest"
else
  SECRET_FLAGS="--set-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest,JWT_SECRET=jwt-secret:latest"
fi
if [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  SECRET_FLAGS="${SECRET_FLAGS},GOOGLE_CLIENT_SECRET=google-oauth-secret:latest"
fi
if [ -n "${GOOGLE_CLIENT_ID:-}" ]; then ENV_VARS="${ENV_VARS},GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"; fi
# HubSpot Ops Runner (optional): agents become IAM-authenticated clients of the
# policy-gated sandbox runner. No HubSpot credential enters this service.
if [ -n "${HS_OPS_RUNNER_URL:-}" ]; then ENV_VARS="${ENV_VARS},HS_OPS_RUNNER_URL=${HS_OPS_RUNNER_URL}"; fi
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --service-account "${SA_EMAIL}" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 1 \
  --memory 1Gi --cpu 1 \
  --set-env-vars "${ENV_VARS}" \
  ${SECRET_FLAGS}

URL="$(gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"
# Cloud Run issues TWO hostnames for one service: the deterministic
# service-projectnumber.region.run.app form and a legacy service-hash-code.a.run.app
# form. `status.url` reports only one, and which one differs by service age. OAuth
# origins must match the browsed host character for character, so a deploy that
# advertises one hostname while the console hands the user the other produces a
# silent origin mismatch at sign-in. Compute both; register both.
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)' 2>/dev/null || echo '')"
URL_ALT=""
if [ -n "${PROJECT_NUMBER}" ]; then
  CANDIDATE="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
  if [ "${CANDIDATE}" != "${URL}" ]; then URL_ALT="${CANDIDATE}"; fi
fi
ACCOUNT_Q="$(printf '%s' "${ACTIVE_ACCOUNT}" | sed 's/@/%40/')"

echo
echo "============================================================"
echo "  DEPLOYED: ${URL}"
if [ -n "${URL_ALT}" ]; then echo "       ALSO: ${URL_ALT}"; echo "             (same service, second hostname — both work)"; fi
echo "  model provider: ${MODEL_PROVIDER}"
echo "============================================================"
echo

# Everything below needs a browser, so print it as an ordered checklist with
# the URLs already filled in. Hunting for the right console page across five
# tabs is where a deploy actually loses its afternoon.
STEP=1
if [ "${MODEL_PROVIDER}" = "vertex" ]; then
  echo "STEP ${STEP} — enable the Claude models (one-time, ~2 min)"
  echo "  https://console.cloud.google.com/vertex-ai/model-garden?project=${PROJECT_ID}&authuser=${ACCOUNT_Q}"
  echo "  Search 'Claude' -> Enable: claude-sonnet-5, claude-haiku-4-5, claude-opus-4-8."
  echo "  Until this is done every agent run fails with 403/404 and the MODEL lamp stays red."
  echo
  STEP=$((STEP + 1))
fi

if [ -z "${GOOGLE_CLIENT_ID:-}" ]; then
  echo "STEP ${STEP} — OAuth consent screen (required before anyone can sign in)"
  echo "  https://console.cloud.google.com/apis/credentials/consent?project=${PROJECT_ID}&authuser=${ACCOUNT_Q}"
  echo "  App name 'Agent Canvas', support email ${OWNER_EMAIL}."
  echo "  If 'Internal' is greyed out, this project is outside the Workspace org — choose"
  echo "  External, and ADD EVERY TEAM MEMBER AS A TEST USER. In Testing mode a person who"
  echo "  is not a listed test user cannot sign in at all, whatever the app allowlist says."
  echo
  STEP=$((STEP + 1))
  echo "STEP ${STEP} — OAuth client (Web application)"
  echo "  https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}&authuser=${ACCOUNT_Q}"
  echo "  Authorized JavaScript origins — ADD BOTH (same service, two hostnames):"
  echo "      ${URL}"
  if [ -n "${URL_ALT}" ]; then echo "      ${URL_ALT}"; fi
  echo "  Authorized redirect URIs — ADD BOTH:"
  echo "      ${URL}/api/google/oauth/callback"
  if [ -n "${URL_ALT}" ]; then echo "      ${URL_ALT}/api/google/oauth/callback"; fi
  echo "  Registering one and browsing to the other fails sign-in with an origin"
  echo "  mismatch and no useful error. Adding both costs nothing."
  echo "  Copy the client ID and the client secret, then run STEP $((STEP + 1))."
  echo
  STEP=$((STEP + 1))
  echo "STEP ${STEP} — attach the credentials (copy-paste, fill in the two values)"
  echo
  echo "    CLIENT_ID=<paste>.apps.googleusercontent.com"
  echo "    CLIENT_SECRET=<paste>"
  echo
  echo "    printf '%s' \"\${CLIENT_SECRET}\" | gcloud secrets create google-oauth-secret \\"
  echo "      --project ${PROJECT_ID} --data-file=- 2>/dev/null \\"
  echo "      || printf '%s' \"\${CLIENT_SECRET}\" | gcloud secrets versions add google-oauth-secret \\"
  echo "      --project ${PROJECT_ID} --data-file=-"
  echo
  echo "    gcloud secrets add-iam-policy-binding google-oauth-secret --project ${PROJECT_ID} \\"
  echo "      --member=serviceAccount:${SA_EMAIL} --role=roles/secretmanager.secretAccessor"
  echo
  echo "    gcloud run services update ${SERVICE} --project ${PROJECT_ID} --region ${REGION} \\"
  echo "      --update-env-vars GOOGLE_CLIENT_ID=\"\${CLIENT_ID}\" \\"
  echo "      --update-secrets GOOGLE_CLIENT_SECRET=google-oauth-secret:latest"
  echo
  STEP=$((STEP + 1))
else
  echo "STEP ${STEP} — confirm the OAuth client lists ALL of these (sign-in fails silently otherwise):"
  echo "  Origins:   ${URL}${URL_ALT:+   ${URL_ALT}}"
  echo "  Redirects: ${URL}/api/google/oauth/callback${URL_ALT:+   ${URL_ALT}/api/google/oauth/callback}"
  echo
  STEP=$((STEP + 1))
fi

echo "STEP ${STEP} — OPTIONAL: light the HUBSPOT lamp (Ops Runner client)"
echo "  The canvas talks to ctg-hs-ops-runner via Cloud Run IAM — no HubSpot key here."
echo "  a) Grant the canvas permission to call the runner (you own ctg-hs-exec-tool):"
echo "     gcloud run services add-iam-policy-binding ctg-hs-ops-runner \\"
echo "       --project ctg-hs-exec-tool --region us-central1 \\"
echo "       --member serviceAccount:${SA_EMAIL} --role roles/run.invoker"
echo "  b) Re-run this deploy with HS_OPS_RUNNER_URL=\$(gcloud run services describe \\"
echo "       ctg-hs-ops-runner --region us-central1 --project ctg-hs-exec-tool \\"
echo "       --format='value(status.url)'), or attach it directly:"
echo "     gcloud run services update ${SERVICE} --project ${PROJECT_ID} --region ${REGION} \\"
echo "       --update-env-vars HS_OPS_RUNNER_URL=<runner-url>"
echo
STEP=$((STEP + 1))
echo "STEP ${STEP} — go live"
echo "  1. Open ${URL} and sign in as ${OWNER_EMAIL}."
if [ -n "${URL_ALT}" ]; then echo "     (or ${URL_ALT} — both reach the same service)"; fi
echo "  2. Open Capabilities. Every lamp should be green except HUBSPOT and MCP,"
echo "     which are dark by design (not wired yet)."
echo "  3. Click 'Connect Google Workspace' and grant the six scopes."
echo "  4. CHECK THE ALLOWLIST before inviting anyone: top-bar avatar -> Admin."
echo "     It is seeded with first-name@ addresses (fred@, darren@, jessica@)."
echo "     If a real mailbox differs, fix it there or that person cannot sign in."
echo "  5. Probe one agent: command bar -> \"have Scout confirm the model connection\""
echo "     works with one short memory entry\". A completed run proves the model path."
echo
echo "Deployment is idempotent: re-run this script any time to repair or update."
